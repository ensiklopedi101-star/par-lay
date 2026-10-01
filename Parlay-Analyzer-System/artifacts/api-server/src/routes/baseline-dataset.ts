import { Router, type IRouter } from "express";
import { logger } from "../lib/logger";
import { requireAdmin } from "../middlewares/admin";
import { loadBaselineDataset } from "../services/baseline-dataset-loader";

const router: IRouter = Router();

router.get("/baseline/dataset", requireAdmin, async (_req, res) => {
  try {
    const dataset = await loadBaselineDataset();
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Disposition", 'attachment; filename="m1-baseline-dataset-v1.json"');
    res.json(dataset);
  } catch (err) {
    logger.error({ err }, "Failed to export the M1 baseline dataset");
    res.status(500).json({ error: "Failed to generate the baseline dataset." });
  }
});

export default router;