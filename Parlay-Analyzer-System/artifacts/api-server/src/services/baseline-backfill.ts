import { supabase } from "../lib/supabase-client";
import { logger } from "../lib/logger";
import { marketKey } from "./revalidation";

type PredictionRow = {
  id: string;
  fixture_id: number;
  market_bet: string | null;
  best_market: string | null;
  best_odds: number | null;
  created_at: string | null;
};

type MovementRow = {
  fixture_id: string;
  bookmaker?: string | null;
  market_type: string;
  home_odds?: number | null;
  away_odds?: number | null;
  draw_odds?: number | null;
  over_odds?: number | null;
  under_odds?: number | null;
  btts_yes?: number | null;
  btts_no?: number | null;
  captured_at: string;
};

export interface BaselineBackfillSummary {
  scanned: number;
  backfilled: number;
  skippedNoMarket: number;
  skippedNoHistoricalOdds: number;
  dryRun: boolean;
}

function movementPrice(marketBet: string | null, row: MovementRow): number | null {
  const type = marketKey(marketBet).type;
  const market = row.market_type.toLowerCase();
  if (type === "unknown") return null;
  if ((type === "home" || type === "away" || type === "draw") &&
      !["h2h", "1x2", "ml", "match_winner"].some((key) => market.includes(key))) return null;
  if ((type === "over" || type === "under") && !market.includes("over") && !market.includes("total") && !market.includes("ou")) return null;
  if ((type === "btts_yes" || type === "btts_no") && !market.includes("btts") && !market.includes("both")) return null;

  const value =
    type === "home" ? row.home_odds :
    type === "away" ? row.away_odds :
    type === "draw" ? row.draw_odds :
    type === "over" ? row.over_odds :
    type === "under" ? row.under_odds :
    type === "btts_yes" ? row.btts_yes :
    type === "btts_no" ? row.btts_no :
    null;
  return Number(value) > 1 ? Number(value) : null;
}

function selectBaseline(marketBet: string | null, createdAt: string | null, rows: MovementRow[]) {
  if (!marketBet || !createdAt) return null;
  const analysisTime = new Date(createdAt).getTime();
  if (!Number.isFinite(analysisTime)) return null;

  // Use each bookmaker's latest snapshot at or before analysis time, then take
  // the best price. Never use a future snapshot as a fabricated baseline.
  const latest = new Map<string, MovementRow>();
  for (const row of rows) {
    const captured = new Date(row.captured_at).getTime();
    if (!Number.isFinite(captured) || captured > analysisTime) continue;
    const key = `${String(row.bookmaker ?? "")}::${row.market_type.toLowerCase()}`;
    const previous = latest.get(key);
    if (!previous || captured > new Date(previous.captured_at).getTime()) latest.set(key, row);
  }

  let selected: { odds: number; capturedAt: string; bookmaker: string } | null = null;
  for (const row of latest.values()) {
    const odds = movementPrice(marketBet, row);
    if (odds == null) continue;
    if (!selected || odds > selected.odds) {
      selected = {
        odds,
        capturedAt: row.captured_at,
        bookmaker: String(row.bookmaker ?? "unknown"),
      };
    }
  }
  return selected;
}

export async function runBaselineBackfill(options: {
  dryRun?: boolean;
  limit?: number;
} = {}): Promise<BaselineBackfillSummary> {
  const dryRun = options.dryRun ?? false;
  const limit = Math.max(1, Math.min(500, options.limit ?? 500));
  const summary: BaselineBackfillSummary = {
    scanned: 0,
    backfilled: 0,
    skippedNoMarket: 0,
    skippedNoHistoricalOdds: 0,
    dryRun,
  };

  const { data: predictions, error } = await supabase
    .from("ai_predictions")
    .select("id, fixture_id, market_bet, best_market, best_odds, created_at")
    .eq("status", "active")
    .is("best_odds", null)
    .limit(limit);
  if (error) {
    logger.error({ error }, "[BASELINE-BACKFILL] Failed to load legacy predictions");
    throw error;
  }

  const rows = (predictions ?? []) as PredictionRow[];
  summary.scanned = rows.length;
  if (rows.length === 0) return summary;

  const { data: movementRows, error: movementError } = await supabase
    .from("odds_movement_history")
    .select("fixture_id, bookmaker, market_type, home_odds, away_odds, draw_odds, over_odds, under_odds, btts_yes, btts_no, captured_at")
    .in("fixture_id", rows.map((row) => String(row.fixture_id)))
    .order("captured_at", { ascending: false })
    .limit(10000);
  if (movementError) {
    logger.error({ movementError }, "[BASELINE-BACKFILL] Failed to load movement history");
    throw movementError;
  }

  const byFixture = new Map<string, MovementRow[]>();
  for (const row of (movementRows ?? []) as MovementRow[]) {
    const list = byFixture.get(String(row.fixture_id)) ?? [];
    list.push(row);
    byFixture.set(String(row.fixture_id), list);
  }

  for (const prediction of rows) {
    const marketBet = prediction.market_bet ?? prediction.best_market;
    if (!marketBet || marketKey(marketBet).type === "unknown") {
      summary.skippedNoMarket++;
      continue;
    }
    const baseline = selectBaseline(marketBet, prediction.created_at, byFixture.get(String(prediction.fixture_id)) ?? []);
    if (!baseline) {
      summary.skippedNoHistoricalOdds++;
      continue;
    }
    if (!dryRun) {
      const { error: updateError } = await supabase
        .from("ai_predictions")
        .update({
          best_odds: baseline.odds,
          baseline_odds_source: `odds_movement_history:${baseline.bookmaker}`,
          baseline_odds_captured_at: baseline.capturedAt,
          updated_at: new Date().toISOString(),
        })
        .eq("id", prediction.id)
        .is("best_odds", null);
      if (updateError) {
        logger.warn({ updateError, predictionId: prediction.id }, "[BASELINE-BACKFILL] Failed to update prediction");
        continue;
      }
    }
    summary.backfilled++;
  }

  logger.info(summary, "[BASELINE-BACKFILL] Complete");
  return summary;
}