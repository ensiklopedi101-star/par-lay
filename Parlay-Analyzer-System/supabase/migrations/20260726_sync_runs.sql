-- Migration: sync_runs table untuk tracking riwayat sync dan lastSyncAt yang akurat.
-- Terapkan via Supabase SQL Editor atau Management API.

CREATE TABLE IF NOT EXISTS public.sync_runs (
  id BIGSERIAL PRIMARY KEY,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'running', -- running, completed, partial, failed
  leagues TEXT[] DEFAULT '{}',
  events_fetched INT DEFAULT 0,
  events_inserted INT DEFAULT 0,
  odds_fetched INT DEFAULT 0,
  errors INT DEFAULT 0,
  rate_limited_seconds INT DEFAULT 0,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sync_runs_created_at ON public.sync_runs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sync_runs_status ON public.sync_runs(status);
