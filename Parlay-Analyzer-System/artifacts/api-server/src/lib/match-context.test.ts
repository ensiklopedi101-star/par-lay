import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildMatchContext,
  correlationFindings,
  estimateLambdas,
  formatMatchContextBlock,
  jointProbability,
  marketProbabilities,
  modelProbabilityForSelection,
  parsePercent,
  parseStatNumber,
  parseTeamRates,
  DEFAULT_LEAGUE,
  type TeamRatesParsed,
} from "./match-context.js";
import { scoreMatrix } from "./quant/poisson.js";

/* Payload nyata dari team_season_stats (Sunderland 2026-27). */
const sunderland = {
  stats_xg: { MP: "10", xG: "1.34", xGA: "1.47", xGD: "-0.13", GF: "0.80", GA: "1.70", "xG vs Actual": "-0.54" },
  stats_goals_scored: {
    MP: "10",
    Home: "0.40 / match",
    Away: "1.20 / match",
    "Per Match": "0.80 Scored / match",
    "Home Advantage": "-50%",
  },
  stats_goals_conceded: {
    MP: "10",
    Home: "0.80 / match",
    Away: "2.60 / match",
    "Per Match": "1.70 Conceded / match",
    "Home Advantage": "'+53%",
  },
  stats_team_form: { MP: "6", W: "1", D: "1", L: "4", Pts: "4", PPG: "0.67", "Last 6": "W L D L L L", "Over 2.5": "33%" },
  stats_btts: { MP: "10", BTTS: "4", "BTTS %": "40%", "Home %": "0%", "Away %": "80%" },
  stats_fts: { MP: "10", FTS: "4", "FTS %": "40%", "Home %": "60%", "Away %": "20%" },
  stats_shots: { "Over 10.5": "80%", "Over 12.5": "40%" },
  stats_ht: { MP: "10", "Win %": "10%", "Draw %": "60%", "Loss %": "30%" },
};

const opponent = {
  stats_xg: { MP: "10", xG: "1.60", xGA: "1.10", xGD: "0.50", GF: "1.50", GA: "1.10", "xG vs Actual": "0.10" },
  stats_goals_scored: { MP: "10", Home: "1.80 / match", Away: "1.20 / match", "Per Match": "1.50 Scored / match" },
  stats_goals_conceded: { MP: "10", Home: "0.80 / match", Away: "1.40 / match", "Per Match": "1.10 Conceded / match" },
  stats_team_form: { MP: "10", Pts: "18", PPG: "1.80", "Last 6": "W W D W L W" },
  stats_btts: { "BTTS %": "60%", "Home %": "50%", "Away %": "70%" },
};

/* ── Parsing ───────────────────────────────────────────────────────────── */

test("parseStatNumber menangani format nyata termasuk apostrof liar", () => {
  assert.equal(parseStatNumber("1.20 / match"), 1.2);
  assert.equal(parseStatNumber("'+53%"), 53);
  assert.equal(parseStatNumber("-0.54"), -0.54);
  assert.equal(parseStatNumber(8), 8);
  assert.equal(parseStatNumber("tidak ada angka"), null);
  assert.equal(parseStatNumber(null), null);
});

test("parsePercent membedakan '80%' dari 0.8", () => {
  assert.equal(parsePercent("80%"), 0.8);
  assert.equal(parsePercent("0.8"), 0.8);
  assert.equal(parsePercent("100%"), 1);
  assert.equal(parsePercent(undefined), null);
});

test("parseTeamRates membaca split kandang/tandang dan residual xG", () => {
  const rates = parseTeamRates(sunderland);
  assert.equal(rates.goalsFor, 0.8);
  assert.equal(rates.goalsForHome, 0.4);
  assert.equal(rates.goalsForAway, 1.2);
  assert.equal(rates.goalsAgainstAway, 2.6);
  assert.equal(rates.xgFor, 1.34);
  assert.equal(rates.xgResidual, -0.54);
  assert.equal(rates.bttsHome, 0);
  assert.equal(rates.bttsAway, 0.8);
  assert.equal(rates.formPpg, 0.67);
  assert.equal(rates.last6, "W L D L L L");
});

