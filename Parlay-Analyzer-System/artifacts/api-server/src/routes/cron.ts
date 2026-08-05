import { Router, type IRouter } from "express";
import { fetchAndSaveAllLeagues } from "../services/odds-fetcher";
import { logger } from "../lib/logger";
import { runRevalidation } from "../services/revalidation";
import { runBaselineBackfill } from "../services/baseline-backfill";
import { runRevalidationAndTriggeredReanalysis } from "../services/reanalysis";

const router: IRouter = Router();

const CRON_SECRET = process.env["CRON_SECRET"];

function isAuthorized(req: any): boolean {
  if (!CRON_SECRET) return false;
  const header = req.headers["x-cron-secret"] ?? req.headers["X-Cron-Secret"];
  const query = req.query["token"];
  return header === CRON_SECRET || query === CRON_SECRET;
}

/**
 * Cron-safe endpoint for external cron services (e.g. cron-job.org).
 *
 * GET /api/cron?token=<CRON_SECRET>&action=keep-alive  -> lightweight ping, no odds API calls
 * GET /api/cron?token=<CRON_SECRET>&action=sync        -> trigger full odds sync
 * GET /api/cron?token=<CRON_SECRET>&action=revalidate  -> refresh active pre-kickoff prediction tags
 * GET /api/cron?token=<CRON_SECRET>&action=reanalyze  -> backfill + revalidate + trigger bounded AI revisions
 *
 * Keep-alive is recommended for 30-minute pings to keep a Replit workspace alive
 * without burning the Odds-API free-plan quota.
 */
function handleCron(req: any, res: any) {
  if (!CRON_SECRET) {
    res.status(503).json({ error: "CRON_SECRET not configured" });
    return;
  }

  if (!isAuthorized(req)) {
    res.status(401).json({ error: "Invalid cron secret" });
    return;
  }

  const action = (req.query["action"] as string | undefined) ?? "keep-alive";

  if (action === "sync") {
    res.json({
      message: "Cron sync started in background",
      timestamp: new Date().toISOString(),
    });
    fetchAndSaveAllLeagues().catch((err) =>
      logger.error({ err }, "Cron-triggered odds sync failed"),
    );
    return;
  }

  if (action === "revalidate") {
    res.json({
      message: "Prediction revalidation started in background",
      timestamp: new Date().toISOString(),
    });
    runRevalidation().catch((err) =>
      logger.error({ err }, "Cron-triggered prediction revalidation failed"),
    );
    return;
  }

  if (action === "backfill") {
    res.json({
      message: "Baseline odds backfill started in background",
      timestamp: new Date().toISOString(),
    });
    runBaselineBackfill({ dryRun: false }).catch((err) =>
      logger.error({ err }, "Cron-triggered baseline backfill failed"),
    );
    return;
  }

  if (action === "reanalyze") {
    res.json({
      message: "Triggered AI re-analysis started in background",
      timestamp: new Date().toISOString(),
    });
    runBaselineBackfill({ dryRun: false })
      .then(() => runRevalidationAndTriggeredReanalysis({ maxPerRun: 5 }))
      .catch((err) => logger.error({ err }, "Cron-triggered AI re-analysis failed"));
    return;
  }

  res.json({
    ok: true,
    action: "keep-alive",
    timestamp: new Date().toISOString(),
  });
}

// The router is mounted at `/api`, so this route is exposed as `/api/cron`.
router.get("/cron", handleCron);

export default router;
