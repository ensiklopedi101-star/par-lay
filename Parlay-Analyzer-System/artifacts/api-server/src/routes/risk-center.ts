import { Router, type IRouter } from "express";
import { logger } from "../lib/logger";
import { supabase } from "../lib/supabase-client";

const router: IRouter = Router();

type PredictionRow = {
  id: string;
  fixture_id: number;
  market_bet: string | null;
  best_market: string | null;
  best_odds: number | null;
  ev_at_analysis: number | null;
  expected_value: number | null;
  confidence_score: number | null;
  revalidation_status: "keep" | "review" | "invalidated" | null;
  revalidation_note: string | null;
  last_revalidated_at: string | null;
};

type FixtureRow = {
  fixture_id: number;
  home_team_name: string;
  away_team_name: string;
  league_name: string | null;
  fixture_date: string;
};

type RevisionRow = {
  prediction_id: string;
  trigger_type: string;
  trigger_reason: string;
  prediction_text: string | null;
  market_bet: string | null;
  best_odds: number | null;
  ev_at_analysis: number | null;
  confidence_score: number | null;
  provider: string | null;
  model_version: string | null;
  status: string;
  error_message: string | null;
  created_at: string;
};

/**
 * Read-only operational view of active predictions that need attention before
 * kickoff. Settlement status remains separate; this endpoint never mutates
 * predictions or parlay history.
 */
router.get("/risk-center", async (_req, res) => {
  try {
    const now = new Date().toISOString();
    const { data: predictionRows, error: predictionError } = await supabase
      .from("ai_predictions")
      .select(
        "id, fixture_id, market_bet, best_market, best_odds, ev_at_analysis, expected_value, confidence_score, revalidation_status, revalidation_note, last_revalidated_at",
      )
      .eq("status", "active")
      .limit(500);

    if (predictionError) {
      logger.error({ error: predictionError }, "[RISK-CENTER] Failed to load predictions");
      res.status(500).json({ error: predictionError.message });
      return;
    }

    const predictions = (predictionRows ?? []) as PredictionRow[];
    const fixtureIds = predictions.map((prediction) => prediction.fixture_id);
    if (fixtureIds.length === 0) {
      res.json({
        summary: { total: 0, review: 0, invalidated: 0 },
        items: [],
        generatedAt: now,
      });
      return;
    }

    const { data: fixtureRows, error: fixtureError } = await supabase
      .from("fixtures")
      .select("fixture_id, home_team_name, away_team_name, league_name, fixture_date")
      .in("fixture_id", fixtureIds)
      .gt("fixture_date", now);

    if (fixtureError) {
      logger.error({ error: fixtureError }, "[RISK-CENTER] Failed to load upcoming fixtures");
      res.status(500).json({ error: fixtureError.message });
      return;
    }

    const upcomingFixtures = (fixtureRows ?? []) as FixtureRow[];
    const fixtureById = new Map(
      upcomingFixtures.map((fixture) => [Number(fixture.fixture_id), fixture]),
    );
    const upcomingPredictions = predictions.filter((prediction) =>
      fixtureById.has(Number(prediction.fixture_id)),
    );

    if (upcomingPredictions.length === 0) {
      res.json({
        summary: { total: 0, review: 0, invalidated: 0 },
        items: [],
        generatedAt: now,
      });
      return;
    }

    const { data: parlayLegRows, error: parlayLegError } = await supabase
      .from("parlay_legs")
      .select("prediction_id, fixture_id, parlay_id")
      .in("fixture_id", upcomingPredictions.map((prediction) => prediction.fixture_id));

    if (parlayLegError) {
      logger.warn({ error: parlayLegError }, "[RISK-CENTER] Failed to load parlay links");
    }

    const { data: revisionRows, error: revisionError } = await supabase
      .from("ai_prediction_revisions")
      .select(
        "prediction_id, trigger_type, trigger_reason, prediction_text, market_bet, best_odds, ev_at_analysis, confidence_score, provider, model_version, status, error_message, created_at",
      )
      .in("prediction_id", upcomingPredictions.map((prediction) => prediction.id))
      .order("created_at", { ascending: false })
      .limit(250);

    if (revisionError) {
      logger.warn({ error: revisionError }, "[RISK-CENTER] Failed to load AI revisions");
    }

    const latestRevisionByPrediction = new Map<string, RevisionRow>();
    for (const revision of (revisionRows ?? []) as RevisionRow[]) {
      if (!latestRevisionByPrediction.has(String(revision.prediction_id))) {
        latestRevisionByPrediction.set(String(revision.prediction_id), revision);
      }
    }

    const parlayByFixture = new Map<number, Set<string>>();
    for (const row of parlayLegRows ?? []) {
      const fixtureId = Number(row.fixture_id);
      const parlays = parlayByFixture.get(fixtureId) ?? new Set<string>();
      if (row.parlay_id != null) parlays.add(String(row.parlay_id));
      parlayByFixture.set(fixtureId, parlays);
    }

    const attentionItems = upcomingPredictions
      .filter((prediction) => prediction.revalidation_status !== "keep")
      .map((prediction) => {
        const fixture = fixtureById.get(Number(prediction.fixture_id))!;
        const status = prediction.revalidation_status ?? "review";
        const parlayIds = parlayByFixture.get(Number(prediction.fixture_id)) ?? new Set<string>();
        const latestRevision = latestRevisionByPrediction.get(String(prediction.id));
        return {
          predictionId: prediction.id,
          fixtureId: Number(prediction.fixture_id),
          homeTeam: fixture.home_team_name,
          awayTeam: fixture.away_team_name,
          league: fixture.league_name ?? "",
          fixtureDate: fixture.fixture_date,
          market: prediction.market_bet ?? prediction.best_market ?? "N/A",
          bestOdds: prediction.best_odds,
          evAtAnalysis: prediction.ev_at_analysis ?? prediction.expected_value,
          confidence: prediction.confidence_score,
          revalidationStatus: status,
          revalidationNote:
            prediction.revalidation_note ??
            "Belum ada hasil revalidasi odds; perlu pengecekan manual.",
          lastRevalidatedAt: prediction.last_revalidated_at,
          inParlay: parlayIds.size > 0,
          parlayCount: parlayIds.size,
          latestRevision: latestRevision
            ? {
                triggerType: latestRevision.trigger_type,
                triggerReason: latestRevision.trigger_reason,
                predictionText: latestRevision.prediction_text,
                marketBet: latestRevision.market_bet,
                bestOdds: latestRevision.best_odds,
                evAtAnalysis: latestRevision.ev_at_analysis,
                confidence: latestRevision.confidence_score,
                provider: latestRevision.provider,
                modelVersion: latestRevision.model_version,
                status: latestRevision.status,
                errorMessage: latestRevision.error_message,
                createdAt: latestRevision.created_at,
              }
            : null,
        };
      })
      .sort((a, b) => {
        if (a.revalidationStatus !== b.revalidationStatus) {
          return a.revalidationStatus === "invalidated" ? -1 : 1;
        }
        return new Date(a.fixtureDate).getTime() - new Date(b.fixtureDate).getTime();
      })
      .slice(0, 50);

    const review = attentionItems.filter((item) => item.revalidationStatus === "review").length;
    const invalidated = attentionItems.filter((item) => item.revalidationStatus === "invalidated").length;

    res.json({
      summary: { total: attentionItems.length, review, invalidated },
      items: attentionItems,
      generatedAt: now,
    });
  } catch (err) {
    logger.error({ err }, "[RISK-CENTER] Unexpected failure");
    res.status(500).json({ error: "Internal error" });
  }
});

export default router;