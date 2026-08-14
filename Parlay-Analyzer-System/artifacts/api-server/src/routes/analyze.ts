import { Router, type IRouter } from "express";
import {
  analyzeFixture,
  assessOddsAvailability,
  extractPredictionRecommendation,
  loadAIConfig,
  OddsUnavailableError,
  PredictionAlreadyExistsError,
  StatsEmptyError,
} from "../services/ai-analysis";
import { logger } from "../lib/logger";
import { supabase } from "../lib/supabase-client";
import { calculateKelly } from "../lib/kelly-criterion";
import { requireAdmin } from "../middlewares/admin";
import { createParlayFromCandidates, type ParlayCandidate } from "../services/parlay-builder";
import { latestOddsByMarket } from "../services/odds-history";
import { randomUUID } from "node:crypto";

const router: IRouter = Router();

type BatchTicket = {
  fixture_id: string;
  prediction_id?: string | number;
  home_team: string;
  away_team: string;
  league: string;
  confidence: number;
  selection: string;
  market: string;
  odds: number;
  ev_percent: number;
  odds_status?: "valid" | "stale";
  kelly_stake: string;
  kelly_edge: number;
  prediction_text: string;
  status: "scanned" | "waiting_odds" | "skipped" | "error";
  is_parlay_leg: boolean;
};

type BatchJob = {
  id: string;
  status: "running" | "completed" | "failed";
  scanDays: number;
  total: number;
  completed: number;
  currentMatch: string | null;
  tickets: BatchTicket[];
  parlayId: string | null;
  waitingOdds: number;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
};

const batchJobs = new Map<string, BatchJob>();
const MAX_BATCH_JOBS = 20;

function trimBatchJobs() {
  while (batchJobs.size > MAX_BATCH_JOBS) {
    const oldest = batchJobs.keys().next().value;
    if (!oldest) break;
    batchJobs.delete(oldest);
  }
}

function publicBatchJob(job: BatchJob) {
  return {
    jobId: job.id,
    status: job.status,
    scanDays: job.scanDays,
    total: job.total,
    completed: job.completed,
    currentMatch: job.currentMatch,
    scanned: job.tickets.length,
    parlayLegs: job.tickets.filter((ticket) => ticket.is_parlay_leg).length,
    waitingOdds: job.tickets.filter((ticket) => ticket.status === "waiting_odds").length,
    noBet: job.tickets.filter((ticket) => ticket.status === "scanned" && ticket.selection === "NO_BET").length,
    tickets: job.status === "running" ? job.tickets : job.tickets,
    parlayId: job.parlayId,
    error: job.error,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
  };
}

