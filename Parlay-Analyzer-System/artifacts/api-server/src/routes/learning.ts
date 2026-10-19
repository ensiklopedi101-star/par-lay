import { Router, type IRouter } from "express";
import { logger } from "../lib/logger";
import { getLearningSummary } from "../services/learning-summary";
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

router.get("/learning/optimizer", requireAdmin, async (_req, res) => {
  try {
    res.json(await getLearningLoopState());
  } catch (error) {
    logger.error({ error }, "[LEARNING] Failed to load controlled learning state");
    const message = errorMessage(error);
    res.status(message.includes("schema is unavailable") ? 503 : 500).json({ error: message });
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