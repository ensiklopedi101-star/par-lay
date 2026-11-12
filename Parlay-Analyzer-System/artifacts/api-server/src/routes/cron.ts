import { Router, type IRouter } from "express";
import { fetchAndSaveAllLeagues, fetchAndSaveLeagueOdds, DEFAULT_LEAGUES, getConfiguredScanDays, getConfiguredBookmakers } from "../services/odds-fetcher";
import { logger } from "../lib/logger";
import { runRevalidation } from "../services/revalidation";
import { runBaselineBackfill } from "../services/baseline-backfill";
import { runRevalidationAndTriggeredReanalysis } from "../services/reanalysis";
import { runClosingOddsCapture, runOutcomeSettlement } from "../services/closing-odds-capture";
import { refreshElapsedFixtureResults } from "../services/fixture-results";
import { runAutoAnalysis } from "../services/auto-analysis";
import { supabase } from "../lib/supabase-client";
import { isCronAuthorized } from "../lib/cron-auth";
import { parseMaxEvents } from "../lib/cron-params";
import { closeStaleSyncRuns } from "../services/sync-runs";
import { leaguesForDailySync, remainingMs, stepBudgetMs } from "../services/daily-plan";

const router: IRouter = Router();

const CRON_SECRET = process.env["CRON_SECRET"];

/** Batas waktu nyata fungsi Vercel: `vercel.json` → `maxDuration: 60`. */
const VERCEL_FUNCTION_LIMIT_MS = 60_000;
/**
 * Anggaran daily sengaja di bawah batas fungsi. Sisa ±15 detik dipakai untuk
 * cold start, latensi jaringan, dan penulisan respons.
 */
const DAILY_TIME_BUDGET_MS = 45_000;
/** Anggaran maksimal untuk satu liga pada sync harian. */
const DAILY_SYNC_MAX_MS = 12_000;
/** Anggaran maksimal analisis AI. */
const DAILY_ANALYZE_MAX_MS = 18_000;
/** Analisis tidak dijalankan bila anggarannya di bawah ini. */
const DAILY_ANALYZE_MIN_MS = 3_000;
/** Waktu yang disisakan untuk closing/outcomes setelah analisis. */
const DAILY_RESERVE_AFTER_ANALYZE_MS = 6_000;
/** Jumlah event per liga pada sync harian (hemat kuota). */
const DAILY_SYNC_MAX_EVENTS = 10;

function isAuthorized(req: any): boolean {
  return isCronAuthorized({
    secret: CRON_SECRET,
    headerSecret: req.headers["x-cron-secret"] ?? req.headers["X-Cron-Secret"],
    authorization: req.headers["authorization"],
    queryToken: req.query["token"],
  });
}

/**
 * Cron-safe endpoint for external cron services (e.g. cron-job.org).
 *
 * GET /api/cron?token=<CRON_SECRET>&action=closing  -> isi odds_close untuk
 *   fixture yang kick-off dalam 10 menit. Biaya kuota nol (membaca snapshot
 *   yang sudah tersimpan). Aman dipanggil sesering apa pun.
 * GET /api/cron?token=<CRON_SECRET>&action=outcomes -> isi outcome pada
 *   prediction_selections dari skor akhir. Tanpa ini, ledger tidak akan
 *   pernah punya hasil dan Fase 3 mustahil dievaluasi.
 *
 * GET /api/cron?token=<CRON_SECRET>&action=results -> tarik skor akhir fixture yang
 *   sudah lewat (tanpa AI, tanpa evaluasi prediksi). Ini yang membuat rantai
 *   settlement punya bahan; sebelumnya hanya dijadwalkan `node-cron` yang
 *   tidak hidup di Vercel.
 * GET /api/cron?token=<CRON_SECRET>&action=analyze -> analisis AI untuk fixture
 *   akan datang yang belum dianalisis, dengan anggaran waktu. Aman dipanggil
 *   berulang: yang sudah dianalisis tidak diulang.
 * GET /api/cron?token=<CRON_SECRET>&action=daily  -> SEMUA tugas harian dalam
 *   satu panggilan: sync tiap liga, results, closing, outcomes. Wajib di
 *   Vercel Hobby karena hanya tersedia dua slot cron.
 * GET /api/cron?token=<CRON_SECRET>&action=keep-alive  -> lightweight ping, no odds API calls
 * GET /api/cron?token=<CRON_SECRET>&action=sync        -> trigger full odds sync
 * GET /api/cron?token=<CRON_SECRET>&action=revalidate  -> refresh active pre-kickoff prediction tags
 * GET /api/cron?token=<CRON_SECRET>&action=reanalyze  -> backfill + revalidate + trigger bounded AI revisions
 *
 * Keep-alive is recommended for 30-minute pings to keep a Replit workspace alive
 * without burning the Odds-API free-plan quota.
 */
