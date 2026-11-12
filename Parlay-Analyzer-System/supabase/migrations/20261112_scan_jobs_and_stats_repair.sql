-- Scan job yang tahan mati + perbaikan blok turunan.
--
-- Konteks audit 12 Nov 2026:
--   • Batch scanner hanya menyimpan job di `Map` di memori satu instance
--     (routes/analyze.ts). Setiap poll yang mendarat di instance lain
--     menjawab 404 "Batch job not found or expired" padahal scan berjalan,
--     dan job yang dibunuh Vercel (maxDuration 60 detik) hilang bersama
--     instance-nya. Scan terakhir berhenti di 133 dari 147 fixture.
--   • Migrasi 20261111 hanya menyalin 4 dari 11 kolom saat menggabungkan
--     duplikat, sehingga 27 tim kehilangan `stats_over_25` (5 di antaranya
--     juga `stats_under`). Ke-27 tim itu masih menyimpan "Over 2.5" di
--     `stats_team_form`.
--
-- Idempotent: aman dijalankan berulang.

-- ── 1. Tabel job scan ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.scan_jobs (
  id            TEXT PRIMARY KEY,
  status        TEXT NOT NULL DEFAULT 'running', -- running | completed | partial | failed
  scan_days     INT  NOT NULL DEFAULT 0,
  total         INT  NOT NULL DEFAULT 0,
  completed     INT  NOT NULL DEFAULT 0,
  current_match TEXT,
  tickets       JSONB NOT NULL DEFAULT '[]'::jsonb,
  pending       JSONB NOT NULL DEFAULT '[]'::jsonb,
  parlay_id     TEXT,
  waiting_odds  INT  NOT NULL DEFAULT 0,
  error         TEXT,
  started_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at   TIMESTAMPTZ,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scan_jobs_status_updated
  ON public.scan_jobs (status, updated_at DESC);

COMMENT ON TABLE public.scan_jobs IS
  'Snapshot job batch scanner. Sumber kebenaran saat instance Vercel yang menjalankan job sudah dibuang.';

-- ── 2. Lengkapi stats_over_25 dari stats_team_form ────────────────────────
-- `updated_at` SENGAJA tidak diubah: baris yang datanya berasal dari 15 Okt
-- harus tetap terlihat basi. Memperbarui timestamp di sini akan membuat
-- statistik 28 hari tampak segar dan AI akan memakainya.
WITH parsed AS (
  SELECT
    id,
    (regexp_match(COALESCE(stats_team_form ->> 'Over 2.5', ''), '([0-9]+(?:\.[0-9]+)?)'))[1]::numeric AS over_pct
  FROM public.team_season_stats
  WHERE jsonb_typeof(stats_team_form) = 'object'
    AND stats_team_form ? 'Over 2.5'
    AND (stats_over_25 IS NULL OR stats_over_25::text IN ('{}', 'null', ''))
)
UPDATE public.team_season_stats target
SET stats_over_25 = jsonb_build_object(
  'Over 2.5', parsed.over_pct::text || '%',
  '%',        parsed.over_pct::text || '%',
  'Derived From', 'stats_team_form'
)
FROM parsed
WHERE target.id = parsed.id
  AND parsed.over_pct IS NOT NULL
  AND parsed.over_pct BETWEEN 0 AND 100;

-- ── 3. Lengkapi stats_under: 100 − Over 2.5 ───────────────────────────────
WITH parsed AS (
  SELECT
    id,
    (regexp_match(COALESCE(stats_over_25 ->> 'Over 2.5', ''), '([0-9]+(?:\.[0-9]+)?)'))[1]::numeric AS over_pct
  FROM public.team_season_stats
  WHERE jsonb_typeof(stats_over_25) = 'object'
    AND stats_over_25 ? 'Over 2.5'
    AND (stats_under IS NULL OR stats_under::text IN ('{}', 'null', ''))
)
UPDATE public.team_season_stats target
SET stats_under = jsonb_build_object(
  'Under 2.5', (100 - parsed.over_pct)::text || '%',
  'Derived From', '100 - stats_over_25[Over 2.5]'
)
FROM parsed
WHERE target.id = parsed.id
  AND parsed.over_pct IS NOT NULL
  AND parsed.over_pct BETWEEN 0 AND 100;

-- Verifikasi:
--   SELECT count(*) FROM public.team_season_stats
--    WHERE stats_over_25 IS NULL OR stats_over_25::text IN ('{}', 'null');  -- harus 0
--   SELECT league_slug, count(*) FROM public.team_season_stats
--    WHERE stats_goals_scored::text ILIKE '%conceded%' GROUP BY 1;          -- sisa kerusakan impor

-- ── 4. Penjaga di level database ──────────────────────────────────────────
-- Penjaga di aplikasi hanya berlaku untuk jalur yang lewat aplikasi. Impor
-- yang datang langsung ke Supabase (Edge Function `footystats-ingest`) tidak
-- melewatinya — itulah bagaimana 18 baris La Liga bisa menyimpan data
-- "Conceded" di kolom `stats_goals_scored`.
--
-- `NOT VALID` dipakai supaya baris lama yang sudah rusak tidak memblokir
-- migrasi: constraint berlaku untuk INSERT/UPDATE baru, baris lama tetap ada
-- sampai diimpor ulang. Ia bisa di-`VALIDATE` setelah data dibersihkan.
ALTER TABLE public.team_season_stats
  DROP CONSTRAINT IF EXISTS team_stats_scored_not_conceded;

ALTER TABLE public.team_season_stats
  ADD CONSTRAINT team_stats_scored_not_conceded
  CHECK (
    stats_goals_scored IS NULL
    OR stats_goals_scored::text NOT ILIKE '%conceded%'
  ) NOT VALID;

COMMENT ON CONSTRAINT team_stats_scored_not_conceded ON public.team_season_stats IS
  'Menolak blok berlabel "Conceded" di kolom gol-dicetak, termasuk impor di luar aplikasi.';
