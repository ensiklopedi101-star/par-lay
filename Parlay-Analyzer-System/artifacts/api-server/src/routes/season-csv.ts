import { Router, type IRouter } from "express";
import multer from "multer";
import { logger } from "../lib/logger";
import { parseSeasonCsv, upsertSeasonStats } from "../services/csv-season-processor";

const router: IRouter = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

const CSV_UPLOAD_PASSWORD = process.env["CSV_UPLOAD_PASSWORD"] ?? "parlay2024";

router.post("/upload-csv", upload.single("file"), async (req, res) => {
  const { password, league_slug, season } = req.body as Record<string, string>;

  if (!password || password !== CSV_UPLOAD_PASSWORD) {
    res.status(401).json({ error: "Unauthorized — wrong password" });
    return;
  }
  if (!league_slug || !season) {
    res.status(400).json({ error: "league_slug and season are required" });
    return;
  }
  if (!req.file) {
    res.status(400).json({ error: "No file uploaded" });
    return;
  }

  try {
    logger.info(
      { fileName: req.file.originalname, league_slug, season },
      "Processing season CSV upload",
    );

    const { rows, stats, skipReasons } = await parseSeasonCsv(
      req.file.buffer,
      league_slug,
      season,
    );

    if (rows.length === 0) {
      res.status(400).json({
        error: "No valid rows found in CSV",
        stats,
        skipReasons,
      });
      return;
    }

    const { inserted, errors, merged } = await upsertSeasonStats(rows);

    logger.info(
      { inserted, errors, merged, skipped: stats.skipped, total: stats.total, league_slug, season },
      "Season CSV upload complete",
    );

    res.json({
      inserted,
      errors,
      merged,
      skipped: stats.skipped,
      total: stats.total,
      teams: rows.map((r) => r.team_name),
      skipReasons: skipReasons.slice(0, 20), // limit payload size
    });
  } catch (err) {
    logger.error({ err }, "Season CSV upload failed");
    res.status(500).json({ error: "Failed to process CSV" });
  }
});

export default router;
