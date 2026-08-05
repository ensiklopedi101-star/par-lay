import { logger } from "../lib/logger";
import { supabase } from "../lib/supabase-client";
import { latestOddsByMarket } from "./odds-history";
import {
  analyzeFixture,
  type OddsRow,
  type AnalysisResult,
} from "./ai-analysis";
import type { RevalidationCandidate, RevalidationSummary } from "./revalidation";

export type ReanalysisTrigger = "odds_drift" | "ev_deterioration" | "final_window" | "pre_bet_refresh";

export interface ReanalysisSummary {
  considered: number;
  analyzed: number;
  skippedCooldown: number;
  skippedNoOdds: number;
  failed: number;
  maxPerRun: number;
  revisions: string[];
}

const COOLDOWN_HOURS = 12;
const DEFAULT_MAX_PER_RUN = 5;

function normalizeTeamName(value: string): string {
  return value
    .toLowerCase()
    .replace(/\b(fc|cf|sc|afc)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

async function loadOddsRows(candidate: RevalidationCandidate): Promise<OddsRow[]> {
  const fields = "match_id, home_team, away_team, bookmaker, market_type, odds_1, odds_2, odds_draw, captured_at";
  const direct = await supabase
    .from("odds_history")
    .select(fields)
    .eq("match_id", String(candidate.fixtureId))
    .order("captured_at", { ascending: false })
    .limit(60);
  if (direct.data?.length) return latestOddsByMarket(direct.data as OddsRow[]);

  const fallback = await supabase
    .from("odds_history")
    .select(fields)
    .eq("home_team", candidate.homeTeam)
    .eq("away_team", candidate.awayTeam)
    .order("captured_at", { ascending: false })
    .limit(60);
  if (fallback.data?.length) return latestOddsByMarket(fallback.data as OddsRow[]);

  // Provider names sometimes carry FC/SC suffixes. A bounded read gives the
  // service one last safe matching opportunity without guessing by odds alone.
  const broad = await supabase
    .from("odds_history")
    .select(fields)
    .limit(5000);
  return latestOddsByMarket(((broad.data ?? []) as Array<OddsRow & { home_team?: string; away_team?: string }>).filter((row) =>
    normalizeTeamName(String(row.home_team ?? "")) === normalizeTeamName(candidate.homeTeam) &&
    normalizeTeamName(String(row.away_team ?? "")) === normalizeTeamName(candidate.awayTeam),
  )).slice(0, 60);
}

function isTrigger(candidate: RevalidationCandidate): candidate is RevalidationCandidate & { trigger: ReanalysisTrigger } {
  return candidate.trigger === "odds_drift" ||
    candidate.trigger === "ev_deterioration" ||
    candidate.trigger === "final_window";
}

async function hasRecentRevision(predictionId: string, now: number): Promise<boolean> {
  const cutoff = new Date(now - COOLDOWN_HOURS * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from("ai_prediction_revisions")
    .select("id")
    .eq("prediction_id", predictionId)
    .gte("created_at", cutoff)
    .limit(1);
  if (error) {
    // If the migration is not live yet, fail closed: never spend AI quota.
    logger.warn({ error, predictionId }, "[REANALYSIS] Revision lookup failed; skipping for safety");
    return true;
  }
  return Boolean(data?.length);
}

export async function runTriggeredReanalysis(
  candidates: RevalidationCandidate[],
  options: { maxPerRun?: number; force?: boolean; predictionIds?: string[] } = {},
): Promise<ReanalysisSummary> {
  const maxPerRun = Math.max(1, Math.min(20, options.maxPerRun ?? DEFAULT_MAX_PER_RUN));
  const summary: ReanalysisSummary = {
    considered: 0,
    analyzed: 0,
    skippedCooldown: 0,
    skippedNoOdds: 0,
    failed: 0,
    maxPerRun,
    revisions: [],
  };

  const targetIds = options.predictionIds ? new Set(options.predictionIds) : null;
  const triggered = candidates
    .filter((candidate) => !targetIds || targetIds.has(candidate.predictionId))
    .filter((candidate) => options.force || isTrigger(candidate))
    .filter((candidate) => options.force || candidate.status !== "keep");
  summary.considered = triggered.length;
  let analyzedThisRun = 0;

  for (const candidate of triggered) {
    if (analyzedThisRun >= maxPerRun) break;
    if (await hasRecentRevision(candidate.predictionId, Date.now())) {
      summary.skippedCooldown++;
      continue;
    }

    const oddsRows = await loadOddsRows(candidate);
    if (oddsRows.length === 0) {
      summary.skippedNoOdds++;
      continue;
    }

    try {
      const triggerType: ReanalysisTrigger = isTrigger(candidate) ? candidate.trigger : "pre_bet_refresh";
      const result: AnalysisResult = await analyzeFixture(String(candidate.fixtureId), {
        skipExistingPredictionCheck: true,
        persistPrediction: false,
        fixture: {
          home_team_name: candidate.homeTeam,
          away_team_name: candidate.awayTeam,
          league_name: candidate.leagueName,
        },
        oddsRows,
      });

      const { data: revision, error } = await supabase
        .from("ai_prediction_revisions")
        .insert({
          prediction_id: candidate.predictionId,
          fixture_id: candidate.fixtureId,
          trigger_type: triggerType,
          trigger_reason: candidate.triggerReason,
          trigger_context: {
            oddsDelta: candidate.oddsDelta,
            analysisOdds: candidate.analysisOdds,
            currentOdds: candidate.currentOdds,
            evAtAnalysis: candidate.evAtAnalysis,
            currentEV: candidate.currentEV,
            evDrop: candidate.evDrop,
          },
          prediction_text: result.prediction_text,
          market_bet: result.market_bet ?? null,
          best_odds: result.odds && result.odds > 1 ? result.odds : null,
          ev_at_analysis: result.ev_at_analysis ?? null,
          confidence_score: result.confidence ?? null,
          provider: result.provider ?? null,
          model_version: result.model ?? null,
          status: "completed",
        })
        .select("id")
        .single();

      if (error) throw error;
      analyzedThisRun++;
      summary.analyzed++;
      if (revision?.id) summary.revisions.push(String(revision.id));
    } catch (error) {
      summary.failed++;
      logger.error({ error, predictionId: candidate.predictionId, fixtureId: candidate.fixtureId }, "[REANALYSIS] Triggered analysis failed");
      await supabase.from("ai_prediction_revisions").insert({
        prediction_id: candidate.predictionId,
        fixture_id: candidate.fixtureId,
        trigger_type: isTrigger(candidate) ? candidate.trigger : "pre_bet_refresh",
        trigger_reason: candidate.triggerReason,
        trigger_context: {
          oddsDelta: candidate.oddsDelta,
          analysisOdds: candidate.analysisOdds,
          currentOdds: candidate.currentOdds,
          evAtAnalysis: candidate.evAtAnalysis,
          currentEV: candidate.currentEV,
          evDrop: candidate.evDrop,
        },
        status: "failed",
        error_message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  logger.info(summary, "[REANALYSIS] Complete");
  return summary;
}

export async function runRevalidationAndTriggeredReanalysis(options: {
  maxPerRun?: number;
  force?: boolean;
  predictionIds?: string[];
} = {}): Promise<{ revalidation: RevalidationSummary; reanalysis: ReanalysisSummary }> {
  const { runRevalidation } = await import("./revalidation");
  const revalidation = await runRevalidation();
  const reanalysis = await runTriggeredReanalysis(revalidation.candidates ?? [], options);
  return { revalidation, reanalysis };
}