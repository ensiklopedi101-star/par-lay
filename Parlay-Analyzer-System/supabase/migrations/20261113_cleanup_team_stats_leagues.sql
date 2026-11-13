-- Pembersihan & perapian team_season_stats (13 Nov 2026):
-- 1) 20 klub Spanyol yang tersimpan di england-championship 2026-27
--    (pemilih liga ekstensi salah; salinan spain-laliga lebih baru &
--    lengkap, jadi baris ini duplikat basi yang aman dihapus).
-- 2) Duplikat nama panjang/pendek satu klub (kasus "Rennes ganda"):
--    gabung kolom stats ke baris keeper, lalu hapus baris donor.
-- 3) Rename nama resmi panjang ke nama kanonis pendek; alias yang sama
--    ditambahkan di team-name-cleaner.ts agar tidak tercipta ulang.
do $$
declare
  grp record;
  col text;
begin
  delete from team_season_stats
  where league_slug = 'england-championship' and season = '2026-27'
    and team_name in ('Athletic Club Bilbao', 'Atlético de Madrid', 'Barcelona', 'CA Osasuna', 'Deportivo Alavés', 'Elche', 'Getafe Club de Fútbol', 'Levante UD', 'Málaga', 'Rayo Vallecano', 'Real Betis Balompié', 'Real Club Celta de Vigo', 'Real Club Deportivo de La Coruña', 'Real Madrid', 'Real Racing Club de Santander', 'Real Sociedad de Fútbol', 'Reial Club Deportiu Espanyol', 'Sevilla', 'Valencia', 'Villarreal');

  for grp in
    select * from (values
      ('france-ligue-1', 'Rennes', 'Stade Rennais'),
      ('france-ligue-1', 'Lyon', 'Olympique Lyonnais'),
      ('france-ligue-1', 'Auxerre', 'Association Jeunesse Auxerroise'),
      ('france-ligue-1', 'Angers SCO', 'Angers Sporting Club de l''Ouest'),
      ('france-ligue-1', 'Stade Brest 29', 'Stade Brestois 29'),
      ('italy-serie-a', 'Inter', 'Internazionale Milano'),
      ('netherlands-eredivisie', 'AZ', 'Alkmaar Zaanstreek'),
      ('netherlands-eredivisie', 'NEC', 'Nijmegen Eendracht Combinatie'),
      ('spain-laliga', 'RC Celta de Vigo', 'Celta de Vigo'),
      ('spain-laliga', 'RC Celta de Vigo', 'Real Club Celta de Vigo'),
      ('spain-laliga', 'RCD Espanyol', 'Reial Club Deportiu Espanyol')
    ) as t(league, keeper, donor)
  loop
    foreach col in array array['stats_xg','stats_fts','stats_btts','stats_goals_conceded','stats_goals_scored','stats_shots','stats_over_25','stats_over_35','stats_under','stats_team_form','stats_ht'] loop
      execute format(
        'update team_season_stats k set %I = coalesce(k.%I, d.%I) from team_season_stats d where k.league_slug = %L and k.season = ''2026-27'' and k.team_name = %L and d.league_slug = k.league_slug and d.season = k.season and d.team_name = %L',
        col, col, col, grp.league, grp.keeper, grp.donor);
    end loop;
    delete from team_season_stats
    where league_slug = grp.league and season = '2026-27' and team_name = grp.donor;
  end loop;

  for grp in
    select * from (values
      ('france-ligue-1', 'Lille OSC Métropole', 'Lille'),
      ('france-ligue-1', 'OGC Nice Côte d''Azur', 'Nice'),
      ('france-ligue-1', 'Racing Club De Lens', 'Lens'),
      ('france-ligue-1', 'RC Strasbourg Alsace', 'Strasbourg Alsace'),
      ('france-ligue-1', 'Espérance Sportive Troyes Aube Champagne', 'Troyes'),
      ('france-ligue-1', 'Olympique de Marseille', 'Marseille'),
      ('italy-serie-a', 'Atalanta Bergamasca', 'Atalanta'),
      ('italy-serie-a', 'Bologna FC 1909', 'Bologna'),
      ('italy-serie-a', 'Genoa CFC', 'Genoa'),
      ('italy-serie-a', 'Parma Calcio 1913', 'Parma'),
      ('italy-serie-a', 'SS Lazio', 'Lazio'),
      ('italy-serie-a', 'ACF Fiorentina', 'Fiorentina'),
      ('italy-serie-a', 'SS Monza 1912', 'Monza'),
      ('netherlands-eredivisie', 'Ajax Amsterdam', 'Ajax'),
      ('netherlands-eredivisie', 'Feyenoord Rotterdam', 'Feyenoord'),
      ('netherlands-eredivisie', 'Sparta Rotterdam', 'Sparta'),
      ('netherlands-eredivisie', 'SBV Excelsior', 'Excelsior'),
      ('netherlands-eredivisie', 'Willem II Tilburg', 'Willem II'),
      ('netherlands-eredivisie', 'Cambuur Leeuwarden', 'Cambuur'),
      ('netherlands-eredivisie', 'HFC ADO Den Haag', 'ADO Den Haag'),
      ('spain-laliga', 'Getafe Club de Fútbol', 'Getafe'),
      ('spain-laliga', 'Real Betis Balompié', 'Real Betis'),
      ('spain-laliga', 'Real Sociedad de Fútbol', 'Real Sociedad'),
      ('spain-laliga', 'Real Racing Club de Santander', 'Racing Santander'),
      ('spain-laliga', 'Real Club Deportivo de La Coruña', 'Deportivo La Coruna'),
      ('spain-laliga', 'CA Osasuna', 'Osasuna'),
      ('germany-bundesliga', 'Freiburg', 'SC Freiburg'),
      ('germany-bundesliga', 'Leipzig', 'RB Leipzig'),
      ('germany-bundesliga', 'Leverkusen', 'Bayer Leverkusen'),
      ('germany-bundesliga', 'Hoffenheim', 'TSG Hoffenheim'),
      ('germany-bundesliga', 'Stuttgart', 'VfB Stuttgart')
    ) as t(league, old_name, new_name)
  loop
    update team_season_stats set team_name = grp.new_name, updated_at = now()
    where league_slug = grp.league and season = '2026-27' and team_name = grp.old_name;
  end loop;
end $$;
