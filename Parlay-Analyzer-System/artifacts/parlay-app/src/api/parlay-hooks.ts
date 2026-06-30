import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

const API_BASE = "/api";

async function apiGet<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`API ${res.status}`);
  return res.json();
}

/* ─── Shared Types ─── */
export interface SyncStatus {
  isRunning: boolean;
  totalEvents: number;
  lastSyncAt?: string;
  leagueBreakdown?: { leagueSlug: string; eventCount: number }[];
}

export interface Health {
  supabase?: { status?: string; latencyMs?: number; [key: string]: unknown };
  gemini?: { status?: string; model?: string; [key: string]: unknown };
  aiPipeline?: { status?: string; [key: string]: unknown };
  aiLearning?: { status?: string; hitRate?: number | null; [key: string]: unknown };
  oddsApi?: { status?: string; [key: string]: unknown };
  timestamp?: string;
}

export interface LeagueAvailable {
  slug: string;
  name: string;
  country?: string;
  eventsCount?: number;
}

export interface FixtureEvent {
  id: number;
  home: string;
  away: string;
  date: string;
  leagueSlug?: string;
  status?: string;
  [key: string]: unknown;
}

export interface EventDetail {
  id: number;
  bookmakers?: Record<string, Market[]>;
  [key: string]: unknown;
}

export interface Market {
  name: string;
  odds: Record<string, unknown>[];
}

export interface Config {
  leagues?: string[];
  bookmakers?: string[];
  markets?: string[];
  cronExpression?: string;
  aiPersona?: string | null;
  agentInstructions?: string | null;
  [key: string]: unknown;
}

export interface Standing {
  id: string;
  team: string;
  league_name: string;
  season: string;
  position: number;
  points: number;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goals_for: number;
  goals_against: number;
  goal_difference: number;
  last_6: string;
}

export interface ParlayLeg {
  fixture_id: number;
  home: string;
  away: string;
  league: string;
  date: string;
  market: string;
  selection: string;
  odds: number;
  probability: number;
}

export interface Parlay {
  parlay_id: string;
  parlay_name: string;
  legs_count: number;
  combined_odds: number;
  expected_value: number;
  win_probability: number;
  status: string;
  created_at: string;
  legs?: ParlayLeg[];
}

async function apiPost<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`API ${res.status}`);
  return res.json();
}

/* ─── Sync Status ─── */
export const getGetSyncStatusQueryKey = () => ["sync/status"];
export function useGetSyncStatus() {
  return useQuery<SyncStatus>({
    queryKey: getGetSyncStatusQueryKey(),
    queryFn: () => apiGet<SyncStatus>(`${API_BASE}/sync/status`),
  });
}

/* ─── Available Leagues ─── */
export const getListAvailableLeaguesQueryKey = () => ["odds/available-leagues"];
export function useListAvailableLeagues() {
  return useQuery<LeagueAvailable[]>({
    queryKey: getListAvailableLeaguesQueryKey(),
    queryFn: () => apiGet<LeagueAvailable[]>(`${API_BASE}/odds/available-leagues`),
  });
}

/* ─── Supabase Parlays ─── */
export const getListSupabaseParlaysQueryKey = (params?: { status?: string }) => [
  "supabase/parlays",
  params,
];
export function useListSupabaseParlays(params?: { status?: string }) {
  return useQuery<Parlay[]>({
    queryKey: getListSupabaseParlaysQueryKey(params),
    queryFn: () => {
      const qs = params?.status ? `?status=${encodeURIComponent(params.status)}` : "";
      return apiGet<Parlay[]>(`${API_BASE}/supabase/parlays${qs}`);
    },
  });
}

/* ─── Supabase Fixtures ─── */
export const getListSupabaseFixturesQueryKey = (params?: Record<string, string | number>) => [
  "supabase/fixtures",
  params,
];
export function useListSupabaseFixtures(params?: Record<string, string | number>) {
  return useQuery<FixtureEvent[]>({
    queryKey: getListSupabaseFixturesQueryKey(params),
    queryFn: () => {
      const qs = params ? new URLSearchParams(params as Record<string, string>).toString() : "";
      return apiGet<FixtureEvent[]>(`${API_BASE}/supabase/fixtures${qs ? "?" + qs : ""}`);
    },
  });
}

/* ─── Events ─── */
export const getListEventsQueryKey = (params?: { league?: string; limit?: number }) => [
  "odds/events",
  params,
];
export function useListEvents(params?: { league?: string; limit?: number }) {
  return useQuery<FixtureEvent[]>({
    queryKey: getListEventsQueryKey(params),
    queryFn: () => {
      const qs = params ? new URLSearchParams(params as Record<string, string>).toString() : "";
      return apiGet<FixtureEvent[]>(`${API_BASE}/odds/events${qs ? "?" + qs : ""}`);
    },
  });
}

