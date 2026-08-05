import cron from "node-cron";
import { logger } from "../lib/logger";
import { fetchAndSaveAllLeagues, getConfiguredScanDays, DEFAULT_LEAGUES, DEFAULT_BOOKMAKERS, type LeagueConfig } from "../services/odds-fetcher";
import { runSettlement } from "../services/settlement";
import { runBaselineBackfill } from "../services/baseline-backfill";
import { runRevalidationAndTriggeredReanalysis } from "../services/reanalysis";
import { supabase } from "../lib/supabase-client";

let currentOddsTask:         ReturnType<typeof cron.schedule> | null = null;
let currentSettlementTask:   ReturnType<typeof cron.schedule> | null = null;
let currentRevalidationTask: ReturnType<typeof cron.schedule> | null = null;

/* ─── Load config & run odds sync ─── */
async function loadConfigAndSync() {
  let leagues: LeagueConfig[] = DEFAULT_LEAGUES;
  let bookmakers = DEFAULT_BOOKMAKERS;
  let scanDays: number | undefined;
  try {
    const { data, error } = await supabase
      .from("scheduler_config")
      .select("*")
      .limit(1);
    if (error) throw error;
    const cfg = data?.[0];
    if (cfg) {
      if (Array.isArray(cfg.leagues) && cfg.leagues.length > 0) {
        const matched = DEFAULT_LEAGUES.filter((l) => cfg.leagues.includes(l.slug));
        if (matched.length > 0) leagues = matched;
      }
      if (Array.isArray(cfg.bookmakers) && cfg.bookmakers.length > 0) {
        // The current free plan rejects sharp/exchange books (including
        // Sbobet) and rejects legacy 1xBet/Betano selections. Keep outbound
        // requests on the known-free recreational bookmaker.
        const freeBookmakers = cfg.bookmakers
          .map((name: unknown) => String(name).trim().toLowerCase())
          .filter((name: string) => name === "bet365");
        bookmakers = freeBookmakers.length > 0 ? "Bet365" : DEFAULT_BOOKMAKERS;
      }
      scanDays = Number.isInteger(Number(cfg.scan_days)) && Number(cfg.scan_days) >= 1 && Number(cfg.scan_days) <= 90
        ? Number(cfg.scan_days)
        : undefined;
    }
  } catch (err) {
    logger.error({ err }, "Failed to load scheduler config — using defaults");
  }
  scanDays ??= await getConfiguredScanDays();
  logger.info({ leagues: leagues.map((l) => l.slug), bookmakers, scanDays }, "Cron triggered: odds sync");
  await fetchAndSaveAllLeagues(leagues, bookmakers, scanDays);
}

function scheduleOddsTask(expression: string) {
  if (currentOddsTask) currentOddsTask.stop();
  currentOddsTask = cron.schedule(expression, () => {
    loadConfigAndSync().catch((err) =>
      logger.error({ err }, "Scheduled odds sync failed"),
    );
  });
  logger.info({ expression }, "Odds scheduler configured");
}

/* ─── Daily settlement runner ─── */
async function runDailySettlement() {
  logger.info("[SETTLEMENT] Cron harian dimulai — mengecek hasil pertandingan semalam...");
  try {
    const result = await runSettlement();
    logger.info(result, "[SETTLEMENT] Cron selesai");
  } catch (err) {
    logger.error({ err }, "[SETTLEMENT] Cron gagal");
  }
}

/* ─── Revalidation runner — backfill safe legacy baselines, then re-check
   odds/EV and run bounded AI revisions on explicit triggers. ─── */
async function runScheduledRevalidation() {
  logger.info("[REVALIDATION] Cron dimulai — baseline backfill + revalidasi + AI trigger...");
  try {
    const backfill = await runBaselineBackfill({ dryRun: false, limit: 500 });
    const result = await runRevalidationAndTriggeredReanalysis({ maxPerRun: 5 });
    logger.info({ backfill, ...result }, "[REVALIDATION] Cron selesai");
  } catch (err) {
    logger.error({ err }, "[REVALIDATION] Cron gagal");
  }
}

/* Revalidation runs after odds sync so it sees the latest stored prices.
   Baseline backfill only uses historical snapshots at or before analysis time. */

/* ─── Export: start all schedulers ─── */
export function startScheduler() {
  logger.info("Scheduler starting — odds sync + daily settlement + revalidation");

  /* Initial odds sync on startup */
  loadConfigAndSync().catch((err) =>
    logger.error({ err }, "Initial odds sync failed"),
  );

  /* Stop existing tasks before re-creating */
  if (currentOddsTask)         { currentOddsTask.stop(); }
  if (currentSettlementTask)   { currentSettlementTask.stop(); }
  if (currentRevalidationTask) { currentRevalidationTask.stop(); }

  /* The initial run loads scheduler_config; reconfigure from there. */
  let configuredExpression = "0 */6 * * *";
  supabase
    .from("scheduler_config")
    .select("cron_expression")
    .limit(1)
    .maybeSingle()
    .then(({ data, error }) => {
      if (error) {
        logger.warn({ err: error }, "Failed to load cron expression — using default");
      }
      const expression = typeof data?.cron_expression === "string" && data.cron_expression.trim()
        ? data.cron_expression.trim()
        : configuredExpression;
      try {
        scheduleOddsTask(expression);
      } catch (err) {
        logger.error({ err, expression }, "Invalid cron expression — using default");
        scheduleOddsTask(configuredExpression);
      }
    });

  /* Settlement: every day at 06:00 server time */
  currentSettlementTask = cron.schedule("0 6 * * *", () => {
    runDailySettlement().catch((err) =>
      logger.error({ err }, "Daily settlement failed"),
    );
  });

  /* Revalidation: run after the regular 3-hour odds cadence so it sees the
     latest stored prices. It only tags active, pre-kickoff predictions. */
  currentRevalidationTask = cron.schedule("15 */3 * * *", () => {
    runScheduledRevalidation().catch((err) =>
      logger.error({ err }, "Scheduled revalidation failed"),
    );
  });

  logger.info("Scheduler running — odds sync uses scheduler_config | settlement daily at 06:00 | revalidation every 3h");
}
