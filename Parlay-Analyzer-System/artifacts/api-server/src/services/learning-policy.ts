export const MARKET_FAMILIES = ["ML", "HT", "Totals", "AH", "BTTS"] as const;
export type LearningMarketFamily = (typeof MARKET_FAMILIES)[number];

export interface LearningPolicy {
  minConfidence: number;
  minEvPercent: number;
  excludedMarketFamilies: LearningMarketFamily[];
}

export interface LearningEvaluationSample {
  prediction_id: string;
  analysis_at: string | null;
  outcome: "WIN" | "LOSS" | "HALF_WIN" | "HALF_LOSS" | "PUSH";
  market_bet: string | null;
  odds: number | null;
  probability: number | null;
  confidence: number | null;
  ev_percent: number | null;
}

export interface PolicyBacktestMetrics {
  totalSettled: number;
  selected: number;
  coverage: number;
  decisive: number;
  wins: number;
  losses: number;
  hitRate: number | null;
  roiPerBet: number | null;
  roiSampleSize: number;
  brierScore: number | null;
  brierSampleSize: number;
}

export const BASELINE_LEARNING_POLICY: LearningPolicy = {
  minConfidence: 6.5,
  minEvPercent: 0,
  excludedMarketFamilies: [],
};

export function parseLearningPolicy(value: unknown): LearningPolicy {
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const minConfidence = Number(raw.minConfidence);
  const minEvPercent = Number(raw.minEvPercent);
  const excluded = Array.isArray(raw.excludedMarketFamilies)
    ? raw.excludedMarketFamilies.filter((market): market is LearningMarketFamily =>
        MARKET_FAMILIES.includes(market as LearningMarketFamily),
      )
    : [];
  return {
    minConfidence: Number.isFinite(minConfidence) ? Math.min(9.5, Math.max(6.5, minConfidence)) : BASELINE_LEARNING_POLICY.minConfidence,
    minEvPercent: Number.isFinite(minEvPercent) ? Math.min(20, Math.max(0, minEvPercent)) : BASELINE_LEARNING_POLICY.minEvPercent,
    excludedMarketFamilies: Array.from(new Set(excluded)),
  };
}

export function isPolicyStrictlyTighter(candidate: LearningPolicy, baseline: LearningPolicy): boolean {
  return candidate.minConfidence > baseline.minConfidence
    || candidate.minEvPercent > baseline.minEvPercent
    || candidate.excludedMarketFamilies.some((market) => !baseline.excludedMarketFamilies.includes(market));
}

export function isPolicyNoWeaker(candidate: LearningPolicy, baseline: LearningPolicy): boolean {
  return candidate.minConfidence >= baseline.minConfidence
    && candidate.minEvPercent >= baseline.minEvPercent
    && baseline.excludedMarketFamilies.every((market) => candidate.excludedMarketFamilies.includes(market));
}

export function buildLearningPolicyAddendum(policyInput: unknown): string {
  const policy = parseLearningPolicy(policyInput);
  const rules = [
    `JANGAN memilih rekomendasi dengan confidence di bawah ${policy.minConfidence.toFixed(1)}/10.`,
    `JANGAN memilih rekomendasi dengan EV di bawah ${policy.minEvPercent.toFixed(1)}%.`,
  ];
  if (policy.excludedMarketFamilies.length > 0) {
    rules.push(`JANGAN memilih keluarga market ini: ${policy.excludedMarketFamilies.join(", ")}.`);
  }
  return [
    "BATAS KEBIJAKAN BELAJAR TERKONTROL:",
    ...rules,
    "Batas ini adalah filter tambahan; jangan mengarang probability, odds, market, atau line.",
    "Jika rekomendasi tidak lolos, keluarkan NO_BET. Kebijakan ini tidak boleh menurunkan validasi data inti.",
  ].join("\n");
}

export function policySelectsSample(
  sample: LearningEvaluationSample,
  policyInput: unknown,
  resolveMarketFamily: (market: string) => string | null,
): boolean {
  const policy = parseLearningPolicy(policyInput);
  const confidence = sample.confidence == null ? Number.NaN : Number(sample.confidence);
  const evPercent = sample.ev_percent == null ? Number.NaN : Number(sample.ev_percent);
  if (!Number.isFinite(confidence) || confidence < policy.minConfidence) return false;
  if (!Number.isFinite(evPercent) || evPercent < policy.minEvPercent) return false;
  if (!sample.market_bet) return false;
  const family = resolveMarketFamily(sample.market_bet);
  return family != null && !policy.excludedMarketFamilies.includes(family as LearningMarketFamily);
}

