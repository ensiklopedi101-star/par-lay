import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { ManualParlayLeg } from "@/utils/manual-parlay-selection";
import {
  ADMIN_PASSWORD_STORAGE_KEY,
  clearStoredAdminPassword,
} from "@/hooks/use-admin-password";

const API_BASE = "/api";

/**
 * Build a query string from optional params.
 *
 * `new URLSearchParams({ a: undefined })` silently becomes `a=undefined`,
 * which made "All Leagues" filter by the literal slug "undefined" and return
 * an empty table. Skip empty values instead of serialising them.
 */
export function buildQueryString(
  params?: Record<string, string | number | boolean | undefined | null>,
): string {
  if (!params) return "";
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    const text = String(value).trim();
    if (text === "") continue;
    searchParams.set(key, text);
  }
  const query = searchParams.toString();
  return query ? `?${query}` : "";
}

/**
 * Drop a rejected password so the next admin action asks for it again instead
 * of retrying the same wrong value from localStorage forever.
 */
function handleUnauthorized(response: Response): void {
  if (response.status === 401) clearStoredAdminPassword();
}

async function apiGet<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`API ${res.status}`);
  return res.json();
}

async function apiAdminGet<T>(url: string): Promise<T> {
  const adminPassword = getAdminPassword();
  const res = await fetch(url, {
    headers: adminPassword ? { "x-admin-password": adminPassword } : undefined,
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    handleUnauthorized(res);
    throw new Error(json && typeof json.error === "string" ? json.error : `API ${res.status}`);
  }
  return json as T;
}

/* ─── Shared Types ─── */
/**
 * Satu baris riwayat sync (`sync_runs`) yang sudah dinormalkan server.
 * Dipakai untuk menampilkan apa yang sebenarnya terjadi saat sync berjalan:
 * berapa event ditarik, berapa tersimpan, berapa error, berapa detik kena
 * rate limit.
 */
export interface SyncRunSummary {
  id: number | null;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  /** `null` bila run belum selesai. */
  durationMs: number | null;
  leagues: string[];
  leagueCount: number;
  eventsFetched: number;
  eventsInserted: number;
  oddsFetched: number;
  errors: number;
  rateLimitedSeconds: number;
  errorMessage: string | null;
  /** Proporsi event tersimpan dari yang ditarik (0–1), `null` bila nol. */
  insertRatio: number | null;
  /** Penjelasan bila rasio tersimpan/ditarik rendah (termasuk nol). */
  insertReason?: string | null;
}

/**
 * Ringkasan proses settlement — lihat `services/settlement-summary.ts`.
 * Semua angka dihitung di server; klien hanya menampilkan.
 */
export interface SettlementSummary {
  predictions: { total: number; settled: number; pending: number; noBet: number };
  selections: { total: number; settled: number; pending: number; noBet: number };
  outcomes: { outcome: string; count: number }[];
  coverage: { withClosingOdds: number; withOutcome: number; betRows: number; total: number };
  /** Fixture yang sudah lewat tetapi belum punya skor akhir. */
  fixturesMissingScore: number;
  fixturesScored: number;
  generatedAt: string;
  /** Penjelasan jujur apa yang belum bisa dihitung dan kenapa. */
  notes: string[];
}

export interface SyncStatus {
  isRunning: boolean;
  totalEvents: number;
  configuredLeagueCount?: number;
  configuredLeagues?: string[];
  lastSyncAt?: string;
  lastSyncStatus?: string | null;
  leagueBreakdown?: { leagueSlug: string; eventCount: number }[];

  /** ─── Transparansi (baru) ─── */
  lastSyncRun?: SyncRunSummary | null;
  recentSyncRuns?: SyncRunSummary[];
  /** Umur run yang masih berstatus `running`, dalam detik. */
  runningAgeSeconds?: number | null;
  /** `true` bila ada run `running` yang umurnya melewati ambang (proses mati). */
  staleRunning?: boolean;
  staleThresholdSeconds?: number;
  /** Jendela pemindaian fixture dalam hari (dari `scheduler_config.scan_days`). */
  scanDays?: number;
}

export interface Health {
  supabase?: { status?: string; latencyMs?: number; [key: string]: unknown };
  gemini?: { status?: string; model?: string; [key: string]: unknown };
  aiPipeline?: {
    status?: string;
    activePredictions?: number;
    reviewPredictions?: number;
    invalidatedPredictions?: number;
    [key: string]: unknown;
  };
  aiLearning?: {
    status?: string;
    hitRate?: number | null;
    wins?: number;
    losses?: number;
    halfWins?: number;
    halfLosses?: number;
    pushes?: number;
    settled?: number;
    sampleSize?: number;
    recommendedMarket?: string | null;
    [key: string]: unknown;
  };
  oddsApi?: { status?: string; [key: string]: unknown };
  timestamp?: string;
}

export interface RiskCenterItem {
  predictionId: string;
  fixtureId: number;
  homeTeam: string;
  awayTeam: string;
  league: string;
  fixtureDate: string;
  market: string;
  bestOdds: number | null;
  evAtAnalysis: number | null;
  confidence: number | null;
  revalidationStatus: "review" | "invalidated";
  revalidationNote: string;
  lastRevalidatedAt: string | null;
  inParlay: boolean;
  parlayCount: number;
  latestRevision: {
    triggerType: string;
    triggerReason: string;
    predictionText: string | null;
    marketBet: string | null;
    bestOdds: number | null;
    evAtAnalysis: number | null;
    confidence: number | null;
    provider: string | null;
    modelVersion: string | null;
    status: string;
    errorMessage: string | null;
    createdAt: string;
  } | null;
}

export interface RiskCenterResponse {
  summary: { total: number; review: number; invalidated: number };
  items: RiskCenterItem[];
  generatedAt: string;
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
  isUpcomingRadar?: boolean;
  oddsCount?: number;
  oddsCapturedAt?: string | null;
  oddsMovementCount?: number;
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
  scanDays?: number;
  aiPersona?: string | null;
  agentInstructions?: string | null;
  effectiveAiPersona?: string;
  personaSource?: "database" | "default";
  v5ContractSuffix?: string;
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
  confidence?: number | null;
  source?: "ai" | "manual";
  result?: string | null;
}

export interface Parlay {
  parlay_id: string;
  parlay_name: string;
  legs_count: number;
  combined_odds: number;
  expected_value: number;
  win_probability: number;
  status: string;
  generated_by?: string | null;
  decision: "AMBIL" | "NO BET" | null;
  actual_result?: string | null;
  created_at: string;
  updated_at?: string | null;
  legs?: ParlayLeg[];
}

export interface AIPredictionBoardItem {
  id: string;
  fixtureId: number;
  homeTeam: string;
  awayTeam: string;
  league: string;
  fixtureDate: string | null;
  market: string;
  selection: string;
  odds: number | null;
  analysisOdds: number | null;
  oddsStatus: "verified" | "missing_market" | "missing_line" | "line_mismatch" | "missing_selection" | "missing_price" | "stale" | "unsupported";
  oddsStatusReason: string;
  oddsCapturedAt: string | null;
  probability: number | null;
  confidence: number;
  ev: number;
  evBasis: "current" | "analysis";
  latestRevisionAt: string | null;
  predictionText: string;
  createdAt: string;
  isInParlay: boolean;
  isUpcoming: boolean;
  status: string;
  decision: "AMBIL" | "NO BET" | null;
  result: "WIN" | "LOSS" | "HALF_WIN" | "HALF_LOSS" | "PUSH" | null;
  homeScore: number | null;
  awayScore: number | null;
  settledAt: string | null;
  fixtureStatus: string | null;
  fixtureFinished: boolean;
  isSelectable: boolean;
  selectabilityReason: string | null;
}

export interface CreateParlayFromPredictionsResult {
  parlayId: string | null;
  legs: unknown[];
  combinedOdds: number;
  winProbability: number;
  expectedValue: number;
  avgConfidence: number;
}

export type ManualParlayLegInput = Pick<
  ManualParlayLeg,
  "fixtureId" | "bookmaker" | "marketType" | "marketLine" | "outcomeKey" | "odds" | "probability"
>;

export type ParlayReadinessStatus =
  | "ready"
  | "review"
  | "invalidated"
  | "missing_odds"
  | "stale"
  | "missing_prediction"
  | "started_or_finished"
  | "rate_limited_unverified";

export interface ParlayReadinessLeg {
  parlayId: string;
  fixtureId: number;
  homeTeam: string;
  awayTeam: string;
  fixtureDate: string | null;
  market: string;
  selection: string;
  analysisOdds: number;
  currentOdds: number | null;
  confidence: number;
  currentEV: number | null;
  status: ParlayReadinessStatus;
  reason: string;
  oddsVerification: {
    refreshStatus: string;
    capturedAt: string | null;
    ageMinutes: number | null;
    verified: boolean;
  };
  aiRevision: {
    status: string;
    provider: string | null;
    modelVersion: string | null;
    createdAt: string;
  } | null;
}

export interface ParlayReadiness {
  ready: boolean;
  generatedAt: string;
  refresh: {
    requested: number;
    refreshed: number;
    failed: number;
    skipped: number;
    rateLimited: number;
    missingOdds: number;
    fixtures: Array<{
      fixtureId: number;
      status: string;
      retryAfterSeconds?: number;
      errorMessage?: string;
    }>;
  } | null;
  reanalysis: {
    considered: number;
    analyzed: number;
    skippedCooldown: number;
    skippedNoOdds: number;
    failed: number;
    revisions: string[];
  };
  selectedParlays: Array<{ id: string; name: string }>;
  legs: ParlayReadinessLeg[];
  mergePreview: {
    combinedOdds: number;
    winProbability: number;
    expectedValue: number;
    avgConfidence: number;
    riskScore: number;
    riskLevel: "low" | "medium" | "high" | "very_high";
    legs: number;
    rejected: Array<{ fixtureId: number; reason: string }>;
    maxLegs: number;
    stake?: number;
    potentialReturn?: number;
    potentialProfit?: number;
  };
}

function getAdminPassword(): string | null {
  try {
    return localStorage.getItem(ADMIN_PASSWORD_STORAGE_KEY);
  } catch {
    return null;
  }
}

async function apiPost<T>(url: string, body?: unknown): Promise<T> {
  const adminPassword = getAdminPassword();
  const headers: Record<string, string> = {};
  if (body) headers["content-type"] = "application/json";
  if (adminPassword) headers["x-admin-password"] = adminPassword;
  const res = await fetch(url, {
    method: "POST",
    headers: Object.keys(headers).length > 0 ? headers : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    handleUnauthorized(res);
    throw new Error(json && typeof json.error === "string" ? json.error : `API ${res.status}`);
  }
  return json as T;
}

/* ─── Sync Status ─── */
export const getGetSyncStatusQueryKey = () => ["sync/status"];
export function useGetSyncStatus() {
  return useQuery<SyncStatus>({
    queryKey: getGetSyncStatusQueryKey(),
    queryFn: () => apiGet<SyncStatus>(`${API_BASE}/sync/status`),
  });
}

/* ─── Backtest Model Poisson vs Pasar ─── */
export interface ModelBacktestReportData {
  generatedAt: string;
  fixturesTotal: number;
  skippedNoStats: number;
  skippedNoMarket: number;
  report: {
    samples: number;
    withMarket: number;
    oneX2: {
      modelLogLoss: number;
      modelBrier: number;
      argmaxHitRate: number;
      vsMarket: {
        n: number;
        modelLogLoss: number;
        marketLogLoss: number;
        skill: number;
        tStat: number | null;
      } | null;
    };
    over25: { n: number; logLoss: number; brier: number; baseRate: number };
    btts: { n: number; logLoss: number; brier: number; baseRate: number };
    calibrationEce: number | null;
    byLeague: Array<{
      league: string;
      n: number;
      modelLogLoss: number;
      vsMarket: { n: number; skill: number; tStat: number | null } | null;
    }>;
    byPeriod: Array<{
      period: string;
      n: number;
      modelLogLoss: number;
      vsMarket: { n: number; skill: number; tStat: number | null } | null;
    }>;
    verdict: string;
  };
  calibration: {
    trainN: number;
    validationN: number;
    defaultParams: { xgWeight: number; shrinkK: number };
    bestParams: { xgWeight: number; shrinkK: number } | null;
    bestTrainSkill: number | null;
    defaultValidation: { skill: number; tStat: number | null } | null;
    bestValidation: { skill: number; tStat: number | null } | null;
    adoptionJustified: boolean;
    note: string;
  };
  infoVariants: Array<{
    key: string;
    label: string;
    n: number;
    modelLogLoss: number;
    vsMarket: { n: number; skill: number; tStat: number | null } | null;
  }>;
}

export const getGetModelBacktestQueryKey = () => ["learning/model-backtest"];
export function useGetModelBacktest() {
  return useQuery<ModelBacktestReportData>({
    queryKey: getGetModelBacktestQueryKey(),
    queryFn: () => apiGet<ModelBacktestReportData>(`${API_BASE}/learning/model-backtest`),
    staleTime: 5 * 60 * 1000,
  });
}

/* ─── Ringkasan Settlement ─── */
export const getGetSettlementSummaryQueryKey = () => ["sync/settlement-summary"];
export function useGetSettlementSummary() {
  return useQuery<SettlementSummary>({
    queryKey: getGetSettlementSummaryQueryKey(),
    queryFn: () => apiGet<SettlementSummary>(`${API_BASE}/sync/settlement-summary`),
  });
}

/* ─── Status Otomatisasi ─── */
export interface CronTrigger {
  action: string;
  schedule: string;
  source: "vercel" | "node-cron";
  runsPerDay: number;
  covers: string[];
}

export interface AutomationGap {
  action: string;
  consequence: string;
  unscheduled: boolean;
  onlyOnDeadScheduler: boolean;
}

export interface AutomationStatus {
  triggers: CronTrigger[];
  gaps: AutomationGap[];
  coveredByVercel: string[];
  maxGapHours: number;
  atHobbyLimit: boolean;
  fixturesAwaitingScore: number;
  /** Dari yang menunggu: masih bisa ditarik otomatis vs permanen tanpa skor. */
  fixturesRecoverable: number;
  fixturesUnrecoverable: number;
  /** Bukti cron benar-benar berjalan, bukan sekadar dideklarasikan. */
  evidence: {
    lastDailyRunAt: string | null;
    hoursSinceDailyRun: number | null;
    stale: boolean;
  };
  generatedAt: string;
  notes: string[];
}

export const getGetAutomationStatusQueryKey = () => ["sync/automation-status"];
export function useGetAutomationStatus() {
  return useQuery<AutomationStatus>({
    queryKey: getGetAutomationStatusQueryKey(),
    queryFn: () => apiGet<AutomationStatus>(`${API_BASE}/sync/automation-status`),
  });
}

/* ─── Status Analisis AI ─── */
export interface AnalysisStatus {
  upcomingFixtures: number;
  totalPredictions: number;
  lastPredictionAt: string | null;
  hoursSinceLastPrediction: number | null;
  awaitingAnalysis: number;
  generatedAt: string;
  notes: string[];
}

export const getGetAnalysisStatusQueryKey = () => ["sync/analysis-status"];
export function useGetAnalysisStatus() {
  return useQuery<AnalysisStatus>({
    queryKey: getGetAnalysisStatusQueryKey(),
    queryFn: () => apiGet<AnalysisStatus>(`${API_BASE}/sync/analysis-status`),
  });
}

/* ─── Komposisi Parlay ─── */
export interface ScoredCombination {
  legs: Array<{
    marketKey: string;
    fixtureId: number;
    league: string;
    date?: string | null;
    selection: { label: string; odds: number; evConservative: number; pFinal: number; family: string };
  }>;
  combinedOdds: number;
  pIndependent: number;
  pCorrelated: number;
  pDecision: number;
  evDecision: number;
  evPessimistic: number;
  breakEvenBias: number;
  marginPaid: number | null;
}

export interface ParlayComposition {
  best: ScoredCombination | null;
  alternatives: ScoredCombination[];
  eligible: number;
  rejected: Array<{ marketKey: string; fixtureId: number; reason: string }>;
  combinationsEvaluated: number;
  minLegs: number;
  maxLegs: number;
  ledgerRows?: number;
  generatedAt: string;
  notes: string[];
}

export const getGetParlayCompositionQueryKey = () => ["parlays/compose-preview"];
export function useGetParlayComposition() {
  return useQuery<ParlayComposition>({
    queryKey: getGetParlayCompositionQueryKey(),
    queryFn: () => apiGet<ParlayComposition>(`${API_BASE}/parlays/compose-preview`),
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

export const getPredictionBoardQueryKey = () => ["parlays/predictions"];
export function usePredictionBoard() {
  return useQuery<AIPredictionBoardItem[]>({
    queryKey: getPredictionBoardQueryKey(),
    queryFn: () => apiGet<AIPredictionBoardItem[]>(`${API_BASE}/parlays/predictions`),
    refetchInterval: 60_000,
  });
}

export interface ParlayActionInput {
  parlayIds: string[];
  stake?: number;
}

export function useVerifyParlays() {
  return useMutation<ParlayReadiness, Error, ParlayActionInput>({
    mutationFn: (input) => apiPost<ParlayReadiness>(`${API_BASE}/parlays/readiness`, input),
  });
}

export interface MergedParlayResponse {
  parlayId: string;
  legs: unknown[];
  combinedOdds: number;
  winProbability: number;
  expectedValue: number;
  avgConfidence: number;
  riskScore: number;
  riskLevel: "low" | "medium" | "high" | "very_high";
  rejected: Array<{ fixtureId: number; reason: string }>;
  readiness: ParlayReadiness;
  stake?: number;
  potentialReturn?: number;
  potentialProfit?: number;
}

export function useMergeParlays() {
  const queryClient = useQueryClient();
  return useMutation<MergedParlayResponse, Error, ParlayActionInput>({
    mutationFn: (input) => apiPost<MergedParlayResponse>(`${API_BASE}/parlays/merge`, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["supabase/parlays"] });
    },
  });
}

export function useCreateParlayFromPredictions() {
  const queryClient = useQueryClient();
  return useMutation<CreateParlayFromPredictionsResult, Error, {
    predictionIds: string[];
    manualLegs: ManualParlayLegInput[];
  }>({
    mutationFn: (input) => apiPost<CreateParlayFromPredictionsResult>(`${API_BASE}/parlays/from-predictions`, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["supabase/parlays"] });
      queryClient.invalidateQueries({ queryKey: getPredictionBoardQueryKey() });
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
    queryFn: () => apiGet<FixtureEvent[]>(`${API_BASE}/supabase/fixtures${buildQueryString(params)}`),
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
    queryFn: () => apiGet<FixtureEvent[]>(`${API_BASE}/odds/events${buildQueryString(params)}`),
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
    queryFn: () => apiGet<Record<string, unknown>[]>(`${API_BASE}/csv/teams${buildQueryString(params)}`),
  });
}

/* ─── Team Stats Health ─── */
export interface StatsLeagueHealth {
  slug: string;
  name: string;
  statsRows: number;
  teamsCovered: number;
  teamsComplete: number;
  teamsIncomplete: number;
  latestUpdatedAt: string | null;
  ageDays: number | null;
  status: "missing" | "stale" | "current";
}

export interface StatsParlayReminder {
  parlayId: string;
  parlayName: string;
  legsCount: number;
  createdAt: string;
  leagues: string[];
  missingLeagues: string[];
  staleLeagues: string[];
  needsUpdate: boolean;
}

export interface StatsHealth {
  scanDays: number;
  staleAfterDays: number;
  totalLeagues: number;
  coveredLeagues: number;
  missingLeagues: StatsLeagueHealth[];
  staleLeagues: StatsLeagueHealth[];
  leagues: StatsLeagueHealth[];
  parlayReminders: StatsParlayReminder[];
  checkedAt: string;
}

export const getStatsHealthQueryKey = () => ["stats/health"];
export function useGetStatsHealth() {
  return useQuery<StatsHealth>({
    queryKey: getStatsHealthQueryKey(),
    queryFn: () => apiGet<StatsHealth>(`${API_BASE}/stats/health`),
    refetchInterval: 60_000,
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
    queryFn: () => apiGet<Standing[]>(`${API_BASE}/supabase/standings${buildQueryString(params)}`),
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

export interface ManualPredictionResultInput {
  predictionId: string;
  homeScore: number;
  awayScore: number;
  homeScoreHT?: number;
  awayScoreHT?: number;
}

export interface ManualPredictionResultResponse {
  predictionId: string;
  fixtureId: number;
  scoreSaved: boolean;
  settled: boolean;
  learningIncluded: boolean;
  result?: "WIN" | "LOSS" | "HALF_WIN" | "HALF_LOSS" | "PUSH";
  status?: string;
  homeScore?: number;
  awayScore?: number;
  settledAt?: string | null;
  message?: string;
  settlement?: { settled: number; lessons: number; skipped: number };
}

export function useRecordManualPredictionResult() {
  const queryClient = useQueryClient();
  return useMutation<ManualPredictionResultResponse, Error, ManualPredictionResultInput>({
    mutationFn: ({ predictionId, ...scores }) =>
      apiPost<ManualPredictionResultResponse>(
        `${API_BASE}/parlays/predictions/${encodeURIComponent(predictionId)}/manual-result`,
        scores,
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: getPredictionBoardQueryKey() });
      queryClient.invalidateQueries({ queryKey: getLearningSummaryQueryKey() });
      queryClient.invalidateQueries({ queryKey: ["health"] });
    },
  });
}

/* ─── AI Analysis ─── */
export interface AIAnalysisResult {
  fixture_id: string;
  home_team?: string;
  away_team?: string;
  prediction_text: string;
  created_at: string;
  revalidation_status?: "keep" | "review" | "invalidated" | null;
  revalidation_note?: string | null;
  last_revalidated_at?: string | null;
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

export interface LearningMarketBreakdown {
  market: string;
  family: string;
  sampleSize: number;
  wins: number;
  losses: number;
  halfWins: number;
  halfLosses: number;
  pushes: number;
  hitRate: number | null;
  averageEv: number | null;
  averageOdds: number | null;
  roiPercent: number | null;
  roiSamples: number;
}

export interface LearningSummary {
  generatedAt: string;
  dataQuality: {
    status: "usable" | "early_signal" | "insufficient";
    sampleSize: number;
    minimumRecommendedSample: number;
    explanation: string;
  };
  totals: {
    settled: number;
    decisive: number;
    wins: number;
    losses: number;
    halfWins: number;
    halfLosses: number;
    pushes: number;
    noBetExcluded: number;
    unknownOutcomes: number;
    hitRate: number | null;
    averageEv: number | null;
    roiPercent: number | null;
    roiSamples: number;
  };
  recommendedMarket: (LearningMarketBreakdown & { reason: string }) | null;
  marketBreakdown: LearningMarketBreakdown[];
  recentLessons: Array<{
    fixtureId: number;
    homeTeam: string;
    awayTeam: string;
    league: string;
    market: string;
    outcome: "WIN" | "LOSS" | "HALF_WIN" | "HALF_LOSS" | "PUSH";
    odds: number | null;
    ev: number | null;
    lessonText: string;
    createdAt: string | null;
  }>;
  learningRules: string[];
}

export const getLearningSummaryQueryKey = () => ["learning/summary"];
export function useGetLearningSummary() {
  return useQuery<LearningSummary>({
    queryKey: getLearningSummaryQueryKey(),
    queryFn: () => apiGet<LearningSummary>(`${API_BASE}/learning/summary`),
    refetchInterval: 60_000,
  });
}

export interface LearningPolicyView {
  minConfidence: number;
  minEvPercent: number;
  excludedMarketFamilies: string[];
}

export interface LearningLoopProposalView {
  id: string;
  title: string;
  rationale: string;
  status: "draft" | "backtested" | "approved" | "rejected" | "insufficient_data";
  evidence_summary: Record<string, unknown>;
  gemini_confidence: number;
  confidence_rationale: string;
  training_sample_size: number;
  validation_sample_size: number;
  candidate_policy: LearningPolicyView;
  training_metrics: Record<string, unknown>;
  backtest: {
    eligible?: boolean;
    baseline?: Record<string, unknown>;
    candidate?: Record<string, unknown>;
    validationSamples?: number;
    [key: string]: unknown;
  } | null;
  provider: string | null;
  model: string | null;
  created_at: string;
  candidate_version_id: string | null;
}

export interface LearningLoopVersionView {
  id: string;
  version_number: number;
  policy: LearningPolicyView;
  is_active: boolean;
  rollback_eligible: boolean;
  created_at: string;
  activated_at: string | null;
}

export interface LearningLoopState {
  activeVersion: {
    id: string | null;
    versionNumber: number | null;
    policy: LearningPolicyView;
  };
  evaluations: {
    total: number;
    pendingClassification: number;
    classified: number;
    auditEligible: number;
    auditExcluded: number;
    settledPredictionsAvailable: number;
    notImported: number;
  };
  automation: {
    enabled: boolean;
    confidenceThreshold: number;
    lastRun: {
      status: string;
      started_at: string;
      finished_at: string | null;
      summary: Record<string, unknown>;
      error: string | null;
      attempt_count: number;
    } | null;
  };
  proposals: LearningLoopProposalView[];
  versions: LearningLoopVersionView[];
  events: Array<{
    id: string;
    action: "promote" | "auto_promote" | "rollback";
    from_version_id: string | null;
    to_version_id: string;
    created_at: string;
  }>;
}

export const getLearningLoopStateQueryKey = () => ["learning/optimizer"];
export function useGetLearningLoopState(enabled = true) {
  return useQuery<LearningLoopState>({
    queryKey: getLearningLoopStateQueryKey(),
    queryFn: () => apiAdminGet<LearningLoopState>(`${API_BASE}/learning/optimizer`),
    refetchInterval: 30_000,
    enabled,
    retry: false,
  });
}

export function useLearningLoopAction() {
  const queryClient = useQueryClient();
  return useMutation<unknown, Error, { path: string; body?: unknown }>({
    mutationFn: ({ path, body }) => apiPost<unknown>(`${API_BASE}${path}`, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: getLearningLoopStateQueryKey() }),
  });
}

export const getRiskCenterQueryKey = () => ["risk-center"];
export function useGetRiskCenter() {
  return useQuery<RiskCenterResponse>({
    queryKey: getRiskCenterQueryKey(),
    queryFn: () => apiGet<RiskCenterResponse>(`${API_BASE}/risk-center`),
    refetchInterval: 60_000,
  });
}

/**
 * POST /analyze/:fixtureId is admin-only because it spends Gemini quota and
 * writes a new ai_predictions row, so it must send the admin password.
 */
export function useRunAIAnalysis() {
  const queryClient = useQueryClient();
  return useMutation<AIAnalysisResult, Error, { fixtureId: string | number; adminPassword?: string }>({
    mutationFn: async ({ fixtureId, adminPassword }) => {
      const password = adminPassword ?? getAdminPassword();
      const res = await fetch(`${API_BASE}/analyze/${fixtureId}`, {
        method: "POST",
        headers: password ? { "x-admin-password": password } : undefined,
      });
      handleUnauthorized(res);
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error ?? `API ${res.status}`);
      return json as AIAnalysisResult;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: getAIPredictionQueryKey(variables.fixtureId) });
    },
  });
}
