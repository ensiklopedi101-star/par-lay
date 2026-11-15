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
  /** Baris mentah terpersiapkan (dengan odds) untuk simulasi strategi tiket. */
  preparedRows: PreparedWarehouseRow[];
}

export interface PreparedWarehouseRow {
  match: WarehouseMatch;
  lambdas: { lambdaHome: number; lambdaAway: number };
  market: BacktestSample["market"];
  marketOver25: number | null;
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

  const prepared: PreparedWarehouseRow[] = [];
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

  const toSample = (row: PreparedWarehouseRow, lambdas: { lambdaHome: number; lambdaAway: number }): BacktestSample => {
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
    preparedRows: prepared,
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

/* ───────────── Simulasi strategi tiket (pembuktian pasar-dulu) ───────────── */

export interface TicketStrategyResult {
  strategy: "pasar-dulu" | "model-dulu" | "pasar+filter-statistik";
  tickets: number;
  legsUsed: number;
  legHitRate: number | null;
  ticketHitRate: number | null;
  avgCombinedOdds: number | null;
  /** ROI per unit taruhan datar pada tiket mingguan yang terbentuk. */
  roi: number | null;
}

type Side = "home" | "draw" | "away";

interface StrategyLeg {
  prob: number;
  odds: number;
  won: boolean;
}

function weekKey(matchDate: string): string {
  const d = new Date(`${matchDate}T00:00:00Z`);
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day);
  return d.toISOString().slice(0, 10);
}

function argmaxSide(probs: { home: number; draw: number; away: number }): Side {
  if (probs.home >= probs.draw && probs.home >= probs.away) return "home";
  return probs.draw >= probs.away ? "draw" : "away";
}

/**
 * Simulasi penyusunan tiket mingguan 5–8 leg dari data gudang.
 * Tiga strategi dibandingkan pada kumpulan pertandingan yang sama:
 *  - pasar-dulu: leg favorit pasar (peluang fair tertinggi ≥ ambang).
 *  - model-dulu: leg favorit model Poisson (≥ ambang menurut model).
 *  - pasar+filter-statistik: favorit pasar yang juga favorit model.
 * Tiket dibentuk per pekan (Senin) lintas liga, maksimal 8 leg
 * berpeluang tertinggi; pekan dengan <5 kandidat dilewati.
 */
export function simulateTicketStrategies(
  rows: PreparedWarehouseRow[],
  minProb = 0.6,
): TicketStrategyResult[] {
  const strategies: TicketStrategyResult["strategy"][] = [
    "pasar-dulu", "model-dulu", "pasar+filter-statistik",
  ];
  const legsByStrategyWeek = new Map<string, StrategyLeg[]>();

  for (const row of rows) {
    const { match } = row;
    if (!row.market || match.ft_home == null || match.ft_away == null) continue;
    const matrix = scoreMatrix(row.lambdas.lambdaHome, row.lambdas.lambdaAway);
    const modelRaw = marketProbabilities(matrix);
    const model = { home: modelRaw.homeWin, draw: modelRaw.draw, away: modelRaw.awayWin };
    const actualSide: Side = match.ft_home > match.ft_away ? "home" : match.ft_home < match.ft_away ? "away" : "draw";
    const oddsOf = (side: Side): number | null =>
      side === "home" ? match.odd_home : side === "draw" ? match.odd_draw : match.odd_away;

    const marketSide = argmaxSide(row.market);
    const modelSide = argmaxSide(model);
    const picks: Array<{ strategy: TicketStrategyResult["strategy"]; side: Side; prob: number }> = [];
    if (row.market[marketSide] >= minProb) {
      picks.push({ strategy: "pasar-dulu", side: marketSide, prob: row.market[marketSide] });
      if (modelSide === marketSide) {
        picks.push({ strategy: "pasar+filter-statistik", side: marketSide, prob: row.market[marketSide] });
      }
    }
    if (model[modelSide] >= minProb) {
      picks.push({ strategy: "model-dulu", side: modelSide, prob: model[modelSide] });
    }
    for (const pick of picks) {
      const odds = oddsOf(pick.side);
      if (!odds || odds <= 1) continue;
      const key = `${pick.strategy}|${weekKey(match.match_date)}`;
      const list = legsByStrategyWeek.get(key) ?? [];
      list.push({ prob: pick.prob, odds, won: pick.side === actualSide });
      legsByStrategyWeek.set(key, list);
    }
  }

  return strategies.map((strategy) => {
    let tickets = 0;
    let ticketsWon = 0;
    let legsUsed = 0;
    let legsWon = 0;
    let oddsSum = 0;
    let profit = 0;
    for (const [key, legs] of legsByStrategyWeek) {
      if (!key.startsWith(`${strategy}|`)) continue;
      const chosen = [...legs].sort((a, b) => b.prob - a.prob).slice(0, 8);
      if (chosen.length < 5) continue;
      tickets++;
      legsUsed += chosen.length;
      legsWon += chosen.filter((l) => l.won).length;
      const combinedOdds = chosen.reduce((acc, l) => acc * l.odds, 1);
      oddsSum += combinedOdds;
      const won = chosen.every((l) => l.won);
      if (won) ticketsWon++;
      profit += won ? combinedOdds - 1 : -1;
    }
    return {
      strategy,
      tickets,
      legsUsed,
      legHitRate: legsUsed > 0 ? legsWon / legsUsed : null,
      ticketHitRate: tickets > 0 ? ticketsWon / tickets : null,
      avgCombinedOdds: tickets > 0 ? oddsSum / tickets : null,
      roi: tickets > 0 ? profit / tickets : null,
    };
  });
}
