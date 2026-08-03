import { logger } from "../lib/logger";
import { supabase } from "../lib/supabase-client";

const BASE_URL = "https://api.odds-api.io/v3";

let syncRunning = false;
export function isSyncRunning(): boolean { return syncRunning; }

const MAX_EVENTS_PER_SYNC = 40;
const UPCOMING_WINDOW_DAYS = 10;
// The current free Odds-API plan accepts Bet365 as a recreational bookmaker.
// Sbobet may be selectable on the account but requires a paid plan.
export const DEFAULT_BOOKMAKERS = "Bet365";
const ODDS_REFRESH_HOURS = 6;
const ACTIVE_LEAGUE_CACHE_MS = 6 * 60 * 60 * 1000;

let activeLeagueCache: { slugs: Set<string>; expiresAt: number } | null = null;

function normalizeBookmakerName(name: string): string {
  return name.toLowerCase().replace(/\s*\(no latency\)\s*/g, "").trim();
}

export function normalizeScanDays(value: unknown, fallback = UPCOMING_WINDOW_DAYS): number {
  const days = Number(value);
  return Number.isInteger(days) && days >= 1 && days <= 90 ? days : fallback;
}

export async function getConfiguredScanDays(): Promise<number> {
  try {
    const { data, error } = await supabase
      .from("scheduler_config")
      .select("scan_days")
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return normalizeScanDays(data?.scan_days);
  } catch (err) {
    logger.warn({ err }, "RADAR: Failed to load scan_days — using default odds window");
    return UPCOMING_WINDOW_DAYS;
  }
}

function redactApiKey(url: string): string {
  return url.replace(/([?&]apiKey=)[^&]*/i, "$1[REDACTED]");
}

interface SyncRunRecord {
  id: number;
  started_at: string;
  finished_at: string | null;
  status: string;
  leagues: string[];
  events_fetched: number;
  events_inserted: number;
  odds_fetched: number;
  errors: number;
  rate_limited_seconds: number;
  error_message: string | null;
}

async function startSyncRun(leagues: string[]): Promise<number | null> {
  try {
    const { data, error } = await supabase
      .from("sync_runs")
      .insert({
        started_at: new Date().toISOString(),
        status: "running",
        leagues,
      })
      .select("id")
      .single();
    if (error) throw error;
    return (data?.id as number) ?? null;
  } catch (err) {
    logger.warn({ err }, "sync_runs insert failed; status tracking disabled");
    return null;
  }
}

async function finishSyncRun(
  id: number | null,
  status: "completed" | "partial" | "failed",
  stats: {
    events_fetched?: number;
    events_inserted?: number;
    odds_fetched?: number;
    errors?: number;
    rate_limited_seconds?: number;
    error_message?: string;
  },
) {
  if (!id) return;
  try {
    await supabase
      .from("sync_runs")
      .update({
        finished_at: new Date().toISOString(),
        status,
        ...stats,
      })
      .eq("id", id);
  } catch (err) {
    logger.warn({ err, id }, "sync_runs update failed");
  }
}

async function incrementSyncRunStats(
  id: number | null | undefined,
  stats: Partial<Pick<SyncRunRecord, "events_fetched" | "events_inserted" | "odds_fetched" | "errors">>,
) {
  if (!id) return;
  try {
    const { data } = await supabase.from("sync_runs").select("*").eq("id", id).single();
    if (!data) return;
    const current = data as SyncRunRecord;
    await supabase
      .from("sync_runs")
      .update({
        events_fetched: (current.events_fetched ?? 0) + (stats.events_fetched ?? 0),
        events_inserted: (current.events_inserted ?? 0) + (stats.events_inserted ?? 0),
        odds_fetched: (current.odds_fetched ?? 0) + (stats.odds_fetched ?? 0),
        errors: (current.errors ?? 0) + (stats.errors ?? 0),
      })
      .eq("id", id);
  } catch (err) {
    logger.warn({ err, id }, "sync_runs increment failed");
  }
}

export interface LeagueConfig {
  slug: string;
  name: string;
}

