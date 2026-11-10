import assert from "node:assert/strict";
import test from "node:test";
import {
  MIN_TEAMS_FOR_LEAGUE_AVERAGE,
  buildOddsInput,
  computeLeagueAverages,
  findDuplicateTeams,
  parseStatNumber,
  resolveTeamRow,
  runQuantEngine,
  sameTeamName,
  teamKey,
  toTeamRates,
  type TeamStatsRow,
} from "./adapter";

/* ─── Real values copied from Supabase on 2026-11-09 ─── */

const ajaxRow: TeamStatsRow = {
  team_name: "Ajax",
  league_slug: "netherlands-eredivisie",
  season: "2025-26",
  stats_goals_scored: {
    MP: "36", Home: "1.84 / match", Away: "1.76 / match",
    "Per Match": "1.81 Scored / match", "Goals Scored": "65",
  },
  stats_goals_conceded: {
    MP: "36", Home: "0.95 / match", Away: "1.41 / match",
    "Per Match": "1.17 Conceded / match", "Goals Conceded": "42",
  },
  stats_xg: { xG: "1.73", xGA: "1.46", MP: "36", GF: "1.81", GA: "1.17" },
};

/** The user's own example: home 0.44, away 1.45, per-match 1.00. */
const userExample: TeamStatsRow = {
  team_name: "Contoh",
  stats_goals_scored: {
    MP: "20", Away: "1.45 / match", Home: "0.44 / match",
    "Per Match": "1.00 Scored / match", "Goals Scored": "20", "Home Advantage": "-56%",
  },
  stats_goals_conceded: {
    MP: "20", Away: "1.27 / match", Home: "0.78 / match",
    "Per Match": "1.05 Conceded / match", "Goals Conceded": "21", "Home Advantage": "'+26%",
  },
};

/* ─── Numeric parsing ─── */

test("parseStatNumber strips units and signs", () => {
  assert.equal(parseStatNumber("1.84 / match"), 1.84);
  assert.equal(parseStatNumber("36"), 36);
  assert.equal(parseStatNumber("+2%"), 2);
  assert.equal(parseStatNumber("'+26%"), 26);
  assert.equal(parseStatNumber("1,05"), 1.05);
  assert.equal(parseStatNumber("-56%"), -56);
  assert.equal(parseStatNumber(2.5), 2.5);
});

test("parseStatNumber rejects non-numbers", () => {
  for (const bad of [null, undefined, "", "n/a", "-", "abc", {}, [], NaN, Infinity]) {
    assert.equal(parseStatNumber(bad), null, `expected null for ${JSON.stringify(bad)}`);
  }
});

/* ─── Team rates ─── */

test("toTeamRates reads the real Ajax row", () => {
  const { rates, warnings } = toTeamRates(ajaxRow);
  assert.ok(rates);
  assert.equal(rates.matches, 36);
  assert.equal(rates.goalsFor, 1.81);
  assert.equal(rates.goalsAgainst, 1.17);
  assert.equal(rates.xgFor, 1.73);
  assert.equal(rates.xgAgainst, 1.46);
  assert.deepEqual(warnings, []);
});

test("toTeamRates reads the user's example row", () => {
  const { rates } = toTeamRates(userExample);
  assert.ok(rates);
  assert.equal(rates.matches, 20);
  assert.equal(rates.goalsFor, 1.0);
  assert.equal(rates.goalsAgainst, 1.05);
});

test("toTeamRates refuses a row with no usable rate", () => {
  const empty: TeamStatsRow = { team_name: "Kosong", stats_goals_scored: null, stats_goals_conceded: null };
  const { rates, warnings } = toTeamRates(empty);
  assert.equal(rates, null);
  assert.ok(warnings.length >= 3);
});

test("toTeamRates ignores a block whose label says the opposite side", () => {
  /* Seen in 19 live rows: stats_goals_scored holding "Conceded" data. */
  const crossed: TeamStatsRow = {
    team_name: "Tertukar",
    stats_goals_scored: { MP: "10", "Per Match": "1.20 Conceded / match" },
    stats_goals_conceded: { MP: "10", "Per Match": "1.20 Conceded / match" },
  };
  const { rates, warnings } = toTeamRates(crossed);
  assert.equal(rates, null, "cross-filled row must not be modelled");
  assert.ok(warnings.some((w) => w.includes("Conceded")));
});

/* ─── Duplicates ─── */

test("teamKey normalises club suffixes and accents", () => {
  assert.equal(teamKey("Getafe"), teamKey("Getafe CF"));
  assert.equal(teamKey("Atlético Madrid"), teamKey("Atletico Madrid"));
  assert.equal(teamKey("Real Betis"), teamKey("Real Betis SAD"));
});

test("sameTeamName merges city suffixes but keeps distinct clubs apart", () => {
  /* The live data spells these two ways, with different numbers each time. */
  assert.equal(sameTeamName("Espanyol", "Espanyol Barcelona"), true);
  assert.equal(sameTeamName("Getafe", "Getafe CF"), true);
  assert.equal(sameTeamName("Real Betis", "Real Betis Seville"), true);
  assert.equal(sameTeamName("Levante", "Levante UD"), true);
  /* A shared prefix is not enough: these are different clubs. */
  assert.equal(sameTeamName("Manchester United", "Manchester City"), false);
  assert.equal(sameTeamName("Real Madrid", "Real Sociedad"), false);
  assert.equal(sameTeamName("AC Milan", "Inter Milan"), false);
});

