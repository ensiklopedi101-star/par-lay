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

/* ─── Fase C: evaluasi holdout kronologis untuk bobot blend ──────────────
 *
 * `fitBlendWeight` di bawah ini mencampur data latih + uji dalam satu
 * himpunan (kebocoran): w* yang dipilih adalah w yang paling cocok dengan
 * data yang sama yang dipakai menilainya. Blueprint Fase C menuntut bukti
 * yang lebih keras: fit di masa lalu, nilai di masa depan yang tidak
 * dilihat saat fitting, dengan gerbang statistik ≥100 latih + ≥100 holdout.
 *
 * Kandidat yang dinilai adalah blend logit pada w* hasil fitting latih.
 * Pembandingnya jujur: pasar murni (w=0) dan `p_final` incumbent — yaitu
 * probabilitas yang benar-benar ditulis sistem produksi saat itu (bobot
 * heuristik 0,30 × reliability). Kandidat hanya boleh diadopsi bila di
 * holdout ia mengalahkan incumbent dengan margin yang berarti DAN tidak
 * kalah dari pasar murni; selisih di bawah margin dianggap noise, bukan
 * bukti — persis kegagalan "sampel kecil menulis ulang sistem" yang
 * pernah terjadi pada gerbang pembelajaran prompt.
 */
export const MIN_BLEND_TRAIN_SAMPLES = 100;
export const MIN_BLEND_HOLDOUT_SAMPLES = 100;
/** Selisih log-loss minimum (per sampel) agar selisih dianggap bukti. */
export const MIN_BLEND_ADOPTION_GAIN = 0.002;

export interface BlendHoldoutSample extends BlendSample {
  /** Probabilitas incumbent produksi (p_final); null = tidak bisa dinilai. */
  pFinal: number | null;
  analysedAt: string | null;
}

export interface BlendHoldoutEvaluation {
  status: "insufficient_data" | "evaluated";
  trainN: number;
  holdoutN: number;
  cutoff: string | null;
  /** w* dari fitting data latih saja. */
  fittedWeight: number | null;
  holdout: {
    marketLogLoss: number;
    incumbentLogLoss: number;
    candidateLogLoss: number;
    modelLogLoss: number;
    marketBrier: number;
    incumbentBrier: number;
    candidateBrier: number;
  } | null;
  adoption: {
    adoptCandidate: boolean;
    /** incumbent − kandidat; positif = kandidat lebih baik. */
    gainVsIncumbent: number | null;
    /** pasar − kandidat; positif = kandidat lebih baik dari pasar murni. */
    gainVsMarket: number | null;
    reason: string;
  };
}

function logLossOf(samples: BlendHoldoutSample[], pOf: (s: BlendHoldoutSample) => number | null): number | null {
  let sum = 0;
  let n = 0;
  for (const s of samples) {
    const p = pOf(s);
    if (p == null || !Number.isFinite(p)) continue;
    const q = clampP(p);
    sum += -(s.outcome === 1 ? Math.log(q) : Math.log(1 - q));
    n++;
  }
  return n > 0 ? sum / n : null;
}

function brierOf(samples: BlendHoldoutSample[], pOf: (s: BlendHoldoutSample) => number | null): number | null {
  let sum = 0;
  let n = 0;
  for (const s of samples) {
    const p = pOf(s);
    if (p == null || !Number.isFinite(p)) continue;
    sum += (p - s.outcome) ** 2;
    n++;
  }
  return n > 0 ? sum / n : null;
}

const blendP = (w: number) => (s: BlendHoldoutSample): number =>
  sigmoid(w * logit(clampP(s.pModel)) + (1 - w) * logit(clampP(s.pMarket)));

