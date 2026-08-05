import { Router, type IRouter } from "express";
import { logger } from "../lib/logger";
import { supabase } from "../lib/supabase-client";
import { requireAdmin } from "../middlewares/admin";
import { refreshOddsForFixtures } from "../services/odds-fetcher";
import { runRevalidation, type RevalidationCandidate } from "../services/revalidation";
import { runTriggeredReanalysis } from "../services/reanalysis";
import {
  calculateParlayMetrics,
  createMergedParlay,
  type ParlayCandidate,
} from "../services/parlay-builder";

const router: IRouter = Router();
const READINESS_MAX_AGE_MINUTES = 20;

type ParlayRow = {
  id: string;
  parlay_name: string;
  status: string;
};

type LegRow = {
  parlay_id: string;
  prediction_id: string | null;
  fixture_id: number;
  leg_order: number;
  market: string;
  selection: string;
  odds: number;
  probability: number;
  confidence: number | null;
};

type PredictionRow = {
  id: string;
  fixture_id: number;
  status: string | null;
  market_bet: string | null;
  best_market: string | null;
  best_odds: number | null;
  confidence_score: number | null;
  ev_at_analysis: number | null;
  expected_value: number | null;
  home_team: string | null;
  away_team: string | null;
  league: string | null;
};

type FixtureRow = {
  fixture_id: number;
  fixture_date: string;
  home_team_name: string;
  away_team_name: string;
  league_name: string | null;
};

type RevisionRow = {
  prediction_id: string;
  status: string;
  provider: string | null;
  model_version: string | null;
  created_at: string;
  market_bet: string | null;
  best_odds: number | null;
  ev_at_analysis: number | null;
  confidence_score: number | null;
};

type ReadinessStatus =
  | "ready"
  | "review"
  | "invalidated"
  | "missing_odds"
  | "started_or_finished"
  | "missing_prediction"
  | "stale";

function asIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map((item) => String(item)).filter(Boolean))).slice(0, 10);
}

function candidateFrom(
  leg: LegRow,
  prediction: PredictionRow | undefined,
  fixture: FixtureRow | undefined,
  revalidation: RevalidationCandidate | undefined,
): ParlayCandidate {
  return {
    predictionId: leg.prediction_id ?? prediction?.id,
    fixtureId: leg.fixture_id,
    homeTeam: fixture?.home_team_name ?? prediction?.home_team ?? "Unknown home",
    awayTeam: fixture?.away_team_name ?? prediction?.away_team ?? "Unknown away",
    league: fixture?.league_name ?? prediction?.league ?? "",
    date: fixture?.fixture_date,
    market: revalidation?.marketBet ?? prediction?.market_bet ?? prediction?.best_market ?? leg.market,
    selection: leg.selection,
    odds: revalidation?.currentOdds ?? leg.odds,
    confidence: prediction?.confidence_score ?? leg.confidence ?? 0,
    evPercent: ((revalidation?.currentEV ?? prediction?.ev_at_analysis ?? prediction?.expected_value ?? 0) * 100),
  };
}

async function loadReadiness(parlayIds: string[]) {
  const { data: parlays, error: parlaysError } = await supabase
    .from("parlays")
    .select("id, parlay_name, status")
    .in("id", parlayIds)
    .eq("status", "active");
  if (parlaysError) throw parlaysError;

  const selectedParlays = (parlays ?? []) as ParlayRow[];
  const { data: legs, error: legsError } = await supabase
    .from("parlay_legs")
    .select("parlay_id, prediction_id, fixture_id, leg_order, market, selection, odds, probability, confidence")
    .in("parlay_id", selectedParlays.map((parlay) => parlay.id))
    .order("leg_order", { ascending: true });
  if (legsError) throw legsError;

  const legRows = (legs ?? []) as LegRow[];
  const fixtureIds = Array.from(new Set(legRows.map((leg) => Number(leg.fixture_id))));
  const predictionIds = Array.from(new Set(legRows.map((leg) => leg.prediction_id).filter(Boolean) as string[]));

  const [{ data: predictions, error: predictionsError }, { data: fixtures, error: fixturesError }] = await Promise.all([
    supabase
      .from("ai_predictions")
      .select("id, fixture_id, status, market_bet, best_market, best_odds, confidence_score, ev_at_analysis, expected_value, home_team, away_team, league")
      .or(predictionIds.length ? `id.in.(${predictionIds.join(",")})` : `fixture_id.in.(${fixtureIds.join(",")})`),
    supabase
      .from("fixtures")
      .select("fixture_id, fixture_date, home_team_name, away_team_name, league_name")
      .in("fixture_id", fixtureIds),
  ]);
  if (predictionsError) throw predictionsError;
  if (fixturesError) throw fixturesError;

  return {
    selectedParlays,
    legRows,
    predictions: (predictions ?? []) as PredictionRow[],
    fixtures: (fixtures ?? []) as FixtureRow[],
    fixtureIds,
  };
}