function settledNetReturn(outcome: LearningEvaluationSample["outcome"], odds: number): number {
  switch (outcome) {
    case "WIN": return odds - 1;
    case "HALF_WIN": return (odds - 1) / 2;
    case "HALF_LOSS": return -0.5;
    case "LOSS": return -1;
    case "PUSH": return 0;
  }
}

export function evaluatePolicyBacktest(
  samples: LearningEvaluationSample[],
  policy: unknown,
  resolveMarketFamily: (market: string) => string | null,
): PolicyBacktestMetrics {
  const selected = samples.filter((sample) => policySelectsSample(sample, policy, resolveMarketFamily));
  const decisive = selected.filter((sample) => sample.outcome !== "PUSH");
  const wins = decisive.filter((sample) => sample.outcome === "WIN" || sample.outcome === "HALF_WIN").length;
  const losses = decisive.length - wins;
  const roiSamples = selected.filter((sample) => Number.isFinite(Number(sample.odds)) && Number(sample.odds) > 1);
  const brierSamples = decisive.filter((sample) => Number.isFinite(Number(sample.probability))
    && Number(sample.probability) > 0 && Number(sample.probability) < 1);
  const brierScore = brierSamples.length
    ? brierSamples.reduce((sum, sample) => {
        const probability = Number(sample.probability);
        const actual = sample.outcome === "WIN" || sample.outcome === "HALF_WIN" ? 1 : 0;
        return sum + (probability - actual) ** 2;
      }, 0) / brierSamples.length
    : null;

  return {
    totalSettled: samples.length,
    selected: selected.length,
    coverage: samples.length ? selected.length / samples.length : 0,
    decisive: decisive.length,
    wins,
    losses,
    hitRate: decisive.length ? wins / decisive.length : null,
    roiPerBet: roiSamples.length
      ? roiSamples.reduce((sum, sample) => sum + settledNetReturn(sample.outcome, Number(sample.odds)), 0) / roiSamples.length
      : null,
    roiSampleSize: roiSamples.length,
    brierScore,
    brierSampleSize: brierSamples.length,
  };
}

export function splitChronologicalSamples<T extends { analysis_at: string | null }>(
  samples: T[],
  trainingFraction = 0.7,
): { training: T[]; validation: T[]; validationStart: string | null } {
  const ordered = samples
    .filter((sample) => sample.analysis_at && Number.isFinite(new Date(sample.analysis_at).getTime()))
    .slice()
    .sort((a, b) => new Date(a.analysis_at!).getTime() - new Date(b.analysis_at!).getTime());
  let splitIndex = Math.floor(ordered.length * trainingFraction);
  const splitTimestamp = ordered[splitIndex]?.analysis_at;
  if (splitTimestamp) {
    const splitTime = new Date(splitTimestamp).getTime();
    // Keep equal timestamps on one side of the split. The validation query
    // uses a timestamp cutoff, so a tie would otherwise leak training rows.
    let groupStart = splitIndex;
    while (groupStart > 0 && new Date(ordered[groupStart - 1]!.analysis_at!).getTime() === splitTime) {
      groupStart--;
    }
    let groupEnd = splitIndex;
    while (groupEnd < ordered.length && new Date(ordered[groupEnd]!.analysis_at!).getTime() === splitTime) {
      groupEnd++;
    }
    const safeBoundaries = [groupStart, groupEnd].filter((boundary) => boundary > 0 && boundary < ordered.length);
    splitIndex = safeBoundaries.length
      ? safeBoundaries.sort((left, right) => Math.abs(left - splitIndex) - Math.abs(right - splitIndex))[0]!
      : ordered.length;
  }
  const training = ordered.slice(0, splitIndex);
  const validation = ordered.slice(splitIndex);
  return {
    training,
    validation,
    validationStart: validation[0]?.analysis_at ?? null,
  };
}
