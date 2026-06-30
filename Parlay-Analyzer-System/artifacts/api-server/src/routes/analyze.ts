import { Router, type IRouter } from "express";
import { analyzeFixture, StatsEmptyError } from "../services/ai-analysis";
import { logger } from "../lib/logger";
import { supabase } from "../lib/supabase-client";
import { calculateKelly, extractProbFromPrediction } from "../lib/kelly-criterion";

const router: IRouter = Router();

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

/* ═════════════════════════════════════════════════════════════════════════════════
   M3: BATCH SCANNER — Scan semua fixture dalam 48 jam ke depan
   ══════════════════════════════════════════════════════════════════════════════════ */

router.post("/analyze/batch", async (_req, res) => {
  try {
    logger.info("BATCH SCANNER: Request received");

    /* 1. Ambil fixture dalam 48 jam ke depan */
    const now = new Date().toISOString();
    const future = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();

    const { data: fixtures } = await supabase
      .from("fixtures")
      .select("fixture_id, home_team, away_team, league_name, event_date")
      .gte("event_date", now)
      .lte("event_date", future)
      .order("event_date", { ascending: true });

    if (!fixtures || fixtures.length === 0) {
      res.json({ scanned: 0, tickets: [], message: "No fixtures in the next 48 hours" });
      return;
    }

    logger.info({ count: fixtures.length }, "BATCH SCANNER: Fixtures to scan");

    /* 2. Ambil predictions yang sudah ada (untuk skip) */
    const { data: existing } = await supabase
      .from("ai_predictions")
      .select("fixture_id")
      .eq("status", "active")
      .gte("created_at", now);

    const existingSet = new Set((existing ?? []).map((r) => String(r.fixture_id)));

    /* 3. Scan per fixture (max 10 untuk rate limit) */
    const tickets: {
      fixture_id: string;
      home_team: string;
      away_team: string;
      league: string;
      confidence: number;
      selection: string;
      market: string;
      odds: number;
      ev_percent: number;
      kelly_stake: string;
      kelly_edge: number;
      prediction_text: string;
      status: "scanned" | "skipped" | "error";
      is_parlay_leg: boolean;
    }[] = [];

    const toScan = fixtures.filter((f) => !existingSet.has(String(f.fixture_id))).slice(0, 10);

    for (const fx of toScan) {
      try {
        const result = await analyzeFixture(String(fx.fixture_id));
        /* Try to extract JSON from prediction_text */
        let ticket = {
          selection: "NO_BET",
          market: "",
          confidence: 0,
          odds: 0,
          ev_percent: 0,
        };
        const jsonMatch = result.prediction_text.match(/\{[\s\S]*?\}/);
        if (jsonMatch) {
          try {
            const parsed = JSON.parse(jsonMatch[0]);
            ticket = { ...ticket, ...parsed };
          } catch {
            /* ignore JSON parse error */
          }
        }

        // Kelly Criterion calculation (backend, not Gemini)
        const prob = extractProbFromPrediction(result.prediction_text);
        const kelly = prob && ticket.odds > 1
          ? calculateKelly(ticket.odds, prob)
          : { recommendedUnit: "N/A", edge: 0, isPositiveEdge: false };

        // Dynamic threshold: Single >= 6.5, Parlay >= 8.0
        const isParlayLeg = ticket.confidence >= 8.0;

        tickets.push({
          fixture_id: String(fx.fixture_id),
          home_team: result.home_team,
          away_team: result.away_team,
          league: fx.league_name ?? "",
          confidence: ticket.confidence || 0,
          selection: ticket.selection || "NO_BET",
          market: ticket.market || "",
          odds: ticket.odds || 0,
          ev_percent: ticket.ev_percent || 0,
          kelly_stake: kelly.recommendedUnit,
          kelly_edge: kelly.edge,
          prediction_text: result.prediction_text.substring(0, 500),
          status: "scanned",
          is_parlay_leg: isParlayLeg,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown";
        tickets.push({
          fixture_id: String(fx.fixture_id),
          home_team: fx.home_team,
          away_team: fx.away_team,
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
      }
    }

    /* 4. Dynamic threshold filtering:
        - Single Bet: confidence >= 6.5
        - Parlay Leg: confidence >= 8.0
    */
    const validTickets = tickets.filter((t) => t.confidence >= 6.5 && t.status === "scanned");
    const parlayLegs = tickets.filter((t) => t.confidence >= 8.0 && t.status === "scanned");

    /* 5. Log ke performance_log */
    const { error: logErr } = await supabase.from("performance_log").insert({
      date: new Date().toISOString().split("T")[0],
      predictions_made: tickets.length,
      valid_tickets: validTickets.length,
      hit_rate: null,
      total_roi: null,
      created_at: new Date().toISOString(),
    });
    if (logErr) {
      logger.warn({ logErr }, "BATCH SCANNER: Failed to log to performance_log");
    }

    logger.info(
      { scanned: tickets.length, valid: validTickets.length, parlayLegs: parlayLegs.length },
      "BATCH SCANNER: Done"
    );
    res.json({ scanned: tickets.length, validTickets: validTickets.length, parlayLegs: parlayLegs.length, tickets });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    logger.error({ err }, "BATCH SCANNER failed");
    res.status(500).json({ error: message });
  }
});

export default router;
