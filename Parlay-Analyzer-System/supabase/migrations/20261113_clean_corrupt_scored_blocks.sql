-- Bersihkan blok korup "Goals Conceded" yang tersimpan di kolom
-- stats_goals_scored (18 baris spain-laliga 2026-27, dari ingest lama).
-- Nilai yang sama sudah tersimpan dengan benar di stats_goals_conceded,
-- jadi mengosongkan blok korup tidak menghilangkan data apa pun.
-- Tanpa ini, constraint team_stats_scored_not_conceded menolak SETIAP
-- update pada baris-baris tersebut (17 dari 20 tim tertolak pada ingest
-- stats_team_form 2026-11-13).
begin;
update team_season_stats
set stats_goals_scored = null,
    updated_at = now()
where league_slug = 'spain-laliga'
  and season = '2026-27'
  and stats_goals_scored::text ilike '%conceded%'
  and stats_goals_scored::text not ilike '%scored%';
commit;
