/**
 * Orkestrator analisis satu pertandingan (menggantikan peran LLM sebagai
 * penghasil probabilitas).
 *
 * Alur:
 *   odds bandar → de-vig → invers ke λ pasar
 *   statistik tim → shrinkage → λ model
 *   λ akhir = pooling geometrik(λ pasar, λ model; bobot w)
 *   satu matriks skor → probabilitas SEMUA market yang ditawarkan
 *   EV, EV konservatif (− σ·odds), stake fractional Kelly, gerbang keputusan
 */

import { devig, type DevigMethod } from "./devig";
import {
  bttsProb,
  evOfOutcome,
  fitMarketLambdas,
  handicapOutcome,
  matchResultProbs,
  scoreMatrix,
  totalsOutcome,
  winShare,
  type LineOutcome,
  type ScoreMatrix,
} from "./poisson";
import { modelLambdas, type LeagueAverages, type LlmAdjustment, type TeamRates } from "./strength";
import { blendLambdas, defaultModelWeight } from "./blend";
import { stakePlan } from "./kelly";

export interface OfferedTotals { line: number; overOdds: number; underOdds: number }
export interface OfferedAH { line: number; homeOdds: number; awayOdds: number }

export interface MatchInput {
  odds1x2: { home: number; draw: number; away: number };
  totals?: OfferedTotals[];
  btts?: { yes: number; no: number } | null;
  ah?: OfferedAH[];
  league: LeagueAverages;
  home: TeamRates;
  away: TeamRates;
  rho?: number;
  devigMethod?: DevigMethod;
  /** null/undefined → otomatis dari reliability data */
  modelWeight?: number | null;
  adjustment?: LlmAdjustment | null;
  /** EV minimum (nominal) agar bet layak */
  minEv?: number;
  kellyFraction?: number;
  maxStakePct?: number;
}

export interface SelectionEval {
  key: string;
  label: string;
  family: "ML" | "Totals" | "AH" | "BTTS";
  odds: number;
  line: number | null;
  /** probabilitas efektif akhir (porsi menang, push dikeluarkan) */
  pFinal: number;
  /** probabilitas fair pasar (de-vig) */
  pMarket: number | null;
  /** probabilitas model statistik murni, tanpa pasar */
  pModelOnly: number;
  outcome: LineOutcome;
  ev: number;
  evConservative: number;
  sigma: number;
  stakePct: number;
  minOdds: number;
  passes: boolean;
  rejectReasons: string[];
}

export interface MatchAnalysis {
  devig1x2: { probs: { home: number; draw: number; away: number }; overround: number; usedMethod: string };
  marketLambdas: { lambdaHome: number; lambdaAway: number; fitError: number };
  modelLambdas: { lambdaHome: number; lambdaAway: number; reliability: number };
  finalLambdas: { lambdaHome: number; lambdaAway: number };
  modelWeight: number;
  fairResult: { home: number; draw: number; away: number };
  fairBtts: { yes: number; no: number };
  topScores: Array<{ score: string; p: number }>;
  selections: SelectionEval[];
  best: SelectionEval | null;
  decision: "BET" | "NO_BET";
  warnings: string[];
}

const pairFair = (a: number, b: number, method: DevigMethod) => devig([a, b], method).probs;

function topScores(M: ScoreMatrix, count = 6) {
  const flat: Array<{ score: string; p: number }> = [];
  for (let h = 0; h <= 6; h++) for (let a = 0; a <= 6; a++) flat.push({ score: `${h}-${a}`, p: M.m[h]![a]! });
  return flat.sort((x, y) => y.p - x.p).slice(0, count);
}

function pickFitTotals(totals: OfferedTotals[] | undefined): OfferedTotals | null {
  if (!totals || totals.length === 0) return null;
  const nonQuarter = totals.filter((t) => Math.abs(t.line * 2 - Math.round(t.line * 2)) < 1e-9);
  const pool = nonQuarter.length ? nonQuarter : totals;
  return pool.slice().sort((a, b) => Math.abs(a.line - 2.5) - Math.abs(b.line - 2.5))[0]!;
}

