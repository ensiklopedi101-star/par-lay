import { test } from "node:test";
import assert from "node:assert/strict";
import {
  candidatesFromAnalyses,
  candidatesFromSelectionRows,
  type FixtureMeta,
} from "./parlay-candidates";
import type { SelectionEval } from "../lib/quant/pipeline";

function sel(key: string, passes: boolean, evConservative = 0.02): SelectionEval {
  return {
    key,
    label: key,
    family: "Totals",
    odds: 1.9,
    line: 2.5,
    pFinal: 0.56,
    pMarket: 0.53,
    pModelOnly: 0.58,
    outcome: "win" as never,
    ev: 0.064,
    evConservative,
    sigma: 0.0286,
    stakePct: 0.02,
    minOdds: 1.5,
    passes,
    rejectReasons: passes ? [] : ["EV konservatif ≤ 0"],
  };
}

test("hanya market yang lolos engine yang menjadi kandidat", () => {
  const candidates = candidatesFromAnalyses([
    {
      fixtureId: 101,
      league: "england-premier-league",
      date: "2026-11-21",
      selections: [sel("over_2.5", true), sel("btts_yes", false), sel("home_win", true)],
    },
  ]);

  assert.equal(candidates.length, 2);
  assert.deepEqual(
    candidates.map((c) => c.marketKey),
    ["over_2.5", "home_win"],
  );
});

test("kandidat membawa liga dan tanggal untuk perhitungan korelasi", () => {
  const [candidate] = candidatesFromAnalyses([
    {
      fixtureId: 101,
      league: "serie-a",
      date: "2026-11-22",
      selections: [sel("over_2.5", true)],
    },
  ]);

  assert.equal(candidate!.league, "serie-a");
  assert.equal(candidate!.date, "2026-11-22");
  assert.equal(candidate!.fixtureId, 101);
});

test("fixtureId tidak valid dilewati, bukan menghasilkan kandidat rusak", () => {
  const candidates = candidatesFromAnalyses([
    { fixtureId: Number.NaN, league: "x", selections: [sel("over_2.5", true)] },
    { fixtureId: 1.5, league: "x", selections: [sel("btts_yes", true)] },
  ]);

  assert.equal(candidates.length, 0);
});

test("mengumpulkan kandidat dari banyak pertandingan sekaligus", () => {
  const candidates = candidatesFromAnalyses([
    { fixtureId: 1, league: "a", selections: [sel("over_2.5", true)] },
    { fixtureId: 2, league: "b", selections: [sel("over_2.5", true), sel("btts_yes", true)] },
    { fixtureId: 3, league: "c", selections: [sel("home_win", true)] },
  ]);

  assert.equal(candidates.length, 4);
  assert.deepEqual(
    [...new Set(candidates.map((c) => c.fixtureId))].sort(),
    [1, 2, 3],
  );
});

test("baris ledger tanpa metadata fixture dilewati, bukan dikarang", () => {
  const meta = new Map<number, FixtureMeta>([
    [10, { fixtureId: 10, league: "serie-a", date: "2026-11-21" }],
  ]);

  const candidates = candidatesFromSelectionRows(
    [
      {
        fixture_id: 10,
        market_key: "over_2.5",
        family: "Totals",
        line: 2.5,
        odds: 1.9,
        p_final: 0.56,
        p_market_fair: 0.53,
        p_model_only: 0.58,
        ev: 0.064,
        ev_conservative: 0.02,
      },
      {
        /* Tidak ada di peta: liga/tanggal tidak diketahui → korelasi mustahil. */
        fixture_id: 99,
        market_key: "btts_yes",
        family: "BTTS",
        line: null,
        odds: 1.8,
        p_final: 0.6,
        p_market_fair: 0.55,
        p_model_only: 0.62,
        ev: 0.08,
        ev_conservative: 0.03,
      },
    ],
    meta,
  );

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0]!.fixtureId, 10);
});

test("baris ledger dengan EV konservatif ≤ 0 tidak menjadi kandidat", () => {
  const meta = new Map<number, FixtureMeta>([[10, { fixtureId: 10, league: "serie-a" }]]);
  const base = {
    fixture_id: 10,
    family: "Totals",
    line: 2.5,
    odds: 1.9,
    p_final: 0.56,
    p_market_fair: 0.53,
    p_model_only: 0.58,
    ev: 0.064,
  };

  const candidates = candidatesFromSelectionRows(
    [
      { ...base, market_key: "over_2.5", ev_conservative: -0.01 },
      { ...base, market_key: "under_2.5", ev_conservative: 0.001 },
    ],
    meta,
  );

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0]!.marketKey, "under_2.5");
});

test("label market dibentuk ulang dari kunci agar bisa dibaca", () => {
  const meta = new Map<number, FixtureMeta>([[10, { fixtureId: 10, league: "serie-a" }]]);
  const [candidate] = candidatesFromSelectionRows(
    [
      {
        fixture_id: 10,
        market_key: "over_2.5",
        family: "Totals",
        line: 2.5,
        odds: 1.9,
        p_final: 0.56,
        p_market_fair: 0.53,
        p_model_only: 0.58,
        ev: 0.064,
        ev_conservative: 0.02,
      },
    ],
    meta,
  );

  assert.equal(candidate!.selection.label, "over 2.5");
});

test("candidatesFromSelectionRows: fixture yang sudah kick-off / selesai dibuang (pagar anti look-ahead)", () => {
  const now = new Date("2026-11-23T04:00:00Z");
  const row = (fixture_id: number) => ({
    fixture_id, market_key: "TOT:over:2.5", family: "Totals", line: 2.5,
    odds: 1.9, p_final: 0.56, p_market_fair: 0.53, p_model_only: 0.58, ev: 0.06, ev_conservative: 0.02,
  });
  const meta = new Map<number, FixtureMeta>([
    [11, { fixtureId: 11, league: "x", date: "2026-11-20", kickoffAt: "2026-11-20T19:45:00Z", statusShort: "settled" }],
    [12, { fixtureId: 12, league: "x", date: "2026-11-23", kickoffAt: "2026-11-23T01:00:00Z", statusShort: "live" }],
    [13, { fixtureId: 13, league: "x", date: "2026-11-24", kickoffAt: "2026-11-24T19:45:00Z", statusShort: "pending" }],
  ]);
  const candidates = candidatesFromSelectionRows([row(11), row(12), row(13)], meta, { requirePassing: false, now });
  assert.deepEqual(candidates.map((c) => c.fixtureId), [13], "hanya fixture yang belum kick-off yang boleh direkomendasikan");
});

test("candidatesFromSelectionRows: requirePassing=false membuka gerbang EV untuk jalur pasar-dulu", () => {
  const meta = new Map<number, FixtureMeta>([[7, { fixtureId: 7, league: "x", date: "2026-11-21" }]]);
  const rows = [{
    fixture_id: 7, market_key: "TOT:over:0.5", family: "Totals", line: 0.5,
    odds: 1.1, p_final: 0.9, p_market_fair: 0.88, p_model_only: 0.9, ev: -0.02, ev_conservative: -0.03,
  }];
  assert.equal(candidatesFromSelectionRows(rows, meta).length, 0);
  const opened = candidatesFromSelectionRows(rows, meta, { requirePassing: false });
  assert.equal(opened.length, 1);
  assert.equal(opened[0]!.selection.pMarket, 0.88);
});
