-- Samakan slug La Liga di team_season_stats dengan slug resmi tabel
-- `leagues` / konfigurasi odds & fixture: "spain-laliga".
-- Sebelumnya statistik tersimpan sebagai "spain-la-liga" (ejaan FootyStats)
-- sehingga ingest selalu 422 dan statistik terbelah dari liga resminya.
-- Constraint diganti NOT VALID lagi persis seperti semula; satu baris warisan
-- (Bilbao) melanggarnya secara teks dan mencegah UPDATE apa pun selama
-- constraint aktif.
alter table public.team_season_stats drop constraint team_stats_scored_not_conceded;
update public.team_season_stats
set league_slug = 'spain-laliga'
where league_slug = 'spain-la-liga';
alter table public.team_season_stats
  add constraint team_stats_scored_not_conceded
  check ((stats_goals_scored is null) or ((stats_goals_scored)::text !~~* '%conceded%')) not valid;
