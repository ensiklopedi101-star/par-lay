-- Autonomous learning is allowed only when model confidence, data provenance,
-- and a chronological holdout all pass their server-side gates.

ALTER TABLE public.prediction_learning_evaluations
  ADD COLUMN IF NOT EXISTS audit_status text NOT NULL DEFAULT 'excluded',
  ADD COLUMN IF NOT EXISTS audit_reasons jsonb NOT NULL DEFAULT '["legacy_record_not_audited"]'::jsonb,
  ADD COLUMN IF NOT EXISTS settlement_source text NOT NULL DEFAULT 'legacy_unknown',
  ADD COLUMN IF NOT EXISTS settlement_verified boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS settlement_verified_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.prediction_learning_evaluations'::regclass
      AND conname = 'prediction_learning_evaluations_audit_status_check'
  ) THEN
    ALTER TABLE public.prediction_learning_evaluations
      ADD CONSTRAINT prediction_learning_evaluations_audit_status_check
      CHECK (audit_status IN ('eligible', 'excluded'));
  END IF;
END;
$$;

ALTER TABLE public.ai_learning_prompt_proposals
  ADD COLUMN IF NOT EXISTS gemini_confidence numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS confidence_rationale text NOT NULL DEFAULT '';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.ai_learning_prompt_proposals'::regclass
      AND conname = 'ai_learning_prompt_proposals_gemini_confidence_check'
  ) THEN
    ALTER TABLE public.ai_learning_prompt_proposals
      ADD CONSTRAINT ai_learning_prompt_proposals_gemini_confidence_check
      CHECK (gemini_confidence >= 0 AND gemini_confidence <= 1);
  END IF;
END;
$$;

ALTER TABLE public.ai_learning_prompt_events
  DROP CONSTRAINT IF EXISTS ai_learning_prompt_events_action_check;
ALTER TABLE public.ai_learning_prompt_events
  ADD CONSTRAINT ai_learning_prompt_events_action_check
  CHECK (action IN ('promote', 'auto_promote', 'rollback'));

CREATE INDEX IF NOT EXISTS idx_prediction_learning_evaluations_audit
  ON public.prediction_learning_evaluations(audit_status, classification_status, analysis_at);

CREATE TABLE IF NOT EXISTS public.ai_learning_automation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_key text NOT NULL UNIQUE,
  status text NOT NULL CHECK (status IN ('running', 'completed', 'skipped', 'failed')),
  attempt_count integer NOT NULL DEFAULT 1,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_learning_automation_runs_started
  ON public.ai_learning_automation_runs(started_at DESC);

ALTER TABLE public.ai_learning_automation_runs ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON public.ai_learning_automation_runs TO service_role;

CREATE OR REPLACE FUNCTION public.claim_ai_learning_automation_run(p_run_key text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inserted_id uuid;
  run_row public.ai_learning_automation_runs%ROWTYPE;
BEGIN
  IF p_run_key !~ '^daily:[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
    RAISE EXCEPTION 'Invalid autonomous learning run key';
  END IF;

  INSERT INTO public.ai_learning_automation_runs(run_key, status, attempt_count)
  VALUES (p_run_key, 'running', 1)
  ON CONFLICT (run_key) DO NOTHING
  RETURNING id INTO inserted_id;

  IF inserted_id IS NOT NULL THEN
    RETURN jsonb_build_object('claimed', true, 'runId', inserted_id, 'attempt', 1);
  END IF;

  SELECT * INTO run_row
  FROM public.ai_learning_automation_runs
  WHERE run_key = p_run_key
  FOR UPDATE;

  IF run_row.status IN ('completed', 'skipped') THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'already_finished');
  END IF;
  IF run_row.status = 'running' AND run_row.started_at > now() - interval '2 hours' THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'already_running');
  END IF;

  UPDATE public.ai_learning_automation_runs
  SET status = 'running',
      attempt_count = attempt_count + 1,
      started_at = now(),
      finished_at = NULL,
      summary = '{}'::jsonb,
      error = NULL
  WHERE run_key = p_run_key
  RETURNING id, attempt_count INTO inserted_id, run_row.attempt_count;

  RETURN jsonb_build_object('claimed', true, 'runId', inserted_id, 'attempt', run_row.attempt_count);
END;
$$;

REVOKE ALL ON FUNCTION public.claim_ai_learning_automation_run(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_ai_learning_automation_run(text) TO service_role;

CREATE OR REPLACE FUNCTION public.activate_ai_learning_proposal(p_proposal_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  proposal_row public.ai_learning_prompt_proposals%ROWTYPE;
  active_version uuid;
BEGIN
  SELECT * INTO proposal_row
  FROM public.ai_learning_prompt_proposals
  WHERE id = p_proposal_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Learning proposal not found';
  END IF;
  IF proposal_row.status <> 'backtested'
     OR COALESCE((proposal_row.backtest->>'eligible')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'Proposal has not passed the validation backtest';
  END IF;
  IF COALESCE(proposal_row.gemini_confidence, 0) < 0.90
     OR COALESCE((proposal_row.backtest->'criteria'->>'confidenceEligible')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'Gemini confidence is below the autonomous promotion threshold';
  END IF;
  IF COALESCE((proposal_row.backtest->'criteria'->>'dataQualityEligible')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'Training and holdout data do not meet provenance requirements';
  END IF;
  IF proposal_row.candidate_version_id IS NULL THEN
    RAISE EXCEPTION 'Proposal has no candidate prompt version';
  END IF;

  SELECT id INTO active_version
  FROM public.ai_learning_prompt_versions
  WHERE is_active
  FOR UPDATE;

  IF active_version IS DISTINCT FROM proposal_row.base_version_id THEN
    RAISE EXCEPTION 'Active prompt changed after this proposal was generated; create a fresh proposal';
  END IF;

  UPDATE public.ai_learning_prompt_versions SET is_active = false WHERE is_active;
  UPDATE public.ai_learning_prompt_versions
  SET is_active = true, activated_at = now()
  WHERE id = proposal_row.candidate_version_id;
  UPDATE public.ai_learning_prompt_proposals
  SET status = 'approved', reviewed_at = now(), updated_at = now()
  WHERE id = p_proposal_id;

  INSERT INTO public.ai_learning_prompt_events(action, from_version_id, to_version_id, proposal_id, backtest)
  VALUES ('auto_promote', active_version, proposal_row.candidate_version_id, p_proposal_id, proposal_row.backtest);

  RETURN jsonb_build_object('ok', true, 'versionId', proposal_row.candidate_version_id, 'automatic', true);
END;
$$;

REVOKE ALL ON FUNCTION public.activate_ai_learning_proposal(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.activate_ai_learning_proposal(uuid) TO service_role;
