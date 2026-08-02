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
  confidence: number;
  evPercent: number;
}

function probabilityFor(candidate: ParlayCandidate): number {
  const confidenceProbability = Math.max(0.01, Math.min(0.99, candidate.confidence / 10));
  return candidate.odds > 1
    ? Math.max(0.01, Math.min(0.99, Math.max(confidenceProbability, 1 / candidate.odds)))
    : confidenceProbability;
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
  const avgConfidence = uniqueCandidates.reduce((sum, candidate) => sum + candidate.confidence, 0) / uniqueCandidates.length;
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
    if (results.length === 0 || results.some((result) => !result)) continue;

    const status = results.some((result) => result === "LOSS")
      ? "lost"
      : results.every((result) => result === "WIN")
        ? "won"
        : "settled";
    await supabase.from("parlays").update({
      status,
      actual_result: status,
      updated_at: new Date().toISOString(),
    }).eq("id", parlayId);
    logger.info({ parlayId, status }, "[PARLAY] Status parlay diperbarui");
  }
}