import { Router, type IRouter } from "express";
import healthRouter from "./health";
import oddsRouter from "./odds";
import configRouter from "./config";
import csvRouter from "./csv";
import seasonCsvRouter from "./season-csv";
import supabaseRouter from "./supabase";
import analyzeRouter from "./analyze";
import statsIngestRouter from "./stats-ingest";
import cronRouter from "./cron";
import statsHealthRouter from "./stats-health";

const router: IRouter = Router();

router.use(healthRouter);
router.use(oddsRouter);
router.use(configRouter);
router.use(csvRouter);
router.use(seasonCsvRouter);
router.use(supabaseRouter);
router.use(analyzeRouter);
router.use(statsIngestRouter);
router.use(cronRouter);
router.use(statsHealthRouter);

export default router;