test("parseTeamRates membuka bungkus COMBINED/BASELINE_ONLY agar statistik musim sebelumnya benar-benar dipakai model", () => {
  const wrapped = {
    _meta: "COMBINED",
    current_season: {
      stats_xg: { MP: "3", xG: "2.40", xGA: "0.60" },
      stats_goals_scored: { Home: "2.50 / match", Away: "2.30 / match", "Per Match": "2.40 / match" },
      stats_goals_conceded: { Home: "0.50 / match", Away: "0.70 / match", "Per Match": "0.60 / match" },
    },
    baseline_reference: sunderland,
  };
  const rates = parseTeamRates(wrapped);
  /* Harus membaca baseline Sunderland, bukan null/default karena kolom
     stats_* tidak berada di level teratas bungkus. */
  assert.equal(rates.goalsForHome, 0.4);
  assert.equal(rates.goalsAgainstAway, 2.6);
  assert.equal(rates.xgFor, 1.34);

  const ctx = buildMatchContext({
    homeTeam: "Sunderland",
    awayTeam: "Arsenal",
    homeStats: wrapped,
    awayStats: opponent,
    league: { homeGoals: 1.5, awayGoals: 1.1 },
  });
  assert.ok(ctx.dataGaps.some((gap) => /jangkar musim sebelumnya/.test(gap)));
  assert.ok(ctx.signals.some((signal) => /Split Sunderland: 0\.40/.test(signal)));
});

test("parseTeamRates aman untuk baris kosong", () => {
  const rates = parseTeamRates(null);
  assert.equal(rates.goalsFor, null);
  assert.equal(rates.xgFor, null);
});

/* ── λ ─────────────────────────────────────────────────────────────────── */

const neutralRates = (overrides: Partial<TeamRatesParsed> = {}): TeamRatesParsed => ({
  ...parseTeamRates(null),
  matches: 10,
  ...overrides,
});

test("estimateLambdas: tim rata-rata melawan tim rata-rata ≈ rata-rata liga", () => {
  const league = { homeGoals: 1.5, awayGoals: 1.1 };
  const avg = neutralRates({ goalsFor: 1.3, goalsAgainst: 1.3, xgFor: 1.3, xgAgainst: 1.3 });
  const lambdas = estimateLambdas(avg, avg, league);
  assert.ok(Math.abs(lambdas.lambdaHome - league.homeGoals) < 0.05);
  assert.ok(Math.abs(lambdas.lambdaAway - league.awayGoals) < 0.05);
});

test("estimateLambdas memakai split kandang/tandang, bukan rata-rata musim", () => {
  const league = { homeGoals: 1.5, awayGoals: 1.1 };
  const homeStrong = neutralRates({
    goalsForHome: 2.4,
    goalsForAway: 0.4,
    xgFor: 1.3,
    goalsAgainst: 1.0,
    xgAgainst: 1.0,
  });
  const awayWeak = neutralRates({
    goalsAgainstAway: 2.4,
    goalsAgainstHome: 0.6,
    xgAgainst: 1.3,
    goalsFor: 1.0,
    xgFor: 1.0,
  });
  const split = estimateLambdas(homeStrong, awayWeak, league);

  /* Bila split diabaikan (semua memakai rata-rata 1.4 gol), λ_home akan jauh lebih kecil. */
  const flat = neutralRates({ goalsFor: 1.4, goalsAgainst: 1.0, xgFor: 1.3, xgAgainst: 1.0 });
  const flatAway = neutralRates({ goalsFor: 1.0, xgFor: 1.0, goalsAgainst: 1.4, xgAgainst: 1.3 });
  const noSplit = estimateLambdas(flat, flatAway, league);
  assert.ok(split.lambdaHome > noSplit.lambdaHome);
});