async function buildReadiness(parlayIds: string[], refresh = true) {
  if (parlayIds.length === 0) {
    throw new Error("Pilih minimal satu parlay aktif");
  }
  const loaded = await loadReadiness(parlayIds);
  const refreshSummary = refresh ? await refreshOddsForFixtures(loaded.fixtureIds) : null;
  let revalidation = await runRevalidation();
  const targetedPredictionIds = Array.from(new Set(loaded.predictions.map((prediction) => prediction.id)));
  const reanalysis = await runTriggeredReanalysis(revalidation.candidates ?? [], {
    force: true,
    maxPerRun: Math.min(7, Math.max(1, targetedPredictionIds.length)),
    predictionIds: targetedPredictionIds,
  });
  revalidation = await runRevalidation();
  const candidateByPrediction = new Map(
    (revalidation.candidates ?? []).map((candidate) => [candidate.predictionId, candidate]),
  );
  const predictionById = new Map(loaded.predictions.map((prediction) => [prediction.id, prediction]));
  const predictionByFixture = new Map(loaded.predictions.map((prediction) => [Number(prediction.fixture_id), prediction]));
  const fixtureById = new Map(loaded.fixtures.map((fixture) => [Number(fixture.fixture_id), fixture]));
  const { data: revisionRows } = await supabase
    .from("ai_prediction_revisions")
    .select("prediction_id, status, provider, model_version, created_at, market_bet, best_odds, ev_at_analysis, confidence_score")
    .in("prediction_id", targetedPredictionIds)
    .order("created_at", { ascending: false })
    .limit(100);
  const latestRevisionByPrediction = new Map<string, RevisionRow>();
  for (const revision of (revisionRows ?? []) as RevisionRow[]) {
    if (!latestRevisionByPrediction.has(String(revision.prediction_id))) {
      latestRevisionByPrediction.set(String(revision.prediction_id), revision);
    }
  }
  const now = Date.now();

  const legs = loaded.legRows.map((leg) => {
    const prediction = leg.prediction_id
      ? predictionById.get(leg.prediction_id)
      : predictionByFixture.get(Number(leg.fixture_id));
    const fixture = fixtureById.get(Number(leg.fixture_id));
    const revalidationCandidate = prediction ? candidateByPrediction.get(prediction.id) : undefined;
    const candidate = candidateFrom(leg, prediction, fixture, revalidationCandidate);
    const latestRevision = prediction ? latestRevisionByPrediction.get(prediction.id) : undefined;
    if (latestRevision?.status === "completed") {
      if (latestRevision.market_bet) candidate.market = latestRevision.market_bet;
      if (latestRevision.best_odds != null && latestRevision.best_odds > 1) candidate.odds = latestRevision.best_odds;
      if (latestRevision.confidence_score != null) candidate.confidence = latestRevision.confidence_score;
      if (latestRevision.ev_at_analysis != null) candidate.evPercent = latestRevision.ev_at_analysis * 100;
    }
    const capturedAt = revalidationCandidate?.oddsCapturedAt;
    const kickoffAt = fixture ? new Date(fixture.fixture_date).getTime() : 0;
    const upcoming = kickoffAt > now;
    const fresh = upcoming && (capturedAt
      ? now - new Date(capturedAt).getTime() <= READINESS_MAX_AGE_MINUTES * 60_000
      : refreshSummary?.refreshed === refreshSummary?.requested);
    const aiFresh = latestRevision?.status === "completed";
    const status: ReadinessStatus = prediction?.status === "active" && revalidationCandidate?.status === "keep" && fresh && aiFresh
      ? "ready"
      : !prediction
        ? "missing_prediction"
        : !upcoming
          ? "started_or_finished"
          : !revalidationCandidate?.currentOdds
            ? "missing_odds"
          : revalidationCandidate?.status === "invalidated"
            ? "invalidated"
            : revalidationCandidate?.status === "review"
              ? "review"
              : "stale";
    return {
      parlayId: leg.parlay_id,
      fixtureId: Number(leg.fixture_id),
      homeTeam: candidate.homeTeam,
      awayTeam: candidate.awayTeam,
      fixtureDate: fixture?.fixture_date ?? null,
      market: candidate.market,
      selection: candidate.selection,
      analysisOdds: leg.odds,
      currentOdds: revalidationCandidate?.currentOdds ?? null,
      confidence: candidate.confidence,
      currentEV: revalidationCandidate?.currentEV ?? null,
      status,
      reason: status === "ready"
        ? "Odds segar, AI berhasil diperbarui, dan revalidasi terakhir tetap aman."
        : !aiFresh
          ? "AI belum berhasil diperbarui untuk leg ini; jangan pasang bet."
          : status === "missing_odds"
            ? "Odds terbaru untuk market ini tidak ditemukan; jangan pasang bet."
            : status === "review"
              ? revalidationCandidate?.triggerReason ?? "Perlu review sebelum kickoff."
              : status === "invalidated"
                ? revalidationCandidate?.triggerReason ?? "Sinyal value sudah invalid."
                : status === "started_or_finished"
                  ? "Fixture sudah mulai atau selesai."
                  : "Prediksi aktif tidak ditemukan.",
      aiRevision: latestRevision
        ? {
            status: latestRevision.status,
            provider: latestRevision.provider,
            modelVersion: latestRevision.model_version,
            createdAt: latestRevision.created_at,
          }
        : null,
      candidate,
    };
  });

  const readyCandidates = legs.filter((leg) => leg.status === "ready").map((leg) => leg.candidate);
  const rejected = legs
    .filter((leg) => leg.status !== "ready")
    .map((leg) => ({ fixtureId: leg.fixtureId, reason: leg.reason }));
  const metrics = calculateParlayMetrics(readyCandidates);
  return {
    ready: legs.length > 0 && legs.every((leg) => leg.status === "ready"),
    generatedAt: new Date().toISOString(),
    refresh: refreshSummary,
    reanalysis,
    selectedParlays: loaded.selectedParlays.map((parlay) => ({
      id: parlay.id,
      name: parlay.parlay_name,
    })),
    legs,
    mergePreview: {
      ...metrics,
      legs: readyCandidates.length,
      rejected,
      maxLegs: 7,
    },
  };
}

