import { Router, type IRouter } from "express";
import { logger } from "../lib/logger";
import { supabase } from "../lib/supabase-client";

const router: IRouter = Router();

/* ─── Fixtures ─── */
router.get("/supabase/fixtures", async (req, res) => {
  try {
    const { league_name, status_short, date_from, date_to, limit } = req.query;
    let q = supabase
      .from("fixtures")
      .select("*")
      .gte("fixture_date", (date_from as string | undefined) ?? new Date().toISOString());
    if (league_name) q = q.eq("league_name", league_name as string);
    if (status_short) q = q.eq("status_short", status_short as string);
    if (date_from) q = q.gte("fixture_date", date_from as string);
    if (date_to) q = q.lte("fixture_date", date_to as string);
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

/* ─── Team Standings (derived from team_season_stats) ─── */
router.get("/supabase/standings", async (req, res) => {
  try {
    const { league_slug, season } = req.query;

    let q = supabase
      .from("team_season_stats")
      .select("id, team_name, league_slug, season, stats_team_form");
    if (league_slug) q = q.eq("league_slug", league_slug as string);
    if (season) q = q.eq("season", season as string);

    const { data, error } = await q.limit(500);
    if (error) { logger.error({ error }, "Supabase standings error"); res.status(500).json({ error: error.message }); return; }

    function extractLast6(form: Record<string, unknown>): string {
      const v = form["Last 6"] ?? form["last_6"] ?? form["last6"] ?? form["Last_6"];
      if (typeof v === "string") return v;
      if (Array.isArray(v)) return v.join("");
      return "";
    }

    const rows = (data ?? []).map((row) => {
      const form = (row.stats_team_form as Record<string, unknown>) ?? {};
      const toNum = (v: unknown) => {
        const n = typeof v === "string" ? Number(v) : Number(v ?? 0);
        return Number.isFinite(n) ? n : 0;
      };
      const points = toNum(form.Pts);
      const gd = toNum(form.GD);

      return {
        id: row.id,
        team: row.team_name,
        league_name: row.league_slug,
        season: row.season,
        position: 0,
        points,
        played: toNum(form.MP),
        won: toNum(form.W),
        drawn: toNum(form.D),
        lost: toNum(form.L),
        goals_for: toNum(form.GF),
        goals_against: toNum(form.GA),
        goal_difference: gd,
        last_6: extractLast6(form),
        _sortKey: { points, gd },
      };
    });

    // Sort per league, then assign position per league (not global)
    const groupedByLeague = rows.reduce<Record<string, typeof rows>>((acc, row) => {
      const lg = row.league_name;
      if (!acc[lg]) acc[lg] = [];
      acc[lg].push(row);
      return acc;
    }, {});

    const result: typeof rows = [];
    for (const leagueRows of Object.values(groupedByLeague)) {
      leagueRows.sort((a, b) => {
        if (b._sortKey.points !== a._sortKey.points) return b._sortKey.points - a._sortKey.points;
        return b._sortKey.gd - a._sortKey.gd;
      });
      leagueRows.forEach((row, idx) => {
        row.position = idx + 1;
        delete (row as { _sortKey?: unknown })._sortKey;
        result.push(row);
      });
    }

    res.json(result);
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