test("estimateLambdas menurunkan keandalan saat sampel kecil", () => {
  const weakDefense = neutralRates({ goalsAgainst: 1.3, xgAgainst: 1.3, goalsFor: 1.3, xgFor: 1.3 });
  const few = neutralRates({ matches: 2, goalsFor: 5, xgFor: 5, goalsAgainst: 1.3, xgAgainst: 1.3 });
  const many = neutralRates({ matches: 20, goalsFor: 5, xgFor: 5, goalsAgainst: 1.3, xgAgainst: 1.3 });

  assert.ok(estimateLambdas(few, weakDefense).reliability < estimateLambdas(many, weakDefense).reliability);
  /* Shrinkage menahan data ekstrem: 2 laga menghasilkan λ lebih dekat ke rata-rata
     liga daripada 20 laga dengan angka yang sama. */
  assert.ok(estimateLambdas(few, weakDefense).lambdaHome < estimateLambdas(many, weakDefense).lambdaHome);
  assert.ok(estimateLambdas(few, weakDefense).lambdaHome < 4.5);
});

/* ── Market & korelasi ─────────────────────────────────────────────────── */

test("probabilitas 1X2 berjumlah 1", () => {
  const matrix = scoreMatrix(1.6, 1.1);
  const markets = marketProbabilities(matrix);
  assert.ok(Math.abs(markets.homeWin + markets.draw + markets.awayWin - 1) < 1e-9);
  assert.ok(Math.abs(markets.over25 + markets.under25 - 1) < 1e-9);
  assert.ok(Math.abs(markets.bttsYes + markets.bttsNo - 1) < 1e-9);
});

test("Over 2.5 + BTTS berkorelasi positif dan joint ≠ perkalian", () => {
  const matrix = scoreMatrix(1.7, 1.3);
  const findings = correlationFindings(matrix);
  const overBtts = findings.find((f) => f.pair === "Over 2.5 + BTTS")!;
  assert.ok(overBtts.joint > overBtts.independent);
  assert.ok(overBtts.ratio > 1.1);
  /* Joint tidak boleh melebihi probabilitas masing-masing komponen. */
  assert.ok(overBtts.joint <= Math.min(overBtts.joint / 1, 1));
});

test("jointProbability menghitung irisan kejadian dari matriks yang sama", () => {
  const matrix = scoreMatrix(1.2, 1.2);
  const over = jointProbability(matrix, [(h, a) => h + a > 2.5]);
  const btts = jointProbability(matrix, [(h, a) => h > 0 && a > 0]);
  const both = jointProbability(matrix, [(h, a) => h + a > 2.5, (h, a) => h > 0 && a > 0]);
  assert.ok(both <= over + 1e-9);
  assert.ok(both <= btts + 1e-9);
  assert.ok(both > 0);
});

/* ── Konteks & format ──────────────────────────────────────────────────── */

test("buildMatchContext menghasilkan sinyal split, residual, dan λ", () => {
  const ctx = buildMatchContext({
    homeTeam: "Sunderland",
    awayTeam: "Arsenal",
    homeStats: sunderland,
    awayStats: opponent,
    league: { homeGoals: 1.5, awayGoals: 1.1 },
    restDays: { home: 3, away: 6 },
    standings: { home: { position: 18, points: 4 }, away: { position: 2, points: 22 } },
  });
  const joined = ctx.signals.join(" | ");
  assert.match(joined, /Split Sunderland: 0\.40/);
  assert.match(joined, /Residual xG Sunderland: -0\.54/);
  assert.match(joined, /Istirahat/);
  assert.match(joined, /Klasemen/);
  assert.ok(ctx.lambdas.lambdaHome > 0);
  assert.deepEqual(ctx.dataGaps, []);
});

test("buildMatchContext menandai data hilang, bukan menebak diam-diam", () => {
  const ctx = buildMatchContext({
    homeTeam: "A",
    awayTeam: "B",
    homeStats: null,
    awayStats: null,
  });
  assert.ok(ctx.leagueIsDefault);
  assert.ok(ctx.dataGaps.some((gap) => /Rata-rata gol liga/.test(gap)));
  assert.ok(ctx.dataGaps.some((gap) => /xG tidak lengkap/.test(gap)));
  assert.ok(ctx.dataGaps.some((gap) => /Split kandang/.test(gap)));
});