async function runBatchJob(job: BatchJob, fixtures: Array<{
  fixture_id: number;
  home_team_name: string;
  away_team_name: string;
  league_name: string | null;
  fixture_date: string;
}>) {
  const parlayCandidates: ParlayCandidate[] = [];
  const existing = await supabase
    .from("ai_predictions")
    .select("fixture_id")
    .in("fixture_id", fixtures.map((fixture) => fixture.fixture_id));
  const existingSet = new Set((existing.data ?? []).map((row) => String(row.fixture_id)));
  const pendingFixtures = fixtures.filter((fixture) => !existingSet.has(String(fixture.fixture_id)));
  const oddsResult = await supabase
    .from("odds_history")
    .select("match_id, bookmaker, market_type, odds_1, odds_2, odds_draw, captured_at")
    .in("match_id", pendingFixtures.map((fixture) => String(fixture.fixture_id)));
  const oddsByFixture = new Map<string, Array<{
    bookmaker: string;
    market_type: string;
    odds_1: number | null;
    odds_2: number | null;
    odds_draw: number | null;
    captured_at?: string;
  }>>();
  for (const row of latestOddsByMarket(oddsResult.data ?? [])) {
    const key = String(row.match_id);
    const rows = oddsByFixture.get(key) ?? [];
    rows.push({
      bookmaker: String(row.bookmaker ?? ""),
      market_type: String(row.market_type ?? ""),
      odds_1: row.odds_1,
      odds_2: row.odds_2,
      odds_draw: row.odds_draw,
      captured_at: row.captured_at,
    });
    oddsByFixture.set(key, rows);
  }
  const waitingFixtures = pendingFixtures.filter((fixture) =>
    assessOddsAvailability(oddsByFixture.get(String(fixture.fixture_id)) ?? []).status === "missing",
  );
  const toScan = pendingFixtures
    .filter((fixture) => !waitingFixtures.some((waiting) => waiting.fixture_id === fixture.fixture_id))
    .slice(0, 10);

  // Load the scheduler persona once for the whole batch instead of on every
  // fixture, and share one team-stats cache across fixtures so a team that
  // appears more than once in the batch is only queried once.
  const { persona, agentInstructions } = await loadAIConfig();
  const statsCache = new Map<string, Record<string, unknown>>();

  job.total = waitingFixtures.length + toScan.length;
  job.completed = waitingFixtures.length;
  job.waitingOdds = waitingFixtures.length;
  for (const fx of waitingFixtures) {
    job.tickets.push({
      fixture_id: String(fx.fixture_id),
      home_team: fx.home_team_name,
      away_team: fx.away_team_name,
      league: fx.league_name ?? "",
      confidence: 0,
      selection: "WAITING_FOR_ODDS",
      market: "",
      odds: 0,
      ev_percent: 0,
      kelly_stake: "N/A",
      kelly_edge: 0,
      prediction_text: "Menunggu data odds dari provider. AI belum dipanggil.",
      status: "waiting_odds",
      is_parlay_leg: false,
    });
  }

  // Adaptive throttling: only wait between fixtures when the AI provider has
  // actually signalled rate limiting (429/503) on the previous call. On a
  // clean run there is no artificial delay at all; after a rate-limit hit the
  // wait backs off exponentially (capped at 20s) and resets to 0 as soon as a
  // call succeeds cleanly again.
  let backoffMs = 0;
  for (let index = 0; index < toScan.length; index++) {
    const fx = toScan[index]!;
    job.currentMatch = `${fx.home_team_name} vs ${fx.away_team_name}`;
    try {
      if (index > 0 && backoffMs > 0) {
        logger.info({ backoffMs }, "[AI-BATCH] Throttling — provider signalled rate limiting on previous call");
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
      }
      logger.info({ matchNumber: index + 1, total: toScan.length }, `[AI-BATCH] Menganalisa pertandingan ${index + 1}...`);
      const result = await analyzeFixture(String(fx.fixture_id), {
        persona,
        agentInstructions,
        skipExistingPredictionCheck: true,
        fixture: {
          home_team_name: fx.home_team_name,
          away_team_name: fx.away_team_name,
          league_name: fx.league_name,
        },
        oddsRows: oddsByFixture.get(String(fx.fixture_id)) ?? [],
        statsCache,
      });
      backoffMs = result.rateLimited ? Math.min(backoffMs === 0 ? 5_000 : backoffMs * 2, 20_000) : 0;
       const recommendation = extractPredictionRecommendation(result.prediction_text);
       const prob = result.probability ?? null;
      const kelly = prob && recommendation.odds > 1
        ? calculateKelly(recommendation.odds, prob)
        : { recommendedUnit: "N/A", edge: 0, isPositiveEdge: false };
       const isParlayLeg = Boolean(
        result.odds_status !== "stale" &&
        recommendation.marketBet &&
        recommendation.odds > 1 &&
        recommendation.confidence >= 8 &&
        recommendation.marketBet.toLowerCase() !== "no_bet",
       ) &&
         prob != null &&
         prob > 0 &&
         prob < 1 &&
         recommendation.evPercent > 0;

      const ticket: BatchTicket = {
        fixture_id: String(fx.fixture_id),
        prediction_id: result.prediction_id,
        home_team: result.home_team,
        away_team: result.away_team,
        league: fx.league_name ?? "",
        confidence: recommendation.confidence,
        selection: recommendation.marketBet ?? "NO_BET",
        market: recommendation.marketBet ?? "",
        odds: recommendation.odds,
        ev_percent: recommendation.evPercent,
        odds_status: result.odds_status === "stale" ? "stale" : "valid",
        kelly_stake: kelly.recommendedUnit,
        kelly_edge: kelly.edge,
        prediction_text: result.prediction_text.substring(0, 500),
        status: "scanned",
        is_parlay_leg: isParlayLeg,
      };
      job.tickets.push(ticket);
       if (isParlayLeg && prob != null) {
        parlayCandidates.push({
          predictionId: result.prediction_id,
          fixtureId: fx.fixture_id,
          homeTeam: result.home_team,
          awayTeam: result.away_team,
          league: fx.league_name ?? "",
          date: fx.fixture_date,
          market: recommendation.marketBet!,
          selection: recommendation.marketBet!,
          odds: recommendation.odds,
          confidence: recommendation.confidence,
           probability: prob,
          evPercent: recommendation.evPercent,
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown";
      if (err instanceof OddsUnavailableError) {
        job.waitingOdds++;
        job.tickets.push({
          fixture_id: String(fx.fixture_id),
          home_team: fx.home_team_name,
          away_team: fx.away_team_name,
          league: fx.league_name ?? "",
          confidence: 0,
          selection: "WAITING_FOR_ODDS",
          market: "",
          odds: 0,
          ev_percent: 0,
          kelly_stake: "N/A",
          kelly_edge: 0,
          prediction_text: "Menunggu data odds dari provider. AI belum dipanggil.",
          status: "waiting_odds",
          is_parlay_leg: false,
        });
        continue;
      }
      job.tickets.push({
        fixture_id: String(fx.fixture_id),
        home_team: fx.home_team_name,
        away_team: fx.away_team_name,
        league: fx.league_name ?? "",
        confidence: 0,
        selection: "NO_BET",
        market: "",
        odds: 0,
        ev_percent: 0,
        kelly_stake: "N/A",
        kelly_edge: 0,
        prediction_text: message,
        status: "error",
        is_parlay_leg: false,
      });
    } finally {
      job.completed = waitingFixtures.length + index + 1;
    }
  }

  job.currentMatch = null;
  job.parlayId = await createParlayFromCandidates(parlayCandidates);
  const validTickets = job.tickets.filter((ticket) => ticket.confidence >= 6.5 && ticket.status === "scanned");
  const parlayLegs = job.tickets.filter((ticket) => ticket.is_parlay_leg);
  const { error: logErr } = await supabase.from("performance_log").insert({
    date: new Date().toISOString().split("T")[0],
    total_parlays: job.parlayId ? 1 : 0,
    wins: 0,
    losses: 0,
    hit_rate: null,
    total_roi: null,
    created_at: new Date().toISOString(),
  });
  if (logErr) logger.warn({ logErr }, "BATCH SCANNER: Failed to log to performance_log");
  logger.info(
    { scanned: job.tickets.length, valid: validTickets.length, parlayLegs: parlayLegs.length, parlayId: job.parlayId },
    "BATCH SCANNER: Done",
  );
}

/* ═════════════════════════════════════════════════════════════════════════════════
   M3: BATCH SCANNER — Scan semua fixture dalam configured scan window
   (didefinisikan sebelum /analyze/:fixtureId agar tidak tertangkap wildcard)
   ══════════════════════════════════════════════════════════════════════════════════ */

/** Admin-only: jalankan batch scan AI untuk fixture dalam configured scan window. */
router.post("/analyze/batch", requireAdmin, async (_req, res) => {
  try {
    logger.info("BATCH SCANNER: Request received");
    const runningJob = Array.from(batchJobs.values()).find((job) => job.status === "running");
    if (runningJob) {
      res.status(409).json({
        error: "Batch scanner sedang berjalan",
        jobId: runningJob.id,
        completed: runningJob.completed,
        total: runningJob.total,
      });
      return;
    }

    /* 1. Ambil fixture dalam configured scan window */
    const now = new Date().toISOString();
    const { data: config } = await supabase
      .from("scheduler_config")
      .select("scan_days")
      .limit(1)
      .maybeSingle();
    const configuredScanDays = Number(config?.scan_days ?? 11);
    const scanDays = Number.isInteger(configuredScanDays) && configuredScanDays >= 1 && configuredScanDays <= 90
      ? configuredScanDays
      : 11;
    const future = new Date(Date.now() + scanDays * 24 * 60 * 60 * 1000).toISOString();

    const { data: fixtures, error: fixturesError } = await supabase
      .from("fixtures")
      .select("fixture_id, home_team_name, away_team_name, league_name, fixture_date")
      .gte("fixture_date", now)
      .lte("fixture_date", future)
      .order("fixture_date", { ascending: true });

    if (fixturesError) {
      logger.error({ error: fixturesError }, "BATCH SCANNER: Failed to load fixtures");
      res.status(500).json({ error: `Failed to load fixtures: ${fixturesError.message}` });
      return;
    }

    if (!fixtures || fixtures.length === 0) {
      const job: BatchJob = {
        id: randomUUID(),
        status: "completed",
        scanDays,
        total: 0,
        completed: 0,
        currentMatch: null,
        tickets: [],
        parlayId: null,
        waitingOdds: 0,
        error: null,
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
      };
      batchJobs.set(job.id, job);
      trimBatchJobs();
      res.status(202).json({
        ...publicBatchJob(job),
        message: `Tidak ada fixture dalam ${scanDays} hari ke depan`,
      });
      return;
    }

    const job: BatchJob = {
      id: randomUUID(),
      status: "running",
      scanDays,
      total: 0,
      completed: 0,
      currentMatch: null,
      tickets: [],
      parlayId: null,
      waitingOdds: 0,
      error: null,
      startedAt: new Date().toISOString(),
      finishedAt: null,
    };
    batchJobs.set(job.id, job);
    trimBatchJobs();
    void runBatchJob(job, fixtures as typeof fixtures)
      .then(() => {
        job.status = "completed";
        job.finishedAt = new Date().toISOString();
      })
      .catch((err) => {
        job.status = "failed";
        job.error = err instanceof Error ? err.message : "Batch scanner failed";
        job.finishedAt = new Date().toISOString();
        logger.error({ err, jobId: job.id }, "BATCH SCANNER failed");
      });
    res.status(202).json(publicBatchJob(job));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    logger.error({ err }, "BATCH SCANNER failed");
    res.status(500).json({ error: message });
  }
});

router.get("/analyze/batch/:jobId", requireAdmin, (req, res) => {
  const job = batchJobs.get(String(req.params.jobId));
  if (!job) {
    res.status(404).json({ error: "Batch job not found or expired" });
    return;
  }
  res.json(publicBatchJob(job));
});

/**
 * POST /api/analyze/:fixtureId
 * Jalankan analisis baru, panggil Gemini, simpan & kembalikan hasil.
 */
router.post("/analyze/:fixtureId", async (req, res) => {
  const { fixtureId } = req.params;

  if (!fixtureId) {
    res.status(400).json({ error: "fixtureId is required" });
    return;
  }

  try {
    logger.info({ fixtureId }, "AI analysis requested");
    const result = await analyzeFixture(fixtureId);
    res.json(result);
  } catch (err) {
    if (err instanceof OddsUnavailableError) {
      res.status(409).json({
        code: "WAITING_FOR_ODDS",
        status: "waiting_odds",
        error: err.message,
      });
      return;
    }
    if (err instanceof PredictionAlreadyExistsError) {
      res.status(409).json({
        code: "ALREADY_ANALYZED",
        status: "already_analyzed",
        error: err.message,
      });
      return;
    }
    if (err instanceof StatsEmptyError) {
      res.status(400).json({ error: err.message });
      return;
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    logger.error({ err, fixtureId }, "AI analysis failed");
    res.status(500).json({ error: message });
  }
});

/**
 * GET /api/analyze/:fixtureId
 * Ambil prediksi terakhir yang sudah tersimpan (tanpa memanggil Gemini lagi).
 */
router.get("/analyze/:fixtureId", async (req, res) => {
  const { fixtureId } = req.params;

  try {
    const { data, error } = await supabase
      .from("ai_predictions")
      .select("*")
      .eq("fixture_id", fixtureId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    if (!data) {
      res.status(404).json({ error: "No prediction found for this fixture" });
      return;
    }

    res.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    logger.error({ err, fixtureId }, "Failed to fetch prediction");
    res.status(500).json({ error: message });
  }
});

export default router;
