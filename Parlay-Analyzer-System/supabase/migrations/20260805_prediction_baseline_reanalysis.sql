-- Safe odds provenance for legacy predictions and immutable AI re-analysis revisions.
ALTER TABLE public.ai_predictions
  ADD COLUMN IF NOT EXISTS baseline_odds_source text,
  ADD COLUMN IF NOT EXISTS baseline_odds_captured_at timestamptz;

CREATE TABLE IF NOT EXISTS public.ai_prediction_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prediction_id uuid NOT NULL REFERENCES public.ai_predictions(id) ON DELETE CASCADE,
  fixture_id integer NOT NULL,
  trigger_type text NOT NULL,
  trigger_reason text NOT NULL,
  trigger_context jsonb NOT NULL DEFAULT '{}'::jsonb,
  prediction_text text,
  market_bet text,
  best_odds numeric,
  ev_at_analysis numeric,
  confidence_score numeric,
  provider text,
  model_version text,
  status text NOT NULL DEFAULT 'completed',
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_prediction_revisions_prediction
  ON public.ai_prediction_revisions(prediction_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_prediction_revisions_fixture
  ON public.ai_prediction_revisions(fixture_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_prediction_revisions_trigger
  ON public.ai_prediction_revisions(trigger_type, created_at DESC);