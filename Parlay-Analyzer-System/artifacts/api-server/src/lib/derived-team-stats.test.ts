import { test } from "node:test";
import assert from "node:assert/strict";
import { assessTeamStatsQuality } from "../services/ai-analysis";
import {
  buildDerivedTeamStats,
  leagueGoalsAgainstAverage,
  type TeamMatchPerspective,
} from "./derived-team-stats";

const match = (
  gf: number,
  ga: number,
  venue: "H" | "A",
): TeamMatchPerspective => ({
  gf,
  ga,
  venue,
  result: gf > ga ? "W" : gf === ga ? "D" : "L",
});

/** Agregat 3 laga Bayern Munich 2026-27 dari fixtures produksi: GF10 GA3, W2 D1, BTTS 3/3. */
const BayernMatches: TeamMatchPerspective[] = [
  match(3, 1, "A"),
  match(6, 1, "H"),
  match(1, 1, "H"),
];

test("blok turunan menghasilkan 8 blok wajib yang lolos gerbang kualitas analisis", () => {
  const blocks = buildDerivedTeamStats(BayernMatches, 1.3889);
  const quality = assessTeamStatsQuality(blocks);
  assert.deepEqual(quality.missingKeys, []);
  assert.equal(quality.valid, true);
});

test("laju gol dan proxy xG yang disusutkan ke rata-rata liga dihitung benar", () => {
  const blocks = buildDerivedTeamStats(BayernMatches, 1.3889);
  assert.equal(blocks.stats_goals_scored?.["Per Match"], "3.33 Scored / match");
  // 0.75 · 3.333 + 0.25 · 1.3889 = 2.847
  assert.equal(blocks.stats_xg?.xG, "2.85");
  assert.equal(blocks.stats_xg?.["xG vs Actual"], "+0.49");
  assert.equal(blocks.stats_team_form?.Pts, "7");
  assert.equal(blocks.stats_btts?.["BTTS %"], "100%");
});

test("tim tanpa laga menghasilkan objek kosong, bukan blok karangan", () => {
  assert.deepEqual(buildDerivedTeamStats([], 1.4), {});
});

test("rata-rata GA liga adalah total kemasukan per penampilan tim", () => {
  assert.ok(Math.abs(leagueGoalsAgainstAverage(BayernMatches) - 1.0) < 1e-9);
  assert.equal(leagueGoalsAgainstAverage([]), 0);
});
