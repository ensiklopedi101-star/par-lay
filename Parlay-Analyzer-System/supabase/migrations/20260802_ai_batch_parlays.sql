-- Structured prediction-to-parlay link for automatic batch parlays.
ALTER TABLE public.parlay_legs
  ADD COLUMN IF NOT EXISTS prediction_id uuid NULL;

CREATE INDEX IF NOT EXISTS idx_parlay_legs_prediction_id
  ON public.parlay_legs(prediction_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_parlay_legs_prediction'
  ) THEN
    ALTER TABLE public.parlay_legs
      ADD CONSTRAINT fk_parlay_legs_prediction
      FOREIGN KEY (prediction_id) REFERENCES public.ai_predictions(id)
      ON DELETE SET NULL;
  END IF;
END $$;