export const DEFAULT_LEAGUES: LeagueConfig[] = [
  { slug: "england-premier-league", name: "Premier League (EPL)" },
  { slug: "england-championship", name: "Championship" },
  { slug: "spain-laliga", name: "La Liga" },
  { slug: "italy-serie-a", name: "Serie A" },
  { slug: "france-ligue-1", name: "Ligue 1" },
  { slug: "netherlands-eredivisie", name: "Eredivisie" },
  { slug: "germany-bundesliga", name: "Bundesliga" },
  { slug: "republic-of-korea-k-league-1", name: "K-League 1" },
  { slug: "china-chinese-super-league", name: "Chinese Super League" },
  { slug: "japan-j1-league", name: "J1 League (Japan)" },
  { slug: "uefa-europa-league", name: "UEFA Europa League" },
  { slug: "uefa-champions-league", name: "UEFA Champions League" },
];

export class RateLimitError extends Error {
  constructor(public retryAfterSeconds: number) {
    super(`Rate limited — retry in ${retryAfterSeconds}s`);
  }
}

interface ApiLeague {
  slug: string;
  name: string;
  eventsCount: number;
}

interface ApiOddsEntry {
  hdp?: number;
  over?: string;
  under?: string;
  home?: string;
  draw?: string;
  away?: string;
  yes?: string;
  no?: string;
  [key: string]: unknown;
}

interface ApiMarket {
  name: string;
  odds: ApiOddsEntry[];
}

interface ApiEvent {
  id: number;
  home: string;
  away: string;
  date: string;
  status: string;
  /* Skor tersedia ketika status = "FT" / "AET" / "PEN" */
  home_goals?: number | string | null;
  away_goals?: number | string | null;
  home_goals_ht?: number | string | null;
  away_goals_ht?: number | string | null;
  scores?: {
    home?: number | string | null;
    away?: number | string | null;
    home_ht?: number | string | null;
    away_ht?: number | string | null;
  };
  result?: {
    home?: number | string | null;
    away?: number | string | null;
  };
  bookmakers?: Record<string, ApiMarket[]>;
}

function parseRetryAfter(body: string): number {
  const match = body.match(/resets in (\d+) minutes? and (\d+) seconds?/);
  if (match) return parseInt(match[1]!) * 60 + parseInt(match[2]!);
  return 3600;
}

async function apiGet<T>(url: string, label: string): Promise<T> {
   logger.info({ url: redactApiKey(url), label }, "RADAR: HTTP request to Odds-API");
  const res = await fetch(url);
  logger.info({ status: res.status, statusText: res.statusText, label, ok: res.ok }, "RADAR: HTTP response from Odds-API");
  if (res.status === 429) {
    const body = await res.text().catch(() => "");
    logger.warn({ body, retryAfter: parseRetryAfter(body) }, "RADAR: Rate limited by Odds-API");
    throw new RateLimitError(parseRetryAfter(body));
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    logger.error({ body, status: res.status, statusText: res.statusText, label }, "RADAR: Odds-API HTTP error");
    throw new Error(`odds-api.io ${res.status} [${label}]: ${body}`);
  }
  return res.json() as Promise<T>;
}

export async function fetchActiveLeagueSlugs(apiKey: string): Promise<Set<string>> {
  if (activeLeagueCache && activeLeagueCache.expiresAt > Date.now()) {
    logger.info({ count: activeLeagueCache.slugs.size }, "RADAR: Using cached active leagues");
    return activeLeagueCache.slugs;
  }
  try {
    const url = `${BASE_URL}/leagues?apiKey=${apiKey}&sport=football&all=true`;
     logger.info({ url: redactApiKey(url) }, "RADAR: Fetching active leagues from Odds-API");
    const data = await apiGet<ApiLeague[]>(url, "leagues");
    logger.info({ rawData: data, dataLength: data?.length }, "RADAR: Response from Odds-API leagues");
    const filtered = data.filter((l) => l.eventsCount > 0);
    logger.info({ filteredCount: filtered.length, slugs: filtered.map((l) => l.slug) }, "RADAR: Active leagues after filtering");
    const slugs = new Set(filtered.map((l) => l.slug));
    activeLeagueCache = { slugs, expiresAt: Date.now() + ACTIVE_LEAGUE_CACHE_MS };
    return slugs;
  } catch (err) {
    if (err instanceof RateLimitError) throw err;
    logger.error({ err }, "RADAR: Failed to fetch active leagues");
    return new Set();
  }
}