test("findDuplicateTeams flags conflicting numbers", () => {
  const rows: TeamStatsRow[] = [
    {
      team_name: "Espanyol",
      stats_goals_scored: { MP: "20", "Per Match": "1.50 Scored / match" },
      stats_goals_conceded: { MP: "20", "Per Match": "1.10 Conceded / match" },
    },
    {
      team_name: "Espanyol Barcelona",
      stats_goals_scored: { MP: "12", "Per Match": "1.00 Scored / match" },
      stats_goals_conceded: { MP: "12", "Per Match": "1.10 Conceded / match" },
    },
  ];
  const groups = findDuplicateTeams(rows);
  assert.equal(groups.length, 1);
  assert.equal(groups[0]!.conflicting, true);
  assert.equal(groups[0]!.rows.length, 2);
});

test("resolveTeamRow prefers the larger sample and warns", () => {
  const rows: TeamStatsRow[] = [
    { team_name: "Espanyol Barcelona", stats_goals_scored: { MP: "12", "Per Match": "1.00 Scored / match" }, stats_goals_conceded: { MP: "12", "Per Match": "1.1 Conceded / match" } },
    { team_name: "Espanyol", stats_goals_scored: { MP: "20", "Per Match": "1.50 Scored / match" }, stats_goals_conceded: { MP: "20", "Per Match": "1.1 Conceded / match" } },
  ];
  const { row, warnings } = resolveTeamRow(rows, "Espanyol");
  assert.equal(row?.team_name, "Espanyol");
  assert.ok(warnings.some((w) => w.includes("2 entri")));
});

test("resolveTeamRow finds a team that only exists under another spelling", () => {
  const rows: TeamStatsRow[] = [
    { team_name: "Real Betis Seville", stats_goals_scored: { MP: "20", "Per Match": "1.2 Scored / match" }, stats_goals_conceded: { MP: "20", "Per Match": "1.1 Conceded / match" } },
  ];
  const { row } = resolveTeamRow(rows, "Real Betis");
  assert.equal(row?.team_name, "Real Betis Seville");
});

test("resolveTeamRow returns null when the team is absent", () => {
  const { row, warnings } = resolveTeamRow([], "Tidak Ada FC");
  assert.equal(row, null);
  assert.ok(warnings[0]!.includes("tidak ada"));
});

/* ─── League averages ─── */

function leagueRows(count: number, home: number, away: number): TeamStatsRow[] {
  return Array.from({ length: count }, (_, i) => ({
    team_name: `Team ${i}`,
    stats_goals_scored: {
      MP: "20",
      Home: `${home} / match`,
      Away: `${away} / match`,
      "Per Match": `${((home + away) / 2).toFixed(2)} Scored / match`,
    },
    stats_goals_conceded: { MP: "20", "Per Match": "1.10 Conceded / match" },
  }));
}

test("computeLeagueAverages separates home and away rates", () => {
  const { averages, teamsUsed } = computeLeagueAverages(leagueRows(10, 1.7, 1.1));
  assert.ok(averages);
  assert.equal(averages.homeGoals, 1.7);
  assert.equal(averages.awayGoals, 1.1);
  assert.equal(teamsUsed, 10);
});

test("computeLeagueAverages refuses too few teams", () => {
  const { averages, warnings } = computeLeagueAverages(leagueRows(MIN_TEAMS_FOR_LEAGUE_AVERAGE - 1, 1.7, 1.1));
  assert.equal(averages, null);
  assert.ok(warnings.length > 0);
});

test("computeLeagueAverages refuses swapped home/away columns", () => {
  /* Away mean > home mean by more than 25% means the data is wrong somewhere. */
  const { averages, warnings } = computeLeagueAverages(leagueRows(12, 1.0, 2.0));
  assert.equal(averages, null);
  assert.ok(warnings.some((w) => w.includes("tertukar")));
});

/* ─── Odds selection ─── */

test("buildOddsInput uses one bookmaker, never a mix", () => {
  const result = buildOddsInput({
    matchWinner: [
      { bookmaker: "Bet365", home: 2.1, draw: 3.4, away: 3.6 },
      { bookmaker: "Pinnacle", home: 2.2, draw: 3.3, away: 3.5 },
    ],
    overUnder: [
      { bookmaker: "Bet365", line: 2.5, over: 1.95, under: 1.9 },
      { bookmaker: "Pinnacle", line: 2.5, over: 2.0, under: 1.85 },
    ],
    asianHandicap: [{ bookmaker: "Bet365", line: -0.5, home: 1.9, away: 1.95 }],
    btts: [{ bookmaker: "Bet365", yes: 1.8, no: 2.0 }],
  });
  assert.equal(result.bookmaker, "Bet365");
  assert.deepEqual(result.odds1x2, { home: 2.1, draw: 3.4, away: 3.6 });
  assert.equal(result.totals.length, 1);
  assert.equal(result.totals[0]!.overOdds, 1.95);
  assert.equal(result.ah.length, 1);
  assert.deepEqual(result.btts, { yes: 1.8, no: 2.0 });
});

