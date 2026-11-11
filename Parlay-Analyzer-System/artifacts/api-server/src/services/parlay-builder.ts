import { supabase } from "../lib/supabase-client";
import { logger } from "../lib/logger";

export interface ParlayCandidate {
  predictionId?: string | number;
  fixtureId: string | number;
  homeTeam: string;
  awayTeam: string;
  league: string;
  date?: string;
  market: string;
  selection: string;
  odds: number;
  confidence: number | null;
  probability: number;
  evPercent: number;
  source?: "USER_SELECTION";
}

export interface MergeParlayResult {
  parlayId: string | null;
  legs: ParlayCandidate[];
  combinedOdds: number;
  winProbability: number;
  expectedValue: number;
  riskScore: number;
  riskLevel: "low" | "medium" | "high" | "very_high";
  rejected: Array<{ fixtureId: number; reason: string }>;
}

export type ParlayRiskLevel = "low" | "medium" | "high" | "very_high";

export interface CreateMergedParlayOptions {
  generatedBy?: string;
  namePrefix?: string;
  reasoning?: string;
}

function probabilityFor(candidate: ParlayCandidate): number {
  return Math.max(0.01, Math.min(0.99, candidate.probability));
}

export function calculateParlayMetrics(candidates: ParlayCandidate[]) {
  const combinedOdds = candidates.reduce(
    (product, candidate) => product * Math.max(1.01, candidate.odds),
    1,
  );
  const winProbability = candidates.reduce(
    (product, candidate) => product * probabilityFor(candidate),
    1,
  );
  const expectedValue = winProbability * combinedOdds - 1;
  const confidenceValues = candidates
    .map((candidate) => candidate.confidence)
    .filter((value): value is number => value != null && Number.isFinite(value));
  const avgConfidence = confidenceValues.length > 0
    ? confidenceValues.reduce((sum, value) => sum + value, 0) / confidenceValues.length
    : 0;
  const confidenceRiskPenalty = confidenceValues.length > 0
    ? Math.max(0, 8 - avgConfidence) * 4
    : 0;
  const riskScore = Math.min(
    100,
    Math.round(
      (1 - winProbability) * 65 +
      Math.max(0, candidates.length - 2) * 6 +
      confidenceRiskPenalty +
      Math.max(0, combinedOdds - 8) * 1.5,
    ),
  );
  const riskLevel: ParlayRiskLevel = riskScore >= 75
    ? "very_high"
    : riskScore >= 55
      ? "high"
      : riskScore >= 30
        ? "medium"
        : "low";
  return { combinedOdds, winProbability, expectedValue, avgConfidence, riskScore, riskLevel };
}

