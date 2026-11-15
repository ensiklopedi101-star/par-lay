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

## Dua eksperimen lanjutan (14 Nov 2026)

Hasil pertama: skill −4,08% (t=−1,60), ECE 3,2 poin. Dua pertanyaan
berikutnya dijawab otomatis di laporan yang sama:

1. **Peluruhan prior** (`byPeriod`, per bulan kick-off). Skill yang
   memburuk dari bulan ke bulan berarti prior musim lalu makin basi —
   obatnya data musim berjalan. Skill yang sudah buruk sejak bulan
   pertama berarti masalahnya di model.
2. **Kalibrasi parameter** (`calibration`). Grid kasar bobot xG
   {0, 0.3, 0.6, 0.8, 1.0} × shrinkage K {0, 3, 6, 12} dipilih di
   separuh pertama sampel (kronologis) dan dihakimi di separuh kedua.
   `adoptionJustified` hanya true bila kombinasi terpilih mengalahkan
   bawaan (0,6 / K=6) di validasi **dan** skill validasinya positif.
   Menang di data latih saja dilaporkan sebagai overfitting dan
   parameter bawaan dipertahankan. Adopsi sendiri selalu berupa
   perubahan kode tersendiri setelah membaca hasil validasi — tidak
   pernah otomatis.

## Eksperimen informasi (14 Nov 2026)

Hasil periode: skill sudah negatif sejak Agustus (−1,64%) dan tetap
−4,43% di Oktober (n=98) — bukan peluruhan prior semata. Kalibrasi
parameter juga ditolak sistem (pemenang grid pun skill latihnya
negatif). Kesimpulan sementara: yang kurang bukan parameter, melainkan
**informasi**. Laporan kini membandingkan tiga varian pada sampel yang
identik:

| Varian | Informasi |
|---|---|
| `prior_only` | Statistik musim lalu saja (baseline, model backtest saat ini) |
| `form_only` | Form musim berjalan point-in-time saja (fallback prior bila belum ada laga) |
| `prior_plus_form` | Campuran λ: bobot form = lagaForm/(lagaForm+6) |

Form direkonstruksi dari skor final tabel `fixtures` dengan
`RollingFormTracker` (`lib/rolling-form.ts`): rates sebuah pertandingan
dibaca sebelum hasilnya dicatat — urutan terbalik = look-ahead. Hasil
melawan tim promosi tetap dihitung ke form lawannya walau pertandingan
tim promosi sendiri di luar sampel.

Catatan kejujuran: jalur LIVE memakai statistik musim berjalan dari
ingest (termasuk xG berjalan), jadi eksperimen ini juga mengestimasi
seberapa jauh vonis prior-only meremehkan model live. Eksperimen ini
eksploratori di sampel yang sama — keputusan mengubah jalur live tetap
butuh bukti lanjutan, bukan satu tabel.

## Nilai sisa model & ceruk pasar (14 Nov 2026)

Eksperimen informasi membantah hipotesis form: form saja −4,80%,
campuran prior+form −3,68% (baseline −4,08%) — perbaikan kecil, tetap
negatif. Pasar unggul bukan karena form gol semata. Dua pertanyaan
terakhir sebelum keputusan desain:

1. **Bobot campuran** (`blend`): grid w ∈ {0, 0.1, …, 1} untuk
   p = w·model + (1−w)·pasar dipilih di separuh awal, dihakimi di
   separuh akhir melawan pasar murni (w=0). `modelAddsValue` hanya
   true bila campuran berbobot positif mengalahkan pasar murni di
   validasi. Ini menentukan takaran model yang jujur di jalur live
   (bawaan saat ini 0,35).
2. **Ceruk totals/BTTS** (`over25VsMarket`, `bttsVsMarket`): untuk
   pertama kalinya probabilitas Over 2.5 dan BTTS model dibandingkan
   dengan harga pasarnya sendiri (snapshot Totals line tepat 2.5 dan
   BTTS terakhir sebelum kick-off, konsensus fair yang sama). Pasar
   1X2 adalah yang paling efisien; keunggulan model — bila ada —
   lebih mungkin bersembunyi di pasar turunan gol.

## Insiden integritas (14 Nov 2026)

Perluasan query odds ke ML+Totals+BTTS tanpa paginasi membuat baris
ML terdesak batas 1000 baris: n vs pasar anjlok 127 → 56 dan vonis
bergeser ke −7,72% dari subset rusak. Vonis itu **dibatalkan**.
Perbaikannya: `collectPagedRows` (patrun PR #27) + penunjuk
`oddsRowsLoaded` di panel. Pelajaran permanen: setiap perubahan
cakupan query wajib memeriksa bahwa n sampel tidak bergerak tanpa
penjelasan — angka yang berubah diam-diam lebih berbahaya daripada
angka buruk.

## Temuan pasar gol & uji konfirmasi (14 Nov 2026)

Setelah integritas pulih (n=127, skill 1X2 −4,08%): **Over 2.5
+5,69% (t=1,37) dan BTTS +7,66% (t=2,01, n=124)** — model kalah di
1X2 tetapi unggul di pasar gol, BTTS melewati ambang t≥2. Ini sampel
penemuan, bukan pembuktian: banyak uji pada sampel yang sama membuat
satu t≈2 bisa lahir dari keberuntungan. Panel kini menjalankan uji
konfirmasi otomatis — skill per paruh kronologis (harus positif di
keduanya) dan pada varian prior+form (harus bertahan saat informasi
diperkaya). Hanya edge yang lolos keduanya yang boleh dibahas untuk
mengubah jalur live, dan perubahan itu pun tetap lewat PR tersendiri.

## Cakupan lima pasaran (15 Nov 2026)

Backtest kini menyatakan status setiap pasaran secara eksplisit
(`marketCoverage` di panel): 1X2, Over/Under 2.5, dan BTTS teruji;
**Asian Handicap teruji** — cover kandang pada line konsensus
antar-bookmaker (line paling banyak ditawarkan), probabilitas model
dari `winShare(handicapOutcome(...))` yang sama seperti jalur live,
push dikeluarkan, hasil fraksional (1 / 0,75 / 0,25 / 0) untuk line
perempat; **Half-Time belum bisa diuji** — sistem tidak punya model
gol babak pertama dan jalur live mengembalikan null untuk HT.
Menguji HT dari matriks full-time akan menghasilkan angka bohong;
pasaran itu menunggu model HT tersendiri, dan panel mengatakannya
terus terang.
