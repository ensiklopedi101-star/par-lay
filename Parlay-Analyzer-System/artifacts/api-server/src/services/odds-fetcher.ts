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
const MAX_RATE_LIMIT_RETRIES = 2;
const MAX_RATE_LIMIT_BACKOFF_SECONDS = 300;

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

async function updateSyncRunStats(
  id: number | null,
  stats: Pick<SyncRunRecord, "events_fetched" | "events_inserted" | "odds_fetched" | "errors">,
): Promise<void> {
  if (!id) return;
  try {
    const { error } = await supabase
      .from("sync_runs")
      .update(stats)
      .eq("id", id);
    if (error) throw error;
  } catch (err) {
    logger.warn({ err, id }, "sync_runs per-league update failed");
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

function parseRetryAfter(body: string, headerValue?: string | null): number {
  if (headerValue != null && headerValue.trim() !== "") {
    const headerSeconds = Number(headerValue);
    if (Number.isFinite(headerSeconds) && headerSeconds >= 0) {
      return Math.ceil(headerSeconds);
    }
  }
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
    const retryAfterSeconds = parseRetryAfter(body, res.headers.get("retry-after"));
    logger.warn({ body, retryAfter: retryAfterSeconds, label }, "RADAR: Rate limited by Odds-API");
    throw new RateLimitError(retryAfterSeconds);
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

function buildOddsMovementRow(
  fixtureId: number,
  bookmaker: string,
  market: ApiMarket,
  capturedAt: string,
): Record<string, unknown> | null {
  const name = (market.name ?? "").toLowerCase();
  const o = market.odds[0] ?? {};

  let newOdds: Record<string, number | null>;

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
    return null; /* market tidak dikenal — skip */
  }

  return {
    fixture_id: String(fixtureId),
    bookmaker,
    market_type: market.name,
    captured_at: capturedAt,
    ...newOdds,
  };
}

async function saveOddsMovementBatch(
  fixtureId: number,
  movementRows: Array<{ bookmaker: string; market: ApiMarket; row: Record<string, unknown> }>,
): Promise<void> {
  if (movementRows.length === 0) return;
  try {
    const { data: latestRows, error: latestError } = await supabase
      .from("odds_movement_history")
      .select("bookmaker, market_type, captured_at, home_odds, away_odds, draw_odds, over_odds, under_odds, btts_yes, btts_no")
      .eq("fixture_id", String(fixtureId))
      .order("captured_at", { ascending: false });
    if (latestError) throw latestError;

    const latestByKey = new Map<string, Record<string, unknown>>();
    for (const latest of (latestRows ?? []) as Array<Record<string, unknown>>) {
      const key = `${String(latest.bookmaker)}::${String(latest.market_type)}`;
      if (!latestByKey.has(key)) latestByKey.set(key, latest);
    }

    const changedRows = movementRows.filter(({ bookmaker, market, row }) => {
      const latest = latestByKey.get(`${bookmaker}::${market.name}`);
      if (!latest) return true;
      return Object.entries(row).some(([key, value]) => {
        if (key === "fixture_id" || key === "bookmaker" || key === "market_type" || key === "captured_at") return false;
        const previous = latest[key];
        if (value === null && previous === null) return false;
        if (value === null || previous === null || value === undefined || previous === undefined) return true;
        return Math.abs(Number(value) - Number(previous)) >= 0.005;
      });
    });

    if (changedRows.length === 0) return;
    const { error } = await supabase
      .from("odds_movement_history")
      .insert(changedRows.map(({ row }) => row));
    if (error) throw error;
    logger.info({ fixtureId, inserted: changedRows.length }, "RADAR: Odds movement batch saved");
  } catch (error) {
    // Movement history is auxiliary; preserve the previous fail-open behavior.
    logger.debug({ error, fixtureId }, "odds_movement_history batch skipped");
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

  // 2. Collect all odds rows for this event before touching Supabase.
  const capturedAt = new Date().toISOString();
  const oddsPayloads: Array<Record<string, unknown>> = [];
  const movementPayloads: Array<{ bookmaker: string; market: ApiMarket; row: Record<string, unknown> }> = [];
  for (const [bookmaker, markets] of Object.entries(event.bookmakers)) {
    for (const market of markets) {
      if (market.odds.length < 1) continue;
      const odds = market.odds[0]!;
      oddsPayloads.push({
        match_id: String(event.id),
        home_team: event.home,
        away_team: event.away,
        commence_time: event.date,
        bookmaker,
        market_type: market.name,
        odds_1: odds.home ? parseFloat(odds.home) : null,
        odds_2: odds.away ? parseFloat(odds.away) : null,
        odds_draw: odds.draw ? parseFloat(odds.draw) : null,
        captured_at: capturedAt,
      });
      const movementRow = buildOddsMovementRow(event.id, bookmaker, market, capturedAt);
      if (movementRow) movementPayloads.push({ bookmaker, market, row: movementRow });
    }
  }
  if (oddsPayloads.length === 0) return;

  // The live database has no unique constraint for odds_history. Preserve the
  // existing latest-row update behavior, but reduce reads to one query and
  // insert all new market rows in one batch.
  const { data: existingOddsRows, error: existingOddsError } = await supabase
    .from("odds_history")
    .select("id, match_id, bookmaker, market_type, captured_at")
    .eq("match_id", String(event.id))
    .order("captured_at", { ascending: false });
  if (existingOddsError) {
    logger.error({ error: existingOddsError, eventId: event.id }, "RADAR: Existing odds lookup ERROR");
  }

  const existingByKey = new Map<string, Record<string, unknown>>();
  for (const row of (existingOddsRows ?? []) as Array<Record<string, unknown>>) {
    const key = `${String(row.bookmaker)}::${String(row.market_type)}`;
    if (!existingByKey.has(key)) existingByKey.set(key, row);
  }
  const rowsToInsert: Array<Record<string, unknown>> = [];
  const rowsToUpdate: Array<{ id: unknown; payload: Record<string, unknown> }> = [];
  for (const payload of oddsPayloads) {
    const key = `${String(payload.bookmaker)}::${String(payload.market_type)}`;
    const existing = existingByKey.get(key);
    if (existing?.id != null) rowsToUpdate.push({ id: existing.id, payload });
    else rowsToInsert.push(payload);
  }

  if (rowsToInsert.length > 0) {
    const { error } = await supabase.from("odds_history").insert(rowsToInsert);
    if (error) logger.error({ error, eventId: event.id, count: rowsToInsert.length }, "RADAR: Odds batch insert ERROR");
  }
  if (rowsToUpdate.length > 0) {
    const updateResults = await Promise.all(rowsToUpdate.map(({ id, payload }) =>
      supabase.from("odds_history").update(payload).eq("id", id),
    ));
    const updateError = updateResults.find((result) => result.error)?.error;
    if (updateError) logger.error({ error: updateError, eventId: event.id }, "RADAR: Odds batch update ERROR");
  }
  logger.info({ eventId: event.id, inserted: rowsToInsert.length, updated: rowsToUpdate.length }, "RADAR: Odds batch saved");

  // One read + one insert for all movement snapshots belonging to this event.
  await saveOddsMovementBatch(event.id, movementPayloads);
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
  options: { maxEvents?: number; upcomingWindowDays?: number } = {},
): Promise<{
  league: string;
  saved: number;
  skipped: boolean;
  errors: number;
  eventsFetched: number;
  oddsFetched: number;
  rateLimitedSeconds?: number;
}> {
  const { maxEvents, upcomingWindowDays = UPCOMING_WINDOW_DAYS } = options;
  let saved = 0;
  let errors = 0;
  let eventsFetched = 0;
  let oddsFetched = 0;
  let rateLimitedSeconds = 0;

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

    for (const event of toFetch) {
      try {
        await new Promise((r) => setTimeout(r, 300));
        const withOdds = await fetchEventOdds(event.id, apiKey, bookmakers);
        await saveEventAndOdds(withOdds, league.slug, leagueIdMap);
        saved++;
        oddsFetched++;
      } catch (err) {
        if (err instanceof RateLimitError) {
          rateLimitedSeconds = err.retryAfterSeconds;
          logger.warn({ retryAfter: rateLimitedSeconds, saved }, "Rate limited — returning partial league result for retry");
          break;
        }
        errors++;
        logger.error({ err, eventId: event.id }, "Failed to fetch/save odds for event");
      }
    }
  } catch (err) {
    if (err instanceof RateLimitError) {
      rateLimitedSeconds = err.retryAfterSeconds;
      logger.warn({ retryAfter: rateLimitedSeconds }, "Rate limited on league events fetch");
    }
    else {
      logger.error({ err, league: league.slug }, "Failed to process league");
      errors++;
    }
  }

  logger.info({ league: league.slug, saved, errors, rateLimitedSeconds }, "League sync attempt done");
  return {
    league: league.slug,
    saved,
    skipped: false,
    errors,
    eventsFetched,
    oddsFetched,
    ...(rateLimitedSeconds > 0 && { rateLimitedSeconds }),
  };
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

  let activeSlugs: Set<string> = new Set();
  for (let attempt = 0; attempt <= MAX_RATE_LIMIT_RETRIES; attempt++) {
    try {
      activeSlugs = await fetchActiveLeagueSlugs(apiKey);
      break;
    } catch (err) {
      if (!(err instanceof RateLimitError)) {
        syncRunning = false;
        throw err;
      }
      rateLimitWait: {
        const waitSeconds = Math.min(
          Math.max(1, err.retryAfterSeconds),
          MAX_RATE_LIMIT_BACKOFF_SECONDS,
        );
        logger.warn(
          { attempt: attempt + 1, retryAfterSeconds: err.retryAfterSeconds, waitSeconds },
          "RADAR: Rate limited fetching active leagues — backing off",
        );
        if (attempt >= MAX_RATE_LIMIT_RETRIES) {
          syncRunning = false;
          logger.warn("RADAR: Active league fetch permanently skipped for this sync run");
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, waitSeconds * 1000));
      }
    }
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
  const retriedLeagues: string[] = [];
  const permanentlySkippedLeagues: string[] = [];

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

  let remainingSlots = MAX_EVENTS_PER_SYNC;
  for (const league of leaguesToSync) {
    if (remainingSlots <= 0) {
      logger.info({ maxEvents: MAX_EVENTS_PER_SYNC }, "RADAR: Reached per-sync event cap — pausing until next cycle");
      status = "partial";
      break;
    }

    let leagueSaved = 0;
    let leagueOddsFetched = 0;
    let leagueErrors = 0;
    let leagueEventsFetched = 0;
    let leagueRateLimitedSeconds = 0;
    let leagueCompleted = false;

    for (let attempt = 0; attempt <= MAX_RATE_LIMIT_RETRIES; attempt++) {
      logger.info({ league: league.slug, remainingSlots, attempt: attempt + 1 }, "RADAR: Processing league");
      let result;
      try {
        result = await fetchAndSaveLeagueOdds(league, apiKey, bookmakers, leagueIdMap, {
          maxEvents: remainingSlots,
          upcomingWindowDays,
        });
      } catch (err) {
        status = "failed";
        errorMessage = err instanceof Error ? err.message : "Unknown error";
        logger.error({ err, league: league.slug }, "RADAR: Sync failed");
        break;
      }

      if (attempt === 0) leagueEventsFetched = result.eventsFetched;
      leagueSaved += result.saved;
      leagueOddsFetched += result.oddsFetched;
      leagueErrors += result.errors;

      if (!result.rateLimitedSeconds) {
        leagueCompleted = true;
        break;
      }

      leagueRateLimitedSeconds = result.rateLimitedSeconds;
      rateLimitedSeconds = Math.max(rateLimitedSeconds, leagueRateLimitedSeconds);
      if (attempt >= MAX_RATE_LIMIT_RETRIES) {
        status = "partial";
        permanentlySkippedLeagues.push(league.slug);
        logger.warn(
          { league: league.slug, retryAfterSeconds: leagueRateLimitedSeconds },
          "RADAR: League permanently skipped after rate-limit retries",
        );
        break;
      }

      if (!retriedLeagues.includes(league.slug)) retriedLeagues.push(league.slug);
      const waitSeconds = Math.min(
        Math.max(1, leagueRateLimitedSeconds),
        MAX_RATE_LIMIT_BACKOFF_SECONDS,
      );
      logger.warn(
        { league: league.slug, attempt: attempt + 1, retryAfterSeconds: leagueRateLimitedSeconds, waitSeconds },
        "RADAR: Backing off before retrying league",
      );
      await new Promise((resolve) => setTimeout(resolve, waitSeconds * 1000));
    }

    totalEventsFetched += leagueEventsFetched;
    totalEventsInserted += leagueSaved;
    totalOddsFetched += leagueOddsFetched;
    totalErrors += leagueErrors;
    remainingSlots -= leagueSaved;

    // One absolute stats update per league, rather than a read/update during
    // and after every league.
    await updateSyncRunStats(syncRunId, {
      events_fetched: totalEventsFetched,
      events_inserted: totalEventsInserted,
      odds_fetched: totalOddsFetched,
      errors: totalErrors,
    });

    if (!leagueCompleted && status === "failed") break;
    await new Promise((r) => setTimeout(r, 500));
  }

  if (permanentlySkippedLeagues.length > 0) {
    errorMessage = `Rate-limit retried leagues: ${retriedLeagues.join(", ") || "none"}; permanently skipped: ${permanentlySkippedLeagues.join(", ")}`;
  } else if (retriedLeagues.length > 0) {
    errorMessage = `Rate-limit retried leagues: ${retriedLeagues.join(", ")}; all retries recovered`;
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

/**
 * Refresh only the provider events used by a bet slip. This is deliberately
 * separate from the scheduled league sync: the user needs a point-in-time
 * odds check immediately before placing a bet, even when the normal 6-hour
 * sync TTL has not expired yet.
 */
export async function refreshOddsForFixtures(fixtureIds: number[]): Promise<{
  requested: number;
  refreshed: number;
  failed: number;
  skipped: number;
}> {
  const uniqueIds = Array.from(new Set(fixtureIds.filter((id) => Number.isFinite(id)))).slice(0, 20);
  const summary = { requested: uniqueIds.length, refreshed: 0, failed: 0, skipped: 0 };
  if (uniqueIds.length === 0) return summary;

  const apiKey = process.env["ODDS_API_KEY"];
  if (!apiKey) {
    throw new Error("ODDS_API_KEY is not configured");
  }

  const { data: fixtures, error: fixturesError } = await supabase
    .from("fixtures")
    .select("fixture_id, league_name, fixture_date")
    .in("fixture_id", uniqueIds)
    .gt("fixture_date", new Date().toISOString());
  if (fixturesError) throw fixturesError;

  const { data: leagues } = await supabase
    .from("leagues")
    .select("id, slug, name")
    .eq("is_active", true);
  const leagueIdMap = new Map(
    (leagues ?? []).map((league) => [String(league.slug ?? league.name), Number(league.id)]),
  );
  const fixtureById = new Map((fixtures ?? []).map((fixture) => [Number(fixture.fixture_id), fixture]));

  for (const fixtureId of uniqueIds) {
    const fixture = fixtureById.get(fixtureId);
    if (!fixture) {
      summary.skipped++;
      continue;
    }
    try {
      const event = await fetchEventOdds(fixtureId, apiKey, DEFAULT_BOOKMAKERS);
      await saveEventAndOdds(event, String(fixture.league_name ?? ""), leagueIdMap);
      summary.refreshed++;
    } catch (error) {
      summary.failed++;
      logger.warn({ error, fixtureId }, "[ODDS-READINESS] Failed to refresh fixture odds");
    }
  }

  logger.info(summary, "[ODDS-READINESS] Fixture odds refresh complete");
  return summary;
}
