import { test } from "node:test";
import assert from "node:assert/strict";
import {
  findContradictoryColumns,
  normalizeStatsRow,
  over25FromForm,
} from "./stats-integrity.js";

/* Blok nyata dari database La Liga 2026-27 (diambil 12 Nov 2026). */
const CONCEDED_BLOCK = {
  MP: "6",
  Away: "1.00 / match",
  Home: "1.00 / match",
  "Per Match": "1.00 Conceded / match",
  "Goals Conceded": "6",
  "Home Advantage": "0%",
};

const SCORED_BLOCK = {
  MP: "6",
  Away: "1.00 / match",
  Home: "1.50 / match",
  "Per Match": "1.17 Scored / match",
  "Goals Scored": "7",
  "Home Advantage": "+14%",
};

const FORM_BLOCK = {
  MP: "8",
  W: "5",
  D: "1",
  L: "2",
  GF: "14",
  GA: "9",
  Pts: "16",
  "Over 2.5": "63%",
};

test("blok Conceded di kolom scored terdeteksi dan dibuang", () => {
  const row = { stats_goals_scored: CONCEDED_BLOCK, stats_team_form: FORM_BLOCK };
  const hits = findContradictoryColumns(row);
  assert.equal(hits.length, 1);
  assert.equal(hits[0]!.column, "stats_goals_scored");
  assert.equal(hits[0]!.belongsTo, "stats_goals_conceded");

  const normalized = normalizeStatsRow(row);
  assert.equal(normalized.stats.stats_goals_scored, undefined);
  assert.deepEqual(normalized.removed.map((hit) => hit.column), ["stats_goals_scored"]);
});

test("blok yang benar tidak disentuh", () => {
  const row = { stats_goals_scored: SCORED_BLOCK, stats_goals_conceded: CONCEDED_BLOCK };
  const normalized = normalizeStatsRow(row);
  assert.deepEqual(normalized.removed, []);
  assert.deepEqual(normalized.stats.stats_goals_scored, SCORED_BLOCK);
  assert.deepEqual(normalized.stats.stats_goals_conceded, CONCEDED_BLOCK);
});

test("arah sebaliknya juga tertangkap", () => {
  const hits = findContradictoryColumns({ stats_goals_conceded: SCORED_BLOCK });
  assert.deepEqual(hits.map((hit) => hit.column), ["stats_goals_conceded"]);
});

test("stats_over_25 & stats_under diisi dari form bila kosong", () => {
  const normalized = normalizeStatsRow({ stats_team_form: FORM_BLOCK });
  assert.deepEqual(normalized.derived.sort(), ["stats_over_25", "stats_under"]);
  assert.equal((normalized.stats.stats_over_25 as Record<string, string>)["Over 2.5"], "63%");
  assert.equal((normalized.stats.stats_under as Record<string, string>)["Under 2.5"], "37%");
});

test("blok yang sudah ada tidak ditimpa; under diturunkan dari nilai itu", () => {
  const existing = { "Over 2.5": "51%" };
  const normalized = normalizeStatsRow({
    stats_over_25: existing,
    stats_team_form: FORM_BLOCK,
  });
  assert.deepEqual(normalized.stats.stats_over_25, existing);
  assert.deepEqual(normalized.derived, ["stats_under"]);
  assert.equal((normalized.stats.stats_under as Record<string, string>)["Under 2.5"], "49%");
});

test("hanya over yang hilang: under yang sudah ada dibiarkan", () => {
  const under = { "Under 2.5": "44%" };
  const normalized = normalizeStatsRow({ stats_under: under, stats_team_form: FORM_BLOCK });
  assert.deepEqual(normalized.derived, ["stats_over_25"]);
  assert.deepEqual(normalized.stats.stats_under, under);
});

test("tanpa form tidak ada yang dikarang", () => {
  const normalized = normalizeStatsRow({ stats_xg: { "Per Match": "1.42" } });
  assert.deepEqual(normalized.derived, []);
  assert.equal(normalized.stats.stats_over_25, undefined);
});

test("pembacaan Over 2.5 toleran format", () => {
  assert.equal(over25FromForm({ "Over 2.5": "63%" }), 63);
  assert.equal(over25FromForm({ "over 2.5": "63.4 %" }), 63.4);
  assert.equal(over25FromForm({ "Over 2,5": "63%" }), 63);
  assert.equal(over25FromForm({ "Over 2.5 Goals": "48%" }), 48);
  assert.equal(over25FromForm({ "Over 2.5": "120%" }), null, "di luar 0-100 ditolak");
  assert.equal(over25FromForm({ "Over 3.5": "30%" }), null);
  assert.equal(over25FromForm(null), null);
  assert.equal(over25FromForm("junk"), null);
});

test("normalisasi idempoten", () => {
  const once = normalizeStatsRow({ stats_goals_scored: CONCEDED_BLOCK, stats_team_form: FORM_BLOCK });
  const twice = normalizeStatsRow(once.stats);
  assert.deepEqual(twice.removed, []);
  assert.deepEqual(twice.derived, []);
  assert.deepEqual(twice.stats, once.stats);
});

test("blok kosong bukan kontradiksi", () => {
  assert.deepEqual(findContradictoryColumns({ stats_goals_scored: {} }), []);
  assert.deepEqual(findContradictoryColumns({}), []);
});