export function evaluateBlendHoldout(
  samples: BlendHoldoutSample[],
  trainingFraction = 0.7,
): BlendHoldoutEvaluation {
  const usable = samples
    .filter((s) =>
      Number.isFinite(s.pModel) && Number.isFinite(s.pMarket) && s.pFinal != null && Number.isFinite(s.pFinal)
      && (s.outcome === 0 || s.outcome === 1)
      && s.analysedAt != null && Number.isFinite(new Date(s.analysedAt).getTime()))
    .slice()
    .sort((a, b) => new Date(a.analysedAt!).getTime() - new Date(b.analysedAt!).getTime());

  /* Split kronologis; timestamp yang sama tidak boleh terbelah dua sisi
   * (satu putaran analisis menulis banyak baris pada detik yang sama —
   * membelahnya akan membocorkan data latih ke holdout). */
  let splitIndex = Math.floor(usable.length * trainingFraction);
  const splitTime = usable[splitIndex] ? new Date(usable[splitIndex]!.analysedAt!).getTime() : null;
  if (splitTime != null) {
    let groupStart = splitIndex;
    while (groupStart > 0 && new Date(usable[groupStart - 1]!.analysedAt!).getTime() === splitTime) groupStart--;
    let groupEnd = splitIndex;
    while (groupEnd < usable.length && new Date(usable[groupEnd]!.analysedAt!).getTime() === splitTime) groupEnd++;
    const boundaries = [groupStart, groupEnd].filter((b) => b > 0 && b < usable.length);
    if (boundaries.length > 0) {
      splitIndex = boundaries.sort((x, y) => Math.abs(x - splitIndex) - Math.abs(y - splitIndex))[0]!;
    }
  }
  const train = usable.slice(0, splitIndex);
  const holdout = usable.slice(splitIndex);
  const cutoff = holdout[0]?.analysedAt ?? null;

  const insufficient = (reason: string): BlendHoldoutEvaluation => ({
    status: "insufficient_data",
    trainN: train.length,
    holdoutN: holdout.length,
    cutoff,
    fittedWeight: null,
    holdout: null,
    adoption: { adoptCandidate: false, gainVsIncumbent: null, gainVsMarket: null, reason },
  });

  if (train.length < MIN_BLEND_TRAIN_SAMPLES || holdout.length < MIN_BLEND_HOLDOUT_SAMPLES) {
    return insufficient(
      `Perlu ≥${MIN_BLEND_TRAIN_SAMPLES} latih + ≥${MIN_BLEND_HOLDOUT_SAMPLES} holdout decisive; tersedia ${train.length} + ${holdout.length}.`,
    );
  }
  const fit = fitBlendWeight(train);
  if (!fit) return insufficient("fitBlendWeight gagal pada data latih.");

  const w = fit.weight;
  const marketLogLoss = logLossOf(holdout, (s) => s.pMarket);
  const incumbentLogLoss = logLossOf(holdout, (s) => s.pFinal);
  const candidateLogLoss = logLossOf(holdout, blendP(w));
  const modelLogLoss = logLossOf(holdout, (s) => s.pModel);
  const marketBrier = brierOf(holdout, (s) => s.pMarket);
  const incumbentBrier = brierOf(holdout, (s) => s.pFinal);
  const candidateBrier = brierOf(holdout, blendP(w));
  if (marketLogLoss == null || incumbentLogLoss == null || candidateLogLoss == null || modelLogLoss == null
    || marketBrier == null || incumbentBrier == null || candidateBrier == null) {
    return insufficient("Metrik holdout tidak lengkap.");
  }

  const gainVsIncumbent = incumbentLogLoss - candidateLogLoss;
  const gainVsMarket = marketLogLoss - candidateLogLoss;
  const adoptCandidate = gainVsIncumbent >= MIN_BLEND_ADOPTION_GAIN && gainVsMarket >= 0;
  const reason = adoptCandidate
    ? `Kandidat w*=${w.toFixed(2)} mengalahkan incumbent produksi di holdout (+${gainVsIncumbent.toFixed(4)} log-loss) dan tidak kalah dari pasar murni — layak diadopsi lewat PR.`
    : `Kandidat w*=${w.toFixed(2)} belum terbukti di holdout (vs incumbent ${gainVsIncumbent >= 0 ? "+" : ""}${gainVsIncumbent.toFixed(4)}, vs pasar ${gainVsMarket >= 0 ? "+" : ""}${gainVsMarket.toFixed(4)} log-loss; margin bukti minimum ${MIN_BLEND_ADOPTION_GAIN}) — bobot produksi tidak diubah.`;

  return {
    status: "evaluated",
    trainN: train.length,
    holdoutN: holdout.length,
    cutoff,
    fittedWeight: w,
    holdout: {
      marketLogLoss, incumbentLogLoss, candidateLogLoss, modelLogLoss,
      marketBrier, incumbentBrier, candidateBrier,
    },
    adoption: { adoptCandidate, gainVsIncumbent, gainVsMarket, reason },
  };
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
