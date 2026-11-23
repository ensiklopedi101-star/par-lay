import { test } from "node:test";
import assert from "node:assert/strict";
import { loadUpcomingSelectionRows } from "./upcoming-selections";

/**
 * Supabase palsu minimal untuk loader seleksi mendatang: meniru rantai
 * select/gt/lte/order/limit/in dan menerapkan filter tanggal + in-list
 * secara nyata, agar tes membuktikan jendela waktu ditegakkan di query.
 */
class FakeQuery {
  private filters: Array<(row: Record<string, unknown>, index: number) => boolean> = [];
  constructor(private rows: Array<Record<string, unknown>>) {}
  select() { return this; }
  gt(col: string, val: string) {
    this.filters.push((r) => String(r[col]) > val);
    return this;
  }
  lte(col: string, val: string) {
    this.filters.push((r) => String(r[col]) <= val);
    return this;
  }
  in(col: string, vals: string[]) {
    this.filters.push((r) => vals.includes(String(r[col])));
    return this;
  }
  order() { return this; }
  limit(n: number) {
    this.filters.push((r, i) => i < n);
    return this;
  }
  then(resolve: (v: { data: unknown; error: null }) => void) {
    let out = [...this.rows];
    for (const f of this.filters) out = out.filter((r, i) => f(r, i));
    resolve({ data: out, error: null });
  }
}

function fakeClient(tables: Record<string, Array<Record<string, unknown>>>) {
  return {
    from: (table: string) => new FakeQuery(tables[table] ?? []),
  } as never;
}

const NOW = new Date("2026-11-23T06:00:00Z");

function seed() {
  return {
    fixtures: [
      { fixture_id: 1, league_name: "Serie A", fixture_date: "2026-11-23T19:45:00Z", home_team_name: "Monza", away_team_name: "Fiorentina", status_short: "pending" },
      { fixture_id: 2, league_name: "Serie A", fixture_date: "2026-11-20T19:45:00Z", home_team_name: "Past", away_team_name: "Done", status_short: "settled" },
      { fixture_id: 3, league_name: "LaLiga", fixture_date: "2027-01-15T20:00:00Z", home_team_name: "Far", away_team_name: "Away", status_short: "pending" },
      { fixture_id: 4, league_name: "LaLiga", fixture_date: "2026-11-25T20:00:00Z", home_team_name: "Odd", away_team_name: "Status", status_short: "FT" },
    ],
    prediction_selections: [
      { fixture_id: "1", market_key: "BTTS:yes", family: "BTTS", line: null, odds: 1.54, p_final: 0.64, p_market_fair: 0.6, p_model_only: 0.71, ev: -0.01, ev_conservative: -0.08, bookmaker: "1xbet" },
      { fixture_id: "2", market_key: "ML:home", family: "ML", line: null, odds: 1.4, p_final: 0.7, p_market_fair: 0.68, p_model_only: 0.7, ev: 0.05, ev_conservative: 0.02, bookmaker: "M88" },
      { fixture_id: "3", market_key: "ML:home", family: "ML", line: null, odds: 1.4, p_final: 0.7, p_market_fair: 0.68, p_model_only: 0.7, ev: 0.05, ev_conservative: 0.02, bookmaker: "M88" },
    ],
  };
}

test("hanya seleksi laga belum kick-off dalam horizon yang dimuat", async () => {
  const loaded = await loadUpcomingSelectionRows(fakeClient(seed()), { now: NOW });
  assert.deepEqual(loaded.rows.map((r) => String(r.fixture_id)), ["1"]);
  assert.equal(loaded.meta.get(1)?.kickoffAt, "2026-11-23T19:45:00Z");
  assert.equal(loaded.fixtureCount, 1);
});

test("fixture berstatus selesai dibuang walau tanggalnya di masa depan", async () => {
  const tables = seed();
  const loaded = await loadUpcomingSelectionRows(fakeClient(tables), { now: NOW });
  assert.equal(loaded.meta.has(4), false, "status FT tidak boleh masuk bahan komposisi");
});

test("tanpa fixture mendatang, loader menjawab kosong tanpa query seleksi liar", async () => {
  const loaded = await loadUpcomingSelectionRows(
    fakeClient({ fixtures: [], prediction_selections: seed().prediction_selections }),
    { now: NOW },
  );
  assert.equal(loaded.rows.length, 0);
  assert.equal(loaded.fixtureCount, 0);
});
