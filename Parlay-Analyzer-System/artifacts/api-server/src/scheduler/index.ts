import cron from "node-cron";
import { logger } from "../lib/logger";
import { fetchAndSaveAllLeagues, DEFAULT_LEAGUES, type LeagueConfig } from "../services/odds-fetcher";
import { runSettlement } from "../services/settlement";
import { supabase } from "../lib/supabase-client";

let currentOddsTask:       ReturnType<typeof cron.schedule> | null = null;
let currentSettlementTask: ReturnType<typeof cron.schedule> | null = null;

/* ─── Load config & run odds sync ─── */
async function loadConfigAndSync() {
  let leagues: LeagueConfig[] = DEFAULT_LEAGUES;
  let bookmakers = "Bet365,Sbobet";
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
        bookmakers = cfg.bookmakers.join(",");
      }
    }
  } catch (err) {
    logger.error({ err }, "Failed to load scheduler config — using defaults");
  }
  logger.info({ leagues: leagues.map((l) => l.slug), bookmakers }, "Cron triggered: odds sync");
  await fetchAndSaveAllLeagues(leagues, bookmakers);
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

  /* Odds sync: every 3 hours */
  currentOddsTask = cron.schedule("0 */3 * * *", () => {
    loadConfigAndSync().catch((err) =>
      logger.error({ err }, "Scheduled odds sync failed"),
    );
  });

  /* Settlement: every day at 06:00 server time */
  currentSettlementTask = cron.schedule("0 6 * * *", () => {
    runDailySettlement().catch((err) =>
      logger.error({ err }, "Daily settlement failed"),
    );
  });

  logger.info("Scheduler running — odds sync every 3h | settlement daily at 06:00");
}
