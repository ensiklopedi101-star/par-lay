/**
 * Backtest gudang riset (research_matches) — model Poisson dinilai di
 * ±16 ribu pertandingan historis, bukan ±150 baris produksi.
 *
 * Yang diuji persisnya: inti Poisson sistem (λ dari laju gol venue
 * musim sebelumnya + matriks Dixon-Coles) melawan odds historis
 * dataset. Lapisan xG produksi tidak ada di data historis, jadi ini
 * menguji fondasi model pada skala yang layak — dan memberi panggung
 * yang adil untuk fitur baru (Elo) sebelum menyentuh jalur live.
 *
 * Anti look-ahead: kekuatan tim untuk musim S dihitung HANYA dari
 * pertandingan musim S−1 divisi yang sama. Tim promosi (tidak punya
 * musim sebelumnya di divisi itu) dilewati dan dihitung terbuka.
 */
import { estimateLambdas, marketProbabilities, type TeamRatesParsed } from "./match-context";
import { handicapOutcome, scoreMatrix, winShare } from "./quant/poisson";
import type { LeagueAverages } from "./quant/strength";
import { buildModelBacktest, type BacktestSample, type ModelBacktestReport } from "./model-backtest";

export interface WarehouseMatch {
  league_slug: string;
  match_date: string;
  home_team: string;
  away_team: string;
  home_elo: number | null;
  away_elo: number | null;
  ft_home: number | null;
  ft_away: number | null;
  odd_home: number | null;
  odd_draw: number | null;
  odd_away: number | null;
  over25: number | null;
  under25: number | null;
  handi_size: number | null;
  handi_home: number | null;
  handi_away: number | null;
}

/** Musim Eropa dimulai Agustus: Agu–Des = tahun berjalan, Jan–Jul = tahun−1. */
export function seasonStartYear(matchDate: string): number {
  const year = Number(matchDate.slice(0, 4));
  const month = Number(matchDate.slice(5, 7));
  return month >= 7 ? year : year - 1;
}

interface TeamAccum {
  matches: number;
  gf: number;
  ga: number;
  homeMatches: number;
  homeGf: number;
  homeGa: number;
  awayMatches: number;
  awayGf: number;
  awayGa: number;
}

const emptyAccum = (): TeamAccum => ({
  matches: 0, gf: 0, ga: 0,
  homeMatches: 0, homeGf: 0, homeGa: 0,
  awayMatches: 0, awayGf: 0, awayGa: 0,
});

const per = (total: number, n: number): number | null => (n > 0 ? total / n : null);

function toRates(acc: TeamAccum): TeamRatesParsed {
  return {
    matches: acc.matches,
    goalsFor: per(acc.gf, acc.matches),
    goalsAgainst: per(acc.ga, acc.matches),
    goalsForHome: per(acc.homeGf, acc.homeMatches),
    goalsForAway: per(acc.awayGf, acc.awayMatches),
    goalsAgainstHome: per(acc.homeGa, acc.homeMatches),
    goalsAgainstAway: per(acc.awayGa, acc.awayMatches),
    xgFor: null,
    xgAgainst: null,
    xgResidual: null,
    btts: null,
    bttsHome: null,
    bttsAway: null,
    fts: null,
    ftsHome: null,
    shotsOver105: null,
    formPoints: null,
    formMatches: acc.matches,
    formPpg: null,
    last6: null,
    htWin: null,
  };
}

/**
 * Penyesuaian Elo ke λ: selisih Elo 400 poin ≈ faktor e^k pada λ
 * kandang dan e^−k pada λ tandang. k=0 berarti Elo tidak dipakai.
 * Elo dataset adalah rating klub (bukan venue), jadi penyesuaiannya
 * simetris — venue tetap urusan λ dasar.
 */
export function eloAdjustedLambdas(
  lambdas: { lambdaHome: number; lambdaAway: number },
  homeElo: number | null,
  awayElo: number | null,
  k: number,
): { lambdaHome: number; lambdaAway: number } {
  if (k === 0 || homeElo == null || awayElo == null) return lambdas;
  const factor = Math.exp((k * (homeElo - awayElo)) / 400);
  return {
    lambdaHome: Math.min(4.5, Math.max(0.2, lambdas.lambdaHome * factor)),
    lambdaAway: Math.min(4.0, Math.max(0.15, lambdas.lambdaAway / factor)),
  };
}

function impliedMarket(match: WarehouseMatch): BacktestSample["market"] {
  if (!match.odd_home || !match.odd_draw || !match.odd_away) return null;
  if (match.odd_home <= 1 || match.odd_draw <= 1 || match.odd_away <= 1) return null;
  const raw = [1 / match.odd_home, 1 / match.odd_draw, 1 / match.odd_away];
  const total = raw[0]! + raw[1]! + raw[2]!;
  return { home: raw[0]! / total, draw: raw[1]! / total, away: raw[2]! / total };
}

function impliedOver25(match: WarehouseMatch): number | null {
  if (!match.over25 || !match.under25 || match.over25 <= 1 || match.under25 <= 1) return null;
  const rawOver = 1 / match.over25;
  const rawUnder = 1 / match.under25;
  return rawOver / (rawOver + rawUnder);
}

export interface WarehousePreparation {
  samples: BacktestSample[];
  /** Sampel yang sama tetapi λ disesuaikan Elo dengan kekuatan k. */
  eloSamples: (k: number) => BacktestSample[];
  considered: number;
  skippedNoPrior: number;
  skippedNoMarket: number;
}

