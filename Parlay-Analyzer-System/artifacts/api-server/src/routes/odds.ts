import { Router, type IRouter } from "express";
import { supabase } from "../lib/supabase-client";
import { fetchAndSaveAllLeagues, DEFAULT_LEAGUES } from "../services/odds-fetcher";
import { logger } from "../lib/logger";

const router: IRouter = Router();

router.post("/sync/trigger", (req, res) => {
  res.json({ message: "Odds sync started in background" });
  fetchAndSaveAllLeagues().catch((err) =>
    logger.error({ err }, "Manual odds sync failed"),
  );
});

router.get("/odds/events", async (req, res) => {
  try {
    const { league, limit } = req.query;
    let q = supabase.from("fixtures").select("*").order("fixture_date", { ascending: true });
    if (league) {
      q = q.eq("league_name", league as string);
    }
    const { data, error } = await q.limit(Number(limit ?? 100));
    if (error) {
      logger.error({ error }, "Failed to fetch events from Supabase");
      res.status(500).json({ error: error.message });
      return;
    }
    res.json(
      (data ?? []).map((e) => ({
        id: e.fixture_id,
        leagueSlug: e.league_name,
        home: e.home_team_name,
        away: e.away_team_name,
        date: e.fixture_date,
        status: e.status_short,
        updatedAt: e.updated_at,
      })),
    );
  } catch (err) {
    logger.error({ err }, "Failed to fetch events");
    res.status(500).json({ error: "Failed to fetch events" });
  }
});

router.get("/odds/events/:eventId", async (req, res) => {
  try {
    const eventId = Number(req.params["eventId"]);
    if (isNaN(eventId)) {
      res.status(400).json({ error: "Invalid eventId" });
      return;
    }

    const { data: event, error: eventErr } = await supabase
      .from("fixtures")
      .select("*")
      .eq("fixture_id", eventId)
      .single();

    if (eventErr || !event) {
      res.status(404).json({ error: "Event not found" });
      return;
    }

    const { data: oddsRows, error: oddsErr } = await supabase
      .from("odds_history")
      .select("*")
      .eq("match_id", String(eventId));

    if (oddsErr) {
      logger.error({ error: oddsErr }, "Failed to fetch odds");
    }

    const bookmakers: Record<string, unknown> = {};
    for (const row of oddsRows ?? []) {
      bookmakers[row.bookmaker] = {
        market_type: row.market_type,
        odds: {
          home: row.odds_1,
          away: row.odds_2,
          draw: row.odds_draw,
        },
      };
    }

    res.json({
      id: event.fixture_id,
      leagueSlug: event.league_name,
      home: event.home_team_name,
      away: event.away_team_name,
      date: event.fixture_date,
      status: event.status_short,
      updatedAt: event.updated_at,
      bookmakers,
    });
  } catch (err) {
    logger.error({ err }, "Failed to fetch event odds");
    res.status(500).json({ error: "Failed to fetch event odds" });
  }
});

router.get("/odds/leagues", (_req, res) => {
  res.json(DEFAULT_LEAGUES);
});

router.get("/odds/bookmakers", async (_req, res) => {
  const apiKey = process.env["ODDS_API_KEY"];
  if (!apiKey) { res.status(500).json({ error: "ODDS_API_KEY not set" }); return; }
  try {
    const r = await fetch(`https://api.odds-api.io/v3/bookmakers?apiKey=${apiKey}`);
    const text = await r.text();
    if (!r.ok) { res.status(r.status).json({ error: `API ${r.status}`, body: text }); return; }
    const data = JSON.parse(text) as { name: string; active?: boolean }[];
    res.json(data.map((b) => ({ name: b.name, active: b.active ?? true })));
  } catch (err) {
    logger.error({ err }, "Failed to fetch bookmakers");
    res.status(500).json({ error: "fetch failed" });
  }
});

router.get("/odds/available-leagues", async (_req, res) => {
  try {
    const { data, error } = await supabase
      .from("fixtures")
      .select("league_name")
      .not("league_name", "is", null);

    if (error) {
      logger.error({ error }, "Failed to fetch available leagues");
      res.status(500).json({ error: error.message });
      return;
    }

    const countMap = new Map<string, number>();
    for (const row of data ?? []) {
      countMap.set(row.league_name, (countMap.get(row.league_name) ?? 0) + 1);
    }

    res.json(
      DEFAULT_LEAGUES.map((l) => ({
        slug: l.slug,
        name: l.name,
        eventsCount: countMap.get(l.slug) ?? 0,
      })),
    );
  } catch (err) {
    logger.error({ err }, "Failed to fetch available leagues");
    res.status(500).json({ error: "fetch failed" });
  }
});

export default router;
