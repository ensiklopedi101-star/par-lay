import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { supabase } from "../lib/supabase-client";
import { logger } from "../lib/logger";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

/* ═══════════════════════════════════════════════════════════════
   SYSTEM HEALTH CHECK — Modul 2: Dashboard Bug Fix & Health Monitor
   Returns real-time status of all critical services
   ═══════════════════════════════════════════════════════════════ */
router.get("/health", async (_req, res) => {
  const health = {
    supabase: { status: "checking", latencyMs: 0 },
    gemini: { status: "checking", model: "gemini-2.0-flash" },
    aiPipeline: {
      status: "checking" as "checking" | "ready" | "error" | "missing_key",
      activePredictions: 0,
      reviewPredictions: 0,
      invalidatedPredictions: 0,
    },
    aiLearning: { status: "checking", hitRate: null as number | null },
    oddsApi: { status: "checking", lastRateLimit: null as string | null },
    timestamp: new Date().toISOString(),
  };

  /* 1. Supabase connection */
  const t0 = Date.now();
  try {
    const { data, error } = await supabase
      .from("fixtures")
      .select("fixture_id", { count: "exact", head: true });
    health.supabase.latencyMs = Date.now() - t0;
    health.supabase.status = error ? "error" : "active";
  } catch (err) {
    health.supabase.status = "error";
    health.supabase.latencyMs = Date.now() - t0;
    logger.error({ err }, "Health check: Supabase failed");
  }

  /* 2. Gemini API */
  const geminiKey = process.env["GEMINI_API_KEY"];
  health.gemini.status = geminiKey ? "active" : "missing_key";

  /* 3. AI Pipeline status and risk counts. Active predictions are stored
     recommendations, not an in-progress calculation, so they must not make
     the UI claim that the pipeline is "calculating". */
  try {
    const { count: activeCount, error: activeError } = await supabase
      .from("ai_predictions")
      .select("id", { count: "exact", head: true })
      .eq("status", "active");
    const { count: reviewCount, error: reviewError } = await supabase
      .from("ai_predictions")
      .select("id", { count: "exact", head: true })
      .eq("status", "active")
      .eq("revalidation_status", "review");
    const { count: invalidatedCount, error: invalidatedError } = await supabase
      .from("ai_predictions")
      .select("id", { count: "exact", head: true })
      .eq("status", "active")
      .eq("revalidation_status", "invalidated");

    health.aiPipeline.activePredictions = activeCount ?? 0;
    health.aiPipeline.reviewPredictions = reviewCount ?? 0;
    health.aiPipeline.invalidatedPredictions = invalidatedCount ?? 0;
    health.aiPipeline.status =
      activeError || reviewError || invalidatedError
        ? "error"
        : geminiKey
          ? "ready"
          : "missing_key";
  } catch (err) {
    logger.error({ err }, "Health check: AI pipeline query failed");
    health.aiPipeline.status = "error";
  }

  /* 4. AI Learning — last performance log */
  try {
    const { data: perf } = await supabase
      .from("performance_log")
      .select("hit_rate, total_roi")
      .order("date", { ascending: false })
      .limit(1)
      .maybeSingle();
    health.aiLearning.status = perf ? "active" : "no_data";
    health.aiLearning.hitRate = perf?.hit_rate ?? null;
  } catch {
    health.aiLearning.status = "no_data";
  }

  /* 5. Odds API status */
  const oddsKey = process.env["ODDS_API_KEY"];
  health.oddsApi.status = oddsKey ? "active" : "missing_key";

  res.json(health);
});

export default router;
