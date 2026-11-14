/**
 * Penyiapan sampel + laporan backtest model Poisson (lihat
 * lib/model-backtest.ts untuk metriknya).
 *
 * Desain anti look-ahead:
 * - Pertandingan: fixture 2026-27 yang sudah selesai.
 * - Kekuatan tim: HANYA statistik musim 2025-26 — diketahui sebelum musim
 *   berjalan dimulai. Statistik musim berjalan tidak dipakai karena
 *   agregatnya memuat pertandingan itu sendiri (dan sesudahnya).
 * - Pasar: snapshot ML terakhir sebelum kick-off, konsensus fair antar
 *   bookmaker (devig terburuk per bookmaker → median), sama seperti
 *   jalur live.
 *
 * Hasil di-cache 10 menit: laporan ini on-demand (panel Transparansi /
 * script audit), bukan jalur panas analisis.
 */
import { supabase } from "../lib/supabase-client";
import { logger } from "../lib/logger";
import { DEFAULT_LEAGUE, estimateLambdas, marketProbabilities, parseTeamRates, type LambdaParams, type TeamRatesParsed } from "../lib/match-context";
import { scoreMatrix } from "../lib/quant/poisson";
import { normalizeStatsRow } from "../lib/stats-integrity";
import { teamNamesEquivalent } from "../lib/team-name-cleaner";
import { classifyOddsMarket } from "../lib/odds-market";
import { consensusFairProbability } from "../lib/betting-math";
import {
  buildCalibrationExperiment,
  buildModelBacktest,
  type BacktestSample,
  type CalibrationExperiment,
  type LambdaParamCombo,
  type ModelBacktestReport,
  type PairedMetric,
} from "../lib/model-backtest";
import { RollingFormTracker } from "../lib/rolling-form";
import type { LeagueAverages } from "../lib/quant/strength";

/** Liga yang punya statistik 2025-26 untuk dipakai sebagai prior. */
const BACKTEST_LEAGUES: Record<string, string> = {
  "england-premier-league": "england-premier-league",
  "italy-serie-a": "italy-serie-a",
  "netherlands-eredivisie": "netherlands-eredivisie",
  "france-ligue-1": "france-ligue-1",
  "spain-laliga": "spain-laliga",
  "germany-bundesliga": "germany-bundesliga",
  /* fixtures memakai ejaan ini; team_season_stats memakai south-korea-*. */
  "republic-of-korea-k-league-1": "south-korea-k-league-1",
};
const PRIOR_SEASON = "2025-26";
const FIXTURES_FROM = "2026-08-01";

export interface ModelBacktestResult {
  generatedAt: string;
  fixturesTotal: number;
  skippedNoStats: number;
  skippedNoMarket: number;
  report: ModelBacktestReport;
  calibration: CalibrationExperiment;
  infoVariants: InfoVariantResult[];
}

export interface InfoVariantResult {
  key: "prior_only" | "form_only" | "prior_plus_form";
  label: string;
  n: number;
  modelLogLoss: number;
  vsMarket: PairedMetric | null;
}

/** Parameter bawaan produksi saat ini (lib/match-context.ts). */
const DEFAULT_PARAMS: LambdaParamCombo = { xgWeight: 0.6, shrinkK: 6 };
/** Grid kalibrasi: dipilih kasar dengan sengaja — grid halus di n kecil = overfitting. */
const PARAM_GRID: LambdaParamCombo[] = [0, 0.3, 0.6, 0.8, 1.0]
  .flatMap((xgWeight) => [0, 3, 6, 12].map((shrinkK) => ({ xgWeight, shrinkK })));

interface PreparedFixture {
  id: string;
  league: string;
  kickoff: string;
  homeRates: TeamRatesParsed;
  awayRates: TeamRatesParsed;
  /** Form musim berjalan point-in-time (null = belum ada laga musim ini). */
  formHome: TeamRatesParsed | null;
  formAway: TeamRatesParsed | null;
  leagueAvg: LeagueAverages;
  market: BacktestSample["market"];
  actual: BacktestSample["actual"];
}

