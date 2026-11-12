import { Router, type IRouter } from "express";
import {
  analyzeFixture,
  assessOddsAvailability,
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
  readiness_status?: "bet_ready" | "analytical_no_bet" | "technical_review";
  rejection_reason?: string;
  kelly_stake: string;
  kelly_edge: number;
  prediction_text: string;
  status: "scanned" | "waiting_odds" | "skipped" | "error";
  is_parlay_leg: boolean;
  /** Disimpan supaya leg parlay tidak hilang saat scan di-resume. */
  probability?: number | null;
  fixture_date?: string;
};

type BatchJob = {
  id: string;
  /**
   * `partial` = berhenti karena anggaran waktu request habis, bukan karena
   * gagal. Sisa fixture disimpan di `pending` dan dilanjutkan lewat
   * `POST /analyze/batch/:jobId/resume`.
   */
  status: "running" | "completed" | "partial" | "failed";
  scanDays: number;
  total: number;
  completed: number;
  currentMatch: string | null;
  tickets: BatchTicket[];
  /** Fixture yang belum sempat diproses (id), dipakai untuk resume. */
  pending: number[];
  parlayId: string | null;
  waitingOdds: number;
  error: string | null;
  startedAt: string;
  updatedAt: string;
  finishedAt: string | null;
};

const batchJobs = new Map<string, BatchJob>();
const MAX_BATCH_JOBS = 20;
/*
 * Satu request Vercel dipotong di 60 detik (`vercel.json` → maxDuration).
 * Sebelumnya scanner mengantre 20 fixture tanpa anggaran waktu, sehingga
 * prosesnya dibunuh di tengah jalan: audit 12 Nov 2026 menunjukkan job
 * berhenti di 133 dari 147 fixture setelah 6 panggilan AI. Sekarang antrean
 * dibatasi anggaran waktu dan sisanya bisa dilanjutkan.
 */
const MAX_BATCH_FIXTURES = 60;
const BATCH_TIME_BUDGET_MS = (() => {
  const raw = Number(process.env.SCAN_JOB_BUDGET_MS);
  if (!Number.isFinite(raw) || raw <= 0) return 45_000;
  return Math.min(55_000, Math.max(10_000, raw));
})();
/** Job yang lebih tua dari ini dianggap sampah dan boleh ditimpa. */
const SCAN_JOB_TTL_MS = 6 * 60 * 60 * 1000;
/** Job `running` tanpa pembaruan selama ini dianggap mati bersama instance-nya. */
const SCAN_JOB_STALE_MS = 3 * 60 * 1000;

function trimBatchJobs() {
  while (batchJobs.size > MAX_BATCH_JOBS) {
    const oldest = batchJobs.keys().next().value;
    if (!oldest) break;
    batchJobs.delete(oldest);
  }
}

/**
 * Simpan status job ke `scan_jobs`.
 *
 * Sebelumnya job hanya hidup di `Map` milik satu instance. Di Vercel, poll
 * berikutnya bisa mendarat di instance lain (atau instance-nya sudah dibuang),
 * dan hasilnya 404 "Batch job not found or expired" padahal scan berjalan.
 * Snapshot ditulis setelah setiap tiket; kegagalan penyimpanan tidak boleh
 * menggagalkan scan, jadi error-nya hanya dicatat.
 */
function persistJob(job: BatchJob): void {
  job.updatedAt = new Date().toISOString();
  void supabase
    .from("scan_jobs")
    .upsert({
      id: job.id,
      status: job.status,
      scan_days: job.scanDays,
      total: job.total,
      completed: job.completed,
      current_match: job.currentMatch,
      tickets: job.tickets,
      pending: job.pending,
      parlay_id: job.parlayId,
      waiting_odds: job.waitingOdds,
      error: job.error,
      started_at: job.startedAt,
      finished_at: job.finishedAt,
      updated_at: job.updatedAt,
    }, { onConflict: "id" })
    .then(({ error }) => {
      if (error) logger.warn({ error, jobId: job.id }, "BATCH SCANNER: gagal menyimpan snapshot job");
    });
}

