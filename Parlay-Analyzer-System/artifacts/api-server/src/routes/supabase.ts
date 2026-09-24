import { Router, type IRouter } from "express";
import { logger } from "../lib/logger";
import { supabase } from "../lib/supabase-client";
import { canonicalTeamName, teamIdentityKey } from "../lib/team-name-cleaner";
import { mergeTeamStatsRows } from "../lib/team-stats-merge";

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
    const requestedLimit = Number(limit ?? 50);
    const safeLimit = Number.isFinite(requestedLimit)
      ? Math.min(Math.max(Math.trunc(requestedLimit), 1), 200)
      : 50;

    let q = supabase
      .from("parlays")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(safeLimit);
    if (status) q = q.eq("status", status as string);

    const { data: parlayRows, error: parlayError } = await q;
    if (parlayError) {
      logger.error({ error: parlayError }, "Supabase parlays error");
      res.status(500).json({ error: parlayError.message });
      return;
    }

    const rows = (parlayRows ?? []) as Array<Record<string, unknown>>;
    const parlayIds = rows
      .map((row) => row.id)
      .filter((id): id is string | number => id !== null && id !== undefined);

    const { data: legRows, error: legsError } = parlayIds.length > 0
      ? await supabase
        .from("parlay_legs")
        .select("*")
        .in("parlay_id", parlayIds)
        .order("leg_order", { ascending: true })
      : { data: [], error: null };
    if (legsError) {
      logger.error({ error: legsError }, "Supabase parlay legs error");
      res.status(500).json({ error: legsError.message });
      return;
    }

    const legs = (legRows ?? []) as Array<Record<string, unknown>>;
    const fixtureIds = Array.from(new Set(
      legs
        .map((leg) => Number(leg.fixture_id))
        .filter((id) => Number.isFinite(id)),
    ));
    const { data: fixtureRows, error: fixturesError } = fixtureIds.length > 0
      ? await supabase
        .from("fixtures")
        .select("fixture_id, home_team_name, away_team_name, league_name, fixture_date")
        .in("fixture_id", fixtureIds)
      : { data: [], error: null };
    if (fixturesError) {
      logger.error({ error: fixturesError }, "Supabase parlay fixtures error");
      res.status(500).json({ error: fixturesError.message });
      return;
    }

    const fixtureById = new Map(
      ((fixtureRows ?? []) as Array<Record<string, unknown>>)
        .map((fixture) => [Number(fixture.fixture_id), fixture] as const),
    );
    const legsByParlay = new Map<string, Array<Record<string, unknown>>>();
    for (const leg of legs) {
      const key = String(leg.parlay_id);
      const current = legsByParlay.get(key) ?? [];
      current.push(leg);
      legsByParlay.set(key, current);
    }

    const toNumber = (value: unknown, fallback = 0) => {
      const number = Number(value);
      return Number.isFinite(number) ? number : fallback;
    };

    res.json(rows.map((parlay) => ({
      parlay_id: String(parlay.id),
      parlay_name: String(parlay.parlay_name ?? "AI Parlay"),
      legs_count: toNumber(parlay.legs_count),
      combined_odds: toNumber(parlay.combined_odds),
      expected_value: toNumber(parlay.expected_value),
      win_probability: toNumber(parlay.win_probability),
      avg_confidence: toNumber(parlay.avg_confidence),
      status: String(parlay.status ?? "pending"),
      actual_result: parlay.actual_result ?? null,
      created_at: parlay.created_at,
      updated_at: parlay.updated_at ?? null,
      legs: (legsByParlay.get(String(parlay.id)) ?? []).map((leg) => {
        const fixture = fixtureById.get(Number(leg.fixture_id)) ?? {};
        return {
          fixture_id: Number(leg.fixture_id),
          home: leg.home_team ?? fixture.home_team_name ?? "Unknown",
          away: leg.away_team ?? fixture.away_team_name ?? "Unknown",
          league: leg.league ?? fixture.league_name ?? "",
          date: leg.date ?? fixture.fixture_date ?? leg.created_at,
          market: leg.market ?? "",
          selection: leg.selection ?? "",
          odds: toNumber(leg.odds),
          probability: toNumber(leg.probability),
          confidence: leg.confidence == null ? null : toNumber(leg.confidence),
          result: leg.result ?? null,
        };
      }),
    })));
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

    const mergedByTeam = new Map<string, Record<string, unknown>>();
    for (const row of data ?? []) {
      const leagueSlug = String(row.league_slug ?? "");
      const canonicalTeam = canonicalTeamName(String(row.team_name ?? ""), leagueSlug);
      const key = [
        leagueSlug,
        String(row.season ?? ""),
        teamIdentityKey(canonicalTeam, leagueSlug),
      ].join("::");
      const merged = mergeTeamStatsRows([
        ...(mergedByTeam.has(key) ? [mergedByTeam.get(key)!] : []),
        row as Record<string, unknown>,
      ]);
      merged.team_name = canonicalTeam;
      mergedByTeam.set(key, merged);
    }

    const rows = Array.from(mergedByTeam.values()).map((row) => {
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
      const lg = String(row.league_name ?? "");
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
