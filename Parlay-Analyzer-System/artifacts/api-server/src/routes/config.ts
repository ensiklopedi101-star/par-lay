import { Router, type IRouter } from "express";
import { supabase } from "../lib/supabase-client";
import { logger } from "../lib/logger";
import { isSyncRunning } from "../services/odds-fetcher";
import { requireAdmin } from "../middlewares/admin";
import cron from "node-cron";
import { reloadOddsSchedule } from "../scheduler";
import { buildSettlementSummary } from "../services/settlement-summary";

/**
 * ─── Transparansi sync ────────────────────────────────────────────────────
 * `sync_runs` sudah menyimpan seluruh statistik satu proses sync, tetapi
 * dashboard hanya menampilkan waktu dan status. Struktur di bawah ini
 * menormalkan baris DB menjadi bentuk yang aman dikirim ke klien, sekaligus
 * menghitung durasi dan throughput agar bisa ditampilkan apa adanya.
 */

/** Batas run dianggap basi. Sync per-liga normal selesai < 2 menit. */
const STALE_RUN_SECONDS = 10 * 60;

/** Berapa run terakhir yang dikirim ke dashboard. */
const SYNC_HISTORY_LIMIT = 12;

const SYNC_RUN_COLUMNS = [
  "id",
  "started_at",
  "finished_at",
  "status",
  "leagues",
  "events_fetched",
  "events_inserted",
  "odds_fetched",
  "errors",
  "rate_limited_seconds",
  "error_message",
  "created_at",
].join(", ");

export interface SyncRunSummary {
  id: number | null;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  /** Durasi milidetik; `null` bila run belum selesai. */
  durationMs: number | null;
  leagues: string[];
  leagueCount: number;
  eventsFetched: number;
  eventsInserted: number;
  oddsFetched: number;
  errors: number;
  rateLimitedSeconds: number;
  errorMessage: string | null;
  /** Persentase event yang tersimpan dari yang ditarik; `null` bila tidak ada. */
  insertRatio: number | null;
  /**
   * Penjelasan bila tidak ada satu pun event tersimpan meski ada yang ditarik.
   *
   * Angka `eventsFetched: 811, eventsInserted: 0` terlihat seperti kegagalan
   * total, padahal hampir selalu berarti "semua event di luar jendela".
   * Tanpa penjelasan ini, dashboard hanya menampilkan nol tanpa sebab — dan
   * itulah yang membuat proses sync terasa tidak transparan.
   */
  zeroInsertReason: string | null;
}

