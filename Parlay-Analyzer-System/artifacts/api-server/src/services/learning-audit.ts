/*
 * Odds freshness window. Was 3h, but the production cadence makes that
 * structurally unattainable: analysis runs every 6h (cron analyze) and the
 * hourly per-league sync rotates fixtures, so the snapshot an analysis
 * actually used is routinely ±4h old at analysis time (observed 4.3h gaps
 * on 23–25 Nov 2026 evaluations). A 3h gate therefore excluded most
 * honest samples from learning without improving decision quality.
 * 8h covers one full analyze cadence plus sync rotation, while still
 * rejecting odds captured long before the decision was made.
 */
const MAX_VERIFIED_ODDS_AGE_MS = 8 * 60 * 60 * 1000;
const MAX_ANALYSIS_CLOCK_SKEW_MS = 5 * 60 * 1000;
const MAX_SETTLEMENT_SOURCE_AGE_MS = 24 * 60 * 60 * 1000;

type JsonRecord = Record<string, unknown>;

export interface LearningAuditInput {
  inputSnapshot: unknown;
  analysisAt: string | null;
  settledAt: string | null;
  settlementSource: string | null;
  settlementVerified: boolean;
  settlementVerifiedAt: string | null;
}

export interface LearningAuditResult {
  eligible: boolean;
  reasons: string[];
}

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

function timestamp(value: unknown): number | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function hasProvider(value: unknown, expected: string): boolean {
  return typeof value === "string" && value.trim().toLowerCase() === expected.toLowerCase();
}

export function assessLearningAudit(input: LearningAuditInput): LearningAuditResult {
  const reasons = new Set<string>();
  const snapshot = record(input.inputSnapshot);
  const analysis = record(snapshot.analysis);
  const source = record(snapshot.input);
  const odds = record(source.odds);
  const teamStats = record(source.teamStats);
  const dataQuality = record(snapshot.dataQuality);
  const qualityStats = record(dataQuality.stats);
  const freshness = record(dataQuality.statsFreshness);
  const oddsQuality = record(dataQuality.odds);

  if (snapshot.schemaVersion !== 2) reasons.add("analysis_snapshot_not_versioned");

  const analyzedAt = timestamp(analysis.analyzedAt);
  const rowAnalysisAt = timestamp(input.analysisAt);
  if (!analysis.provider || !analysis.model || analyzedAt === null) {
    reasons.add("analysis_source_or_time_missing");
  }
  if (analyzedAt === null || rowAnalysisAt === null ||
      Math.abs(analyzedAt - rowAnalysisAt) > MAX_ANALYSIS_CLOCK_SKEW_MS) {
    reasons.add("analysis_time_mismatch");
  }

  if (!hasProvider(odds.provider, "Odds-API")) reasons.add("odds_provider_missing");
  if (odds.selectedMarketVerified !== true || oddsQuality.verifiedMarket !== true) {
    reasons.add("selected_market_not_verified");
  }
  if (!Array.isArray(odds.snapshot) || odds.snapshot.length === 0) {
    reasons.add("odds_source_snapshot_missing");
  }
  const oddsCapturedAt = timestamp(
    odds.selectedMarketCapturedAt ?? odds.capturedAt ?? oddsQuality.selectedMarketCapturedAt ?? oddsQuality.capturedAt,
  );
  if (oddsCapturedAt === null || analyzedAt === null) {
    reasons.add("odds_capture_time_missing");
  } else {
    const age = analyzedAt - oddsCapturedAt;
    if (age < -MAX_ANALYSIS_CLOCK_SKEW_MS || age > MAX_VERIFIED_ODDS_AGE_MS) {
      reasons.add("odds_snapshot_stale_at_analysis");
    }
  }

  if (!hasProvider(teamStats.storageProvider, "Supabase")) {
    reasons.add("team_stats_storage_source_missing");
  }
  const homeStats = record(qualityStats.home);
  const awayStats = record(qualityStats.away);
  if (homeStats.valid !== true || awayStats.valid !== true) {
    reasons.add("team_stats_incomplete_or_invalid");
  }
  const homeFreshness = record(freshness.home);
  const awayFreshness = record(freshness.away);
  if (homeFreshness.valid !== true || awayFreshness.valid !== true) {
    reasons.add("team_stats_stale_or_unverified");
  }
  if (!homeFreshness.source || timestamp(homeFreshness.updatedAt) === null ||
      !awayFreshness.source || timestamp(awayFreshness.updatedAt) === null) {
    reasons.add("team_stats_source_or_time_missing");
  }

  if (input.settlementSource !== "odds_api_historical" || input.settlementVerified !== true) {
    reasons.add("settlement_result_not_provider_verified");
  }
  const verifiedAt = timestamp(input.settlementVerifiedAt);
  const settledAt = timestamp(input.settledAt);
  if (verifiedAt === null || settledAt === null) {
    reasons.add("settlement_source_time_missing");
  } else {
    /*
     * Verification may legitimately happen AFTER settlement: the repair
     * path re-confirms a recorded score against the provider feed and, if
     * the provider score matches exactly, restores verification. What must
     * be rejected is a result "verified" long BEFORE it was settled
     * (stale source reused as if fresh), not post-hoc confirmation.
     */
    const sourceAge = settledAt - verifiedAt;
    if (sourceAge > MAX_SETTLEMENT_SOURCE_AGE_MS) {
      reasons.add("settlement_source_time_mismatch");
    }
  }

  const reasonList = [...reasons];
  return { eligible: reasonList.length === 0, reasons: reasonList };
}
