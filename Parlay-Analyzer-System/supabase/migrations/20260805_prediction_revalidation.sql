-- Preserve settlement status while adding a separate pre-kickoff risk signal.
ALTER TABLE public.ai_predictions
  ADD COLUMN IF NOT EXISTS revalidation_status text NOT NULL DEFAULT 'keep',
  ADD COLUMN IF NOT EXISTS revalidation_note text,
  ADD COLUMN IF NOT EXISTS last_revalidated_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_ai_predictions_revalidation
  ON public.ai_predictions(status, revalidation_status, last_revalidated_at);