async function fetchLeagueEvents(leagueSlug: string, apiKey: string): Promise<ApiEvent[]> {
  const params = new URLSearchParams({
    apiKey,
    sport: "football",
    league: leagueSlug,
    status: "pending",
  });
  const url = `${BASE_URL}/events?${params}`;
   logger.info({ url: redactApiKey(url), leagueSlug }, "RADAR: Fetching league events from Odds-API");
  const data = await apiGet<ApiEvent | ApiEvent[]>(
    url,
    `events:${leagueSlug}`,
  );
  logger.info({ rawData: data, isArray: Array.isArray(data), dataLength: Array.isArray(data) ? data.length : 1 }, "RADAR: Response from Odds-API events");
  return Array.isArray(data) ? data : [data];
}

async function fetchEventOdds(eventId: number, apiKey: string, bookmakers: string): Promise<ApiEvent> {
  const params = new URLSearchParams({ apiKey, eventId: String(eventId), bookmakers });
  const url = `${BASE_URL}/odds?${params}`;
  logger.info({ url: redactApiKey(url), eventId, bookmakers }, "RADAR: Fetching event odds from Odds-API");
  const result = await apiGet<ApiEvent>(url, `odds:${eventId}`);
  logger.info({ eventId, hasBookmakers: !!result.bookmakers, bookmakerCount: result.bookmakers ? Object.keys(result.bookmakers).length : 0 }, "RADAR: Response from Odds-API odds");
  return result;
}

async function insertOddsMovementSnapshot(
  fixtureId: number,
  bookmaker: string,
  market: ApiMarket,
): Promise<void> {
  const name = (market.name ?? "").toLowerCase();
  const o = market.odds[0] ?? {};

  let newOdds: Record<string, number | null> = {};

  if (name === "ml" || name === "1x2" || name === "match_winner" || name === "h2h") {
    newOdds = {
      home_odds: o.home  ? parseFloat(o.home as string)  : null,
      away_odds: o.away  ? parseFloat(o.away as string)  : null,
      draw_odds: o.draw  ? parseFloat(o.draw as string)  : null,
    };
  } else if (name.includes("ou") || name.includes("total") || name.includes("over")) {
    newOdds = {
      over_odds:  o.over  ? parseFloat(o.over  as string) : null,
      under_odds: o.under ? parseFloat(o.under as string) : null,
    };
  } else if (name === "btts" || name.includes("both_teams") || name.includes("both teams")) {
    newOdds = {
      btts_yes: o.yes ? parseFloat(o.yes as string) : null,
      btts_no:  o.no  ? parseFloat(o.no  as string) : null,
    };
  } else if (name === "ah" || name.includes("handicap") || name.includes("spread")) {
    newOdds = {
      home_odds: o.home  ? parseFloat(o.home  as string) : null,
      away_odds: o.away  ? parseFloat(o.away  as string) : null,
    };
  } else {
    return; /* market tidak dikenal — skip */
  }

  /* Deduplication: cek snapshot terakhir untuk fixture+bookmaker+market ini.
     Jika odds identik → tidak ada perubahan → skip insert untuk hemat storage. */
  try {
    const { data: latest } = await supabase
      .from("odds_movement_history")
      .select("home_odds, away_odds, draw_odds, over_odds, under_odds, btts_yes, btts_no")
      .eq("fixture_id", String(fixtureId))
      .eq("bookmaker", bookmaker)
      .eq("market_type", market.name)
      .order("captured_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (latest) {
      const isDuplicate = Object.entries(newOdds).every(([key, val]) => {
        const prev = latest[key as keyof typeof latest] as number | null;
        if (val === null && prev === null) return true;
        if (val === null || prev === null) return false;
        return Math.abs(val - prev) < 0.005; /* toleransi floating point */
      });
      if (isDuplicate) return; /* odds tidak berubah — skip */
    }
  } catch {
    /* Jika cek gagal, tetap insert untuk keamanan */
  }

  const row: Record<string, unknown> = {
    fixture_id: String(fixtureId),
    bookmaker,
    market_type: market.name,
    captured_at: new Date().toISOString(),
    ...newOdds,
  };

  const { error } = await supabase.from("odds_movement_history").insert(row);
  if (error) {
    logger.debug({ error, fixtureId, bookmaker, market: market.name }, "odds_movement_history insert skipped");
  }
}

