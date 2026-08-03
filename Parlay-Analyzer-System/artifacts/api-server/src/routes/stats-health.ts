import { Router, type IRouter } from "express";
import { logger } from "../lib/logger";
import { supabase } from "../lib/supabase-client";

const router: IRouter = Router();
const STATS_STALE_DAYS = 14;

type StatsRow = {
  league_slug: string | null;
  team_name: string | null;
  updated_at: string | null;
};

type FixtureRow = {
  fixture_id: number;
  league_name: string | null;
  home_team_name: string | null;
  away_team_name: string | null;
};

function canonicalLeague(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[\/_\s]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^south-korea-/, "republic-of-korea-");
}

function leagueLabel(value: string): string {
  return value
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function latestDate(values: Array<string | null | undefined>): string | null {
  const valid = values
    .filter((value): value is string => {
      if (!value) return false;
      return Number.isFinite(new Date(value).getTime());
    })
    .sort((a, b) => new Date(b).getTime() - new Date(a).getTime());
  return valid[0] ?? null;
}

router.get("/stats/health", async (_req, res) => {
  try {
    const [{ data: config }, { data: statsRows, error: statsError }] = await Promise.all([
      supabase.from("scheduler_config").select("leagues, scan_days").limit(1).maybeSingle(),
      supabase.from("team_season_stats").select("league_slug, team_name, updated_at").limit(5000),
    ]);

    if (statsError) throw statsError;

    const configuredLeagues = Array.isArray(config?.leagues)
      ? config.leagues.map((value: unknown) => String(value).trim()).filter(Boolean)
      : [];
    const scanDays = Number.isInteger(Number(config?.scan_days)) ? Number(config?.scan_days) : 11;
    const now = Date.now();
    const staleCutoff = now - STATS_STALE_DAYS * 24 * 60 * 60 * 1000;
    const rowsByLeague = new Map<string, StatsRow[]>();

    for (const row of (statsRows ?? []) as StatsRow[]) {
      if (!row.league_slug) continue;
      const key = canonicalLeague(row.league_slug);
      const current = rowsByLeague.get(key) ?? [];
      current.push(row);
      rowsByLeague.set(key, current);
    }

    const leagueInputs = configuredLeagues.length > 0
      ? configuredLeagues
      : Array.from(rowsByLeague.keys());
    const healthByKey = new Map<string, {
      slug: string;
      name: string;
      statsRows: number;
      teamsCovered: number;
      latestUpdatedAt: string | null;
      ageDays: number | null;
      status: "missing" | "stale" | "current";
    }>();

    for (const slug of leagueInputs) {
      const key = canonicalLeague(slug);
      if (healthByKey.has(key)) continue;
      const rows = rowsByLeague.get(key) ?? [];
      const latestUpdatedAt = latestDate(rows.map((row) => row.updated_at));
      const ageDays = latestUpdatedAt
        ? Math.max(0, Math.floor((now - new Date(latestUpdatedAt).getTime()) / (24 * 60 * 60 * 1000)))
        : null;
      healthByKey.set(key, {
        slug,
        name: leagueLabel(slug),
        statsRows: rows.length,
        teamsCovered: new Set(rows.map((row) => row.team_name).filter(Boolean)).size,
        latestUpdatedAt,
        ageDays,
        status: rows.length === 0 ? "missing" : latestUpdatedAt && new Date(latestUpdatedAt).getTime() >= staleCutoff ? "current" : "stale",
      });
    }

    const { data: activeParlays, error: parlaysError } = await supabase
      .from("parlays")
      .select("id, parlay_name, legs_count, created_at")
      .eq("status", "active")
      .gte("legs_count", 2)
      .order("created_at", { ascending: false })
      .limit(20);
    if (parlaysError) throw parlaysError;

    const parlayIds = (activeParlays ?? []).map((parlay) => String(parlay.id));
    const { data: legRows, error: legsError } = parlayIds.length > 0
      ? await supabase.from("parlay_legs").select("parlay_id, fixture_id").in("parlay_id", parlayIds)
      : { data: [], error: null };
    if (legsError) throw legsError;

    const fixtureIds = Array.from(new Set((legRows ?? []).map((leg) => Number(leg.fixture_id)).filter(Number.isFinite)));
    const { data: fixtureRows, error: fixturesError } = fixtureIds.length > 0
      ? await supabase.from("fixtures").select("fixture_id, league_name, home_team_name, away_team_name").in("fixture_id", fixtureIds)
      : { data: [], error: null };
    if (fixturesError) throw fixturesError;

    const fixturesById = new Map(
      ((fixtureRows ?? []) as FixtureRow[]).map((fixture) => [Number(fixture.fixture_id), fixture]),
    );
    const legsByParlay = new Map<string, number[]>();
    for (const leg of legRows ?? []) {
      const current = legsByParlay.get(String(leg.parlay_id)) ?? [];
      current.push(Number(leg.fixture_id));
      legsByParlay.set(String(leg.parlay_id), current);
    }

    const parlayReminders = (activeParlays ?? []).map((parlay) => {
      const leagues = Array.from(new Set(
        (legsByParlay.get(String(parlay.id)) ?? [])
          .map((fixtureId) => fixturesById.get(fixtureId)?.league_name)
          .filter((value): value is string => Boolean(value)),
      ));
      const missingLeagues = leagues.filter((league) => healthByKey.get(canonicalLeague(league))?.status === "missing");
      const staleLeagues = leagues.filter((league) => {
        const health = healthByKey.get(canonicalLeague(league));
        if (!health || health.status === "missing") return false;
        return health.status === "stale" ||
          (health.latestUpdatedAt !== null && new Date(health.latestUpdatedAt).getTime() < new Date(parlay.created_at).getTime());
      });
      return {
        parlayId: String(parlay.id),
        parlayName: String(parlay.parlay_name ?? "AI Parlay"),
        legsCount: Number(parlay.legs_count ?? 0),
        createdAt: parlay.created_at,
        leagues,
        missingLeagues,
        staleLeagues,
        needsUpdate: missingLeagues.length > 0 || staleLeagues.length > 0,
      };
    }).filter((reminder) => reminder.needsUpdate);

    const leagues = Array.from(healthByKey.values()).sort((a, b) => {
      const order = { missing: 0, stale: 1, current: 2 };
      return order[a.status] - order[b.status] || a.name.localeCompare(b.name);
    });

    res.json({
      scanDays,
      staleAfterDays: STATS_STALE_DAYS,
      totalLeagues: leagues.length,
      coveredLeagues: leagues.filter((league) => league.status !== "missing").length,
      missingLeagues: leagues.filter((league) => league.status === "missing"),
      staleLeagues: leagues.filter((league) => league.status === "stale"),
      leagues,
      parlayReminders,
      checkedAt: new Date().toISOString(),
    });
  } catch (err) {
    logger.error({ err }, "Failed to build team stats health summary");
    res.status(500).json({ error: "Failed to load team stats health" });
  }
});

export default router;