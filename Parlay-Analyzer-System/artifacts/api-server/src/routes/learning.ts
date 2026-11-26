import { Router, type IRouter } from "express";
import { logger } from "../lib/logger";
import { getLearningSummary } from "../services/learning-summary";
import { getLedgerReport } from "../services/ledger-report";
import { getModelBacktest } from "../services/model-backtest";
import { getWarehouseBacktest } from "../services/warehouse-backtest";
import { requireAdmin } from "../middlewares/admin";
import {
  backfillSettledPredictionEvaluations,
  backtestLearningPromptProposal,
  classifyPendingLearningEvaluations,
  generateLearningPromptProposal,
  getLearningLoopState,
  promoteLearningPromptProposal,
  rejectLearningPromptProposal,
  rollbackLearningPromptVersion,
  runAutonomousLearningCycle,
} from "../services/prompt-learning";

const router: IRouter = Router();

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown learning workflow error";
}

router.get("/learning/summary", async (_req, res) => {
  try {
    res.json(await getLearningSummary());
  } catch (error) {
    logger.error({ error }, "[LEARNING] Failed to build transparent learning summary");
    res.status(500).json({ error: "Failed to load AI learning summary" });
  }
});

/**
 * Laporan bukti Fase 3 (P3): Brier/BSS/ECE, CLV, fitBlendWeight, dan status
 * gerbang ≥300 seleksi ber-hasil — dihitung dari `prediction_selections`,
 * dipisah per model_version (v1 LLM vs v2 quant) dan per family market.
 * Read-only dan tanpa efek samping, jadi aman dibuka publik seperti summary.
 */
router.get("/learning/ledger", async (_req, res) => {
  try {
    res.json(await getLedgerReport());
  } catch (error) {
    logger.error({ error }, "[LEARNING] Failed to build ledger report");
    res.status(500).json({ error: "Failed to load ledger report" });
  }
});

/**
 * Backtest model Poisson vs pasar (prior musim lalu → hasil musim ini).
 * Read-only dan ter-cache 10 menit di server; panel Transparansi yang
 * membacanya, bukan jalur analisis.
 */
router.get("/learning/model-backtest", async (_req, res) => {
  try {
    res.json(await getModelBacktest());
  } catch (error) {
    logger.error({ error }, "[MODEL-BACKTEST] Failed to build report");
    res.status(500).json({ error: "Failed to load model backtest" });
  }
});

/**
 * Backtest gudang riset: model vs pasar di ±16 ribu pertandingan
 * historis + uji fitur Elo (latih/validasi). Read-only, cache 30 menit.
 */
router.get("/learning/warehouse-backtest", async (_req, res) => {
  try {
    res.json(await getWarehouseBacktest());
  } catch (error) {
    logger.error({ error }, "[WAREHOUSE-BACKTEST] Failed to build report");
    res.status(500).json({ error: "Failed to load warehouse backtest" });
  }
});

router.get("/learning/optimizer", requireAdmin, async (_req, res) => {
  try {
    res.json(await getLearningLoopState());
  } catch (error) {
    logger.error({ error }, "[LEARNING] Failed to load controlled learning state");
    const message = errorMessage(error);
    res.status(message.includes("schema is unavailable") ? 503 : 500).json({ error: message });
  }
});

/**
 * Picu siklus pembelajaran otonom penuh secara manual (admin):
 * backfill → repair verifikasi settlement → klasifikasi → proposal →
 * backtest → promosi bergerbang. Idempoten per hari (kunci
 * daily:Asia/Makassar berbagi dengan cron action=learning), jadi aman
 * ditekan kapan pun — bila hari ini sudah berjalan, responsnya
 * status:"skipped" dengan alasannya.
 *
 * Mengapa endpoint ini ada (26 Nov 2026): satu-satunya pemicu siklus
 * sebelumnya adalah cron-job.org dengan CRON_SECRET, dan repair
 * verifikasi hanya hidup di dalam siklus — ketika cron-job.org tidak
 * bisa dipakai, tidak ada jalur manual sama sekali untuk menjalankan
 * repair. Tombol panel memanggil endpoint ini dengan password admin
 * pemilik sendiri; tidak ada kredensial yang perlu dibagikan ke siapa pun.
 */
router.post("/learning/autonomous-cycle", requireAdmin, async (_req, res) => {
  try {
    res.json(await runAutonomousLearningCycle());
  } catch (error) {
    logger.error({ error }, "[LEARNING] Failed to run autonomous learning cycle manually");
    res.status(500).json({ error: errorMessage(error) });
  }
});

router.post("/learning/evaluations/backfill", requireAdmin, async (_req, res) => {
  try {
    res.json(await backfillSettledPredictionEvaluations());
  } catch (error) {
    logger.error({ error }, "[LEARNING] Failed to backfill settled prediction evaluations");
    res.status(500).json({ error: errorMessage(error) });
  }
});

router.post("/learning/evaluations/classify", requireAdmin, async (req, res) => {
  try {
    const limit = Number(req.body?.limit ?? 10);
    if (!Number.isInteger(limit) || limit < 1 || limit > 10) {
      res.status(400).json({ error: "limit must be an integer from 1 to 10" });
      return;
    }
    res.json(await classifyPendingLearningEvaluations(limit));
  } catch (error) {
    logger.error({ error }, "[LEARNING] Failed to classify pending evaluations");
    res.status(500).json({ error: errorMessage(error) });
  }
});

router.post("/learning/proposals", requireAdmin, async (_req, res) => {
  try {
    res.status(201).json(await generateLearningPromptProposal());
  } catch (error) {
    logger.error({ error }, "[LEARNING] Failed to generate a learning proposal");
    res.status(422).json({ error: errorMessage(error) });
  }
});

router.post("/learning/proposals/:id/backtest", requireAdmin, async (req, res) => {
  const proposalId = String(req.params.id ?? "");
  try {
    res.json(await backtestLearningPromptProposal(proposalId));
  } catch (error) {
    logger.error({ error, proposalId }, "[LEARNING] Failed to backtest proposal");
    res.status(422).json({ error: errorMessage(error) });
  }
});

router.post("/learning/proposals/:id/promote", requireAdmin, async (req, res) => {
  const proposalId = String(req.params.id ?? "");
  try {
    res.json(await promoteLearningPromptProposal(proposalId));
  } catch (error) {
    logger.error({ error, proposalId }, "[LEARNING] Failed to promote proposal");
    res.status(422).json({ error: errorMessage(error) });
  }
});

router.post("/learning/proposals/:id/reject", requireAdmin, async (req, res) => {
  const proposalId = String(req.params.id ?? "");
  try {
    await rejectLearningPromptProposal(proposalId);
    res.json({ ok: true });
  } catch (error) {
    logger.error({ error, proposalId }, "[LEARNING] Failed to reject proposal");
    res.status(422).json({ error: errorMessage(error) });
  }
});

router.post("/learning/versions/:id/rollback", requireAdmin, async (req, res) => {
  const versionId = String(req.params.id ?? "");
  try {
    res.json(await rollbackLearningPromptVersion(versionId));
  } catch (error) {
    logger.error({ error, versionId }, "[LEARNING] Failed to roll back prompt version");
    res.status(422).json({ error: errorMessage(error) });
  }
});

export default router;