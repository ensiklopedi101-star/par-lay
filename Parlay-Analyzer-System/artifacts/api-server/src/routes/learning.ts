import { Router, type IRouter } from "express";
import { logger } from "../lib/logger";
import { getLearningSummary } from "../services/learning-summary";

const router: IRouter = Router();

router.get("/learning/summary", async (_req, res) => {
  try {
    res.json(await getLearningSummary());
  } catch (error) {
    logger.error({ error }, "[LEARNING] Failed to build transparent learning summary");
    res.status(500).json({ error: "Failed to load AI learning summary" });
  }
});

export default router;