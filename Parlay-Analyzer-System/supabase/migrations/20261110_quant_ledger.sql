-- Quant ledger: shadow logging of every priced selection.
--
-- Purpose: let the deterministic engine (src/lib/quant) record what it WOULD
-- have bet, and at what probability, without changing any real decision. After
-- a few weeks the rows answer the only question that matters — is the engine
-- better calibrated than the market? — using data that was recorded before the
-- result was known.
--
-- Safe to re-run. All new columns are nullable so the existing writer keeps
-- working untouched.

-- ── 1. Probability provenance on ai_predictions ────────────────────────────
-- The engine separates three numbers that used to be one LLM guess:
--   p_market_fair : de-vigged market probability (the benchmark)
--   p_model_only  : what the team-statistics model says, market removed
--   p_final       : the blend actually used for sizing
-- Keeping all three makes calibration and fitBlendWeight auditable later.
ALTER TABLE public.ai_predictions
  ADD COLUMN IF NOT EXISTS p_market_fair   double precision,
  ADD COLUMN IF NOT EXISTS p_model_only    double precision,
  ADD COLUMN IF NOT EXISTS p_final         double precision,
  ADD COLUMN IF NOT EXISTS odds_close      double precision,
  ADD COLUMN IF NOT EXISTS close_fair_prob double precision,
  ADD COLUMN IF NOT EXISTS model_version   integer NOT NULL DEFAULT 1;

COMMENT ON COLUMN public.ai_predictions.model_version IS
  '1 = LLM writes probability (legacy). 2 = deterministic quant engine.';

-- ── 2. Shadow log: every selection the engine priced ───────────────────────
CREATE TABLE IF NOT EXISTS public.prediction_selections (
  id              bigserial PRIMARY KEY,
  fixture_id      text NOT NULL,
  analysed_at     timestamptz NOT NULL DEFAULT now(),
  model_version   integer NOT NULL DEFAULT 2,
  market_key      text NOT NULL,          -- 'ML:home', 'TOT:over:2.5', 'AH:home:-0.5'
  family          text NOT NULL,          -- ML | Totals | AH | BTTS
  line            double precision,
  odds            double precision NOT NULL,
  p_final         double precision NOT NULL,
  p_market_fair   double precision,
  p_model_only    double precision,
  ev              double precision,
  ev_conservative double precision,
  odds_close      double precision,
  close_fair_prob double precision,
  outcome         text,                   -- win|half_win|push|half_loss|loss|void
  was_bet         boolean NOT NULL DEFAULT false,
  bookmaker       text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (fixture_id, model_version, market_key)
);

CREATE INDEX IF NOT EXISTS prediction_selections_fixture_idx
  ON public.prediction_selections (fixture_id);
CREATE INDEX IF NOT EXISTS prediction_selections_unsettled_idx
  ON public.prediction_selections (analysed_at DESC)
  WHERE outcome IS NULL;

COMMENT ON TABLE public.prediction_selections IS
  'Shadow log: every market the quant engine priced, not just the chosen bet.';
COMMENT ON COLUMN public.prediction_selections.was_bet IS
  'True only for the selection the engine would have staked.';

-- ── 3. Canonical team identity ─────────────────────────────────────────────
-- team_season_stats currently holds the same club under two spellings with
-- different numbers ("Espanyol" vs "Espanyol Barcelona"), and some rows are
-- filed under the wrong league entirely. These tables are the target for a
-- later cleanup; the adapter reconciles names defensively in the meantime.
CREATE TABLE IF NOT EXISTS public.teams (
  id          bigserial PRIMARY KEY,
  league_slug text NOT NULL,
  canonical   text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (league_slug, canonical)
);

CREATE TABLE IF NOT EXISTS public.team_aliases (
  provider  text NOT NULL,
  alias     text NOT NULL,
  team_id   bigint NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, alias)
);

-- Only the service role touches these; the anon key has no business here.
ALTER TABLE public.prediction_selections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_aliases ENABLE ROW LEVEL SECURITY;

-- Verify after applying:
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'prediction_selections' ORDER BY ordinal_position;
