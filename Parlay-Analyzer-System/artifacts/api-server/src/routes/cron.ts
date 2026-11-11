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
          { upcomingWindowDays: scanDays },
        );
      })()
        .then((result) => {
          res.json({
            message: `Sync liga ${requestedLeague} selesai`,
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
    res.json({
      message: "Cron sync started in background",
      leagues,
      hint: "Untuk Vercel, panggil ?action=sync&league=<slug> satu per satu agar tidak kena timeout 60 detik.",
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
     * Vercel Hobby hanya mengizinkan dua cron per proyek, masing-masing paling
     * sering sekali sehari. Rantai yang dibutuhkan sistem ini ada empat (sync,
     * results, closing, outcomes), jadi keempatnya dijalankan berurutan dalam
     * satu panggilan.
     *
     * Dijalankan menunggu (bukan background) agar hasilnya terlihat di respons
     * cron dan di log — kegagalan senyap persis masalah yang sedang diperbaiki
     * di sini. Setiap langkah dibungkus `try` sendiri: satu langkah gagal tidak
     * boleh menggugurkan langkah berikutnya.
     */
    const runDaily = async () => {
      const startedAt = Date.now();
      const step = async <T>(name: string, fn: () => Promise<T>) => {
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

      const steps = [];
      /* 1. Sync odds — satu liga per panggilan agar muat dalam batas waktu. */
      const scanDays = await getConfiguredScanDays().catch(() => 10);
      const bookmakers = await getConfiguredBookmakers();
      const leagueIdMap = await (async () => {
        const { data } = await supabase.from("leagues").select("id, name, slug").eq("is_active", true);
        return new Map((data ?? []).map((l: any) => [l.slug ?? l.name, l.id as number]));
      })().catch(() => new Map<string, number>());

      for (const league of DEFAULT_LEAGUES) {
        steps.push(
          await step(`sync:${league.slug}`, () =>
            fetchAndSaveLeagueOdds(
              league,
              String(process.env["ODDS_API_KEY"]),
              bookmakers,
              leagueIdMap as Map<string, number>,
              { upcomingWindowDays: scanDays },
            ),
          ),
        );
      }

      /* 2. Skor akhir — bahan mentah settlement. */
      steps.push(await step("results", () => refreshElapsedFixtureResults({})));

      /* 3. Analisis AI — sumber utama isi sistem.
       * Dijalankan SETELAH hasil dan skor ditarik, tetapi SEBELUM closing,
       * karena analisis adalah bagian yang paling mungkin menghabiskan
       * anggaran waktu. Kalau anggaran habis, yang tertunda adalah langkah
       * murah (closing/outcomes), bukan yang mahal. */
      steps.push(await step("analyze", () => runAutoAnalysis({ limit: 3, budgetMs: 20_000 })));

      /* 4. Odds penutup — dasar hitung CLV. */
      steps.push(await step("closing", () => runClosingOddsCapture()));

      /* 5. Outcome ledger quant. */
      steps.push(await step("outcomes", () => runOutcomeSettlement()));

      return {
        message: "Rangkaian tugas harian selesai",
        totalMs: Date.now() - startedAt,
        failedSteps: steps.filter((s) => !s.ok).map((s) => s.step),
        steps,
      };
    };

    runDaily()
      .then((summary) => res.json(summary))
      .catch((err) => {
        logger.error({ err }, "Cron harian gagal total");
        res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
      });
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