function hydrateJob(row: Record<string, unknown>): BatchJob {
  return {
    id: String(row.id),
    status: (row.status as BatchJob["status"]) ?? "failed",
    scanDays: Number(row.scan_days ?? 0),
    total: Number(row.total ?? 0),
    completed: Number(row.completed ?? 0),
    currentMatch: (row.current_match as string | null) ?? null,
    tickets: Array.isArray(row.tickets) ? (row.tickets as BatchTicket[]) : [],
    pending: Array.isArray(row.pending) ? (row.pending as number[]).map(Number) : [],
    parlayId: (row.parlay_id as string | null) ?? null,
    waitingOdds: Number(row.waiting_odds ?? 0),
    error: (row.error as string | null) ?? null,
    startedAt: String(row.started_at ?? new Date().toISOString()),
    updatedAt: String(row.updated_at ?? row.started_at ?? new Date().toISOString()),
    finishedAt: (row.finished_at as string | null) ?? null,
  };
}

/** Job dari memori, atau dari `scan_jobs` bila instance ini tidak memilikinya. */
async function loadJob(jobId: string): Promise<BatchJob | null> {
  const cached = batchJobs.get(jobId);
  if (cached) return cached;
  const { data, error } = await supabase
    .from("scan_jobs")
    .select("*")
    .eq("id", jobId)
    .gt("updated_at", new Date(Date.now() - SCAN_JOB_TTL_MS).toISOString())
    .maybeSingle();
  if (error) {
    logger.warn({ error, jobId }, "BATCH SCANNER: gagal membaca job tersimpan");
    return null;
  }
  if (!data) return null;
  const job = hydrateJob(data as Record<string, unknown>);
  batchJobs.set(job.id, job);
  trimBatchJobs();
  return job;
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
    /*
     * `waiting_odds` TIDAK dihitung sebagai review teknis. Dulu tiket
     * "menunggu odds" diberi readiness_status: technical_review, sehingga
     * angka "Technical review" selalu sama dengan jumlah tiket dan tidak
     * memberi informasi apa pun (audit 12 Nov: 133 tiket, 127 di antaranya
     * hanya menunggu odds).
     */
    technicalReview: job.tickets.filter((ticket) =>
      ticket.readiness_status === "technical_review" && ticket.status !== "waiting_odds",
    ).length,
    errors: job.tickets.filter((ticket) => ticket.status === "error").length,
    pending: job.pending.length,
    partial: job.status === "partial",
    tickets: job.tickets,
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
}>, deadlineAt = Date.now() + BATCH_TIME_BUDGET_MS, alreadyCounted = false) {
  const parlayCandidates: ParlayCandidate[] = [];
  const existing = await supabase
    .from("ai_predictions")
    .select("fixture_id, status, market_bet, best_market, best_odds")
    .in("fixture_id", fixtures.map((fixture) => fixture.fixture_id));
  if (existing.error) {
    throw new Error(`Failed to load existing predictions: ${existing.error.message}`);
  }

  /*
   * A row with no selected market is not a completed scan. It can be a
   * recoverable NO BET result, or a legacy row created before odds became
   * available. Keep it eligible so a later scan can use a newly captured
   * odds snapshot. In particular, a missing-odds scan never writes a row,
   * so it must not be turned into a permanent exclusion here.
   */
  const hasUsableSelectedMarket = (row: {
    status?: unknown;
    market_bet?: unknown;
    best_market?: unknown;
    best_odds?: unknown;
  }) => {
    const market = String(row.market_bet ?? row.best_market ?? "").trim().toLowerCase();
    const odds = Number(row.best_odds);
    return Boolean(
      market &&
      market !== "no_bet" &&
      market !== "no bet" &&
      Number.isFinite(odds) &&
      odds > 1 &&
      String(row.status ?? "active").toLowerCase() !== "no_bet",
    );
  };
  const existingSet = new Set(
    (existing.data ?? [])
      .filter(hasUsableSelectedMarket)
      .map((row) => String(row.fixture_id)),
  );
  const pendingFixtures = fixtures.filter((fixture) => !existingSet.has(String(fixture.fixture_id)));
  const oddsResult = pendingFixtures.length > 0
    ? await supabase
      .from("odds_history")
      .select("match_id, bookmaker, market_type, odds_1, odds_2, odds_draw, captured_at")
      .in("match_id", pendingFixtures.map((fixture) => String(fixture.fixture_id)))
    : { data: [], error: null };
  if (oddsResult.error) {
    throw new Error(`Failed to load odds snapshots: ${oddsResult.error.message}`);
  }
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
    assessOddsAvailability(oddsByFixture.get(String(fixture.fixture_id)) ?? []).status !== "valid",
  );
  const toScan = pendingFixtures
    .filter((fixture) => !waitingFixtures.some((waiting) => waiting.fixture_id === fixture.fixture_id))
    .slice(0, MAX_BATCH_FIXTURES);

  // Load the scheduler persona once for the whole batch instead of on every
  // fixture, and share one team-stats cache across fixtures so a team that
  // appears more than once in the batch is only queried once.
  const { persona, agentInstructions } = await loadAIConfig();
  const statsCache = new Map<string, Record<string, unknown>>();

  /*
   * Aditif, bukan absolut: resume memakai fungsi yang sama dan harus
   * melanjutkan hitungan dari job sebelumnya. `alreadyCounted` dipakai saat
   * resume — fixture sisa sudah masuk `job.total` pada run pertama, jadi
   * total tidak boleh ditambah lagi (dulu akan tampak seperti 147 → 160).
   */
  if (!alreadyCounted) {
    job.total = job.total + waitingFixtures.length + toScan.length;
  }
  job.completed = job.completed + waitingFixtures.length;
  job.waitingOdds = job.waitingOdds + waitingFixtures.length;
  const completedBase = job.completed;
  for (const fx of waitingFixtures) {
    const oddsAvailability = assessOddsAvailability(oddsByFixture.get(String(fx.fixture_id)) ?? []);
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
      prediction_text: oddsAvailability.status === "stale"
        ? "Snapshot odds sudah kedaluwarsa. Menunggu refresh provider sebelum AI dipanggil."
        : "Odds provider belum tersedia. AI belum dipanggil.",
      status: "waiting_odds",
       readiness_status: "technical_review",
      is_parlay_leg: false,
    });
  }
  persistJob(job);

  // Adaptive throttling: only wait between fixtures when the AI provider has
  // actually signalled rate limiting (429/503) on the previous call. On a
  // clean run there is no artificial delay at all; after a rate-limit hit the
  // wait backs off exponentially (capped at 20s) and resets to 0 as soon as a
  // call succeeds cleanly again.
  let backoffMs = 0;
  for (let index = 0; index < toScan.length; index++) {
    const fx = toScan[index]!;
    if (Date.now() >= deadlineAt) {
      /*
       * Berhenti dengan rapi sebelum instance dibunuh. Sisa fixture disimpan
       * supaya bisa dilanjutkan, bukan hilang seperti sebelumnya.
       */
      job.pending = toScan.slice(index).map((fixture) => Number(fixture.fixture_id));
      job.currentMatch = null;
      job.status = "partial";
      persistJob(job);
      logger.info(
        { jobId: job.id, processed: job.completed, total: job.total, pending: job.pending.length },
        "BATCH SCANNER: anggaran waktu habis — sisa fixture disimpan untuk resume",
      );
      return;
    }
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
       const recommendation = {
         marketBet: result.market_bet ?? null,
         odds: Number(result.odds ?? 0),
         confidence: Number(result.confidence ?? 0),
         evPercent: Number(result.ev_percent ?? 0),
       };
       const prob = result.probability ?? null;
       const kelly = prob && recommendation.odds > 1
         ? calculateKelly(recommendation.odds, prob)
        : { recommendedUnit: "N/A", edge: 0, isPositiveEdge: false };
       const isParlayLeg = Boolean(
        result.odds_status !== "stale" &&
        recommendation.marketBet &&
        recommendation.odds > 1 &&
         recommendation.confidence >= 6.5 &&
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
         readiness_status: result.readiness_status,
         rejection_reason: result.data_quality?.rejectionReason,
        is_parlay_leg: isParlayLeg,
        probability: prob,
        fixture_date: fx.fixture_date,
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
           readiness_status: "technical_review",
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
         readiness_status: "technical_review",
         rejection_reason: message,
        is_parlay_leg: false,
      });
    } finally {
      job.completed = completedBase + index + 1;
      persistJob(job);
    }
  }

  job.currentMatch = null;

  /*
   * Leg dari run sebelumnya ikut dihitung. Tanpa ini, setiap kali scan
   * dilanjutkan (status `partial`) kandidat yang sudah ditemukan di run
   * sebelumnya hilang dan parlay yang dibuat hanya berisi sisa terakhir.
   */
  const fromTickets: ParlayCandidate[] = job.tickets
    .filter((ticket) =>
      ticket.is_parlay_leg
      && typeof ticket.probability === "number"
      && ticket.probability > 0
      && ticket.probability < 1
      && Number(ticket.odds) > 1
      && Boolean(ticket.market),
    )
    .map((ticket) => ({
      predictionId: ticket.prediction_id as ParlayCandidate["predictionId"],
      fixtureId: Number(ticket.fixture_id),
      homeTeam: ticket.home_team,
      awayTeam: ticket.away_team,
      league: ticket.league,
      date: ticket.fixture_date ?? "",
      market: ticket.market,
      selection: ticket.selection,
      odds: Number(ticket.odds),
      confidence: Number(ticket.confidence),
      probability: ticket.probability as number,
      evPercent: Number(ticket.ev_percent),
    }));

  const candidateKey = (candidate: ParlayCandidate) =>
    `${candidate.fixtureId}::${String(candidate.market).toLowerCase()}`;
  const mergedCandidates = new Map<string, ParlayCandidate>();
  for (const candidate of [...fromTickets, ...parlayCandidates]) {
    if (!mergedCandidates.has(candidateKey(candidate))) {
      mergedCandidates.set(candidateKey(candidate), candidate);
    }
  }
  job.parlayId = await createParlayFromCandidates(Array.from(mergedCandidates.values()));
  const validTickets = job.tickets.filter((ticket) =>
    ticket.readiness_status === "bet_ready" && ticket.status === "scanned",
  );
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
    /*
     * Job `running` dianggap hidup hanya kalau masih ada pembaruan. Instance
     * yang dibunuh meninggalkan status "running" selamanya; tanpa cek umur,
     * tombol scan akan tertolak 409 terus walaupun tidak ada yang berjalan.
     */
    const freshCutoff = new Date(Date.now() - SCAN_JOB_STALE_MS).toISOString();
    const runningJob = Array.from(batchJobs.values()).find(
      (job) => job.status === "running"
        && new Date(job.updatedAt ?? job.startedAt).getTime() >= new Date(freshCutoff).getTime(),
    );
    if (runningJob) {
      res.status(409).json({
        error: "Batch scanner sedang berjalan",
        jobId: runningJob.id,
        completed: runningJob.completed,
        total: runningJob.total,
      });
      return;
    }
    /* Instance lain mungkin yang menjalankannya — cek juga di database. */
    const { data: persistedRunning } = await supabase
      .from("scan_jobs")
      .select("id, completed, total")
      .eq("status", "running")
      .gte("updated_at", freshCutoff)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (persistedRunning?.id) {
      res.status(409).json({
        error: "Batch scanner sedang berjalan",
        jobId: String(persistedRunning.id),
        completed: Number(persistedRunning.completed ?? 0),
        total: Number(persistedRunning.total ?? 0),
      });
      return;
    }
    /* Bersihkan job basi supaya tidak menumpuk di memori. */
    for (const [id, job] of batchJobs) {
      const age = Date.now() - new Date(job.updatedAt ?? job.startedAt).getTime();
      if (job.status !== "running" && age > SCAN_JOB_TTL_MS) batchJobs.delete(id);
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
        pending: [],
        parlayId: null,
        waitingOdds: 0,
        error: null,
        startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
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
      pending: [],
      parlayId: null,
      waitingOdds: 0,
      error: null,
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      finishedAt: null,
    };
    batchJobs.set(job.id, job);
    trimBatchJobs();
    persistJob(job);
    void runBatchJob(job, fixtures as typeof fixtures)
      .then(() => {
        /* `partial` diset di dalam runBatchJob; jangan ditimpa. */
        if (job.status === "running") {
          job.status = "completed";
          job.finishedAt = new Date().toISOString();
        }
        persistJob(job);
      })
      .catch((err) => {
        job.status = "failed";
        job.error = err instanceof Error ? err.message : "Batch scanner failed";
        job.finishedAt = new Date().toISOString();
        persistJob(job);
        logger.error({ err, jobId: job.id }, "BATCH SCANNER failed");
      });
    res.status(202).json(publicBatchJob(job));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    logger.error({ err }, "BATCH SCANNER failed");
    res.status(500).json({ error: message });
  }
});

