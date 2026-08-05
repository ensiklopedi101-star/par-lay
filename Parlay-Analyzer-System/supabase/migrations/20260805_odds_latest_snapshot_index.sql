-- Runtime odds reads select the newest snapshot per provider/bookmaker/market.
-- Keep all historical rows; odds_movement_history remains the append-only
-- market movement log and odds_history remains available for audit/backfill.

CREATE INDEX IF NOT EXISTS idx_odds_history_latest_snapshot
  ON public.odds_history(match_id, bookmaker, market_type, captured_at DESC);