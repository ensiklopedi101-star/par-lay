/**
 * Penggabungan model statistik dengan pasar (market-anchored model).
 *
 * KELEMAHAN YANG DIPERBAIKI: sistem lama menyuruh LLM "memprioritaskan
 * statistik" atau "memprioritaskan pasar" lewat aturan if-else teks
 * (threshold absolut 0.10 pada odds, tidak skala-invarian: 0.10 pada odds 1.30
 * adalah pergerakan raksasa, pada odds 4.00 hampir noise).
 *
 * Pendekatan yang benar: pasar adalah prior terbaik (likuid, menyerap berita).
 * Model hanya diizinkan menggeser prior sesuai bobot `w` yang DIPELAJARI dari
 * ledger (lihat fitBlendWeight). Selama belum terbukti punya skill melawan
 * pasar, bobot dibatasi rendah.
 */

export const DEFAULT_MAX_MODEL_WEIGHT = 0.3;

/** Pooling geometrik di ruang log-λ. w=0 → murni pasar, w=1 → murni model. */
export function blendLambdas(
  market: { lambdaHome: number; lambdaAway: number },
  model: { lambdaHome: number; lambdaAway: number },
  w: number,
): { lambdaHome: number; lambdaAway: number } {
  const wt = Math.min(1, Math.max(0, w));
  const mix = (m: number, x: number) => Math.exp((1 - wt) * Math.log(m) + wt * Math.log(x));
  return {
    lambdaHome: mix(market.lambdaHome, model.lambdaHome),
    lambdaAway: mix(market.lambdaAway, model.lambdaAway),
  };
}

/** Bobot model default = batas × reliability data. Tidak pernah > batas. */
export function defaultModelWeight(reliability: number, cap = DEFAULT_MAX_MODEL_WEIGHT): number {
  return Math.min(cap, Math.max(0, cap * reliability));
}

export interface BlendSample {
  pModel: number;
  pMarket: number;
  outcome: 0 | 1;
}

const logit = (p: number) => Math.log(p / (1 - p));
const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));
const clampP = (p: number) => Math.min(0.995, Math.max(0.005, p));

export interface BlendFit {
  /** bobot model terbaik (log-loss minimum) */
  weight: number;
  logLossAtWeight: number;
  logLossMarketOnly: number;
  logLossModelOnly: number;
  n: number;
  curve: Array<{ w: number; logLoss: number }>;
}

/**
 * Pelajari bobot model vs pasar dari data riil. Ini pembelajaran yang benar:
 * bukan "LLM menulis pelajaran teks", tetapi satu parameter terukur yang
 * meminimalkan log-loss. Jika w* ≈ 0 → model tidak menambah informasi di atas
 * pasar dan sistem otomatis berhenti mengklaim edge.
 */
export function fitBlendWeight(samples: BlendSample[]): BlendFit | null {
  const valid = samples.filter(
    (s) => Number.isFinite(s.pModel) && Number.isFinite(s.pMarket) && (s.outcome === 0 || s.outcome === 1),
  );
  if (valid.length < 30) return null;
  const ll = (w: number) =>
    valid.reduce((sum, s) => {
      const p = clampP(sigmoid(w * logit(clampP(s.pModel)) + (1 - w) * logit(clampP(s.pMarket))));
      return sum - (s.outcome === 1 ? Math.log(p) : Math.log(1 - p));
    }, 0) / valid.length;
  const curve: Array<{ w: number; logLoss: number }> = [];
  let best = { w: 0, logLoss: Infinity };
  for (let i = 0; i <= 20; i++) {
    const w = i / 20;
    const l = ll(w);
    curve.push({ w, logLoss: l });
    if (l < best.logLoss) best = { w, logLoss: l };
  }
  return {
    weight: best.w,
    logLossAtWeight: best.logLoss,
    logLossMarketOnly: ll(0),
    logLossModelOnly: ll(1),
    n: valid.length,
    curve,
  };
}
