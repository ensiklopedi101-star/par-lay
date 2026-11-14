# Backtest Model Poisson vs Pasar

Menjawab satu pertanyaan: **apakah probabilitas model (λ Poisson di
`lib/match-context.ts`) lebih akurat daripada probabilitas pasar pada
pertandingan yang sama?** Bukan "seberapa sering model benar" —
hit-rate bukan bukti nilai betting.

## Desain (anti look-ahead)

| Komponen | Sumber | Alasan |
|---|---|---|
| Pertandingan | Fixture 2026-27 yang sudah selesai (7 liga berstatistik) | Hasil final diketahui |
| Kekuatan tim | Statistik `team_season_stats` musim **2025-26** saja | Diketahui sebelum musim dimulai; agregat musim berjalan memuat pertandingan itu sendiri → bocor |
| Pasar | Snapshot `ML` terakhir **sebelum kick-off** per bookmaker, fair probability konsensus (devig terburuk → median), dinormalisasi | Sama seperti jalur live; bukan harga penutup (itu wilayah CLV) |
| Rata-rata liga | Dari baris prior yang sama (venue split), min 8 tim, selain itu default | Meniru `resolveLeagueAverages` |

Fixture dilewati (dan dihitung terbuka di laporan) bila salah satu tim
tidak punya statistik prior — umumnya tim promosi.

## Metrik

- **Skill vs pasar** = rata-rata selisih log-loss berpasangan
  (pasar − model) per pertandingan + **t-stat**. Positif dan t ≥ 2 =
  model mengalahkan pasar secara signifikan pada sampel ini.
- Log-loss & Brier 1X2 model; log-loss biner Over 2.5 & BTTS.
- **ECE kalibrasi** atas seluruh probabilitas biner model (target ≤ 0.05).
- Argmax hit-rate ditampilkan hanya sebagai konteks.
- Vonis dihitung di `lib/model-backtest.ts` (`buildModelBacktest`) dan
  ditampilkan kata per kata — n < 30 tidak diberi vonis kualitas.

## Cara menjalankan

- **Panel Transparansi** → kartu "Backtest Model vs Pasar"
  (`GET /api/learning/model-backtest`, cache server 10 menit).
- CLI: `npx tsx scripts/backtest-model.ts [--out report.json]`
  (butuh `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`).

Keduanya memakai penyiapan sampel yang sama
(`services/model-backtest.ts`) sehingga angkanya tidak bisa berbeda.

## Keterbatasan yang diakui

1. Prior satu musim penuh dipakai untuk semua pertandingan Aug–Nov;
   makin jauh dari awal musim, prior makin basi. Ini menguji daya tahan
   prior, bukan performa model dengan data musim berjalan.
2. Harga pasar adalah snapshot terakhir sebelum kick-off yang berhasil
   ditangkap sync (bukan closing line resmi exchange).
3. Sampel awal kecil (orde 10²). t-stat menjaga agar kesimpulan tidak
   melebihi bukti — dan vonisnya akan berkata begitu bila memang begitu.
