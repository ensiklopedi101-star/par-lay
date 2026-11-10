-- Odds snapshot summary for the events radar.
--
-- GET /api/odds/events only needs "how many odds rows" and "latest capture
-- time" per fixture. That used to page through every row of odds_history in
-- Node.js, which grows without bound as the 3-hourly sync appends snapshots.
-- These aggregate functions return one row per fixture instead.
--
-- Safe to re-run: CREATE OR REPLACE + explicit grants.
--
-- IDs line up: odds_history.match_id and odds_movement_history.fixture_id both
-- hold the provider fixture id as TEXT, and 93% of sampled ids match
-- fixtures.fixture_id (bigint). 20260701_indexes_and_fk.sql still claims
-- match_id is an unrelated random provider id — that note is stale.

CREATE OR REPLACE FUNCTION public.fixture_odds_summary(p_match_ids text[])
RETURNS TABLE (
  match_id text,
  odds_count bigint,
  latest_captured_at timestamptz,
  market_count bigint
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    h.match_id,
    COUNT(*) AS odds_count,
    MAX(h.captured_at) AS latest_captured_at,
    COUNT(DISTINCT (h.bookmaker, h.market_type)) AS market_count
  FROM public.odds_history h
  WHERE h.match_id = ANY(p_match_ids)
  GROUP BY h.match_id;
$$;

CREATE OR REPLACE FUNCTION public.fixture_odds_movement_summary(p_fixture_ids text[])
RETURNS TABLE (
  fixture_id text,
  movement_count bigint
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    m.fixture_id::text AS fixture_id,
    COUNT(*) AS movement_count
  FROM public.odds_movement_history m
  WHERE m.fixture_id::text = ANY(p_fixture_ids)
  GROUP BY m.fixture_id;
$$;

-- Supabase grants EXECUTE on new functions to PUBLIC *and* to anon /
-- authenticated by default, which would let the anon key enumerate odds
-- counts. Revoking PUBLIC alone is not enough — the named grants must go too.
-- The API server talks to Postgres with the service-role key, so that is the
-- only role that needs this.
REVOKE ALL ON FUNCTION public.fixture_odds_summary(text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fixture_odds_movement_summary(text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fixture_odds_summary(text[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.fixture_odds_movement_summary(text[]) TO service_role;

-- Verify after applying:
--   SELECT proname FROM pg_proc WHERE proname LIKE 'fixture_odds%';
--   SELECT * FROM public.fixture_odds_summary(ARRAY['72036250']);