function num(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function toSyncRunSummary(input: unknown): SyncRunSummary {
  const row = (input ?? {}) as Record<string, unknown>;
  const startedAt = (row["started_at"] as string | null) ?? (row["created_at"] as string) ?? new Date().toISOString();
  const finishedAt = (row["finished_at"] as string | null) ?? null;
  const startMs = new Date(startedAt).getTime();
  const endMs = finishedAt ? new Date(finishedAt).getTime() : NaN;
  const durationMs =
    Number.isFinite(startMs) && Number.isFinite(endMs) ? Math.max(0, endMs - startMs) : null;

  const eventsFetched = num(row["events_fetched"]);
  const eventsInserted = num(row["events_inserted"]);
  const leagues = Array.isArray(row["leagues"]) ? (row["leagues"] as string[]) : [];

  return {
    id: row["id"] != null ? num(row["id"]) : null,
    status: (row["status"] as string) ?? "unknown",
    startedAt,
    finishedAt,
    durationMs,
    leagues,
    leagueCount: leagues.length,
    eventsFetched,
    eventsInserted,
    oddsFetched: num(row["odds_fetched"]),
    errors: num(row["errors"]),
    rateLimitedSeconds: num(row["rate_limited_seconds"]),
    errorMessage: (row["error_message"] as string | null) ?? null,
    insertRatio: eventsFetched > 0 ? eventsInserted / eventsFetched : null,
    zeroInsertReason: explainZeroInsert(eventsFetched, eventsInserted),
  };
}

/**
 * Terangkan kenapa `eventsFetched` bisa besar sementara `eventsInserted` nol.
 *
 * Alurnya di `fetchAndSaveLeagueOdds`:
 *   1. provider mengembalikan SEMUA event satu liga  → `eventsFetched`
 *   2. event disaring ke jendela `scan_days` (default 10 hari ke depan)
 *   3. event yang sudah tersinkron dibuang
 *   4. sisa event diambil odds-nya satu per satu    → `saved` / `inserted`
 *
 * Jadi nol bukan berarti gagal: bisa berarti tidak ada satu pun event yang
 * jatuh di jendela, atau semuanya sudah tersinkron sebelumnya. Keduanya
 * normal dan tidak butuh tindakan — beda halnya dengan error atau rate limit.
 */
function explainZeroInsert(fetched: number, inserted: number): string | null {
  if (fetched <= 0 || inserted > 0) return null;
  return (
    "Tidak ada event baru yang masuk jendela pemindaian. Provider mengembalikan " +
    `${fetched} event, tetapi semuanya jatuh di luar jendela (atau sudah tersinkron ` +
    "sebelumnya). Ini normal saat liga sedang jeda atau jadwal belum dirilis — " +
    "bukan kegagalan. Perbesar scan_days bila ingin jendela lebih jauh."
  );
}

export const LEAGUES_CATALOG = [
  { slug: "england-premier-league",      name: "Premier League",         country: "Inggris" },
  { slug: "england-championship",         name: "Championship",           country: "Inggris" },
  { slug: "spain-laliga",                 name: "La Liga",                country: "Spanyol" },
  { slug: "france-ligue-1",              name: "Ligue 1",                country: "Prancis" },
  { slug: "italy-serie-a",               name: "Serie A",                country: "Italia" },
  { slug: "netherlands-eredivisie",       name: "Eredivisie",             country: "Belanda" },
  { slug: "germany-bundesliga",           name: "Bundesliga",             country: "Jerman" },
  { slug: "uefa-champions-league",        name: "UEFA Champions League",  country: "UEFA" },
  { slug: "uefa-europa-league",           name: "UEFA Europa League",     country: "UEFA" },
  { slug: "fifa-world-cup",              name: "FIFA World Cup",         country: "FIFA" },
  { slug: "republic-of-korea-k-league-1","name": "K-League 1",           country: "Korea" },
  { slug: "china-chinese-super-league",  name: "Chinese Super League",   country: "China" },
  { slug: "japan-j1-league",             name: "J1 League",              country: "Jepang" },
];

export const MARKETS_CATALOG = [
  { key: "ML",     label: "1X2 / Match Result",              description: "Full time match winner (Home/Draw/Away)" },
  { key: "AH",     label: "Alternate Spread",                description: "Asian Handicap — alternative line spreads" },
  { key: "Totals", label: "Alternate Totals",                description: "Over/Under — alternative total goals lines" },
  { key: "HT",     label: "Half Time Result",                description: "Half time score / 1X2 at half time" },
  { key: "BTTS",   label: "Both Teams To Score (BTTS)",      description: "Yes / No — both teams score at least one goal" },
];

const router: IRouter = Router();

async function getOrCreateConfig() {
  const { data, error } = await supabase
    .from("scheduler_config")
    .select("*")
    .limit(1);

  if (error) {
    logger.error({ error }, "Failed to fetch config");
    throw error;
  }

  if (data && data.length > 0) return data[0]!;

  // Create default config
  const { data: created, error: insertErr } = await supabase
    .from("scheduler_config")
    .insert({
      // Slug must match LEAGUES_CATALOG / DEFAULT_LEAGUES ("italy-serie-a").
      leagues: ["italy-serie-a"],
      bookmakers: ["Bet365"],
      markets: ["ML", "Totals", "AH", "HT", "BTTS"],
      cron_expression: "0 */6 * * *",
    })
    .select()
    .single();

  if (insertErr) {
    logger.error({ error: insertErr }, "Failed to create default config");
    throw insertErr;
  }

  return created!;
}

router.get("/catalog", (_req, res) => {
  res.json({ leagues: LEAGUES_CATALOG, markets: MARKETS_CATALOG });
});

router.get("/config", async (_req, res) => {
  try {
    const cfg = await getOrCreateConfig();
    res.json({
      id: cfg.id,
      leagues: cfg.leagues,
      bookmakers: cfg.bookmakers,
      markets: cfg.markets,
      cronExpression: cfg.cron_expression,
      scanDays: Number(cfg.scan_days ?? 11),
      aiPersona: cfg.ai_persona ?? null,
      agentInstructions: cfg.agent_instructions ?? null,
      updatedAt: cfg.updated_at ?? null,
    });
  } catch (err) {
    logger.error({ err }, "Failed to get config");
    res.status(500).json({ error: "Failed to get config" });
  }
});

/** Admin-only: update scheduler config & AI persona. */
router.post("/config", requireAdmin, async (req, res) => {
  try {
    const { leagues, bookmakers, markets, cronExpression, scanDays, aiPersona, agentInstructions } = req.body;
    const normalizedScanDays = scanDays === undefined ? undefined : Number(scanDays);
    if (normalizedScanDays !== undefined && (!Number.isInteger(normalizedScanDays) || normalizedScanDays < 1 || normalizedScanDays > 90)) {
      res.status(400).json({ error: "scanDays must be an integer between 1 and 90" });
      return;
    }
    const normalizedCron = cronExpression === undefined ? undefined : String(cronExpression).trim();
    if (normalizedCron !== undefined && normalizedCron !== "" && !cron.validate(normalizedCron)) {
      res.status(400).json({ error: "cronExpression is not a valid cron expression" });
      return;
    }
    const { data: existing } = await supabase
      .from("scheduler_config")
      .select("id")
      .limit(1);

    const updatePayload: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (leagues !== undefined) updatePayload.leagues = leagues;
    if (bookmakers !== undefined) updatePayload.bookmakers = bookmakers;
    if (markets !== undefined) updatePayload.markets = markets;
    if (normalizedCron) updatePayload.cron_expression = normalizedCron;
    if (normalizedScanDays !== undefined) updatePayload.scan_days = normalizedScanDays;
    if (aiPersona !== undefined) updatePayload.ai_persona = aiPersona;
    if (agentInstructions !== undefined) updatePayload.agent_instructions = agentInstructions;

    let cfg;
    if (existing && existing.length > 0) {
      const { data: updated, error } = await supabase
        .from("scheduler_config")
        .update(updatePayload)
        .eq("id", existing[0]!.id)
        .select()
        .single();
      if (error) throw error;
      cfg = updated!;
    } else {
      const { data: created, error } = await supabase
        .from("scheduler_config")
        .insert({
          leagues,
          bookmakers,
          markets,
          cron_expression: normalizedCron ?? "0 */6 * * *",
          scan_days: normalizedScanDays ?? 11,
          ai_persona: aiPersona ?? null,
          agent_instructions: agentInstructions ?? null,
        })
        .select()
        .single();
      if (error) throw error;
      cfg = created!;
    }

    /*
     * Apply a new cron expression to the running scheduler. Persisting it in
     * Supabase alone left the server on the old schedule until a restart.
     */
    const savedCron = typeof cfg.cron_expression === "string" ? cfg.cron_expression.trim() : "";
    const schedulerReload = normalizedCron && savedCron
      ? reloadOddsSchedule(savedCron)
      : null;
    if (schedulerReload && !schedulerReload.ok) {
      logger.warn({ schedulerReload }, "Config saved but the odds schedule was not reloaded");
    }

    res.json({
      id: cfg.id,
      leagues: cfg.leagues,
      bookmakers: cfg.bookmakers,
      markets: cfg.markets,
      cronExpression: cfg.cron_expression,
      scanDays: Number(cfg.scan_days ?? 11),
      aiPersona: cfg.ai_persona ?? null,
      agentInstructions: cfg.agent_instructions ?? null,
      updatedAt: cfg.updated_at ?? null,
      schedulerReloaded: schedulerReload?.ok ?? false,
    });
  } catch (err) {
    logger.error({ err }, "Failed to save config");
    res.status(500).json({ error: "Failed to save config" });
  }
});

router.post("/sync/settle", requireAdmin, async (_req, res) => {
  try {
    const { runSettlement } = await import("../services/settlement");
    const result = await runSettlement();
    res.json({ ok: true, ...result });
  } catch (err) {
    logger.error({ err }, "Settlement trigger failed");
    res.status(500).json({ error: "Settlement failed" });
  }
});

router.post("/sync/revalidate", requireAdmin, async (_req, res) => {
  try {
    const { runRevalidation } = await import("../services/revalidation");
    const result = await runRevalidation();
    res.json({ ok: true, ...result });
  } catch (err) {
    logger.error({ err }, "Revalidation trigger failed");
    res.status(500).json({ error: "Revalidation failed" });
  }
});

router.post("/sync/backfill-baseline", requireAdmin, async (req, res) => {
  try {
    const { runBaselineBackfill } = await import("../services/baseline-backfill");
    const dryRun = req.body?.dryRun !== false;
    const result = await runBaselineBackfill({
      dryRun,
      limit: Number(req.body?.limit ?? 500),
    });
    res.json({ ok: true, ...result });
  } catch (err) {
    logger.error({ err }, "Baseline odds backfill failed");
    res.status(500).json({ error: "Baseline odds backfill failed" });
  }
});

router.post("/sync/reanalyze", requireAdmin, async (req, res) => {
  try {
    const { runRevalidationAndTriggeredReanalysis } = await import("../services/reanalysis");
    const result = await runRevalidationAndTriggeredReanalysis({
      maxPerRun: Number(req.body?.maxPerRun ?? 5),
    });
    res.json({ ok: true, ...result });
  } catch (err) {
    logger.error({ err }, "Triggered AI re-analysis failed");
    res.status(500).json({ error: "Triggered AI re-analysis failed" });
  }
});

/**
 * GET /sync/settlement-summary — transparansi proses settlement.
 *
 * Menjawab pertanyaan "kenapa hasil settlement belum muncul": berapa yang
 * sudah selesai, berapa menunggu skor, berapa yang gagal karena data tidak
 * lengkap. Hanya membaca; tidak memakai kuota penyedia odds.
 */
router.get("/sync/settlement-summary", async (_req, res) => {
  try {
    const summary = await buildSettlementSummary();
    res.json(summary);
  } catch (err) {
    logger.error({ err }, "Gagal membangun ringkasan settlement");
    res.status(500).json({
      error: "Gagal membangun ringkasan settlement",
      detail: err instanceof Error ? err.message : String(err),
    });
  }
});

router.get("/sync/status", async (_req, res) => {
  /* `supabase` bernilai null bila SUPABASE_URL / service-role key tidak diset
   * (mis. saat dijalankan tanpa env, atau env salah nama di platform).
   * Tanpa penjagaan ini rute melempar TypeError dan berakhir 500 tanpa
   * menjelaskan apa pun. Lebih baik 503 dengan sebab yang bisa dibaca. */
  if (!supabase) {
    res.status(503).json({
      error: "Supabase tidak terkonfigurasi",
      detail:
        "SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY harus tersedia agar status sync bisa dibaca.",
      configured: false,
    });
    return;
  }

  try {
    const { data: schedulerConfig } = await supabase
      .from("scheduler_config")
      .select("leagues, scan_days")
      .limit(1)
      .maybeSingle();
    const configuredLeagues = Array.isArray(schedulerConfig?.leagues)
      ? schedulerConfig.leagues
      : [];
    /* Jendela pemindaian ikut dikirim: tanpa ini, angka "0 tersimpan"
     * tidak bisa ditindaklanjuti karena pengguna tidak tahu seberapa jauh
     * sistem mencari fixture. */
    const scanDays =
      typeof schedulerConfig?.scan_days === "number" && schedulerConfig.scan_days >= 1
        ? schedulerConfig.scan_days
        : 10;

    const { count: totalCount, error: countErr } = await supabase
      .from("fixtures")
      .select("*", { count: "exact", head: true });

    if (countErr) {
      logger.error({ error: countErr }, "Failed to count fixtures");
    }

    const { data: leagueRows, error: leagueErr } = await supabase
      .from("fixtures")
      .select("league_name");

    if (leagueErr) {
      logger.error({ error: leagueErr }, "Failed to fetch league breakdown");
    }

    const leagueMap = new Map<string, number>();
    for (const row of leagueRows ?? []) {
      leagueMap.set(row.league_name, (leagueMap.get(row.league_name) ?? 0) + 1);
    }

    /* ─── Transparansi sync ────────────────────────────────────────────────
     * Sebelumnya endpoint ini hanya mengambil `finished_at` dan `status`,
     * sehingga seluruh isi `sync_runs` (berapa event ditarik, berapa
     * tersimpan, berapa error, kena rate limit berapa detik) terbuang.
     * Akibatnya dashboard hanya bisa menampilkan "Last Sync" dan "Idle" —
     * tidak ada cara mengetahui proses sync benar-benar terjadi.
     *
     * Sekarang seluruh kolom diambil, ditambah riwayat beberapa run terakhir
     * agar tren (mis. run yang selalu error) bisa dilihat.
     */
    let lastSyncAt: string | null = null;
    let lastSyncStatus: string | null = null;
    let lastSyncRun: SyncRunSummary | null = null;
    let recentSyncRuns: SyncRunSummary[] = [];

    try {
      const { data: runs } = await supabase
        .from("sync_runs")
        .select(SYNC_RUN_COLUMNS)
        .order("created_at", { ascending: false })
        .limit(SYNC_HISTORY_LIMIT);

      if (Array.isArray(runs) && runs.length > 0) {
        recentSyncRuns = runs.map(toSyncRunSummary);
        lastSyncRun = recentSyncRuns[0] ?? null;
        lastSyncAt = lastSyncRun.finishedAt ?? lastSyncRun.startedAt;
        lastSyncStatus = lastSyncRun.status;
      }
    } catch (err) {
      /* Tabel sync_runs mungkin belum ada; jatuh ke fixtures.updated_at. */
      logger.debug({ err }, "sync_runs tidak tersedia, memakai fixtures.updated_at");
      const { data: fallback } = await supabase
        .from("fixtures")
        .select("updated_at")
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      lastSyncAt = fallback?.updated_at ?? null;
    }

    /* Run yang masih berjalan diambil terpisah: kalau sebuah run berstatus
     * `running`, created_at run itu adalah yang terbaru sehingga sudah
     * tertangkap di atas. Tetapi bila proses mati di tengah jalan (mis.
     * fungsi Vercel kehabisan waktu 60 detik), statusnya tetap `running`
     * selamanya. Karena itu umur run dihitung agar bisa ditandai basi. */
    const runningRun = recentSyncRuns.find((r) => r.status === "running") ?? null;
    const runningAgeSeconds = runningRun
      ? Math.max(0, Math.round((Date.now() - new Date(runningRun.startedAt).getTime()) / 1000))
      : null;

    res.json({
      totalEvents: totalCount ?? 0,
      configuredLeagueCount: configuredLeagues.length,
      configuredLeagues,
      lastSyncAt,
      lastSyncStatus,
      isRunning: isSyncRunning(),
      leagueBreakdown: Array.from(leagueMap.entries()).map(([leagueSlug, eventCount]) => ({
        leagueSlug,
        eventCount,
      })),

      /* ─── Detail transparansi (baru) ─── */
      lastSyncRun,
      recentSyncRuns,
      scanDays,
      runningAgeSeconds,
      /* `true` bila ada run berstatus `running` yang umurnya melewati ambang —
       * tanda prosesnya mati, bukan sedang berjalan. */
      staleRunning: runningAgeSeconds != null && runningAgeSeconds > STALE_RUN_SECONDS,
      staleThresholdSeconds: STALE_RUN_SECONDS,
      historyLimit: SYNC_HISTORY_LIMIT,
    });
  } catch (err) {
    logger.error({ err }, "Failed to get sync status");
    res.status(500).json({ error: "Failed to get sync status" });
  }
});

export default router;