async function saveEventAndOdds(event: ApiEvent, leagueSlug: string, leagueIdMap: Map<string, number>) {
  logger.info({ eventId: event.id, home: event.home, away: event.away, leagueSlug, leagueIdMapKeys: Array.from(leagueIdMap.keys()) }, "RADAR: saveEventAndOdds called");
  const leagueId = leagueIdMap.get(leagueSlug);
  logger.info({ leagueSlug, leagueIdFound: leagueId }, "RADAR: leagueId lookup result");
  if (!leagueId) {
    logger.warn({ leagueSlug }, "RADAR: No league_id found for league — skipping fixture upsert");
  } else {
    // 1. Upsert fixture to Supabase — termasuk skor bila event sudah selesai
    const resolvedHomeGoals =
      event.home_goals != null ? Number(event.home_goals) :
      event.scores?.home != null ? Number(event.scores.home) :
      event.result?.home != null ? Number(event.result.home) : null;

    const resolvedAwayGoals =
      event.away_goals != null ? Number(event.away_goals) :
      event.scores?.away != null ? Number(event.scores.away) :
      event.result?.away != null ? Number(event.result.away) : null;

    const resolvedHomeHT =
      event.home_goals_ht != null ? Number(event.home_goals_ht) :
      event.scores?.home_ht != null ? Number(event.scores.home_ht) : null;

    const resolvedAwayHT =
      event.away_goals_ht != null ? Number(event.away_goals_ht) :
      event.scores?.away_ht != null ? Number(event.scores.away_ht) : null;

    const seasonYear = event.date ? new Date(event.date).getFullYear() : new Date().getFullYear();
    logger.info({ seasonYear, eventDate: event.date }, "RADAR: Derived season year from fixture date");

    const fixturePayload = {
      fixture_id: event.id,
      league_id: leagueId,
      league_name: leagueSlug,
      home_team_name: event.home,
      away_team_name: event.away,
      fixture_date: event.date,
      status_short: event.status,
      status_long: event.status,
      season: seasonYear,
      /* Skor disimpan ketika tersedia dari API */
      ...(resolvedHomeGoals !== null && { home_goals: resolvedHomeGoals }),
      ...(resolvedAwayGoals !== null && { away_goals: resolvedAwayGoals }),
      ...(resolvedHomeHT !== null && { home_goals_ht: resolvedHomeHT }),
      ...(resolvedAwayHT !== null && { away_goals_ht: resolvedAwayHT }),
      last_updated: new Date().toISOString(),
    };
    logger.info({ fixturePayload }, "RADAR: Attempting fixture upsert");
    const { error: fixtureErr } = await supabase
      .from("fixtures")
      .upsert(fixturePayload, { onConflict: "fixture_id" });
    if (fixtureErr) {
      logger.error({ error: fixtureErr, errorMessage: fixtureErr.message, errorDetails: fixtureErr.details, eventId: event.id }, "RADAR: Supabase fixture upsert ERROR");
    } else {
      logger.info({ eventId: event.id }, "RADAR: Fixture upsert SUCCESS");
    }
  }

  if (!event.bookmakers) return;

  // 2. Upsert odds to Supabase + 3. Insert odds movement snapshot
  for (const [bookmaker, markets] of Object.entries(event.bookmakers)) {
    for (const market of markets) {
      if (market.odds.length >= 1) {
        const odds = market.odds[0];
        const oddsPayload = {
          match_id: String(event.id),
          home_team: event.home,
          away_team: event.away,
          commence_time: event.date,
          bookmaker,
          market_type: market.name,
          odds_1: odds.home ? parseFloat(odds.home) : null,
          odds_2: odds.away ? parseFloat(odds.away) : null,
          odds_draw: odds.draw ? parseFloat(odds.draw) : null,
          captured_at: new Date().toISOString(),
        };
        logger.info({ oddsPayload }, "RADAR: Attempting odds save");
        // The live database does not define a unique constraint on
        // (match_id, bookmaker, market_type), so save the latest row
        // explicitly instead of relying on PostgREST onConflict.
        const { data: existingOdds, error: existingOddsErr } = await supabase
          .from("odds_history")
          .select("id")
          .eq("match_id", String(event.id))
          .eq("bookmaker", bookmaker)
          .eq("market_type", market.name)
          .order("captured_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        let oddsErr = existingOddsErr;
        if (!oddsErr && existingOdds?.id != null) {
          const result = await supabase
            .from("odds_history")
            .update(oddsPayload)
            .eq("id", existingOdds.id);
          oddsErr = result.error;
        } else if (!oddsErr) {
          const result = await supabase
            .from("odds_history")
            .insert(oddsPayload);
          oddsErr = result.error;
        }
        if (oddsErr) {
          logger.error({ error: oddsErr, errorMessage: oddsErr.message, errorDetails: oddsErr.details, eventId: event.id, bookmaker, market: market.name }, "RADAR: Supabase odds save ERROR");
        } else {
          logger.info({ eventId: event.id, bookmaker, market: market.name }, "RADAR: Odds save SUCCESS");
        }

        // 3. Record snapshot to odds_movement_history
        await insertOddsMovementSnapshot(event.id, bookmaker, market);
      }
    }
  }
}

async function getAlreadySyncedEventIds(
  eventIds: number[],
  requestedBookmakers: string[],
): Promise<Set<number>> {
  if (eventIds.length === 0) return new Set();
  const { data, error } = await supabase
    .from("odds_history")
    .select("match_id, bookmaker, captured_at")
    .in("match_id", eventIds.map((id) => String(id)));
  if (error) {
    logger.error({ error }, "Failed to fetch already synced odds");
    return new Set();
  }
  const configured = new Set(requestedBookmakers.map(normalizeBookmakerName).filter(Boolean));
  const freshCutoff = Date.now() - ODDS_REFRESH_HOURS * 60 * 60 * 1000;
  const bookmakersByEvent = new Map<number, Set<string>>();
  for (const row of data ?? []) {
    const eventId = Number(row.match_id);
    if (!Number.isFinite(eventId)) continue;
    if (!row.captured_at || new Date(row.captured_at).getTime() < freshCutoff) continue;
    if (!bookmakersByEvent.has(eventId)) bookmakersByEvent.set(eventId, new Set());
    bookmakersByEvent.get(eventId)!.add(normalizeBookmakerName(String(row.bookmaker)));
  }

  // One fresh bookmaker is enough to avoid re-fetching the same fixture on
  // every scheduler tick. A later run can still refresh once the TTL expires.
  return new Set(
    Array.from(bookmakersByEvent.entries())
      .filter(([, bookmakers]) =>
        configured.size === 0 || Array.from(configured).some((name) => bookmakers.has(name)),
      )
      .map(([eventId]) => eventId),
  );
}

export async function fetchAndSaveLeagueOdds(
  league: LeagueConfig,
  apiKey: string,
  bookmakers: string,
  leagueIdMap: Map<string, number>,
  options: { syncRunId?: number | null; maxEvents?: number; upcomingWindowDays?: number } = {},
): Promise<{ league: string; saved: number; skipped: boolean; errors: number; eventsFetched: number; oddsFetched: number }> {
  const { syncRunId, maxEvents, upcomingWindowDays = UPCOMING_WINDOW_DAYS } = options;
  let saved = 0;
  let errors = 0;
  let eventsFetched = 0;
  let oddsFetched = 0;

  try {
    logger.info({ league: league.slug, bookmakers }, "RADAR: Fetching events for league");
    const events = await fetchLeagueEvents(league.slug, apiKey);
    eventsFetched = events.length;

    if (events.length === 0) {
      logger.info({ league: league.slug }, "No pending events — skipping");
      return { league: league.slug, saved: 0, skipped: true, errors: 0, eventsFetched: 0, oddsFetched: 0 };
    }

    const now = Date.now();
    const windowEnd = now + upcomingWindowDays * 24 * 60 * 60 * 1000;
    const upcomingEvents = events.filter((e) => {
      const eventTime = new Date(e.date).getTime();
      return Number.isFinite(eventTime) && eventTime >= now && eventTime <= windowEnd;
    });
    const allIds = upcomingEvents.map((e) => e.id);
    const requestedBookmakers = bookmakers.split(",").map((name) => name.trim()).filter(Boolean);
    const alreadySynced = await getAlreadySyncedEventIds(allIds, requestedBookmakers);
    let toFetch = upcomingEvents
      .filter((e) => !alreadySynced.has(e.id))
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    if (maxEvents != null && maxEvents > 0) {
      toFetch = toFetch.slice(0, maxEvents);
    }

    logger.info(
      { league: league.slug, total: events.length, alreadySynced: alreadySynced.size, toFetch: toFetch.length },
      "Events found",
    );

    await incrementSyncRunStats(syncRunId, { events_fetched: eventsFetched, events_inserted: toFetch.length });

    for (const event of toFetch) {
      try {
        await new Promise((r) => setTimeout(r, 300));
        const withOdds = await fetchEventOdds(event.id, apiKey, bookmakers);
        await saveEventAndOdds(withOdds, league.slug, leagueIdMap);
        saved++;
        oddsFetched++;
      } catch (err) {
        if (err instanceof RateLimitError) {
          logger.warn({ retryAfter: err.retryAfterSeconds, saved }, "Rate limited — stopping sync early");
          await incrementSyncRunStats(syncRunId, { odds_fetched: oddsFetched, errors });
          return { league: league.slug, saved, skipped: false, errors, eventsFetched, oddsFetched };
        }
        errors++;
        logger.error({ err, eventId: event.id }, "Failed to fetch/save odds for event");
      }
    }
  } catch (err) {
    if (err instanceof RateLimitError) {
      logger.warn({ retryAfter: err.retryAfterSeconds }, "Rate limited on league events fetch");
      throw err;
    }
    logger.error({ err, league: league.slug }, "Failed to process league");
    errors++;
  }

  await incrementSyncRunStats(syncRunId, { odds_fetched: oddsFetched, errors });
  logger.info({ league: league.slug, saved, errors }, "League sync done");
  return { league: league.slug, saved, skipped: false, errors, eventsFetched, oddsFetched };
}

export async function fetchAndSaveAllLeagues(
  leagues: LeagueConfig[] = DEFAULT_LEAGUES,
  bookmakers = DEFAULT_BOOKMAKERS,
  scanDays?: number,
): Promise<void> {
  if (syncRunning) {
    logger.warn("Sync already running — skipping");
    return;
  }
  const apiKey = process.env["ODDS_API_KEY"];
  logger.info({ apiKeyPresent: !!apiKey }, "RADAR: ODDS_API_KEY check");
  if (!apiKey) {
    logger.error("ODDS_API_KEY is not set — skipping odds fetch");
    return;
  }

  syncRunning = true;
  const upcomingWindowDays = normalizeScanDays(scanDays ?? await getConfiguredScanDays());
  logger.info({ leagueCount: leagues.length }, "RADAR: Starting odds sync — checking active leagues");

  let activeSlugs: Set<string>;
  try {
    activeSlugs = await fetchActiveLeagueSlugs(apiKey);
  } catch (err) {
    syncRunning = false;
    if (err instanceof RateLimitError) {
      logger.warn({ retryAfter: err.retryAfterSeconds }, "Rate limited fetching leagues — will retry next cycle");
      return;
    }
    throw err;
  }

  logger.info({ activeCount: activeSlugs.size, activeSlugs: Array.from(activeSlugs) }, "RADAR: Active leagues fetched from API");

  const leaguesToSync = leagues.filter((l) => activeSlugs.has(l.slug));
  const offSeason = leagues.filter((l) => !activeSlugs.has(l.slug)).map((l) => l.name);

  if (offSeason.length > 0) {
    logger.info({ offSeason }, "Leagues off-season — skipping");
  }

  if (leaguesToSync.length === 0) {
    syncRunning = false;
    logger.info("RADAR: No active leagues to sync right now — will retry next cycle");
    return;
  }

  // Start tracking this sync run
  const syncRunId = await startSyncRun(leaguesToSync.map((l) => l.slug));
  let totalEventsFetched = 0;
  let totalEventsInserted = 0;
  let totalOddsFetched = 0;
  let totalErrors = 0;
  let rateLimitedSeconds = 0;
  let status: "completed" | "partial" | "failed" = "completed";
  let errorMessage = "";

  // Build league_id map from Supabase
  let leagueIdMap: Map<string, number>;
  try {
    const { data: leaguesData, error: leaguesErr } = await supabase
      .from("leagues")
      .select("id, name, slug")
      .eq("is_active", true);
    if (leaguesErr) {
      logger.error({ error: leaguesErr }, "RADAR: ERROR loading leagues from Supabase");
    }
    logger.info({ leaguesDataCount: leaguesData?.length ?? 0, leaguesData: leaguesData ?? [] }, "RADAR: leagues table query result");
    leagueIdMap = new Map((leaguesData ?? []).map((l) => [l.slug ?? l.name, l.id]));
    logger.info({ leagueIdMapSize: leagueIdMap.size, leagueIdMapEntries: Array.from(leagueIdMap.entries()) }, "RADAR: League ID map loaded");
  } catch (err) {
    logger.warn({ err }, "RADAR: Failed to load league ID map — using empty map");
    leagueIdMap = new Map();
  }

  try {
    let remainingSlots = MAX_EVENTS_PER_SYNC;
    for (const league of leaguesToSync) {
      if (remainingSlots <= 0) {
        logger.info({ maxEvents: MAX_EVENTS_PER_SYNC }, "RADAR: Reached per-sync event cap — pausing until next cycle");
        status = "partial";
        break;
      }
      logger.info({ league: league.slug, remainingSlots }, "RADAR: Processing league");
      const result = await fetchAndSaveLeagueOdds(league, apiKey, bookmakers, leagueIdMap, {
        syncRunId,
        maxEvents: remainingSlots,
        upcomingWindowDays,
      });
      totalEventsFetched += result.eventsFetched;
      totalEventsInserted += result.saved;
      totalOddsFetched += result.oddsFetched;
      totalErrors += result.errors;
      remainingSlots -= result.saved;
      await new Promise((r) => setTimeout(r, 500));
    }
  } catch (err) {
    if (err instanceof RateLimitError) {
      logger.warn("Rate limited mid-sync — stopping. Next cycle will continue from unsynced events.");
      status = "partial";
      rateLimitedSeconds = err.retryAfterSeconds;
    } else {
      status = "failed";
      errorMessage = err instanceof Error ? err.message : "Unknown error";
      logger.error({ err }, "RADAR: Sync failed");
    }
  }

  await finishSyncRun(syncRunId, status, {
    events_fetched: totalEventsFetched,
    events_inserted: totalEventsInserted,
    odds_fetched: totalOddsFetched,
    errors: totalErrors,
    rate_limited_seconds: rateLimitedSeconds,
    error_message: errorMessage,
  });

  syncRunning = false;
  logger.info(
    { status, totalEventsFetched, totalEventsInserted, totalOddsFetched, totalErrors },
    "RADAR: All leagues odds sync complete",
  );
}
