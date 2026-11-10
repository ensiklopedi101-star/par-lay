-- Team identity cleanup + hard duplicate prevention.
--
-- Context (audited 2026-11-09 against the live database):
--   • 20 Spanish clubs were filed under england-premier-league. The Chrome
--     extension sent only the competition part of the FootyStats URL
--     ("la-liga"), the ingest route accepted it, and created new rows there.
--   • 17 clubs exist under two spellings in the same league/season
--     ("Espanyol" / "Espanyol Barcelona", "Sevilla" / "Sevilla FC", …), with
--     different numbers in each row.
--   • 83 of 301 rows have stats_goals_scored identical to stats_goals_conceded.
--
-- Adds a deterministic `team_key`, deletes the empty cross-league shells,
-- merges duplicate spellings, and finally adds a UNIQUE index so a second row
-- for the same club is physically impossible.
--
-- Safe to re-run: every step is idempotent.

-- ── 1. Deterministic team identity ────────────────────────────────────────
-- Mirrors teamKey() in src/lib/quant/adapter.ts. Must stay in sync.
CREATE OR REPLACE FUNCTION public.team_key(raw text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  WITH base AS (
    SELECT trim(
      regexp_replace(
        regexp_replace(
          regexp_replace(
            lower(translate(coalesce(raw, ''),
              'áàâãäåéèêëíìîïóòôõöúùûüñçÁÀÂÃÄÅÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÑÇ',
              'aaaaaaeeeeiiiiooooouuuuncAAAAAAEEEEIIIIOOOOOUUUUNC')),
            '[^a-z0-9 ]', ' ', 'g'),
          '\y(fc|cf|ud|sc|ac|as|ss|ssc|cd|rc|afc|club|futbol|calcio|sad|sd|sco|bsc|fsv|vfl|vfb|tsg|sv|spvgg)\y', ' ', 'g'),
        '\s+', ' ', 'g')
    ) AS k
  ),
  /* The same club appears with and without its city: "Espanyol Barcelona",
     "Real Betis Seville", "Inter Milano". Drop a recognised trailing city. */
  stripped AS (
    SELECT
      CASE
        WHEN k ~ '\s(barcelona|seville|sevilla|madrid|milano|rotterdam|vallecano|vigo|san sebastian|coruna|vigo)$'
          AND array_length(regexp_split_to_array(k, ' '), 1) > 1
        THEN regexp_replace(k, '\s(barcelona|seville|sevilla|madrid|milano|rotterdam|vallecano|vigo|san sebastian|coruna|vigo)$', '')
        ELSE k
      END AS k
    FROM base
  ),
  /* "celta de vigo" -> "celta de" only after the strip above; drop a dangling
     connector so it compares equal to the bare form. */
  trimmed AS (
    SELECT regexp_replace(
             regexp_replace(k, '\s(de|do|da|del|la|el)$', ''),
             '\s(18|19|20)[0-9]{2}$', ''
           ) AS k FROM stripped
  )
  SELECT NULLIF(trim(k), '') FROM trimmed;
$$;

ALTER TABLE public.team_season_stats
  ADD COLUMN IF NOT EXISTS team_key text;

UPDATE public.team_season_stats
SET team_key = public.team_key(team_name)
WHERE team_key IS DISTINCT FROM public.team_key(team_name);

-- ── 2. Delete the empty cross-league shells ───────────────────────────────
-- A row with no usable statistics is not history, it is noise left by the bad
-- import. Only this exact empty signature is touched.
DELETE FROM public.team_season_stats
WHERE coalesce(stats_goals_scored::text,   '{}') IN ('{}', 'null', '')
  AND coalesce(stats_goals_conceded::text, '{}') IN ('{}', 'null', '')
  AND coalesce(stats_xg::text,             '{}') IN ('{}', 'null', '');

-- ── 3. Merge duplicate spellings (same league + season + team_key) ────────
-- Winner = the row with goals-scored and xG present; tie-break on the shortest
-- name, then the lowest id. Missing blocks are copied from the losers before
-- the losers are deleted, so no data is lost.
CREATE TEMP TABLE _dup_merge ON COMMIT DROP AS
WITH ranked AS (
  SELECT
    id, league_slug, season, team_key,
    ROW_NUMBER() OVER (
      PARTITION BY league_slug, season, team_key
      ORDER BY
        ( (stats_goals_scored IS NOT NULL AND stats_goals_scored::text NOT IN ('{}','null'))::int
        + (stats_xg           IS NOT NULL AND stats_xg::text           NOT IN ('{}','null'))::int ) DESC,
        length(team_name) ASC,
        id ASC
    ) AS rn
  FROM public.team_season_stats
  WHERE team_key IS NOT NULL
)
SELECT
  team_key, league_slug, season,
  (array_agg(id ORDER BY id) FILTER (WHERE rn = 1))[1] AS keep_id,
  array_agg(id) FILTER (WHERE rn > 1) AS drop_ids
FROM ranked
GROUP BY team_key, league_slug, season
HAVING count(*) > 1;

UPDATE public.team_season_stats keep
SET
  stats_goals_scored   = coalesce(
    nullif(keep.stats_goals_scored::text, '{}')::jsonb,
    (SELECT d.stats_goals_scored FROM public.team_season_stats d
      WHERE d.id = ANY(m.drop_ids) AND d.stats_goals_scored IS NOT NULL
        AND d.stats_goals_scored::text NOT IN ('{}','null') LIMIT 1)),
  stats_goals_conceded = coalesce(
    nullif(keep.stats_goals_conceded::text, '{}')::jsonb,
    (SELECT d.stats_goals_conceded FROM public.team_season_stats d
      WHERE d.id = ANY(m.drop_ids) AND d.stats_goals_conceded IS NOT NULL
        AND d.stats_goals_conceded::text NOT IN ('{}','null') LIMIT 1)),
  stats_xg             = coalesce(
    nullif(keep.stats_xg::text, '{}')::jsonb,
    (SELECT d.stats_xg FROM public.team_season_stats d
      WHERE d.id = ANY(m.drop_ids) AND d.stats_xg IS NOT NULL
        AND d.stats_xg::text NOT IN ('{}','null') LIMIT 1)),
  stats_team_form      = coalesce(
    nullif(keep.stats_team_form::text, '{}')::jsonb,
    (SELECT d.stats_team_form FROM public.team_season_stats d
      WHERE d.id = ANY(m.drop_ids) AND d.stats_team_form IS NOT NULL
        AND d.stats_team_form::text NOT IN ('{}','null') LIMIT 1)),
  updated_at = now()
FROM _dup_merge m
WHERE keep.id = m.keep_id;

DELETE FROM public.team_season_stats t
USING _dup_merge m
WHERE t.id = ANY(m.drop_ids);

-- ── 4. Prevent it from ever happening again ───────────────────────────────
-- The application-level matcher (teamNamesEquivalent) deliberately refuses to
-- merge some pairs, which is why duplicates survived. A unique index makes a
-- second row for the same club impossible regardless of what the caller sends.
CREATE UNIQUE INDEX IF NOT EXISTS team_season_stats_league_season_teamkey_uniq
  ON public.team_season_stats (league_slug, season, team_key);

CREATE INDEX IF NOT EXISTS team_season_stats_team_key_idx
  ON public.team_season_stats (team_key);

-- ── 5. Record canonical names for future imports ──────────────────────────
-- `teams` / `team_aliases` were created in 20261110_quant_ledger.sql.
INSERT INTO public.teams (league_slug, canonical)
SELECT DISTINCT league_slug, team_name
FROM public.team_season_stats
WHERE team_key IS NOT NULL
ON CONFLICT (league_slug, canonical) DO NOTHING;

-- Verify:
--   SELECT league_slug, count(*) FROM team_season_stats GROUP BY 1 ORDER BY 2 DESC;
--   SELECT league_slug, season, team_key, count(*) FROM team_season_stats
--     GROUP BY 1,2,3 HAVING count(*) > 1;   -- must return 0 rows
