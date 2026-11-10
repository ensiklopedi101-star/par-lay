/**
 * Shadow logging for the deterministic quant engine.
 *
 * What this does NOT do: change any bet, stake, or prediction. The LLM path
 * stays authoritative until the ledger proves the engine is better calibrated.
 *
 * What it DOES: run the engine alongside the LLM for the same fixture and write
 * every priced market to `prediction_selections`. Because the row is written
 * before kick-off and before the result is known, it is a clean out-of-sample
 * record — the only kind that can honestly answer "does this model beat the
 * market?".
 *
 * Failure policy: shadow logging must never break a scan. Every error is
 * swallowed and logged at warn level.
 */

import { supabase } from "../lib/supabase-client";
import { logger } from "../lib/logger";
import { runQuantEngine, type QuantEngineResult, type StructuredOddsInput, type TeamStatsRow } from "../lib/quant/adapter";
import { sanitizeLlmAdjustment } from "../lib/quant/strength";

/** Engine rows are tagged with version 2; the LLM path is version 1. */
export const QUANT_MODEL_VERSION = 2;

export interface ShadowLogInput {
  fixtureId: number | string;
  homeTeam: string;
  awayTeam: string;
  leagueSlug: string;
  structuredOdds: StructuredOddsInput;
  /** Raw LLM news output; sanitised into a ±12% λ adjustment or dropped. */
  llmAdjustment?: unknown;
  /** Marks the selection the engine would actually have staked. */
  betMarketKey?: string | null;
}

export interface ShadowLogResult {
  logged: number;
  usable: boolean;
  warnings: string[];
  analysis: QuantEngineResult["analysis"];
}

/**
 * Load the league slice used for both the league averages and each team's
 * rates. Kept separate so callers can reuse one download per scan.
 */
export async function loadLeagueStats(
  leagueSlug: string,
  season: string,
): Promise<TeamStatsRow[]> {
  const { data, error } = await supabase
    .from("team_season_stats")
    .select("team_name, league_slug, season, stats_goals_scored, stats_goals_conceded, stats_xg")
    .eq("league_slug", leagueSlug)
    .eq("season", season)
    .limit(500);

  if (error) {
    logger.warn({ error, leagueSlug, season }, "[QUANT-SHADOW] gagal memuat statistik liga");
    return [];
  }
  return (data ?? []) as TeamStatsRow[];
}

/**
 * Run the engine for one fixture and persist every selection it priced.
 * Returns the analysis even when nothing was written, so callers can surface
 * the warnings in logs.
 */
export async function shadowLogQuantAnalysis(input: ShadowLogInput): Promise<ShadowLogResult> {
  try {
    const leagueRows = await loadLeagueStats(input.leagueSlug, currentSeason());
    if (leagueRows.length === 0) {
      return { logged: 0, usable: false, warnings: ["statistik liga kosong"], analysis: null };
    }

    const adjustment = input.llmAdjustment
      ? sanitizeLlmAdjustment(input.llmAdjustment)
      : null;

    const result = runQuantEngine({
      homeTeam: input.homeTeam,
      awayTeam: input.awayTeam,
      leagueRows,
      structuredOdds: input.structuredOdds,
      adjustment,
    });

    if (!result.usable || !result.analysis) {
      logger.debug(
        { fixtureId: input.fixtureId, warnings: result.warnings },
        "[QUANT-SHADOW] fixture ditolak, tidak ada yang dicatat",
      );
      return { logged: 0, usable: false, warnings: result.warnings, analysis: null };
    }

    const analysedAt = new Date().toISOString();
    const rows = result.analysis.selections.map((s) => ({
      fixture_id: String(input.fixtureId),
      analysed_at: analysedAt,
      model_version: QUANT_MODEL_VERSION,
      market_key: s.key,
      family: s.family,
      line: s.line,
      odds: s.odds,
      p_final: s.pFinal,
      p_market_fair: s.pMarket,
      p_model_only: s.pModelOnly,
      ev: s.ev,
      ev_conservative: s.evConservative,
      was_bet: input.betMarketKey != null && input.betMarketKey === s.key,
      bookmaker: result.bookmaker,
    }));

    const { error } = await supabase
      .from("prediction_selections")
      .upsert(rows, { onConflict: "fixture_id,model_version,market_key" });

    if (error) {
      /* Most likely the migration has not been applied yet. Degrade quietly. */
      logger.warn(
        { error, fixtureId: input.fixtureId },
        "[QUANT-SHADOW] gagal menulis prediction_selections (migrasi belum diterapkan?)",
      );
      return { logged: 0, usable: true, warnings: [...result.warnings, error.message], analysis: result.analysis };
    }

    logger.info(
      {
        fixtureId: input.fixtureId,
        selections: rows.length,
        decision: result.analysis.decision,
        modelWeight: result.analysis.modelWeight,
        overround: result.analysis.devig1x2.overround,
      },
      "[QUANT-SHADOW] selections dicatat",
    );

    return { logged: rows.length, usable: true, warnings: result.warnings, analysis: result.analysis };
  } catch (err) {
    logger.warn({ err, fixtureId: input.fixtureId }, "[QUANT-SHADOW] gagal total");
    return { logged: 0, usable: false, warnings: [err instanceof Error ? err.message : String(err)], analysis: null };
  }
}

/**
 * Season key matching `team_season_stats.season` ("2026-27"). European seasons
 * turn over mid-year, so July onward belongs to the next season.
 */
export function currentSeason(now = new Date()): string {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth(); // 0-indexed: 6 = July
  const start = month >= 6 ? year : year - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}
