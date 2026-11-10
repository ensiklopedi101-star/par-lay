import { Router, type IRouter } from "express";
import { supabase } from "../lib/supabase-client";
import { classifyOddsMarket, fetchAndSaveAllLeagues, getConfiguredScanDays, DEFAULT_LEAGUES } from "../services/odds-fetcher";
import { logger } from "../lib/logger";
import { requireAdmin } from "../middlewares/admin";
import { latestOddsByMarket } from "../services/odds-history";

const router: IRouter = Router();
/* Upper bound for a single PostgREST page; also used to size the fallback. */
const POSTGREST_PAGE_SIZE = 1000;

/**
 * Bounded fallback for the odds radar when the aggregate RPC is not deployed.
 *
 * Instead of downloading the whole snapshot table, read the newest rows per
 * fixture (ordered, capped) and collapse them per bookmaker/market. Counts are
 * a lower bound in this mode, which is acceptable for a status badge and much
 * cheaper than paging the full history.
 */
const FALLBACK_MAX_ROWS_PER_FIXTURE = 200;

async function loadOddsStatusFallback(
  fixtureIds: string[],
  oddsByFixture: Map<string, { capturedAt: string | null; count: number }>,
  movementByFixture: Map<string, number>,
): Promise<void> {
  const perFixtureLimit = Math.max(
    FALLBACK_MAX_ROWS_PER_FIXTURE,
    Math.floor(POSTGREST_PAGE_SIZE / Math.max(1, fixtureIds.length)),
  );

  const [oddsResult, movementResult] = await Promise.all([
    supabase
      .from("odds_history")
      .select("match_id, bookmaker, market_type, captured_at")
      .in("match_id", fixtureIds)
      .order("captured_at", { ascending: false })
      .limit(perFixtureLimit * fixtureIds.length),
    supabase
      .from("odds_movement_history")
      .select("fixture_id, bookmaker, market_type, captured_at")
      .in("fixture_id", fixtureIds)
      .order("captured_at", { ascending: false })
      .limit(perFixtureLimit * fixtureIds.length),
  ]);

  if (oddsResult.error) {
    logger.warn({ error: oddsResult.error }, "Failed to load fallback odds status");
  }
  if (movementResult.error) {
    logger.warn({ error: movementResult.error }, "Failed to load fallback odds movement status");
  }

  const countedMarkets = new Map<string, Set<string>>();
  for (const row of (oddsResult.data ?? []) as Array<Record<string, unknown>>) {
    const key = String(row.match_id);
    const marketKey = `${String(row.bookmaker ?? "").toLowerCase()}::${String(row.market_type ?? "").toLowerCase()}`;
    const markets = countedMarkets.get(key) ?? new Set<string>();
    markets.add(marketKey);
    countedMarkets.set(key, markets);

    const current = oddsByFixture.get(key);
    const capturedAt = row.captured_at ? String(row.captured_at) : null;
    oddsByFixture.set(key, {
      count: markets.size,
      capturedAt:
        current?.capturedAt && capturedAt
          ? new Date(capturedAt).getTime() > new Date(current.capturedAt).getTime()
            ? capturedAt
            : current.capturedAt
          : capturedAt ?? current?.capturedAt ?? null,
    });
  }

  /* Movement count keeps the original semantic: extra snapshots beyond the
     first one seen per fixture + bookmaker + market. */
  const movementSnapshots = new Map<string, number>();
  for (const row of (movementResult.data ?? []) as Array<Record<string, unknown>>) {
    const key = [
      String(row.fixture_id),
      String(row.bookmaker ?? "").toLowerCase(),
      String(row.market_type ?? "").toLowerCase(),
    ].join("::");
    movementSnapshots.set(key, (movementSnapshots.get(key) ?? 0) + 1);
  }
  for (const [key, count] of movementSnapshots) {
    if (count <= 1) continue;
    const fixtureId = key.split("::")[0]!;
    movementByFixture.set(fixtureId, (movementByFixture.get(fixtureId) ?? 0) + count - 1);
  }
}

/** Admin-only: trigger manual sync odds dari semua liga aktif. */
router.post("/sync/trigger", requireAdmin, (req, res) => {
  res.json({ message: "Odds sync started in background" });
  fetchAndSaveAllLeagues().catch((err) =>
    logger.error({ err }, "Manual odds sync failed"),
  );
});

