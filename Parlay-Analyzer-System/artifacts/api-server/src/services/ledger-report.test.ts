import { test } from "node:test";
import assert from "node:assert/strict";
import { buildLedgerReport } from "./ledger-report";

/**
 * Klien tiruan minimal untuk `buildLedgerReport`:
 *  - head-count (`select(..., {count, head})` + filter `not`/`eq`) → `{count, error}`
 *  - tarikan baris (`.order().range(a, b)`) → `Promise<{data, error}>` — range
 *    inklusif seperti PostgREST, sehingga paginasi bisa diuji sungguhan.
 * Filter dicatat dengan nama kolom supaya empat count bisa dibedakan.
 */
function fakeClient(opts: {
  counts?: { total?: number; withOutcome?: number; withClosingOdds?: number; wasBet?: number };
  rows?: Record<string, unknown>[];
  rangeError?: { message: string } | null;
}) {
  return {
    from(table: string) {
      const filters: string[] = [];
      const builder: any = {
        select() {
          return builder;
        },
        not(col: string) {
          filters.push(`not:${col}`);
          return builder;
        },
        eq(col: string) {
          filters.push(`eq:${col}`);
          return builder;
        },
        order() {
          return builder;
        },
        range(from: number, to: number) {
          if (opts.rangeError) {
            return Promise.resolve({ data: null, error: opts.rangeError });
          }
          const rows = opts.rows ?? [];
          return Promise.resolve({ data: rows.slice(from, to + 1), error: null });
        },
        then(resolve: (v: unknown) => void) {
          const c = opts.counts ?? {};
          let count = 0;
          if (table === "prediction_selections") {
            if (filters.includes("not:outcome")) count = c.withOutcome ?? 0;
            else if (filters.includes("not:odds_close")) count = c.withClosingOdds ?? 0;
            else if (filters.includes("eq:was_bet")) count = c.wasBet ?? 0;
            else count = c.total ?? 0;
          }
          resolve({ count, error: null });
        },
      };
      return builder;
    },
  } as never;
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    p_final: 0.5,
    p_market_fair: 0.5,
    p_model_only: 0.5,
    odds: 2.0,
    odds_close: null,
    close_fair_prob: null,
    outcome: null,
    was_bet: false,
    ...overrides,
  };
}

test("kalibrasi dihitung atas SEMUA baris, ROI hanya dari was_bet", async () => {
  /* Enam baris dengan nilai yang bisa dihitung tangan:
   *  p_final 0.6 (3 baris: 2 menang, 1 kalah) dan 0.4 (3 baris: 2 kalah, 1 menang)
   *  → brierModel = 1.36/6, brierMarket(pasar 0.55/0.45) = 1.415/6
   *  bin "60–70%": meanP 0.6 vs observed 2/3; bin "40–50%": 0.4 vs 1/3
   *  → ECE = ½·|0.6−⅔| + ½·|0.4−⅓| = 1/15 ≈ 0.0667 */
  const rows = [
    row({ p_final: 0.6, p_market_fair: 0.55, outcome: "win", odds_close: 1.9, was_bet: true }),
    row({ p_final: 0.6, p_market_fair: 0.55, outcome: "win", odds_close: 2.1, was_bet: true }),
    row({ p_final: 0.6, p_market_fair: 0.55, outcome: "loss", odds_close: 2.0 }),
    row({ p_final: 0.4, p_market_fair: 0.45, outcome: "loss", odds_close: 1.9 }),
    row({ p_final: 0.4, p_market_fair: 0.45, outcome: "loss", odds_close: 2.1 }),
    row({ p_final: 0.4, p_market_fair: 0.45, outcome: "win", odds_close: 2.0 }),
  ];
  const report = await buildLedgerReport({
    supabase: fakeClient({
      counts: { total: 6, withOutcome: 6, withClosingOdds: 6, wasBet: 2 },
      rows,
    }),
  });

  assert.deepEqual(report.counts, { total: 6, withOutcome: 6, withClosingOdds: 6, wasBet: 2 });

  /* (a) semua baris — kalibrasi saja, tanpa ROI/vonis */
  assert.ok(report.all, "blok all harus ada selama ledger berisi baris");
  assert.equal(report.all!.scores?.n, 6);
  assert.ok(
    Math.abs(report.all!.scores!.brierModel - 1.36 / 6) < 1e-9,
    `brierModel = 1.36/6, dapat ${report.all!.scores!.brierModel}`,
  );
  assert.ok(Math.abs(report.all!.scores!.brierMarket! - 1.415 / 6) < 1e-9);
  assert.ok(
    Math.abs(report.all!.brierSkill! - (1 - 1.36 / 1.415)) < 1e-9,
    "brierSkill = 1 − brierModel/brierMarket",
  );
  assert.equal(report.all!.calibration.length, 2);
  assert.ok(
    Math.abs(report.all!.ece! - 1 / 15) < 1e-6,
    `ece = 1/15 ≈ 0.0667, dapat ${report.all!.ece}`,
  );
  assert.ok(report.all!.clv, "clv harus terhitung karena odds_close terisi");
  assert.equal(report.all!.clv!.n, 6);
  /* ROI/vonis TIDAK boleh bocor dari himpunan semua baris */
  assert.ok(!("roi" in report.all!), "ROI semua baris sengaja tidak diekspos");
  assert.ok(!("verdict" in report.all!), "vonis semua baris sengaja tidak diekspos");

  /* (b) baris was_bet saja — ROI + vonis yang jujur */
  assert.ok(report.bets, "blok bets harus ada karena ada was_bet");
  assert.equal(report.bets!.n, 2);
  assert.equal(report.bets!.nSettled, 2);
  /* Dua win @2.0 → profit +2 atas staked 2 → ROI 100% */
  assert.ok(Math.abs(report.bets!.roi! - 1) < 1e-9);
  assert.equal(report.bets!.hitRate, 1);
  assert.equal(report.bets!.verdict.level, "insufficient");
  assert.ok(report.bets!.verdict.reasons.length > 0);
  assert.ok(!("scores" in report.bets!), "skor kalibrasi tidak diulang di blok bets");
});