function buildSamples(
  prepared: PreparedFixture[],
  lambdasOf: (fixture: PreparedFixture) => { lambdaHome: number; lambdaAway: number },
): BacktestSample[] {
  return prepared.map((fixture) => {
    const lambdas = lambdasOf(fixture);
    const probs = marketProbabilities(scoreMatrix(lambdas.lambdaHome, lambdas.lambdaAway));
    return {
      id: fixture.id,
      league: fixture.league,
      kickoff: fixture.kickoff,
      model: {
        home: probs.homeWin, draw: probs.draw, away: probs.awayWin,
        over25: probs.over25, bttsYes: probs.bttsYes,
      },
      market: fixture.market,
      actual: fixture.actual,
    };
  });
}

function samplesFor(prepared: PreparedFixture[], params: LambdaParams): BacktestSample[] {
  return buildSamples(prepared, (fixture) =>
    estimateLambdas(fixture.homeRates, fixture.awayRates, fixture.leagueAvg, params));
}

type StatsRow = Record<string, unknown> & { league_slug: string; team_name: string };

function leagueAverages(rows: StatsRow[]): LeagueAverages {
  const home: number[] = [];
  const away: number[] = [];
  for (const row of rows) {
    const rates = parseTeamRates(normalizeStatsRow(row).stats);
    if (rates.goalsForHome != null) home.push(rates.goalsForHome);
    if (rates.goalsForAway != null) away.push(rates.goalsForAway);
  }
  if (home.length < 8 || away.length < 8) return DEFAULT_LEAGUE;
  const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
  return { homeGoals: Number(mean(home).toFixed(3)), awayGoals: Number(mean(away).toFixed(3)) };
}

let cached: { at: number; value: ModelBacktestResult } | null = null;
const CACHE_TTL_MS = 10 * 60 * 1000;