export function analyzeMatch(input: MatchInput): MatchAnalysis {
  const method = input.devigMethod ?? "shin";
  const rho = input.rho ?? -0.1;
  const minEv = input.minEv ?? 0.03;
  const warnings: string[] = [];

  // 1) pasar → fair
  const d1 = devig([input.odds1x2.home, input.odds1x2.draw, input.odds1x2.away], method);
  const fair1x2 = { home: d1.probs[0]!, draw: d1.probs[1]!, away: d1.probs[2]! };

  const fitTotals = pickFitTotals(input.totals);
  let overFair: number | undefined;
  if (fitTotals) overFair = pairFair(fitTotals.overOdds, fitTotals.underOdds, method)[0]!;

  const mkt = fitMarketLambdas(
    { ...fair1x2, ouLine: fitTotals?.line, overFair, priorTotal: (input.league.homeGoals + input.league.awayGoals) },
    rho,
  );
  if (mkt.error > 0.004) warnings.push("Harga pasar kurang konsisten dengan model Poisson (galat fitting tinggi) — hati-hati, mungkin odds tidak sinkron waktu.");
  if (!fitTotals) warnings.push("Tanpa odds Over/Under, total gol tidak terkunci ke pasar — gunakan odds O/U agar probabilitas lebih andal.");

  // 2) statistik → model
  const model = modelLambdas(input.home, input.away, input.league);
  let mdl = { lambdaHome: model.lambdaHome, lambdaAway: model.lambdaAway };
  if (input.adjustment) {
    mdl = {
      lambdaHome: mdl.lambdaHome * input.adjustment.lambdaHomeMult,
      lambdaAway: mdl.lambdaAway * input.adjustment.lambdaAwayMult,
    };
  }
  if (Math.min(input.home.matches, input.away.matches) < 6) {
    warnings.push("Sampel musim berjalan < 6 laga: model otomatis banyak bersandar ke pasar dan prior musim lalu.");
  }

  // 3) blend
  const w = input.modelWeight != null ? input.modelWeight : defaultModelWeight(model.reliability);
  const finalL = blendLambdas(mkt, mdl, w);

  const MF = scoreMatrix(finalL.lambdaHome, finalL.lambdaAway, rho);
  const MM = scoreMatrix(mdl.lambdaHome, mdl.lambdaAway, rho);
  const fairResult = matchResultProbs(MF);
  const fairBtts = bttsProb(MF);
  const modelResult = matchResultProbs(MM);
  const modelBtts = bttsProb(MM);

  const sigma = 0.02 + 0.03 * (1 - model.reliability);
  const selections: SelectionEval[] = [];

  const push = (
    key: string,
    label: string,
    family: SelectionEval["family"],
    odds: number,
    line: number | null,
    outcomeFinal: LineOutcome,
    outcomeModel: LineOutcome,
    pMarket: number | null,
  ) => {
    const pFinal = winShare(outcomeFinal);
    const ev = evOfOutcome(outcomeFinal, odds);
    const evConservative = ev - sigma * odds;
    const sp = stakePlan({
      p: pFinal,
      odds,
      sigma,
      fraction: input.kellyFraction,
      maxStakePct: input.maxStakePct,
    });
    const rejectReasons: string[] = [];
    if (ev < minEv) rejectReasons.push(`EV ${(ev * 100).toFixed(1)}% < minimum ${(minEv * 100).toFixed(1)}%`);
    if (evConservative <= 0) rejectReasons.push("EV konservatif (setelah kurangi σ·odds) ≤ 0");
    selections.push({
      key,
      label,
      family,
      odds,
      line,
      pFinal,
      pMarket,
      pModelOnly: winShare(outcomeModel),
      outcome: outcomeFinal,
      ev,
      evConservative,
      sigma,
      stakePct: rejectReasons.length ? 0 : sp.stakePct,
      minOdds: pFinal > 0 ? (1 + minEv) / pFinal : Infinity,
      passes: rejectReasons.length === 0,
      rejectReasons,
    });
  };

  const binary = (p: number): LineOutcome => ({ win: p, halfWin: 0, push: 0, halfLoss: 0, loss: 1 - p });

  push("ML:home", "1X2 — Home", "ML", input.odds1x2.home, null, binary(fairResult.home), binary(modelResult.home), fair1x2.home);
  push("ML:draw", "1X2 — Draw", "ML", input.odds1x2.draw, null, binary(fairResult.draw), binary(modelResult.draw), fair1x2.draw);
  push("ML:away", "1X2 — Away", "ML", input.odds1x2.away, null, binary(fairResult.away), binary(modelResult.away), fair1x2.away);

  for (const t of input.totals ?? []) {
    const pf = pairFair(t.overOdds, t.underOdds, method);
    push(`TOT:over:${t.line}`, `Over ${t.line}`, "Totals", t.overOdds, t.line, totalsOutcome(MF, t.line, "over"), totalsOutcome(MM, t.line, "over"), pf[0]!);
    push(`TOT:under:${t.line}`, `Under ${t.line}`, "Totals", t.underOdds, t.line, totalsOutcome(MF, t.line, "under"), totalsOutcome(MM, t.line, "under"), pf[1]!);
  }
  if (input.btts) {
    const pf = pairFair(input.btts.yes, input.btts.no, method);
    push("BTTS:yes", "BTTS — Yes", "BTTS", input.btts.yes, null, binary(fairBtts.yes), binary(modelBtts.yes), pf[0]!);
    push("BTTS:no", "BTTS — No", "BTTS", input.btts.no, null, binary(fairBtts.no), binary(modelBtts.no), pf[1]!);
  }
  for (const h of input.ah ?? []) {
    const pf = pairFair(h.homeOdds, h.awayOdds, method);
    const fmt = (n: number) => (n > 0 ? `+${n}` : String(n));
    push(`AH:home:${h.line}`, `AH Home ${fmt(h.line)}`, "AH", h.homeOdds, h.line, handicapOutcome(MF, h.line, "home"), handicapOutcome(MM, h.line, "home"), pf[0]!);
    push(`AH:away:${-h.line}`, `AH Away ${fmt(-h.line)}`, "AH", h.awayOdds, -h.line, handicapOutcome(MF, -h.line, "away"), handicapOutcome(MM, -h.line, "away"), pf[1]!);
  }

  const passing = selections.filter((s) => s.passes).sort((a, b) => b.evConservative - a.evConservative);
  const best = passing[0] ?? null;
  if (selections.length > 6 && best) {
    warnings.push(`${selections.length} market dibandingkan lalu dipilih yang terbaik — risiko winner's curse. Perlakukan EV sebagai batas atas.`);
  }

  return {
    devig1x2: { probs: fair1x2, overround: d1.overround, usedMethod: d1.usedMethod },
    marketLambdas: { lambdaHome: mkt.lambdaHome, lambdaAway: mkt.lambdaAway, fitError: mkt.error },
    modelLambdas: { ...mdl, reliability: model.reliability },
    finalLambdas: finalL,
    modelWeight: w,
    fairResult,
    fairBtts,
    topScores: topScores(MF),
    selections,
    best,
    decision: best ? "BET" : "NO_BET",
    warnings,
  };
}
