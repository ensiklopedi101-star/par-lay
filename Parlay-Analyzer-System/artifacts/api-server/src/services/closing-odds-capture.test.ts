import { test } from "node:test";
import assert from "node:assert/strict";
import { runClosingOddsCapture, runOutcomeSettlement } from "./closing-odds-capture";

/**
 * Supabase palsu: cukup meniru rantai `.from().select().eq()...` yang dipakai
 * job closing-odds. Tujuannya menguji ORKESTRASI (fixture mana yang disentuh,
 * kolom apa yang ditulis), bukan SQL-nya.
 */
interface FakeTable {
  rows: Array<Record<string, unknown>>;
}

function makeFakeSupabase(tables: Record<string, FakeTable>) {
  const updates: Array<{ table: string; patch: Record<string, unknown>; id: unknown }> = [];

  function query(tableName: string) {
    const table = tables[tableName] ?? { rows: [] };
    const filters: Array<(row: Record<string, unknown>) => boolean> = [];

    const builder: any = {
      select: () => builder,
      gte: (column: string, value: unknown) => {
        filters.push((r) => new Date(String(r[column])).getTime() >= new Date(String(value)).getTime());
        return builder;
      },
      lt: (column: string, value: unknown) => {
        filters.push((r) => new Date(String(r[column])).getTime() < new Date(String(value)).getTime());
        return builder;
      },
      in: (column: string, values: unknown[]) => {
        const set = new Set(values.map(String));
        filters.push((r) => set.has(String(r[column])));
        return builder;
      },
      is: (column: string, value: unknown) => {
        filters.push((r) => (value === null ? r[column] == null : r[column] === value));
        return builder;
      },
      eq: (column: string, value: unknown) => {
        filters.push((r) => String(r[column]) === String(value));
        return builder;
      },
      order: () => builder,
      limit: (n: number) => {
        const rows = table.rows.filter((r) => filters.every((f) => f(r))).slice(0, n);
        return Promise.resolve({ data: rows, error: null });
      },
      range: (from: number, to: number) => {
        const rows = table.rows.filter((r) => filters.every((f) => f(r))).slice(from, to + 1);
        return Promise.resolve({ data: rows, error: null });
      },
      maybeSingle: () => {
        const rows = table.rows.filter((r) => filters.every((f) => f(r)));
        return Promise.resolve({ data: rows[0] ?? null, error: null });
      },
      update: (patch: Record<string, unknown>) => {
        const updateBuilder: any = {
          eq: (column: string, value: unknown) => {
            updateBuilder._match = { column, value };
            return updateBuilder;
          },
          is: () => updateBuilder,
          then: (resolve: (v: unknown) => void) => {
            const match = updateBuilder._match;
            const row = table.rows.find((r) => String(r[match.column]) === String(match.value));
            if (row) {
              Object.assign(row, patch);
              updates.push({ table: tableName, patch, id: match.value });
            }
            resolve({ error: null });
          },
        };
        return updateBuilder;
      },
    };

    /* `select()` diakhiri `.then` lewat await langsung. */
    builder.then = (resolve: (v: unknown) => void) => {
      const rows = table.rows.filter((r) => filters.every((f) => f(r)));
      resolve({ data: rows, error: null });
    };

    return builder;
  }

  return {
    client: { from: query } as any,
    updates,
  };
}

const KICKOFF = new Date("2026-11-21T15:00:00Z");
const NOW = new Date("2026-11-21T14:52:00Z"); // T-8 menit

function seedTables(overrides: {
  fixtureDate?: string;
  selections?: Array<Record<string, unknown>>;
  snapshots?: Array<Record<string, unknown>>;
} = {}) {
  return {
    fixtures: {
      rows: [{ fixture_id: 99001, fixture_date: overrides.fixtureDate ?? KICKOFF.toISOString() }],
    },
    prediction_selections: {
      rows: overrides.selections ?? [
        { id: 1, fixture_id: "99001", market_key: "ML:home", odds_close: null, close_fair_prob: null },
        { id: 2, fixture_id: "99001", market_key: "ML:draw", odds_close: null, close_fair_prob: null },
      ],
    },
    odds_movement_history: {
      rows: overrides.snapshots ?? [
        {
          fixture_id: "99001",
          bookmaker: "Bet365",
          market_type: "ML",
          captured_at: "2026-11-21T14:50:00Z",
          home_odds: 2.1,
          away_odds: 3.4,
          draw_odds: 3.6,
          over_odds: null,
          under_odds: null,
          btts_yes: null,
          btts_no: null,
        },
      ],
    },
  };
}

/**
 * Menjalankan job dengan Supabase palsu yang disuntikkan lewat opsi.
 * Tidak ada monkey-patching: `supabase` di sandbox ini null, dan mengubah
 * modul secara global akan membuat tes bergantung pada urutan eksekusi.
 */
async function runWithFake(
  tables: Record<string, FakeTable>,
  now: Date,
) {
  const fake = makeFakeSupabase(tables);
  const summary = await runClosingOddsCapture({ now, supabase: fake.client });
  return { summary, fake };
}