export async function getModelBacktest(force = false): Promise<ModelBacktestResult> {
  if (!force && cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value;
  if (!supabase) throw new Error("Supabase client not initialised");

  const fixtureLeagues = Object.keys(BACKTEST_LEAGUES);
  const { data: fixtures, error: fixturesError } = await supabase
    .from("fixtures")
    .select("fixture_id, league_name, fixture_date, home_team_name, away_team_name, home_goals, away_goals")
    .in("league_name", fixtureLeagues)
    .gte("fixture_date", FIXTURES_FROM)
    .not("home_goals", "is", null)
    .limit(2000);
  if (fixturesError) throw new Error(`fixtures: ${fixturesError.message}`);

  const { data: stats, error: statsError } = await supabase
    .from("team_season_stats")
    .select("league_slug, team_name, stats_xg, stats_goals_scored, stats_goals_conceded, stats_team_form")
    .eq("season", PRIOR_SEASON)
    .in("league_slug", Object.values(BACKTEST_LEAGUES))
    .limit(500);
  if (statsError) throw new Error(`team_season_stats: ${statsError.message}`);

  const statsByLeague = new Map<string, StatsRow[]>();
  for (const row of (stats ?? []) as StatsRow[]) {
    const arr = statsByLeague.get(row.league_slug) ?? [];
    arr.push(row);
    statsByLeague.set(row.league_slug, arr);
  }
  const averagesByLeague = new Map<string, LeagueAverages>();
  for (const [league, rows] of statsByLeague) averagesByLeague.set(league, leagueAverages(rows));

  /* Snapshot ML per fixture (baris diperbarui di tempat oleh sync, jadi
     volume per match kecil). Diambil per potongan id agar respons tidak
     terpotong batas 1000 baris PostgREST. */
  const fixtureRows = (fixtures ?? []) as Array<Record<string, unknown>>;
  const ids = fixtureRows.map((f) => String(f["fixture_id"]));
  const oddsByMatch = new Map<string, Array<Record<string, unknown>>>();
  for (let i = 0; i < ids.length; i += 25) {
    const { data, error } = await supabase
      .from("odds_history")
      .select("match_id, bookmaker, market_type, odds_1, odds_2, odds_draw, captured_at")
      .in("match_id", ids.slice(i, i + 25))
      .eq("market_type", "ML")
      .order("captured_at", { ascending: false })
      .limit(1000);
    if (error) throw new Error(`odds_history: ${error.message}`);
    for (const row of (data ?? []) as Array<Record<string, unknown>>) {
      if (classifyOddsMarket(row["market_type"]) !== "ML") continue;
      const arr = oddsByMatch.get(String(row["match_id"])) ?? [];
      arr.push(row);
      oddsByMatch.set(String(row["match_id"]), arr);
    }
  }

  const prepared: PreparedFixture[] = [];
  let skippedNoStats = 0;
  let skippedNoMarket = 0;
  for (const fixture of fixtureRows) {
    const league = BACKTEST_LEAGUES[String(fixture["league_name"])] ?? String(fixture["league_name"]);
    const rows = statsByLeague.get(league) ?? [];
    const universe = rows.map((r) => r.team_name);
    const find = (team: string) =>
      rows.find((r) => teamNamesEquivalent(team, r.team_name, league, universe));
    const homeRow = find(String(fixture["home_team_name"]));
    const awayRow = find(String(fixture["away_team_name"]));
    if (!homeRow || !awayRow) {
      skippedNoStats++;
      continue;
    }

    const kickoffMs = new Date(String(fixture["fixture_date"])).getTime();
    const prematch = (oddsByMatch.get(String(fixture["fixture_id"])) ?? [])
      .filter((r) => r["captured_at"] && new Date(String(r["captured_at"])).getTime() < kickoffMs);
    let market: BacktestSample["market"] = null;
    if (prematch.length > 0) {
      const latestTs = Math.max(...prematch.map((r) => new Date(String(r["captured_at"])).getTime()));
      const byBookmaker = new Map<string, [number, number, number]>();
      for (const r of prematch) {
        if (new Date(String(r["captured_at"])).getTime() !== latestTs) continue;
        if (r["odds_1"] != null && r["odds_draw"] != null && r["odds_2"] != null) {
          byBookmaker.set(String(r["bookmaker"] ?? "?"), [Number(r["odds_1"]), Number(r["odds_draw"]), Number(r["odds_2"])]);
        }
      }
      const books = [...byBookmaker.values()];
      const home = consensusFairProbability(books, 0);
      const draw = consensusFairProbability(books, 1);
      const away = consensusFairProbability(books, 2);
      if (home != null && draw != null && away != null) {
        const total = home + draw + away;
        market = { home: home / total, draw: draw / total, away: away / total };
      }
    }
    if (market == null) skippedNoMarket++;

    prepared.push({
      id: String(fixture["fixture_id"]),
      league,
      kickoff: String(fixture["fixture_date"]),
      homeRates: parseTeamRates(normalizeStatsRow(homeRow).stats),
      awayRates: parseTeamRates(normalizeStatsRow(awayRow).stats),
      formHome: null,
      formAway: null,
      leagueAvg: averagesByLeague.get(league) ?? DEFAULT_LEAGUE,
      market,
      actual: { homeGoals: Number(fixture["home_goals"]), awayGoals: Number(fixture["away_goals"]) },
    });
  }

  /*
   * Rekonstruksi form musim berjalan point-in-time dari SELURUH hasil
   * liga (termasuk lawan tim promosi yang sampelnya sendiri dilewati):
   * untuk setiap fixture, rates dibaca sebelum hasilnya dicatat.
   */
  const preparedById = new Map(prepared.map((fixture) => [fixture.id, fixture]));
  const tracker = new RollingFormTracker();
  const chronologicalFixtures = [...fixtureRows].sort((a, b) =>
    String(a["fixture_date"]).localeCompare(String(b["fixture_date"])),
  );
  for (const fixture of chronologicalFixtures) {
    const league = BACKTEST_LEAGUES[String(fixture["league_name"])] ?? String(fixture["league_name"]);
    const homeKey = `${league}:${String(fixture["home_team_name"]).trim().toLowerCase()}`;
    const awayKey = `${league}:${String(fixture["away_team_name"]).trim().toLowerCase()}`;
    const target = preparedById.get(String(fixture["fixture_id"]));
    if (target) {
      target.formHome = tracker.ratesFor(homeKey);
      target.formAway = tracker.ratesFor(awayKey);
    }
    tracker.record(homeKey, awayKey, Number(fixture["home_goals"]), Number(fixture["away_goals"]));
  }

  const samples = samplesFor(prepared, DEFAULT_PARAMS);

  /*
   * Eksperimen informasi: apakah yang hilang dari model adalah FORM
   * MUSIM BERJALAN (yang dimiliki pasar)? Tiga varian, sampel identik:
   * prior-only (baseline), form-only (fallback prior bila belum ada
   * laga), dan campuran λ berbobot jumlah laga form /(laga + K).
   */
  const formSamples = buildSamples(prepared, (fixture) =>
    estimateLambdas(
      fixture.formHome ?? fixture.homeRates,
      fixture.formAway ?? fixture.awayRates,
      fixture.leagueAvg,
    ));
  const blendedSamples = buildSamples(prepared, (fixture) => {
    const prior = estimateLambdas(fixture.homeRates, fixture.awayRates, fixture.leagueAvg);
    if (!fixture.formHome || !fixture.formAway) return prior;
    const form = estimateLambdas(fixture.formHome, fixture.formAway, fixture.leagueAvg);
    const formMatches = Math.min(fixture.formHome.matches ?? 0, fixture.formAway.matches ?? 0);
    const w = formMatches / (formMatches + DEFAULT_PARAMS.shrinkK);
    return {
      lambdaHome: w * form.lambdaHome + (1 - w) * prior.lambdaHome,
      lambdaAway: w * form.lambdaAway + (1 - w) * prior.lambdaAway,
    };
  });
  const variantOf = (
    key: InfoVariantResult["key"], label: string, variantSamples: BacktestSample[],
  ): InfoVariantResult => {
    const result = buildModelBacktest(variantSamples);
    return { key, label, n: result.samples, modelLogLoss: result.oneX2.modelLogLoss, vsMarket: result.oneX2.vsMarket };
  };
  const infoVariants: InfoVariantResult[] = [
    variantOf("prior_only", "Prior musim lalu saja (model saat ini)", samples),
    variantOf("form_only", "Form musim berjalan saja", formSamples),
    variantOf("prior_plus_form", "Prior + form musim berjalan (campuran λ)", blendedSamples),
  ];

  /*
   * Eksperimen kalibrasi: separuh pertama (kronologis) memilih kombinasi,
   * separuh kedua menghakiminya. Hanya fixture dengan pasar yang masuk
   * penilaian skill — tanpa pembanding pasar, "terbaik" tidak terdefinisi.
   */
  const chronological = [...prepared].sort((a, b) => a.kickoff.localeCompare(b.kickoff));
  const splitAt = Math.floor(chronological.length / 2);
  const trainPrepared = chronological.slice(0, splitAt);
  const validationPrepared = chronological.slice(splitAt);
  const trainSkills = PARAM_GRID.map((combo) =>
    buildModelBacktest(samplesFor(trainPrepared, combo)).oneX2.vsMarket?.skill ?? null,
  );
  const validationMetrics = PARAM_GRID.map((combo) =>
    buildModelBacktest(samplesFor(validationPrepared, combo)).oneX2.vsMarket,
  );
  const calibration = buildCalibrationExperiment(
    PARAM_GRID,
    trainSkills,
    validationMetrics,
    DEFAULT_PARAMS,
    trainPrepared.length,
    validationPrepared.length,
  );

  const value: ModelBacktestResult = {
    generatedAt: new Date().toISOString(),
    fixturesTotal: fixtureRows.length,
    skippedNoStats,
    skippedNoMarket,
    report: buildModelBacktest(samples),
    calibration,
    infoVariants,
  };
  cached = { at: Date.now(), value };
  logger.info(
    { samples: samples.length, skippedNoStats, skippedNoMarket },
    "[MODEL-BACKTEST] laporan dibuat",
  );
  return value;
}
