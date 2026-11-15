/**
 * Model babak pertama (HT) — Langkah 4 pendekatan pasar-dulu.
 *
 * Skor HT tidak bisa diturunkan dengan membagi dua model full-time:
 * distribusi gol babak pertama punya bentuknya sendiri (lebih sedikit
 * gol, lebih banyak 0-0). Model ini membangun λ HT dari laju gol HT
 * venue musim sebelumnya — data yang hanya dimiliki gudang riset
 * (16 ribu skor HT) — lalu dinilai melawan patokan naif (rata-rata
 * liga) karena dataset tidak menyediakan odds HT historis.
 *
 * Kejujuran cakupan: tanpa odds HT, yang bisa dibuktikan adalah
 * apakah laju HT tim menambah akurasi di atas rata-rata liga.
 * Klaim nilai melawan bandar untuk pasar HT menunggu data odds HT
 * live terkumpul di ledger.
 */
import { scoreMatrix } from "./poisson";

export interface HtProbabilities {
  homeWin: number;
  draw: number;
  awayWin: number;
  /** Paling sedikit satu gol sebelum turun minum. */
  over05: number;
  over15: number;
  bttsYes: number;
}

export function htProbabilities(lambdaHome: number, lambdaAway: number): HtProbabilities {
  const matrix = scoreMatrix(lambdaHome, lambdaAway);
  let homeWin = 0;
  let draw = 0;
  let awayWin = 0;
  let over05 = 0;
  let over15 = 0;
  let bttsYes = 0;
  for (let h = 0; h < matrix.m.length; h++) {
    for (let a = 0; a < matrix.m[h]!.length; a++) {
      const p = matrix.m[h]![a]!;
      if (h > a) homeWin += p;
      else if (h === a) draw += p;
      else awayWin += p;
      if (h + a >= 1) over05 += p;
      if (h + a >= 2) over15 += p;
      if (h >= 1 && a >= 1) bttsYes += p;
    }
  }
  return { homeWin, draw, awayWin, over05, over15, bttsYes };
}

export interface HtBinaryMetric {
  n: number;
  modelLogLoss: number;
  baseLogLoss: number;
  /** 1 − logLoss model / logLoss patokan; > 0 berarti model lebih baik. */
  skill: number;
  /** Tingkat kena pada ambang 0,5. */
  hitRate: number;
}

export interface HtExperimentResult {
  n: number;
  htResult: { modelLogLoss: number; baseLogLoss: number; skill: number; argmaxHitRate: number };
  over05: HtBinaryMetric;
  btts: HtBinaryMetric;
}

const clampP = (p: number) => Math.min(0.995, Math.max(0.005, p));
const binaryLogLoss = (p: number, y: 0 | 1) => -(y === 1 ? Math.log(clampP(p)) : Math.log(1 - clampP(p)));
const multiLogLoss = (probs: number[], outcomeIndex: number) => -Math.log(clampP(probs[outcomeIndex]!));

export interface HtSample {
  model: HtProbabilities;
  base: HtProbabilities;
  actual: { homeGoals: number; awayGoals: number };
}

/** Nilai model HT melawan patokan rata-rata liga pada sampel yang sama. */
export function buildHtExperiment(samples: HtSample[]): HtExperimentResult | null {
  const valid = samples.filter(
    (s) => Number.isFinite(s.actual.homeGoals) && Number.isFinite(s.actual.awayGoals),
  );
  if (valid.length === 0) return null;

  let resultModel = 0;
  let resultBase = 0;
  let argmaxHits = 0;
  const binaries = {
    over05: { model: 0, base: 0, hits: 0 },
    btts: { model: 0, base: 0, hits: 0 },
  };

  for (const s of valid) {
    const { homeGoals, awayGoals } = s.actual;
    const outcomeIndex = homeGoals > awayGoals ? 0 : homeGoals === awayGoals ? 1 : 2;
    resultModel += multiLogLoss([s.model.homeWin, s.model.draw, s.model.awayWin], outcomeIndex);
    resultBase += multiLogLoss([s.base.homeWin, s.base.draw, s.base.awayWin], outcomeIndex);
    const modelArgmax = [s.model.homeWin, s.model.draw, s.model.awayWin].indexOf(
      Math.max(s.model.homeWin, s.model.draw, s.model.awayWin),
    );
    if (modelArgmax === outcomeIndex) argmaxHits++;

    const overActual: 0 | 1 = homeGoals + awayGoals >= 1 ? 1 : 0;
    binaries.over05.model += binaryLogLoss(s.model.over05, overActual);
    binaries.over05.base += binaryLogLoss(s.base.over05, overActual);
    if ((s.model.over05 >= 0.5 ? 1 : 0) === overActual) binaries.over05.hits++;

    const bttsActual: 0 | 1 = homeGoals >= 1 && awayGoals >= 1 ? 1 : 0;
    binaries.btts.model += binaryLogLoss(s.model.bttsYes, bttsActual);
    binaries.btts.base += binaryLogLoss(s.base.bttsYes, bttsActual);
    if ((s.model.bttsYes >= 0.5 ? 1 : 0) === bttsActual) binaries.btts.hits++;
  }

  const n = valid.length;
  const toBinary = (b: { model: number; base: number; hits: number }): HtBinaryMetric => ({
    n,
    modelLogLoss: b.model / n,
    baseLogLoss: b.base / n,
    skill: 1 - b.model / b.base,
    hitRate: b.hits / n,
  });

  return {
    n,
    htResult: {
      modelLogLoss: resultModel / n,
      baseLogLoss: resultBase / n,
      skill: 1 - resultModel / resultBase,
      argmaxHitRate: argmaxHits / n,
    },
    over05: toBinary(binaries.over05),
    btts: toBinary(binaries.btts),
  };
}