/**
 * Siapkan sampel backtest dari baris gudang. `matches` harus hanya
 * pertandingan yang benar-benar sudah dimainkan (penyaringan tanggal
 * & skor adalah tanggung jawab pemanggil, dan dihitung di laporan).
 */
export function prepareWarehouseSamples(matches: WarehouseMatch[]): WarehousePreparation {
  const sorted = [...matches].sort((a, b) => a.match_date.localeCompare(b.match_date));

  /* Agregat per (divisi, musim): dipakai sebagai prior untuk musim berikutnya. */
  const seasonAccum = new Map<string, Map<string, TeamAccum>>();
  const seasonLeagueGoals = new Map<string, { home: number; away: number; matches: number }>();
  const keyOf = (league: string, season: number) => `${league}|${season}`;
  for (const match of sorted) {
    if (match.ft_home == null || match.ft_away == null) continue;
    const season = seasonStartYear(match.match_date);
    const key = keyOf(match.league_slug, season);
    const teams = seasonAccum.get(key) ?? new Map<string, TeamAccum>();
    const home = teams.get(match.home_team) ?? emptyAccum();
    home.matches++; home.gf += match.ft_home; home.ga += match.ft_away;
    home.homeMatches++; home.homeGf += match.ft_home; home.homeGa += match.ft_away;
    teams.set(match.home_team, home);
    const away = teams.get(match.away_team) ?? emptyAccum();
    away.matches++; away.gf += match.ft_away; away.ga += match.ft_home;
    away.awayMatches++; away.awayGf += match.ft_away; away.awayGa += match.ft_home;
    teams.set(match.away_team, away);
    seasonAccum.set(key, teams);
    const goals = seasonLeagueGoals.get(key) ?? { home: 0, away: 0, matches: 0 };
    goals.home += match.ft_home; goals.away += match.ft_away; goals.matches++;
    seasonLeagueGoals.set(key, goals);
  }

  interface PreparedRow {
    match: WarehouseMatch;
    lambdas: { lambdaHome: number; lambdaAway: number };
    market: BacktestSample["market"];
    marketOver25: number | null;
  }
  const prepared: PreparedRow[] = [];
  let skippedNoPrior = 0;
  let skippedNoMarket = 0;

  for (const match of sorted) {
    if (match.ft_home == null || match.ft_away == null) continue;
    const season = seasonStartYear(match.match_date);
    const priorKey = keyOf(match.league_slug, season - 1);
    const priorTeams = seasonAccum.get(priorKey);
    const homeAcc = priorTeams?.get(match.home_team);
    const awayAcc = priorTeams?.get(match.away_team);
    if (!homeAcc || !awayAcc || homeAcc.matches < 10 || awayAcc.matches < 10) {
      skippedNoPrior++;
      continue;
    }
    const goals = seasonLeagueGoals.get(priorKey);
    const league: LeagueAverages = goals && goals.matches >= 50
      ? { homeGoals: goals.home / goals.matches, awayGoals: goals.away / goals.matches }
      : { homeGoals: 1.45, awayGoals: 1.15 };
    const lambdas = estimateLambdas(toRates(homeAcc), toRates(awayAcc), league);
    const market = impliedMarket(match);
    if (market == null) skippedNoMarket++;
    prepared.push({ match, lambdas, market, marketOver25: impliedOver25(match) });
  }

  const toSample = (row: PreparedRow, lambdas: { lambdaHome: number; lambdaAway: number }): BacktestSample => {
    const matrix = scoreMatrix(lambdas.lambdaHome, lambdas.lambdaAway);
    const probs = marketProbabilities(matrix);
    const ah = row.match.handi_size != null
      && row.match.handi_home != null && row.match.handi_home > 1
      && row.match.handi_away != null && row.match.handi_away > 1
      ? {
        line: row.match.handi_size,
        modelHomeCover: winShare(handicapOutcome(matrix, row.match.handi_size, "home")),
        marketHomeFair: (() => {
          const rawHome = 1 / row.match.handi_home!;
          const rawAway = 1 / row.match.handi_away!;
          return Math.min(0.999, Math.max(0.001, rawHome / (rawHome + rawAway)));
        })(),
      }
      : null;
    return {
      id: `${row.match.league_slug}|${row.match.match_date}|${row.match.home_team}|${row.match.away_team}`,
      league: row.match.league_slug,
      kickoff: row.match.match_date,
      model: {
        home: probs.homeWin, draw: probs.draw, away: probs.awayWin,
        over25: probs.over25, bttsYes: probs.bttsYes,
      },
      market: row.market,
      marketOver25: row.marketOver25,
      marketBttsYes: null,
      ah,
      actual: { homeGoals: row.match.ft_home!, awayGoals: row.match.ft_away! },
    };
  };

  return {
    samples: prepared.map((row) => toSample(row, row.lambdas)),
    eloSamples: (k: number) =>
      prepared.map((row) =>
        toSample(row, eloAdjustedLambdas(row.lambdas, row.match.home_elo, row.match.away_elo, k))),
    considered: prepared.length + skippedNoPrior,
    skippedNoPrior,
    skippedNoMarket,
  };
}

export interface WarehouseMetricSummary {
  n: number;
  modelLogLoss: number;
  vsMarket: { n: number; skill: number; tStat: number | null } | null;
  over25VsMarket: { n: number; skill: number; tStat: number | null } | null;
}

export function summarizeWarehouse(report: ModelBacktestReport): WarehouseMetricSummary {
  return {
    n: report.samples,
    modelLogLoss: report.oneX2.modelLogLoss,
    vsMarket: report.oneX2.vsMarket,
    over25VsMarket: report.over25VsMarket,
  };
}

export { buildModelBacktest };
