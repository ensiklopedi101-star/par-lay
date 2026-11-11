import { test } from "node:test";
import assert from "node:assert/strict";
import {
  runAutoAnalysis,
  findFixturesAwaitingAnalysis,
  DEFAULT_BUDGET_MS,
  ESTIMATED_MS_PER_FIXTURE,
} from "./auto-analysis";

interface FakeState {
  /** Fixture akan datang. */
  upcoming?: Array<{ fixture_id: number; home_team_name: string; away_team_name: string; league_name: string; fixture_date: string }>;
  /** fixture_id yang sudah punya prediksi dengan market terpilih. */
  analysed?: number[];
  /** fixture_id yang punya harga. */
  priced?: number[];
}

/**
 * Klien tiruan untuk rantai kueri yang dipakai `findFixturesAwaitingAnalysis`.
 */
function fakeClient(state: FakeState) {
  const upcoming = state.upcoming ?? [];
  const analysed = new Set(state.analysed ?? []);
  const priced = new Set(state.priced ?? []);

  return {
    from(table: string) {
      const filters: string[] = [];
      const builder: any = {
        select() {
          return builder;
        },
        gt() {
          filters.push("gt");
          return builder;
        },
        lte() {
          filters.push("lte");
          return builder;
        },
        in() {
          filters.push("in");
          return builder;
        },
        order() {
          return builder;
        },
        limit(n: number) {
          if (table === "fixtures") return Promise.resolve({ data: upcoming.slice(0, n), error: null });
          if (table === "odds_history") {
            return Promise.resolve({
              data: [...priced].map((id) => ({ match_id: String(id) })),
              error: null,
            });
          }
          return Promise.resolve({ data: [], error: null });
        },
        then(resolve: (v: unknown) => void) {
          if (table === "ai_predictions") {
            resolve({
              data: [...analysed].map((id) => ({
                fixture_id: id,
                status: "active",
                market_bet: "Over 2.5",
                best_market: "over_2.5",
                best_odds: 1.9,
              })),
              error: null,
            });
            return;
          }
          resolve({ data: [], error: null });
        },
      };
      return builder;
    },
  } as any;
}

const fixture = (id: number) => ({
  fixture_id: id,
  home_team_name: `home-${id}`,
  away_team_name: `away-${id}`,
  league_name: "england-premier-league",
  fixture_date: new Date(Date.now() + 24 * 3600_000).toISOString(),
});

test("hanya fixture yang belum dianalisis DAN punya harga yang dipilih", async () => {
  const client = fakeClient({
    upcoming: [fixture(1), fixture(2), fixture(3), fixture(4)],
    analysed: [2],
    priced: [1, 2, 4],
  });

  const { fixtures, withOdds, withoutOdds } = await findFixturesAwaitingAnalysis({ client });

  assert.deepEqual(fixtures.map((f) => f.fixture_id), [1, 4]);
  assert.equal(withOdds, 2);
  assert.equal(withoutOdds, 1, "fixture 3 punya harga? tidak — dilewati");
});

test("fixture tanpa harga dilewati agar tidak menghasilkan NO BET palsu", async () => {
  const client = fakeClient({
    upcoming: [fixture(1), fixture(2)],
    priced: [1],
  });

  const { fixtures, withoutOdds } = await findFixturesAwaitingAnalysis({ client });

  assert.equal(fixtures.length, 1);
  assert.equal(withoutOdds, 1);
});

test("tidak ada fixture akan datang: laporan jujur, bukan error", async () => {
  const summary = await runAutoAnalysis({ client: fakeClient({ upcoming: [] }) });

  assert.equal(summary.candidates, 0);
  assert.equal(summary.analysed, 0);
  assert.ok(summary.notes.some((n) => n.includes("Tidak ada fixture akan datang")));
});

test("berhenti SEBELUM memulai fixture yang tidak akan selesai dalam anggaran", async () => {
  const client = fakeClient({
    upcoming: [fixture(1), fixture(2), fixture(3), fixture(4), fixture(5)],
    priced: [1, 2, 3, 4, 5],
  });

  let calls = 0;
  const summary = await runAutoAnalysis({
    client,
    /* Anggaran cukup untuk kurang-lebih dua fixture. Estimasi per fixture
     * dikecilkan agar kasusnya teruji cepat; waktu nyatanya tetap diukur dari
     * jam dinding, jadi analisis tiruan memang harus memakan waktu. */
    budgetMs: 900,
    estimatedMsPerFixture: 300,
    analyse: async () => {
      calls++;
      await new Promise((resolve) => setTimeout(resolve, 300));
      return {};
    },
  });

  assert.equal(summary.analysed, 2, "dua fixture selesai, bukan dipotong di tengah");
  assert.equal(calls, 2);
  assert.equal(summary.stoppedByBudget, true);
  assert.equal(summary.skippedForTime, 3);
  assert.ok(
    summary.notes.some((n) => n.includes("ditunda ke putaran berikutnya")),
    "sisa pekerjaan harus dinyatakan tertunda, bukan hilang",
  );
});

test("kegagalan satu fixture tidak menghentikan yang lain", async () => {
  const client = fakeClient({
    upcoming: [fixture(1), fixture(2), fixture(3)],
    priced: [1, 2, 3],
  });

  const summary = await runAutoAnalysis({
    client,
    budgetMs: 120_000,
    analyse: async (id) => {
      if (id === "2") throw new Error("model menolak");
      return {};
    },
  });

  assert.equal(summary.analysed, 2);
  assert.equal(summary.failed, 1);
  assert.ok(summary.notes.some((n) => n.includes("gagal dianalisis")));
});

test("semua selesai dalam anggaran: dinyatakan selesai, bukan terpotong", async () => {
  const client = fakeClient({ upcoming: [fixture(1), fixture(2)], priced: [1, 2] });

  const summary = await runAutoAnalysis({
    client,
    budgetMs: 120_000,
    analyse: async () => ({}),
  });

  assert.equal(summary.analysed, 2);
  assert.equal(summary.stoppedByBudget, false);
  assert.ok(summary.notes.some((n) => n.includes("selesai dikerjakan")));
});

test("sisa pekerjaan dihitung dari yang punya harga, bukan semua kandidat", async () => {
  const client = fakeClient({
    upcoming: [fixture(1), fixture(2), fixture(3)],
    priced: [1, 2],
  });

  const summary = await runAutoAnalysis({
    client,
    budgetMs: 10_000,
    analyse: async () => ({}),
  });

  /* 2 punya harga, 0 dikerjakan karena anggaran tidak cukup untuk satu pun. */
  assert.equal(summary.remaining, 2);
  assert.equal(summary.analysed, 0);
});

test("anggaran bawaan menyisakan ruang di bawah batas 60 detik Vercel", () => {
  assert.ok(DEFAULT_BUDGET_MS < 60_000, "harus berhenti sebelum diputus platform");
  assert.ok(DEFAULT_BUDGET_MS + ESTIMATED_MS_PER_FIXTURE > 45_000, "tapi cukup untuk satu fixture");
});

test("supabase tidak tersedia: laporan kosong, bukan lemparan", async () => {
  const summary = await runAutoAnalysis({ client: null as any, analyse: async () => ({}) });

  assert.equal(summary.candidates, 0);
  assert.equal(summary.analysed, 0);
});
