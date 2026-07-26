-- Migration: indexes + foreign keys untuk Parlay Analyzer System
-- Terapkan via Supabase SQL Editor atau Management API (memerlukan SUPABASE_ACCESS_TOKEN).
-- Service role key saja TIDAK cukup untuk DDL.

-- ═══════════════════════════════════════════════════════════════
-- INDEXES
-- ═══════════════════════════════════════════════════════════════

-- Fixtures: query berdasarkan tanggal, liga, dan status paling sering
CREATE INDEX IF NOT EXISTS idx_fixtures_fixture_date ON public.fixtures(fixture_date);
CREATE INDEX IF NOT EXISTS idx_fixtures_league_name ON public.fixtures(league_name);
CREATE INDEX IF NOT EXISTS idx_fixtures_status_short ON public.fixtures(status_short);
-- NOTE: fixtures.event_date tidak ada di schema saat ini; index dihapus.
-- CREATE INDEX IF NOT EXISTS idx_fixtures_event_date ON public.fixtures(event_date);

-- AI Predictions: lookup berdasarkan fixture, status, dan tanggal dibuat
CREATE INDEX IF NOT EXISTS idx_ai_predictions_fixture_id ON public.ai_predictions(fixture_id);
CREATE INDEX IF NOT EXISTS idx_ai_predictions_status ON public.ai_predictions(status);
CREATE INDEX IF NOT EXISTS idx_ai_predictions_created_at ON public.ai_predictions(created_at DESC);

-- Odds History: lookup per fixture/match + urutan waktu
CREATE INDEX IF NOT EXISTS idx_odds_history_match_id ON public.odds_history(match_id);
CREATE INDEX IF NOT EXISTS idx_odds_history_captured_at ON public.odds_history(captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_odds_history_bookmaker ON public.odds_history(bookmaker);

-- Odds Movement: lookup per fixture + urutan waktu
CREATE INDEX IF NOT EXISTS idx_odds_movement_fixture_id ON public.odds_movement_history(fixture_id);
CREATE INDEX IF NOT EXISTS idx_odds_movement_captured_at ON public.odds_movement_history(captured_at DESC);

-- Team Season Stats: natural key + pencarian tim
CREATE INDEX IF NOT EXISTS idx_team_season_stats_key ON public.team_season_stats(league_slug, season, team_name);
CREATE INDEX IF NOT EXISTS idx_team_season_stats_team_name ON public.team_season_stats(team_name);

-- Parlays
CREATE INDEX IF NOT EXISTS idx_parlays_status ON public.parlays(status);
CREATE INDEX IF NOT EXISTS idx_parlays_created_at ON public.parlays(created_at DESC);

-- Parlay Legs
CREATE INDEX IF NOT EXISTS idx_parlay_legs_parlay_id ON public.parlay_legs(parlay_id);
CREATE INDEX IF NOT EXISTS idx_parlay_legs_fixture_id ON public.parlay_legs(fixture_id);

-- Lessons Learned (RAG)
CREATE INDEX IF NOT EXISTS idx_lessons_learned_fixture_id ON public.lessons_learned(fixture_id);
CREATE INDEX IF NOT EXISTS idx_lessons_learned_created_at ON public.lessons_learned(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lessons_learned_league ON public.lessons_learned(league);

-- Performance Log
CREATE INDEX IF NOT EXISTS idx_performance_log_date ON public.performance_log(date);

-- Leagues
CREATE INDEX IF NOT EXISTS idx_leagues_is_active ON public.leagues(is_active);

-- ═══════════════════════════════════════════════════════════════
-- FOREIGN KEYS
-- ═══════════════════════════════════════════════════════════════
-- Perhatikan: FK memerlukan tipe data yang sama di kedua kolom.
-- Hanya tambahkan FK yang tipe kolomnya cocok dengan tabel referensi.

-- AI Predictions -> Fixtures (fixture_id INTEGER di kedua tabel)
ALTER TABLE public.ai_predictions
  DROP CONSTRAINT IF EXISTS ai_predictions_fixture_id_fkey,
  DROP CONSTRAINT IF EXISTS fk_ai_predictions_fixture,
  ADD CONSTRAINT fk_ai_predictions_fixture
  FOREIGN KEY (fixture_id) REFERENCES public.fixtures(fixture_id)
  ON DELETE CASCADE;

-- Parlay Legs -> Parlays (parlay_id di parlay_legs mereferensi id di parlays)
ALTER TABLE public.parlay_legs
  DROP CONSTRAINT IF EXISTS parlay_legs_parlay_id_fkey,
  DROP CONSTRAINT IF EXISTS fk_parlay_legs_parlay,
  ADD CONSTRAINT fk_parlay_legs_parlay
  FOREIGN KEY (parlay_id) REFERENCES public.parlays(id)
  ON DELETE CASCADE;

-- Parlay Legs -> Fixtures (fixture_id INTEGER di kedua tabel)
ALTER TABLE public.parlay_legs
  DROP CONSTRAINT IF EXISTS parlay_legs_fixture_id_fkey,
  DROP CONSTRAINT IF EXISTS fk_parlay_legs_fixture,
  ADD CONSTRAINT fk_parlay_legs_fixture
  FOREIGN KEY (fixture_id) REFERENCES public.fixtures(fixture_id)
  ON DELETE SET NULL;

-- NOTE: odds_history.match_id berisi ID acak dari provider odds (bukan fixture_id).
-- Tidak dibuat FK ke fixtures karena tipe dan referensi tidak cocok.
-- Hanya index di atas yang digunakan untuk performa query.

-- NOTE: odds_movement_history.fixture_id bertipe TEXT sedangkan fixtures.fixture_id
-- bertipe INTEGER. Sebelum FK bisa dibuat, kolom harus disamakan tipenya (ALTER COLUMN)
-- dan aplikasi harus disesuaikan. Saat ini hanya index yang dibuat.