export const getGetEventQueryKey = (eventId: number) => ["odds/events", eventId];
export function useGetEvent(eventId: number) {
  return useQuery<EventDetail>({
    queryKey: getGetEventQueryKey(eventId),
    queryFn: () => apiGet<EventDetail>(`${API_BASE}/odds/events/${eventId}`),
    enabled: !!eventId,
  });
}

/* ─── Team Stats ─── */
export const getListTeamStatsQueryKey = (params?: { leagueSlug?: string; season?: string }) => [
  "csv/teams",
  params,
];
export function useListTeamStats(params?: { leagueSlug?: string; season?: string }) {
  return useQuery<Record<string, unknown>[]>({
    queryKey: getListTeamStatsQueryKey(params),
    queryFn: () => {
      const qs = params ? new URLSearchParams(params as Record<string, string>).toString() : "";
      return apiGet<Record<string, unknown>[]>(`${API_BASE}/csv/teams${qs ? "?" + qs : ""}`);
    },
  });
}

/* ─── Standings ─── */
export const getListStandingsQueryKey = (params?: { league_slug?: string; season?: string }) => [
  "supabase/standings",
  params,
];
export function useListStandings(params?: { league_slug?: string; season?: string }) {
  return useQuery<Standing[]>({
    queryKey: getListStandingsQueryKey(params),
    queryFn: () => {
      const qs = params ? new URLSearchParams(params as Record<string, string>).toString() : "";
      return apiGet<Standing[]>(`${API_BASE}/supabase/standings${qs ? "?" + qs : ""}`);
    },
  });
}

/* ─── Catalog (leagues + markets from server) ─── */
export interface LeagueCatalogItem {
  slug: string;
  name: string;
  country: string;
}
export interface MarketCatalogItem {
  key: string;
  label: string;
  description: string;
}
export interface Catalog {
  leagues: LeagueCatalogItem[];
  markets: MarketCatalogItem[];
}
export const getGetCatalogQueryKey = () => ["catalog"];
export function useGetCatalog() {
  return useQuery<Catalog>({
    queryKey: getGetCatalogQueryKey(),
    queryFn: () => apiGet(`${API_BASE}/catalog`),
    staleTime: Infinity,
  });
}

/* ─── Config ─── */
export const getGetConfigQueryKey = () => ["config"];
export function useGetConfig() {
  return useQuery<Config>({
    queryKey: getGetConfigQueryKey(),
    queryFn: () => apiGet<Config>(`${API_BASE}/config`),
  });
}

export function useSaveConfig() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { data: Record<string, unknown> }) => apiPost(`${API_BASE}/config`, data.data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetConfigQueryKey() }),
  });
}

/* ─── Trigger Sync ─── */
export function useTriggerSync() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiPost(`${API_BASE}/sync/trigger`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: getGetSyncStatusQueryKey() });
      queryClient.invalidateQueries({ queryKey: getListEventsQueryKey() });
    },
  });
}

/* ─── Trigger Settlement ─── */
export interface SettlementResult {
  ok: boolean;
  settled: number;
  lessons: number;
  skipped: number;
}

export function useTriggerSettlement() {
  return useMutation<SettlementResult, Error>({
    mutationFn: () => apiPost<SettlementResult>(`${API_BASE}/sync/settle`),
  });
}

/* ─── AI Analysis ─── */
export interface AIAnalysisResult {
  fixture_id: string;
  home_team?: string;
  away_team?: string;
  prediction_text: string;
  created_at: string;
}

async function apiGetRaw(url: string): Promise<Response> {
  return fetch(url);
}

export const getAIPredictionQueryKey = (fixtureId: string | number) => ["analyze", String(fixtureId)];

export function useGetAIPrediction(fixtureId: string | number) {
  return useQuery<AIAnalysisResult | null>({
    queryKey: getAIPredictionQueryKey(fixtureId),
    queryFn: async () => {
      const res = await apiGetRaw(`${API_BASE}/analyze/${fixtureId}`);
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`API ${res.status}`);
      return res.json();
    },
    enabled: !!fixtureId,
    retry: false,
  });
}

/* ─── Health ─── */
export const getGetHealthQueryKey = () => ["health"];
export function useGetHealth() {
  return useQuery<Health>({
    queryKey: getGetHealthQueryKey(),
    queryFn: () => apiGet<Health>(`${API_BASE}/health`),
  });
}

export function useRunAIAnalysis() {
  const queryClient = useQueryClient();
  return useMutation<AIAnalysisResult, Error, string | number>({
    mutationFn: async (fixtureId) => {
      const res = await fetch(`${API_BASE}/analyze/${fixtureId}`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `API ${res.status}`);
      return json;
    },
    onSuccess: (_data, fixtureId) => {
      queryClient.invalidateQueries({ queryKey: getAIPredictionQueryKey(fixtureId) });
    },
  });
}