router.get("/analyze/batch/:jobId", requireAdmin, async (req, res) => {
  try {
    const job = await loadJob(String(req.params.jobId));
    if (!job) {
      res.status(404).json({ error: "Batch job not found or expired" });
      return;
    }
    res.json(publicBatchJob(job));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    logger.error({ err, jobId: req.params.jobId }, "BATCH SCANNER: gagal memuat status");
    res.status(500).json({ error: message });
  }
});

/**
 * POST /api/analyze/batch/:jobId/resume
 * Lanjutkan job yang berhenti karena anggaran waktu (`status: "partial"`).
 * Inilah yang membuat "Scan 20 hari" bisa menuntaskan 147 fixture walau setiap
 * request Vercel hanya punya 60 detik.
 */
router.post("/analyze/batch/:jobId/resume", requireAdmin, async (req, res) => {
  try {
    const job = await loadJob(String(req.params.jobId));
    if (!job) {
      res.status(404).json({ error: "Batch job not found or expired" });
      return;
    }
    if (job.status === "running") {
      res.status(409).json({ error: "Job masih berjalan", jobId: job.id });
      return;
    }
    if (job.pending.length === 0) {
      res.json(publicBatchJob(job));
      return;
    }

    const pendingIds = [...job.pending];
    const { data: fixtures, error } = await supabase
      .from("fixtures")
      .select("fixture_id, home_team_name, away_team_name, league_name, fixture_date")
      .in("fixture_id", pendingIds)
      .order("fixture_date", { ascending: true });
    if (error) {
      res.status(500).json({ error: `Gagal memuat fixture lanjutan: ${error.message}` });
      return;
    }

    job.status = "running";
    job.pending = [];
    job.error = null;
    job.finishedAt = null;
    persistJob(job);
    res.status(202).json(publicBatchJob(job));

    void runBatchJob(job, (fixtures ?? []) as Array<{
      fixture_id: number;
      home_team_name: string;
      away_team_name: string;
      league_name: string | null;
      fixture_date: string;
    }>, Date.now() + BATCH_TIME_BUDGET_MS, true)
      .then(() => {
        if (job.status === "running") {
          job.status = "completed";
          job.finishedAt = new Date().toISOString();
        }
        persistJob(job);
      })
      .catch((err) => {
        job.status = "failed";
        job.error = err instanceof Error ? err.message : "Batch scanner failed";
        job.finishedAt = new Date().toISOString();
        persistJob(job);
        logger.error({ err, jobId: job.id }, "BATCH SCANNER resume failed");
      });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    logger.error({ err }, "BATCH SCANNER: resume gagal");
    res.status(500).json({ error: message });
  }
});

/**
 * POST /api/analyze/:fixtureId
 * Jalankan analisis baru, panggil Gemini, simpan & kembalikan hasil.
 */
router.post("/analyze/:fixtureId", requireAdmin, async (req, res) => {
  /* Express 5 types route params as string | string[] once a middleware is
     attached to the handler; normalise to a single id. */
  const fixtureId = String(req.params["fixtureId"] ?? "").trim();

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