test("buildOddsInput ignores invalid odds", () => {
  const result = buildOddsInput({
    matchWinner: [{ bookmaker: "X", home: 1.0, draw: 3.4, away: 3.6 }],
    overUnder: [], asianHandicap: [], btts: [],
  });
  assert.equal(result.odds1x2, null);
  assert.ok(result.warnings.length > 0);
});

test("buildOddsInput de-duplicates repeated lines", () => {
  const result = buildOddsInput({
    matchWinner: [{ bookmaker: "B", home: 2, draw: 3, away: 4 }],
    overUnder: [
      { bookmaker: "B", line: 2.5, over: 1.9, under: 1.9 },
      { bookmaker: "B", line: 2.5, over: 2.0, under: 1.8 },
    ],
    asianHandicap: [], btts: [],
  });
  assert.equal(result.totals.length, 1);
});

/* ─── End-to-end ─── */

function endToEndRows(): TeamStatsRow[] {
  return [
    ...leagueRows(10, 1.55, 1.15),
    {
      team_name: "Home FC",
      stats_goals_scored: { MP: "20", Home: "2.10 / match", Away: "1.30 / match", "Per Match": "1.70 Scored / match" },
      stats_goals_conceded: { MP: "20", Home: "0.80 / match", Away: "1.20 / match", "Per Match": "1.00 Conceded / match" },
      stats_xg: { xG: "1.85", xGA: "1.05", MP: "20" },
    },
    {
      team_name: "Away FC",
      stats_goals_scored: { MP: "20", Home: "1.60 / match", Away: "1.00 / match", "Per Match": "1.30 Scored / match" },
      stats_goals_conceded: { MP: "20", Home: "1.10 / match", Away: "1.60 / match", "Per Match": "1.35 Conceded / match" },
      stats_xg: { xG: "1.25", xGA: "1.45", MP: "20" },
    },
  ];
}

test("runQuantEngine produces a coherent analysis for valid input", () => {
  const result = runQuantEngine({
    homeTeam: "Home FC",
    awayTeam: "Away FC",
    leagueRows: endToEndRows(),
    structuredOdds: {
      matchWinner: [{ bookmaker: "Bet365", home: 2.05, draw: 3.5, away: 3.7 }],
      overUnder: [{ bookmaker: "Bet365", line: 2.5, over: 1.92, under: 1.94 }],
      asianHandicap: [{ bookmaker: "Bet365", line: -0.5, home: 1.95, away: 1.91 }],
      btts: [{ bookmaker: "Bet365", yes: 1.85, no: 1.95 }],
    },
  });

  assert.equal(result.usable, true);
  assert.ok(result.analysis);
  /* Every market must be priced, and the probabilities must be coherent. */
  assert.ok(result.analysis!.selections.length >= 8);
  const ml = result.analysis!.selections.filter((s) => s.family === "ML");
  const sum = ml.reduce((acc, s) => acc + s.pFinal, 0);
  assert.ok(Math.abs(sum - 1) < 1e-6, `1X2 probabilities sum to ${sum}`);
  /* Fair probability is de-vigged, so it must sit below the implied raw price. */
  const homeSel = ml.find((s) => s.key === "ML:home")!;
  assert.ok(homeSel.pMarket! < 1 / 2.05, "de-vig lowered the implied probability");
  assert.ok(result.analysis!.devig1x2.overround > 0);
});

test("runQuantEngine rejects a fixture missing league averages", () => {
  const result = runQuantEngine({
    homeTeam: "Home FC",
    awayTeam: "Away FC",
    leagueRows: endToEndRows().slice(0, 4),
    structuredOdds: {
      matchWinner: [{ bookmaker: "Bet365", home: 2.05, draw: 3.5, away: 3.7 }],
      overUnder: [], asianHandicap: [], btts: [],
    },
  });
  assert.equal(result.usable, false);
  assert.equal(result.analysis, null);
  assert.ok(result.warnings.some((w) => w.startsWith("ditolak:")));
});

test("runQuantEngine rejects a fixture with no 1X2 odds", () => {
  const result = runQuantEngine({
    homeTeam: "Home FC",
    awayTeam: "Away FC",
    leagueRows: endToEndRows(),
    structuredOdds: { matchWinner: [], overUnder: [], asianHandicap: [], btts: [] },
  });
  assert.equal(result.usable, false);
  assert.ok(result.warnings.some((w) => w.includes("1X2")));
});

test("runQuantEngine never throws on garbage input", () => {
  const result = runQuantEngine({
    homeTeam: "",
    awayTeam: "",
    leagueRows: [],
    structuredOdds: { matchWinner: [], overUnder: [], asianHandicap: [], btts: [] },
  });
  assert.equal(result.usable, false);
  assert.doesNotThrow(() => JSON.stringify(result.warnings));
});
