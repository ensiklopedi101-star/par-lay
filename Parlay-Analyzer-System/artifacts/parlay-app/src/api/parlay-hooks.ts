import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

const API_BASE = "/api";

async function apiGet<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`API ${res.status}`);
  return res.json();
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
  return useQuery({
    queryKey: getGetSyncStatusQueryKey(),
    queryFn: () => apiGet(`${API_BASE}/sync/status`),
  });
}

/* ─── Available Leagues ─── */
export const getListAvailableLeaguesQueryKey = () => ["odds/available-leagues"];
export function useListAvailableLeagues() {
  return useQuery({
    queryKey: getListAvailableLeaguesQueryKey(),
    queryFn: () => apiGet(`${API_BASE}/odds/available-leagues`),
  });
}

/* ─── Supabase Parlays ─── */
export const getListSupabaseParlaysQueryKey = (params?: { status?: string }) => [
  "supabase/parlays",
  params,
];
export function useListSupabaseParlays(params?: { status?: string }) {
  return useQuery({
    queryKey: getListSupabaseParlaysQueryKey(params),
    queryFn: () => {
      const qs = params?.status ? `?status=${encodeURIComponent(params.status)}` : "";
      return apiGet(`${API_BASE}/supabase/parlays${qs}`);
    },
  });
}

/* ─── Supabase Fixtures ─── */
export const getListSupabaseFixturesQueryKey = (params?: Record<string, string | number>) => [
  "supabase/fixtures",
  params,
];
export function useListSupabaseFixtures(params?: Record<string, string | number>) {
  return useQuery({
    queryKey: getListSupabaseFixturesQueryKey(params),
    queryFn: () => {
      const qs = params ? new URLSearchParams(params as Record<string, string>).toString() : "";
      return apiGet(`${API_BASE}/supabase/fixtures${qs ? "?" + qs : ""}`);
    },
  });
}

/* ─── Events ─── */
export const getListEventsQueryKey = (params?: { league?: string; limit?: number }) => [
  "odds/events",
  params,
];
export function useListEvents(params?: { league?: string; limit?: number }) {
  return useQuery({
    queryKey: getListEventsQueryKey(params),
    queryFn: () => {
      const qs = params ? new URLSearchParams(params as Record<string, string>).toString() : "";
      return apiGet(`${API_BASE}/odds/events${qs ? "?" + qs : ""}`);
    },
  });
}

export const getGetEventQueryKey = (eventId: number) => ["odds/events", eventId];
export function useGetEvent(eventId: number) {
  return useQuery({
    queryKey: getGetEventQueryKey(eventId),
    queryFn: () => apiGet(`${API_BASE}/odds/events/${eventId}`),
    enabled: !!eventId,
  });
}

/* ─── Team Stats ─── */
export const getListTeamStatsQueryKey = (params?: { leagueSlug?: string; season?: string }) => [
  "csv/teams",
  params,
];
export function useListTeamStats(params?: { leagueSlug?: string; season?: string }) {
  return useQuery({
    queryKey: getListTeamStatsQueryKey(params),
    queryFn: () => {
      const qs = params ? new URLSearchParams(params as Record<string, string>).toString() : "";
      return apiGet(`${API_BASE}/csv/teams${qs ? "?" + qs : ""}`);
    },
  });
}

/* ─── Standings ─── */
export const getListStandingsQueryKey = (params?: { league_slug?: string; season?: string }) => [
  "supabase/standings",
  params,
];
export function useListStandings(params?: { league_slug?: string; season?: string }) {
  return useQuery({
    queryKey: getListStandingsQueryKey(params),
    queryFn: () => {
      const qs = params ? new URLSearchParams(params as Record<string, string>).toString() : "";
      return apiGet(`${API_BASE}/supabase/standings${qs ? "?" + qs : ""}`);
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
  return useQuery({
    queryKey: getGetConfigQueryKey(),
    queryFn: () => apiGet(`${API_BASE}/config`),
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
  return useQuery({
    queryKey: getGetHealthQueryKey(),
    queryFn: () => apiGet(`${API_BASE}/health`),
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
