-- Gudang riset historis (xgabora/Club-Football-Match-Data, MIT).
--
-- Tabel ini BUKAN bagian dari jalur live: tidak dibaca analisis,
-- scanner, atau komposisi parlay. Fungsinya satu — memberi backtest
-- dan kalibrasi sampel ribuan pertandingan (odds + Elo pra-pertandingan
-- + skor FT/HT) alih-alih ±150 baris dari odds_history produksi.
-- Fitur yang terbukti di atas tabel ini baru boleh naik ke jalur live
-- lewat perubahan kode tersendiri.
--
-- Hanya 7 divisi liga sistem yang disimpan dan hanya kolom yang
-- dipakai, agar database produksi tidak membengkak: file sumber
-- 238.860 pertandingan / 45 MB menyusut ke ±67 ribu baris ringkas.

create table if not exists public.research_matches (
  id bigint generated always as identity primary key,
  division text not null,
  league_slug text not null,
  match_date date not null,
  home_team text not null,
  away_team text not null,
  home_elo numeric,
  away_elo numeric,
  form3_home numeric,
  form5_home numeric,
  form3_away numeric,
  form5_away numeric,
  ft_home int,
  ft_away int,
  ht_home int,
  ht_away int,
  odd_home numeric,
  odd_draw numeric,
  odd_away numeric,
  over25 numeric,
  under25 numeric,
  handi_size numeric,
  handi_home numeric,
  handi_away numeric,
  source text not null default 'xgabora/Club-Football-Match-Data',
  ingested_at timestamptz not null default now(),
  unique (division, match_date, home_team, away_team)
);

create index if not exists research_matches_league_date_idx
  on public.research_matches (league_slug, match_date);

alter table public.research_matches enable row level security;
