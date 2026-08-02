import cron from "node-cron";
import { logger } from "../lib/logger";
import { fetchAndSaveAllLeagues, DEFAULT_LEAGUES, DEFAULT_BOOKMAKERS, type LeagueConfig } from "../services/odds-fetcher";
import { runSettlement } from "../services/settlement";
import { supabase } from "../lib/supabase-client";

let currentOddsTask:       ReturnType<typeof cron.schedule> | null = null;
let currentSettlementTask: ReturnType<typeof cron.schedule> | null = null;

/* ─── Load config & run odds sync ─── */
async function loadConfigAndSync() {
  let leagues: LeagueConfig[] = DEFAULT_LEAGUES;
  let bookmakers = DEFAULT_BOOKMAKERS;
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
        // 1xBet is not accepted by the current Odds-API free-plan catalogue.
        // Keep the user's two-bookmaker configuration bounded, but replace only
        // this known invalid legacy value for the outbound request.
        bookmakers = cfg.bookmakers
          .map((name: unknown) => String(name).trim())
          .filter(Boolean)
          .map((name: string) => name.toLowerCase() === "1xbet" ? "Betano" : name)
          .filter((name: string, index: number, all: string[]) => all.indexOf(name) === index)
          .slice(0, 2)
          .join(",");
      }
    }
  } catch (err) {
    logger.error({ err }, "Failed to load scheduler config — using defaults");
  }
  logger.info({ leagues: leagues.map((l) => l.slug), bookmakers }, "Cron triggered: odds sync");
  await fetchAndSaveAllLeagues(leagues, bookmakers);
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

/* ─── Export: start all schedulers ─── */
export function startScheduler() {
  logger.info("Scheduler starting — odds sync + daily settlement");

  /* Initial odds sync on startup */
  loadConfigAndSync().catch((err) =>
    logger.error({ err }, "Initial odds sync failed"),
  );

  /* Stop existing tasks before re-creating */
  if (currentOddsTask)       { currentOddsTask.stop(); }
  if (currentSettlementTask) { currentSettlementTask.stop(); }

  /* The initial run loads scheduler_config; reconfigure from there. */
  let configuredExpression = "0 */3 * * *";
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

  logger.info("Scheduler running — odds sync uses scheduler_config | settlement daily at 06:00");
}