export async function createMergedParlay(
  candidates: ParlayCandidate[],
  sourceParlayIds: string[],
  options: CreateMergedParlayOptions = {},
): Promise<MergeParlayResult> {
  const rejected: Array<{ fixtureId: number; reason: string }> = [];
  const unique = new Map<string, ParlayCandidate>();
  for (const candidate of candidates) {
    const fixtureId = Number(candidate.fixtureId);
    if (!Number.isFinite(fixtureId)) continue;
    if (unique.has(String(fixtureId))) {
      rejected.push({ fixtureId, reason: "Fixture duplikat; hanya satu leg per fixture yang diperbolehkan." });
      continue;
    }
    const isUserSelection = candidate.source === "USER_SELECTION";
    /*
     * Gerbang `confidence < 6.5` DIHAPUS (Nov 2026), sama seperti di
     * `ai-analysis.ts` dan `learning-policy.ts`.
     *
     * Confidence adalah angka self-report model bahasa, bukan hasil hitung.
     * Ia sempat menjadi gerbang di tiga tempat sekaligus, sehingga leg dengan
     * `evConservative` kuat tetap ditolak hanya karena model menulis "6.0".
     * Nilai keputusan yang sebenarnya adalah EV — dan untuk parlay, modul
     * `lib/quant/composition.ts` yang menyaring leg lewat `evConservative > 0`
     * plus simulasi korelasi.
     *
     * Di sini tinggal pemeriksaan yang bisa dibuktikan: odds masuk akal dan
     * probabilitasnya berada di (0,1).
     */
    if (
      candidate.odds <= 1
      || !Number.isFinite(candidate.probability)
      || candidate.probability <= 0
      || candidate.probability >= 1
    ) {
      rejected.push({ fixtureId, reason: "Odds atau probabilitas tidak memenuhi batas minimum." });
      continue;
    }

    /* Konteks untuk leg pilihan pengguna: catat bila confidence rendah, tetapi
     * JANGAN menolak hanya karena itu. */
    if (!isUserSelection && (candidate.confidence == null || candidate.confidence < 6.5)) {
      logger.debug(
        { fixtureId, confidence: candidate.confidence },
        "[PARLAY-MERGE] Confidence rendah — tidak lagi menjadi gerbang penolakan",
      );
    }
    if (unique.size >= 7) {
      rejected.push({ fixtureId, reason: "Batas maksimum 7 leg tercapai." });
      continue;
    }
    unique.set(String(fixtureId), candidate);
  }
  const legs = Array.from(unique.values());
  if (legs.length < 2) {
    return {
      parlayId: null,
      legs,
      ...calculateParlayMetrics(legs),
      rejected,
    };
  }

  const metrics = calculateParlayMetrics(legs);
  const leagues = new Set(legs.map((candidate) => candidate.league).filter(Boolean));
  const sourceLabel = sourceParlayIds.length > 0 ? sourceParlayIds.slice(0, 3).join(", ") : "selected";
  const { data: parlay, error: parlayError } = await supabase
    .from("parlays")
    .insert({
      parlay_name: `${options.namePrefix ?? "Merged AI Parlay"} — ${new Date().toLocaleDateString("id-ID")}`,
      legs_count: legs.length,
      combined_odds: metrics.combinedOdds,
      win_probability: metrics.winProbability,
      expected_value: metrics.expectedValue,
      risk_score: metrics.riskScore,
      avg_confidence: metrics.avgConfidence,
      status: "active",
      generated_by: options.generatedBy ?? "AI_MERGE",
      leagues_count: leagues.size,
      countries_count: leagues.size,
      reasoning: options.reasoning
        ?? `Gabungan parlay ${sourceLabel}. Maksimum 7 leg; dibuat setelah verifikasi readiness.`,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (parlayError || !parlay?.id) {
    logger.error({ error: parlayError }, "[PARLAY-MERGE] Failed to create merged parlay");
    return { parlayId: null, legs, ...metrics, rejected };
  }

  const { error: legsError } = await supabase.from("parlay_legs").insert(
    legs.map((candidate, index) => ({
      parlay_id: parlay.id,
      prediction_id: candidate.predictionId ?? null,
      fixture_id: Number(candidate.fixtureId),
      leg_order: index + 1,
      market: candidate.market,
      selection: candidate.selection,
      odds: candidate.odds,
      probability: probabilityFor(candidate),
      confidence: candidate.confidence,
      result: null,
      created_at: new Date().toISOString(),
    })),
  );
  if (legsError) {
    await supabase.from("parlays").delete().eq("id", parlay.id);
    logger.error({ error: legsError, parlayId: parlay.id }, "[PARLAY-MERGE] Failed to create legs");
    return { parlayId: null, legs, ...metrics, rejected };
  }
  return { parlayId: String(parlay.id), legs, ...metrics, rejected };
}

export async function createParlayFromCandidates(candidates: ParlayCandidate[]): Promise<string | null> {
  const uniqueCandidates = Array.from(
    new Map(candidates.map((candidate) => [String(candidate.fixtureId), candidate])).values(),
  ).slice(0, 5);
  if (uniqueCandidates.length < 2) return null;

  const combinedOdds = uniqueCandidates.reduce(
    (product, candidate) => product * Math.max(1.01, candidate.odds),
    1,
  );
  const winProbability = uniqueCandidates.reduce(
    (product, candidate) => product * probabilityFor(candidate),
    1,
  );
  const expectedValue = winProbability * combinedOdds - 1;
  const confidenceValues = uniqueCandidates
    .map((candidate) => candidate.confidence)
    .filter((value): value is number => value != null && Number.isFinite(value));
  const avgConfidence = confidenceValues.length > 0
    ? confidenceValues.reduce((sum, value) => sum + value, 0) / confidenceValues.length
    : 0;
  const leagues = new Set(uniqueCandidates.map((candidate) => candidate.league).filter(Boolean));

  const { data: parlay, error: parlayError } = await supabase
    .from("parlays")
    .insert({
      parlay_name: `AI Batch Parlay — ${new Date().toLocaleDateString("id-ID")}`,
      legs_count: uniqueCandidates.length,
      combined_odds: combinedOdds,
      win_probability: winProbability,
      expected_value: expectedValue,
      avg_confidence: avgConfidence,
      status: "active",
      generated_by: "AI_BATCH",
      leagues_count: leagues.size,
      countries_count: leagues.size,
      reasoning: "Dibuat otomatis dari minimal dua leg dengan confidence AI >= 8.",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (parlayError || !parlay?.id) {
    logger.error({ error: parlayError }, "[PARLAY] Gagal membuat parlay otomatis");
    return null;
  }

  const { error: legsError } = await supabase.from("parlay_legs").insert(
    uniqueCandidates.map((candidate, index) => ({
      parlay_id: parlay.id,
      prediction_id: candidate.predictionId ?? null,
      fixture_id: Number(candidate.fixtureId),
      leg_order: index + 1,
      market: candidate.market,
      selection: candidate.selection,
      odds: candidate.odds,
      probability: probabilityFor(candidate),
      confidence: candidate.confidence,
      result: null,
      created_at: new Date().toISOString(),
    })),
  );

  if (legsError) {
    logger.error({ error: legsError, parlayId: parlay.id }, "[PARLAY] Gagal membuat legs");
    await supabase.from("parlays").delete().eq("id", parlay.id);
    return null;
  }

  logger.info({ parlayId: parlay.id, legs: uniqueCandidates.length }, "[PARLAY] Parlay otomatis dibuat");
  return String(parlay.id);
}

export async function settleParlaysForFixtures(fixtureIds: number[]): Promise<void> {
  if (fixtureIds.length === 0) return;
  const { data: legs } = await supabase
    .from("parlay_legs")
    .select("parlay_id, fixture_id, result")
    .in("fixture_id", fixtureIds);
  const parlayIds = Array.from(new Set((legs ?? []).map((leg) => String(leg.parlay_id))));

  for (const parlayId of parlayIds) {
    const { data: parlayLegs } = await supabase
      .from("parlay_legs")
      .select("result")
      .eq("parlay_id", parlayId);
    const results = (parlayLegs ?? []).map((leg) => String(leg.result ?? "").toUpperCase());
    if (results.length === 0) continue;

    const status = parlayStatusFromLegResults(results);
    if (!status) continue;
    await supabase.from("parlays").update({
      status,
      actual_result: status,
      updated_at: new Date().toISOString(),
    }).eq("id", parlayId);
    logger.info({ parlayId, status }, "[PARLAY] Status parlay diperbarui");
  }
}

/**
 * Decide a parlay's status from its leg results.
 *
 * A single losing leg (full or half) loses the whole parlay, so any pending
 * leg cannot rescue it. A parlay only needs every leg to be settled before it
 * can be declared won, and half wins / pushes still count as non-losing legs —
 * previously `every(result === "WIN")` left such parlays stuck on "settled".
 *
 * Returns null while at least one leg is still unsettled and nothing has lost.
 */
export function parlayStatusFromLegResults(results: string[]): "won" | "lost" | "settled" | null {
  if (results.length === 0) return null;
  const normalized = results.map((result) => result.trim().toUpperCase());
  const isLoss = (result: string) => result === "LOSS" || result === "HALF_LOSS";
  const isWin = (result: string) => result === "WIN" || result === "HALF_WIN";

  if (normalized.some(isLoss)) return "lost";
  if (normalized.some((result) => result === "")) return null;
  if (normalized.some(isWin)) return "won";
  /* Every leg pushed: the stake is returned, which is a settled non-loss. */
  return "settled";
}