router.get("/odds/events", async (req, res) => {
  try {
    const { league, limit } = req.query;
    const scanDays = await getConfiguredScanDays();
    const now = new Date();
    const radarEnd = new Date(now.getTime() + scanDays * 24 * 60 * 60 * 1000);
    let q = supabase
      .from("fixtures")
      .select("*")
      .gte("fixture_date", now.toISOString())
      .order("fixture_date", { ascending: true });
    if (league) {
      q = q.eq("league_name", league as string);
    }
    const { data, error } = await q.limit(Number(limit ?? 100));
    if (error) {
      logger.error({ error }, "Failed to fetch events from Supabase");
      res.status(500).json({ error: error.message });
      return;
    }

    const fixtureIds = (data ?? []).map((event) => String(event.fixture_id));
    const oddsByFixture = new Map<string, { capturedAt: string | null; count: number }>();
    const movementByFixture = new Map<string, number>();

    if (fixtureIds.length > 0) {
      /*
       * Ask Postgres for one aggregate row per fixture. The previous version
       * paged every odds_history / odds_movement_history row into Node.js just
       * to count them, so response time grew with every 3-hourly snapshot.
       */
      const [oddsSummary, movementSummary] = await Promise.all([
        supabase.rpc("fixture_odds_summary", { p_match_ids: fixtureIds }),
        supabase.rpc("fixture_odds_movement_summary", { p_fixture_ids: fixtureIds }),
      ]);

      if (!oddsSummary.error && !movementSummary.error) {
        for (const row of (oddsSummary.data ?? []) as Array<Record<string, unknown>>) {
          oddsByFixture.set(String(row.match_id), {
            count: Number(row.odds_count ?? 0),
            capturedAt: row.latest_captured_at ? String(row.latest_captured_at) : null,
          });
        }
        for (const row of (movementSummary.data ?? []) as Array<Record<string, unknown>>) {
          movementByFixture.set(String(row.fixture_id), Number(row.movement_count ?? 0));
        }
      } else {
        /*
         * The aggregate functions may not be deployed yet. Keep a bounded
         * fallback that only reads the newest snapshot per market instead of
         * the full history, so a missing migration degrades speed, not
         * correctness.
         */
        logger.warn(
          { oddsError: oddsSummary.error, movementError: movementSummary.error },
          "Odds summary RPC unavailable — using bounded fallback",
        );
        await loadOddsStatusFallback(fixtureIds, oddsByFixture, movementByFixture);
      }
    }

    res.json(
      (data ?? []).map((e) => ({
        id: e.fixture_id,
        leagueSlug: e.league_name,
        home: e.home_team_name,
        away: e.away_team_name,
        date: e.fixture_date,
        status: e.status_short,
        isUpcomingRadar: new Date(e.fixture_date).getTime() <= radarEnd.getTime(),
        updatedAt: e.updated_at,
        oddsCount: oddsByFixture.get(String(e.fixture_id))?.count ?? 0,
        oddsCapturedAt: oddsByFixture.get(String(e.fixture_id))?.capturedAt ?? null,
        oddsMovementCount: movementByFixture.get(String(e.fixture_id)) ?? 0,
      })),
    );
  } catch (err) {
    logger.error({ err }, "Failed to fetch events");
    res.status(500).json({ error: "Failed to fetch events" });
  }
});

router.get("/odds/events/:eventId", async (req, res) => {
  try {
    const scanDays = await getConfiguredScanDays();
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

    const bookmakers: Record<string, { name: string; odds: Record<string, unknown>[] }[]> = {};
    for (const row of latestOddsByMarket(oddsRows ?? [])) {
      const bm = (row.bookmaker as string) ?? "Unknown";
      const mt = String(row.market_type ?? "").toLowerCase();
      const marketClass = classifyOddsMarket(mt);
      if (!bookmakers[bm]) bookmakers[bm] = [];

      const entry: Record<string, unknown> = {};
      if (marketClass === "ML" || marketClass === "HT") {
        entry.home = row.odds_1;
        entry.draw = row.odds_draw;
        entry.away = row.odds_2;
      } else if (marketClass === "Totals") {
        entry.over = row.odds_1;
        entry.under = row.odds_2;
        entry.line = row.odds_draw;
      } else if (marketClass === "BTTS") {
        entry.yes = row.odds_1;
        entry.no = row.odds_2;
      } else if (marketClass === "AH") {
        entry.home = row.odds_1;
        entry.away = row.odds_2;
        entry.line = row.odds_draw;
      } else {
        entry.odds_1 = row.odds_1;
        entry.odds_2 = row.odds_2;
        entry.odds_draw = row.odds_draw;
      }

      bookmakers[bm].push({ name: String(row.market_type ?? mt), odds: [entry] });
    }

    res.json({
      id: event.fixture_id,
      leagueSlug: event.league_name,
      home: event.home_team_name,
      away: event.away_team_name,
      date: event.fixture_date,
      status: event.status_short,
       isUpcomingRadar: new Date(event.fixture_date).getTime() <=
         Date.now() + scanDays * 24 * 60 * 60 * 1000,
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

/*
 * The provider list is effectively static, and every upstream call consumes the
 * free Odds-API quota. Cache it for an hour and keep it behind the admin
 * password so anonymous traffic cannot burn the quota.
 */
const BOOKMAKERS_CACHE_MS = 60 * 60 * 1000;
let bookmakersCache: { data: { name: string; active: boolean }[]; expiresAt: number } | null = null;

router.get("/odds/bookmakers", requireAdmin, async (_req, res) => {
  if (bookmakersCache && Date.now() < bookmakersCache.expiresAt) {
    res.json(bookmakersCache.data);
    return;
  }
  const apiKey = process.env["ODDS_API_KEY"];
  if (!apiKey) { res.status(500).json({ error: "ODDS_API_KEY not set" }); return; }
  try {
    const r = await fetch(`https://api.odds-api.io/v3/bookmakers?apiKey=${apiKey}`);
    const text = await r.text();
    if (!r.ok) { res.status(r.status).json({ error: `API ${r.status}`, body: text }); return; }
    const data = JSON.parse(text) as { name: string; active?: boolean }[];
    const bookmakers = data.map((b) => ({ name: b.name, active: b.active ?? true }));
    bookmakersCache = { data: bookmakers, expiresAt: Date.now() + BOOKMAKERS_CACHE_MS };
    res.json(bookmakers);
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