async function handleCron(req: any, res: any) {
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
    /*
     * Satu liga per panggilan bila `league` diberikan.
     *
     * Siklus penuh menyapu tujuh liga dengan jeda 300 ms per event dan
     * backoff rate-limit sampai 300 detik — jauh melewati batas 60 detik
     * fungsi Vercel Hobby, sehingga kena 504 sebelum selesai. Memecahnya per
     * liga membuat tiap panggilan pendek dan muat dalam batas, dengan hasil
     * yang sama bila pemicunya menggilir semua liga.
     */
    const requestedLeague = typeof req.query["league"] === "string" ? req.query["league"] : null;
    /* `?max=` membatasi jumlah event per liga agar matriks GitHub Actions
     * (7 liga paralel) tidak menghabiskan kuota 100 permintaan/jam. */
    const maxEvents = parseMaxEvents(req.query["max"]);

    if (requestedLeague) {
      const league = DEFAULT_LEAGUES.find((l) => l.slug === requestedLeague);
      if (!league) {
        res.status(404).json({
          error: `Liga tidak dikenal: ${requestedLeague}`,
          known_leagues: DEFAULT_LEAGUES.map((l) => l.slug),
        });
        return;
      }

      (async () => {
        const scanDays = await getConfiguredScanDays();
        const bookmakers = await getConfiguredBookmakers();
        const { data } = await supabase
          .from("leagues")
          .select("id, name, slug")
          .eq("is_active", true);
        const leagueIdMap = new Map(
          (data ?? []).map((l: { slug?: string; name?: string; id: number }) => [
            l.slug ?? l.name,
            l.id,
          ]),
        );
        return fetchAndSaveLeagueOdds(
          league,
          String(process.env["ODDS_API_KEY"]),
          bookmakers,
          leagueIdMap as Map<string, number>,
          { upcomingWindowDays: scanDays, ...(maxEvents == null ? {} : { maxEvents }) },
        );
      })()
        .then((result) => {
          res.json({
            message: `Sync liga ${requestedLeague} selesai`,
            maxEvents: maxEvents ?? null,
            result,
            timestamp: new Date().toISOString(),
          });
        })
        .catch((err) => {
          logger.error({ err, league: requestedLeague }, "Cron-triggered league sync failed");
          res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
        });
      return;
    }

    const leagues = DEFAULT_LEAGUES.map((l) => l.slug);

    /*
     * DITUNGGU, bukan "fire-and-forget".
     *
     * Versi sebelumnya menjawab `{message: "started in background"}` lebih dulu
     * lalu melanjutkan sync. Di serverless, setelah respons dikirim instance
     * boleh dibekukan; akibatnya `sync_runs` tertinggal `running` (bukti: run
     * 568) dan pekerjaannya tidak pernah selesai. `fetchAndSaveAllLeagues`
     * sudah punya anggaran 45 detik dan menutup run di `finally`, jadi
     * menunggunya aman di bawah `maxDuration: 60`.
     */
    try {
      const outcome = await fetchAndSaveAllLeagues();
      res.json({
        message:
          outcome.status === "skipped"
            ? `Sync dilewati (${outcome.reason ?? "tanpa alasan"})`
            : "Sync selesai",
        leagues,
        outcome,
        hint: "Untuk pemanggil berbatas waktu ketat, pakai ?action=sync&league=<slug>&max=<n> satu per satu.",
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      logger.error({ err }, "Cron-triggered odds sync failed");
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
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

  if (action === "closing") {
    /* Dijalankan menunggu (bukan background) karena selesai dalam hitungan
       detik: tidak ada panggilan jaringan ke penyedia odds. Menunggu membuat
       kegagalan terlihat di respons, bukan hilang di log. */
    runClosingOddsCapture()
      .then((summary) => {
        res.json({
          message: "Closing odds capture selesai",
          ...summary,
          timestamp: new Date().toISOString(),
        });
      })
      .catch((err) => {
        logger.error({ err }, "Cron-triggered closing odds capture gagal");
        res.status(500).json({
          error: err instanceof Error ? err.message : String(err),
        });
      });
    return;
  }

  if (action === "outcomes") {
    runOutcomeSettlement()
      .then((result) => {
        res.json({ message: "Settlement outcome selesai", ...result, timestamp: new Date().toISOString() });
      })
      .catch((err) => {
        logger.error({ err }, "Cron-triggered outcome settlement gagal");
        res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
      });
    return;
  }

  if (action === "analyze") {
    /* Analisis AI dengan anggaran waktu.
     *
     * Ini yang selama ini tidak ada: prediksi hanya lahir kalau ada yang
     * menekan tombol. Batch scanner di `/api/analyze/batch` tidak bisa dipakai
     * cron karena ia menyelesaikan hingga 20 fixture tanpa satu pun
     * pemeriksaan waktu — di Vercel fungsi diputus pada 60 detik dan sisanya
     * hilang tanpa jejak.
     *
     * Bukti dari DB: maksimum 6 prediksi per hari, semuanya dalam rentang
     * 4 menit, lalu berhenti. Itu pola eksekusi terpotong.
     */
    const limit = Number(req.query["limit"]) || 3;
    runAutoAnalysis({ limit })
      .then((summary) => {
        res.json({ message: "Analisis otomatis selesai", ...summary });
      })
      .catch((err) => {
        logger.error({ err }, "Cron-triggered auto analysis gagal");
        res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
      });
    return;
  }

  if (action === "results") {
    /* Penarikan skor sengaja TIDAK memakai AI dan tidak mengevaluasi prediksi:
     * hanya mengisi `status_short` + `home_goals` + `away_goals`. Memisahkannya
     * dari `runSettlement()` membuat tugas ini cukup cepat untuk batas 60 detik
     * Vercel, dan kegagalan Gemini tidak pernah menghalangi skor masuk. */
    const limit = Number(req.query["limit"]) || undefined;
    refreshElapsedFixtureResults({ limit })
      .then((summary) => {
        res.json({ message: "Penarikan hasil fixture selesai", ...summary });
      })
      .catch((err) => {
        logger.error({ err }, "Cron-triggered fixture results refresh gagal");
        res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
      });
    return;
  }

  if (action === "daily") {
    /*
     * Satu slot cron untuk seluruh tugas harian.
     *
     * Vercel Hobby hanya mengizinkan cron sekali sehari, jadi beberapa tugas
     * harus berbagi satu panggilan. Yang sering dilupakan: fungsi ini dibatasi
     * **60 detik** (`vercel.json` → `maxDuration`). Versi lama menjalankan sync
     * tujuh liga lebih dulu; tujuh liga tidak mungkin selesai dalam 60 detik,
     * sehingga fungsi dipotong sebelum `analyze` — dan `prediction_selections`
     * tetap nol selamanya.
     *
     * Urutan sekarang berdasarkan nilai per detik:
     *   1. `reap`     — tutup run zombie (murah, mencegah status bohong)
     *   2. `sync`     — SATU liga bergiliran, maksimal 10 event, ≤12 detik
     *   3. `analyze`  — inti sistem, anggaran dijamin lebih dulu
     *   4. `results`  — skor akhir untuk settlement
     *   5. `closing` + `outcomes` — hanya DB, murah
     *
     * Setiap langkah mencatat `skipped` bila anggaran habis, sehingga respons
     * cron membedakan "gagal" dari "tidak dijalankan karena waktu".
     */
    const runDaily = async () => {
      const startedAt = Date.now();
      const deadlineAt = startedAt + DAILY_TIME_BUDGET_MS;

      interface StepResult {
        step: string;
        ok: boolean;
        skipped?: boolean;
        ms: number;
        result?: unknown;
        error?: string;
      }

      const step = async <T>(name: string, fn: () => Promise<T>): Promise<StepResult> => {
        const t0 = Date.now();
        try {
          const result = await fn();
          return { step: name, ok: true, ms: Date.now() - t0, result };
        } catch (err) {
          logger.error({ err, step: name }, "[CRON-DAILY] Langkah gagal");
          return {
            step: name,
            ok: false,
            ms: Date.now() - t0,
            error: err instanceof Error ? err.message : String(err),
          };
        }
      };

      const skippedStep = (name: string, reason: string): StepResult => ({
        step: name,
        ok: false,
        skipped: true,
        ms: 0,
        error: `Dilewati: ${reason}`,
      });

      const steps: StepResult[] = [];

      /* 0. Tutup run yang menggantung. Murah, dan mencegah panel menampilkan
       * "Berjalan" untuk proses yang sudah mati. */
      steps.push(await step("reap", () => closeStaleSyncRuns()));

      /* 1. Sync satu liga, bergiliran tiap hari, dibatasi ketat.
       *
       * Sync penuh tujuh liga TIDAK muat dalam 60 detik. Versi lama menaruhnya
       * paling depan, sehingga fungsi dipotong sebelum langkah lain berjalan.
       * Satu liga x 10 event cukup sebagai jaring pengaman bila pemicu GitHub
       * Actions tidak aktif, tanpa menghabiskan kuota 100 permintaan/jam. */
      const syncLeague = leaguesForDailySync(DEFAULT_LEAGUES, new Date(), 1)[0];
      const syncDeadline = Math.min(
        startedAt + DAILY_SYNC_MAX_MS,
        deadlineAt - DAILY_ANALYZE_MIN_MS - DAILY_RESERVE_AFTER_ANALYZE_MS,
      );

      if (!process.env["ODDS_API_KEY"]) {
        steps.push(skippedStep("sync", "ODDS_API_KEY tidak diset"));
      } else if (!syncLeague) {
        steps.push(skippedStep("sync", "tidak ada liga untuk disinkronkan"));
      } else if (syncDeadline - Date.now() < 1_500) {
        steps.push(skippedStep("sync", "sisa waktu tidak cukup"));
      } else {
        const scanDays = await getConfiguredScanDays().catch(() => 10);
        const bookmakers = await getConfiguredBookmakers();
        const leagueIdMap = await (async () => {
          const { data } = await supabase
            .from("leagues")
            .select("id, name, slug")
            .eq("is_active", true);
          return new Map((data ?? []).map((l: any) => [l.slug ?? l.name, l.id as number]));
        })().catch(() => new Map<string, number>());

        steps.push(
          await step(`sync:${syncLeague.slug}`, () =>
            fetchAndSaveLeagueOdds(
              syncLeague,
              String(process.env["ODDS_API_KEY"]),
              bookmakers,
              leagueIdMap as Map<string, number>,
              {
                upcomingWindowDays: scanDays,
                maxEvents: DAILY_SYNC_MAX_EVENTS,
                deadlineAt: syncDeadline,
              },
            ),
          ),
        );
      }

      /* 2. Analisis AI — inti sistem dan satu-satunya pengisi
       * `prediction_selections`. Dijalankan sebelum skor/closing supaya tetap
       * kebagian waktu; langkah murah menyusul. */
      const analyzeBudget = stepBudgetMs(
        deadlineAt,
        DAILY_ANALYZE_MAX_MS,
        DAILY_RESERVE_AFTER_ANALYZE_MS,
      );
      if (analyzeBudget >= DAILY_ANALYZE_MIN_MS) {
        steps.push(
          await step("analyze", () => runAutoAnalysis({ limit: 3, budgetMs: analyzeBudget })),
        );
      } else {
        steps.push(skippedStep("analyze", "sisa anggaran waktu < 3 detik"));
      }

      /* 3. Skor akhir — bahan mentah settlement. Dilewati bila waktu habis. */
      if (remainingMs(deadlineAt) > 10_000) {
        steps.push(await step("results", () => refreshElapsedFixtureResults({})));
      } else {
        steps.push(skippedStep("results", "sisa anggaran waktu < 10 detik"));
      }

      /* 4. Odds penutup & outcome ledger: hanya baca/tulis DB, murah. */
      steps.push(await step("closing", () => runClosingOddsCapture()));
      steps.push(await step("outcomes", () => runOutcomeSettlement()));

      return {
        message: "Rangkaian tugas harian selesai",
        totalMs: Date.now() - startedAt,
        budgetMs: DAILY_TIME_BUDGET_MS,
        functionLimitMs: VERCEL_FUNCTION_LIMIT_MS,
        failedSteps: steps.filter((s) => !s.ok && !s.skipped).map((s) => s.step),
        skippedSteps: steps.filter((s) => s.skipped).map((s) => s.step),
        steps,
      };
    };

    try {
      const summary = await runDaily();
      res.json(summary);
    } catch (err) {
      logger.error({ err }, "Cron harian gagal total");
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
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

  /*
   * Keep-alive juga menjadi "penyapu" run yang menggantung.
   *
   * Ping ringan ini ideal untuk tugas pemeliharaan: tidak memanggil Odds-API,
   * tidak membakar kuota, dan biasanya dijadwalkan tiap 30 menit — cukup rapat
   * dibanding ambang basi 10 menit. Dengan begitu panel tidak pernah lebih dari
   * ~30 menit menampilkan "Berjalan" untuk proses yang sudah mati.
   */
  const reaped = await closeStaleSyncRuns();

  res.json({
    ok: true,
    action: "keep-alive",
    staleRunsClosed: reaped.closed,
    staleRunIds: reaped.ids,
    timestamp: new Date().toISOString(),
  });
}

// The router is mounted at `/api`, so this route is exposed as `/api/cron`.
router.get("/cron", handleCron);

export default router;
