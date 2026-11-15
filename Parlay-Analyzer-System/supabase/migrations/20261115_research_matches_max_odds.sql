-- Odds maksimum antar bandar dari dataset gudang (MaxHome/MaxDraw/
-- MaxAway/MaxOver25/MaxUnder25), pendamping odds rata-rata yang sudah
-- ada. Dipakai simulasi "berburu harga": strategi pasar-dulu yang sama
-- dinilai sekali dengan odds rata-rata dan sekali dengan odds terbaik
-- yang tersedia, agar nilai line shopping terukur, bukan diklaim.
-- Kolom nullable: baris lama terisi saat ingest idempoten berikutnya.

alter table public.research_matches
  add column if not exists max_home numeric,
  add column if not exists max_draw numeric,
  add column if not exists max_away numeric,
  add column if not exists max_over25 numeric,
  add column if not exists max_under25 numeric;
