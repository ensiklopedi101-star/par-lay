import { Router, type IRouter } from "express";
import { logger } from "../lib/logger";
import { supabase } from "../lib/supabase-client";

const router: IRouter = Router();

/* ─── Fixtures ─── */
router.get("/supabase/fixtures", async (req, res) => {
  try {
    const { league_name, status_short, limit } = req.query;
    let q = supabase.from("fixtures").select("*");
    if (league_name) q = q.eq("league_name", league_name as string);
    if (status_short) q = q.eq("status_short", status_short as string);
    const { data, error } = await q.order("fixture_date", { ascending: true }).limit(Number(limit ?? 200));
    if (error) { logger.error({ error }, "Supabase fixtures error"); res.status(500).json({ error: error.message }); return; }
    res.json(data ?? []);
  } catch (err) {
    logger.error({ err }, "Supabase fixtures exception");
    res.status(500).json({ error: "Internal error" });
  }
});

/* ─── Odds History ─── */
router.get("/supabase/odds", async (req, res) => {
  try {
    const { match_id, bookmaker, limit } = req.query;
    let q = supabase.from("odds_history").select("*");
    if (match_id) q = q.eq("match_id", match_id as string);
    if (bookmaker) q = q.eq("bookmaker", bookmaker as string);
    const { data, error } = await q.order("captured_at", { ascending: false }).limit(Number(limit ?? 200));
    if (error) { logger.error({ error }, "Supabase odds error"); res.status(500).json({ error: error.message }); return; }
    res.json(data ?? []);
  } catch (err) {
    logger.error({ err }, "Supabase odds exception");
    res.status(500).json({ error: "Internal error" });
  }
});

/* ─── Parlays ─── */
router.get("/supabase/parlays", async (req, res) => {
  try {
    const { status, limit } = req.query;
    let q = supabase.from("v_active_parlays").select("*");
    if (status) q = q.eq("status", status as string);
    const { data, error } = await q.order("created_at", { ascending: false }).limit(Number(limit ?? 50));
    if (error) { logger.error({ error }, "Supabase parlays error"); res.status(500).json({ error: error.message }); return; }
    res.json(data ?? []);
  } catch (err) {
    logger.error({ err }, "Supabase parlays exception");
    res.status(500).json({ error: "Internal error" });
  }
});

/* ─── Team Standings ─── */
router.get("/supabase/standings", async (req, res) => {
  try {
    const { league_name, season, limit } = req.query;
    let q = supabase.from("team_standings").select("*");
    if (league_name) q = q.eq("league_name", league_name as string);
    if (season) q = q.eq("season", season as string);
    const { data, error } = await q.order("position", { ascending: true }).limit(Number(limit ?? 50));
    if (error) { logger.error({ error }, "Supabase standings error"); res.status(500).json({ error: error.message }); return; }
    res.json(data ?? []);
  } catch (err) {
    logger.error({ err }, "Supabase standings exception");
    res.status(500).json({ error: "Internal error" });
  }
});

/* ─── Leagues list ─── */
router.get("/supabase/leagues", async (_req, res) => {
  try {
    const { data, error } = await supabase.from("leagues").select("*").eq("is_active", true);
    if (error) { logger.error({ error }, "Supabase leagues error"); res.status(500).json({ error: error.message }); return; }
    res.json(data ?? []);
  } catch (err) {
    logger.error({ err }, "Supabase leagues exception");
    res.status(500).json({ error: "Internal error" });
  }
});

/* ─── Odds Movement (view) ─── */
router.get("/supabase/odds-movement", async (req, res) => {
  try {
    const { match_id, limit } = req.query;
    let q = supabase.from("v_odds_movement").select("*");
    if (match_id) q = q.eq("match_id", match_id as string);
    const { data, error } = await q.limit(Number(limit ?? 100));
    if (error) { logger.error({ error }, "Supabase odds movement error"); res.status(500).json({ error: error.message }); return; }
    res.json(data ?? []);
  } catch (err) {
    logger.error({ err }, "Supabase odds movement exception");
    res.status(500).json({ error: "Internal error" });
  }
});

/* ─── Team Season Stats ─── */
router.get("/supabase/team-season-stats", async (req, res) => {
  try {
    const { league_slug, season, limit } = req.query;
    let q = supabase.from("team_season_stats").select("*");
    if (league_slug) q = q.eq("league_slug", league_slug as string);
    if (season) q = q.eq("season", season as string);
    const { data, error } = await q.order("team_name", { ascending: true }).limit(Number(limit ?? 500));
    if (error) { logger.error({ error }, "Supabase team season stats error"); res.status(500).json({ error: error.message }); return; }
    res.json(data ?? []);
  } catch (err) {
    logger.error({ err }, "Supabase team season stats exception");
    res.status(500).json({ error: "Internal error" });
  }
});

export default router;