test("ledger kosong: semua/bets null + catatan bahwa prediksi tidak berjalan", async () => {
  const report = await buildLedgerReport({
    supabase: fakeClient({ counts: { total: 0 }, rows: [] }),
  });
  assert.equal(report.counts.total, 0);
  assert.equal(report.all, null);
  assert.equal(report.bets, null);
  assert.ok(
    report.notes.some((n) => n.includes("masih kosong")),
    "harus menjelaskan ledger kosong",
  );
  assert.ok(
    report.notes.some((n) => n.includes("prediksi")),
    "harus menyebut prediksi sebagai penyebab",
  );
});

test("baris ada tanpa was_bet: all terisi, bets null + catatan jujur", async () => {
  const rows = [
    row({ p_final: 0.6, outcome: "win" }),
    row({ p_final: 0.6, outcome: "win" }),
    row({ p_final: 0.4, outcome: "loss" }),
    row({ p_final: 0.4, outcome: "loss" }),
  ];
  const report = await buildLedgerReport({
    supabase: fakeClient({
      counts: { total: 4, withOutcome: 4, withClosingOdds: 0, wasBet: 0 },
      rows,
    }),
  });
  assert.ok(report.all, "baris ada → blok all ada");
  assert.equal(report.all!.scores, null, "n=4 < 5 → scores masih null");
  assert.equal(report.bets, null);
  assert.ok(report.notes.some((n) => n.includes("was_bet")));
  assert.ok(report.notes.some((n) => n.includes("odds_close")));
});

test("tanpa Supabase mengembalikan laporan kosong, bukan melempar", async () => {
  const report = await buildLedgerReport({ supabase: null as never });
  assert.equal(report.counts.total, 0);
  assert.equal(report.all, null);
  assert.equal(report.bets, null);
  assert.ok(report.notes.some((n) => n.includes("Supabase tidak tersedia")));
});

test("kegagalan tarik baris menjadi catatan, bukan exception", async () => {
  const report = await buildLedgerReport({
    supabase: fakeClient({
      counts: { total: 10, withOutcome: 0, withClosingOdds: 0, wasBet: 0 },
      rangeError: { message: "boom" },
    }),
  });
  assert.equal(report.counts.total, 10, "head-count tetap jalan walau tarikan gagal");
  assert.equal(report.all, null);
  assert.equal(report.bets, null);
  assert.ok(report.notes.some((n) => n.includes("Gagal membaca baris ledger: boom")));
});

test("paginasi menarik lebih dari satu halaman tanpa catatan truncation", async () => {
  /* 1050 baris > PAGE_SIZE 1000 → dua panggilan range; scores.n harus 1050. */
  const rows = Array.from({ length: 1050 }, () =>
    row({ p_final: 0.5, p_market_fair: null, outcome: "win" }),
  );
  const report = await buildLedgerReport({
    supabase: fakeClient({
      counts: { total: 1050, withOutcome: 1050, withClosingOdds: 0, wasBet: 0 },
      rows,
    }),
  });
  assert.equal(report.all!.scores!.n, 1050, "semua halaman harus terambil");
  assert.ok(!report.notes.some((n) => n.includes("Menganalisis")), "tidak boleh klaim truncation");
  /* p = 0.5 semua menang → bin tunggal "50–60%", observed 1 → ECE = |0.5−1| */
  assert.ok(Math.abs(report.all!.ece! - 0.5) < 1e-9);
});