test("mengisi odds_close dan close_fair_prob untuk fixture dalam jendela T-10", async () => {
  const tables = seedTables();
  const { summary, fake } = await runWithFake(tables, NOW);
  assert.equal(summary.fixturesUpdated, 1);
  assert.equal(summary.rowsUpdated, 2);
  assert.equal(summary.errors.length, 0);

  const home = tables.prediction_selections.rows.find((r) => r.id === 1)!;
  assert.equal(home.odds_close, 2.1);
  assert.ok(typeof home.close_fair_prob === "number");
  assert.ok((home.close_fair_prob as number) > 0 && (home.close_fair_prob as number) < 1);
  assert.equal(fake.updates.length, 2);
});

test("fixture yang kick-off-nya masih > 10 menit dilewati", async () => {
  const far = new Date(KICKOFF.getTime() + 60 * 60 * 1000).toISOString();
  const tables = seedTables({ fixtureDate: far });
  const { summary } = await runWithFake(tables, NOW);
  assert.equal(summary.rowsUpdated, 0, "harga 60 menit sebelum kick-off bukan harga penutup");
  assert.equal(tables.prediction_selections.rows[0]!.odds_close, null);
});

test("snapshot in-play tidak dipakai sebagai harga penutup", async () => {
  const tables = seedTables({
    snapshots: [
      {
        fixture_id: "99001",
        bookmaker: "Bet365",
        market_type: "ML",
        captured_at: "2026-11-21T15:30:00Z", // setelah kick-off
        home_odds: 1.4,
        away_odds: 8,
        draw_odds: 5,
        over_odds: null,
        under_odds: null,
        btts_yes: null,
        btts_no: null,
      },
    ],
  });
  const { summary } = await runWithFake(tables, NOW);
  assert.equal(summary.rowsUpdated, 0);
  assert.ok(summary.skipped > 0);
  assert.equal(tables.prediction_selections.rows[0]!.odds_close, null);
});

test("tidak ada selection terbuka → tidak menyentuh apa pun", async () => {
  const tables = seedTables({ selections: [] });
  const { summary, fake } = await runWithFake(tables, NOW);
  assert.equal(summary.candidates, 0);
  assert.equal(summary.rowsUpdated, 0);
  assert.equal(fake.updates.length, 0);
});

test("baris yang sudah punya odds_close tidak ditimpa", async () => {
  const tables = seedTables({
    selections: [
      { id: 1, fixture_id: "99001", market_key: "ML:home", odds_close: 1.95, close_fair_prob: 0.48 },
    ],
  });
  const { summary } = await runWithFake(tables, NOW);
  /* `is("odds_close", null)` menyaring baris ini di database. */
  assert.equal(summary.rowsUpdated, 0);
  assert.equal(tables.prediction_selections.rows[0]!.odds_close, 1.95);
});

/* ── settlement outcome ── */

test("outcome terisi dari skor akhir", async () => {
  const tables: Record<string, FakeTable> = {
    fixtures: {
      rows: [
        { fixture_id: 99001, home_goals: 2, away_goals: 1, home_goals_ht: 1, away_goals_ht: 0 },
      ],
    },
    prediction_selections: {
      rows: [
        { id: 1, fixture_id: "99001", market_key: "ML:home", outcome: null },
        { id: 2, fixture_id: "99001", market_key: "BTTS:yes", outcome: null },
        { id: 3, fixture_id: "99001", market_key: "TOT:over:2.5", outcome: null },
        { id: 4, fixture_id: "99001", market_key: "TOT:under:2.5", outcome: null },
      ],
    },
  };
  const fake = makeFakeSupabase(tables);
  const result = await runOutcomeSettlement({ supabase: fake.client });
  assert.equal(result.outcomesFilled, 4);
  assert.equal(tables.prediction_selections.rows.find((r) => r.id === 1)!.outcome, "win");
  assert.equal(tables.prediction_selections.rows.find((r) => r.id === 2)!.outcome, "win");
  assert.equal(tables.prediction_selections.rows.find((r) => r.id === 3)!.outcome, "win");
  assert.equal(tables.prediction_selections.rows.find((r) => r.id === 4)!.outcome, "loss");
});

test("fixture tanpa skor tidak menghasilkan outcome", async () => {
  const tables: Record<string, FakeTable> = {
    fixtures: { rows: [{ fixture_id: 99002, home_goals: null, away_goals: null }] },
    prediction_selections: {
      rows: [{ id: 9, fixture_id: "99002", market_key: "ML:home", outcome: null }],
    },
  };
  const fake = makeFakeSupabase(tables);
  const result = await runOutcomeSettlement({ supabase: fake.client });
  assert.equal(result.outcomesFilled, 0);
  assert.equal(tables.prediction_selections.rows[0]!.outcome, null);
});

test("outcome yang sudah terisi tidak ditimpa", async () => {
  const tables: Record<string, FakeTable> = {
    fixtures: { rows: [{ fixture_id: 99003, home_goals: 0, away_goals: 3 }] },
    prediction_selections: {
      rows: [{ id: 7, fixture_id: "99003", market_key: "ML:home", outcome: "loss" }],
    },
  };
  const fake = makeFakeSupabase(tables);
  const result = await runOutcomeSettlement({ supabase: fake.client });
  /* `.is("outcome", null)` menyaring baris ini; fake meniru penyaringan itu. */
  assert.equal(result.outcomesFilled, 0);
});