router.post("/parlays/readiness", requireAdmin, async (req, res) => {
  try {
    const parlayIds = asIds(req.body?.parlayIds);
    const stake = Number(req.body?.stake);
    const result = await buildReadiness(parlayIds, true);
    const normalizedStake = Number.isFinite(stake) && stake > 0 ? stake : null;
    const response = normalizedStake == null
      ? result
      : {
          ...result,
          mergePreview: {
            ...result.mergePreview,
            stake: normalizedStake,
            potentialReturn: normalizedStake * result.mergePreview.combinedOdds,
            potentialProfit: normalizedStake * result.mergePreview.combinedOdds - normalizedStake,
          },
        };
    res.json(response);
  } catch (error) {
    logger.error({ error }, "[PARLAY-READINESS] Failed");
    res.status(500).json({ error: error instanceof Error ? error.message : "Readiness check failed" });
  }
});

router.post("/parlays/merge", requireAdmin, async (req, res) => {
  try {
    const parlayIds = asIds(req.body?.parlayIds);
    if (parlayIds.length < 2) {
      res.status(422).json({ error: "Pilih minimal dua parlay aktif untuk digabungkan." });
      return;
    }
    const readiness = await buildReadiness(parlayIds, true);
    if (!readiness.ready) {
      res.status(409).json({
        code: "PARLAY_NOT_READY",
        error: "Merge dibatalkan karena semua leg belum fresh dan valid.",
        readiness,
      });
      return;
    }
    const duplicateFixtures = readiness.legs
      .map((leg) => leg.fixtureId)
      .filter((fixtureId, index, all) => all.indexOf(fixtureId) !== index);
    if (duplicateFixtures.length > 0) {
      res.status(409).json({
        code: "DUPLICATE_FIXTURE",
        error: `Merge dibatalkan: fixture duplikat ditemukan (${Array.from(new Set(duplicateFixtures)).join(", ")}).`,
        readiness,
      });
      return;
    }
    const startedLegs = readiness.legs.filter((leg) => leg.status === "started_or_finished");
    if (startedLegs.length > 0) {
      res.status(409).json({
        code: "FIXTURE_STARTED",
        error: "Merge dibatalkan karena ada fixture yang sudah kickoff.",
        readiness,
      });
      return;
    }
    const candidates = readiness.legs.map((leg) => leg.candidate);
    const result = await createMergedParlay(candidates, parlayIds);
    const stake = Number(req.body?.stake);
    const normalizedStake = Number.isFinite(stake) && stake > 0 ? stake : null;
    const response = normalizedStake == null
      ? result
      : {
          ...result,
          stake: normalizedStake,
          potentialReturn: normalizedStake * result.combinedOdds,
          potentialProfit: normalizedStake * result.combinedOdds - normalizedStake,
        };
    if (!result.parlayId) {
      res.status(422).json({ error: "Tidak cukup leg valid untuk membuat merged parlay.", result, readiness });
      return;
    }
    res.status(201).json({ ...response, readiness });
  } catch (error) {
    logger.error({ error }, "[PARLAY-MERGE] Failed");
    res.status(500).json({ error: error instanceof Error ? error.message : "Merge failed" });
  }
});

export default router;