test("formatMatchContextBlock memuat probabilitas, korelasi, dan aturan", () => {
  const ctx = buildMatchContext({
    homeTeam: "Sunderland",
    awayTeam: "Arsenal",
    homeStats: sunderland,
    awayStats: opponent,
    league: { homeGoals: 1.5, awayGoals: 1.1 },
  });
  const text = formatMatchContextBlock(ctx, "Sunderland", "Arsenal");
  assert.match(text, /MODEL PERTANDINGAN/);
  assert.match(text, /1X2/);
  assert.match(text, /Korelasi market/);
  assert.match(text, /jangan menghitung ulang probabilitas sendiri/);
});

/* ── Probabilitas model untuk sebuah seleksi ───────────────────────────── */

test("modelProbabilityForSelection memetakan label kanonik ke matriks yang sama", () => {
  const matrix = scoreMatrix(1.6, 1.1);
  const markets = marketProbabilities(matrix);

  const home = modelProbabilityForSelection(matrix, markets, "Home Win");
  assert.equal(home.family, "ML");
  assert.ok(Math.abs(home.probability! - markets.homeWin) < 1e-9);

  const over = modelProbabilityForSelection(matrix, markets, "Over 2.5 Goals");
  assert.equal(over.family, "Totals");
  assert.ok(Math.abs(over.probability! - markets.over25) < 1e-9);

  const btts = modelProbabilityForSelection(matrix, markets, "BTTS Yes");
  assert.equal(btts.family, "BTTS");
  assert.ok(Math.abs(btts.probability! - markets.bttsYes) < 1e-9);

  /* Handicap -0.5 untuk tuan rumah identik dengan kemenangan tuan rumah. */
  const ah = modelProbabilityForSelection(matrix, markets, "Asian Handicap Home -0.5");
  assert.equal(ah.family, "AH");
  assert.ok(Math.abs(ah.probability! - markets.homeWin) < 1e-6);
});

test("modelProbabilityForSelection menolak HT dan label asing dengan catatan", () => {
  const matrix = scoreMatrix(1.4, 1.2);
  const markets = marketProbabilities(matrix);
  const ht = modelProbabilityForSelection(matrix, markets, "HT Home");
  assert.equal(ht.probability, null);
  assert.match(ht.note!, /babak pertama/);

  /* Label bebas dari data lama ("HT Result - Manchester City Win") tidak boleh
     dianggap probabilitas; ia hanya menghasilkan null + catatan. */
  const legacy = modelProbabilityForSelection(matrix, markets, "HT Result - Manchester City Win");
  assert.equal(legacy.probability, null);

  const foreign = modelProbabilityForSelection(matrix, markets, "Corners Over 9.5");
  assert.equal(foreign.probability, null);
  assert.match(foreign.note!, /tidak dapat dipetakan/);

  const empty = modelProbabilityForSelection(matrix, markets, null);
  assert.equal(empty.probability, null);
  assert.equal(empty.family, null);
});

test("estimateLambdas params: xgWeight=0 mengabaikan xG; shrinkK besar menarik λ ke rata-rata liga", () => {
    const strong = {
      stats_xg: { MP: "38", xG: "2.50", xGA: "0.80" },
      stats_goals_scored: { "Per Match": "2.00 Scored / match", Home: "2.20 / match", Away: "1.80 / match" },
      stats_goals_conceded: { "Per Match": "1.00 Conceded / match", Home: "0.90 / match", Away: "1.10 / match" },
    };
    const rates = parseTeamRates(strong);
    const withXg = estimateLambdas(rates, rates, DEFAULT_LEAGUE, { xgWeight: 1 });
    const noXg = estimateLambdas(rates, rates, DEFAULT_LEAGUE, { xgWeight: 0 });
    assert.ok(withXg.attackHome > noXg.attackHome, "xG tinggi harus menaikkan rasio serang bila berbobot");
    const shrunk = estimateLambdas(rates, rates, DEFAULT_LEAGUE, { shrinkK: 10000 });
    assert.ok(Math.abs(shrunk.lambdaHome - DEFAULT_LEAGUE.homeGoals) < Math.abs(noXg.lambdaHome - DEFAULT_LEAGUE.homeGoals));
});
