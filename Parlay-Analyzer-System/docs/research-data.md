# Data Riset Eksternal — Arsitektur & Tata Kelola

Menjawab empat pertanyaan pemilik sistem (15 Nov 2026) tentang dua
sumber data prioritas, dengan angka terukur — bukan perkiraan.

## Sumber & isi terverifikasi

| Sumber | Isi (terverifikasi dari file aslinya) | Lisensi |
|---|---|---|
| xgabora/Club-Football-Match-Data | `Matches.csv` 238.860 pertandingan (2000–2026/27, 38 divisi): Elo pra-pertandingan per tim, Form3/Form5, skor FT **dan HT**, shots/corners, odds 1X2 (rata-rata + max), Over/Under 2.5, handicap Asia | MIT |
| probberechts/soccerdata | Library Python pengambil xG per pertandingan (FBref dll) untuk liga top Eropa | — (alat, bukan dataset) |

`EloRatings.csv` sumber sengaja **tidak** disimpan: Elo
pra-pertandingan sudah menempel di setiap baris Matches
(`HomeElo/AwayElo`); menyimpan 274 ribu baris Elo harian hanya
menggandakan data.

## 1. Bisakah masuk otomatis & terjadwal?

Ya — tetapi tiap sumber di tempat yang mampu menjalankannya:

| Sumber | Penjadwal | Frekuensi | Kenapa di situ |
|---|---|---|---|
| CSV historis (prioritas 1) | GitHub Actions (`.github/workflows/research-ingest.yml`) | Bulanan + manual | cron-job.org hanya memanggil URL; Vercel memotong fungsi di 60 detik. Dataset ini arsip — bulanan lebih dari cukup. Butuh repo secrets `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`. |
| Rolling xG soccerdata (prioritas 2) | GitHub Actions (workflow terpisah, pekerjaan berikutnya) | Mingguan | Program Python; harus berjalan di runner, hasilnya yang disimpan. |

cron-job.org tetap menjadi pemicu odds live — tidak dicampur dengan
ingest riset.

## 2. Apakah Supabase membengkak?

Terukur: database produksi **93 MB dari 500 MB** (kuota gratis) pada
15 Nov 2026. Yang disimpan dari prioritas 1 hanya 7 divisi liga
sistem sejak 2020-08-01 dan ±20 kolom terpakai: **16.069 baris**
(terverifikasi dari file asli; 16.067 punya odds, semua punya skor
HT). Estimasi tambahan 10–20 MB termasuk indeks — jauh dari batas.
Prioritas 2 menyimpan **fitur hasil hitungan** (rolling xG per tim
per pertandingan), bukan data mentah: ribuan baris per musim,
< 5 MB. File CSV mentah tetap di GitHub sebagai arsip.

## 3. Perlu database lain?

Tidak. Ambang tindak lanjutnya terukur: evaluasi ulang bila database
melewati ±400 MB. Tabel riset diberi awalan `research_` dan terpisah
jelas dari tabel jalur live.

## 4. Apakah dipakai di jalur analisa?

Bertahap, dengan gerbang bukti — sama seperti semua perubahan model:

1. **Sekarang**: `research_matches` hanya untuk riset. Tidak dibaca
   analisis, scanner, maupun komposisi. Pekerjaan berikutnya:
   backtest warehouse (model vs pasar di ±16 ribu pertandingan,
   kalibrasi parameter yang layak, uji fitur Elo, dan — untuk pertama
   kalinya — pemodelan HT dari skor babak pertama historis).
2. **Naik ke live hanya yang lolos validasi**: campuran Elo ke λ
   dan/atau rolling xG (prioritas 2) masuk `estimateLambdas` lewat
   PR tersendiri dengan angka validasi terlampir. Yang tidak
   mengalahkan model berjalan di data validasi tetap tinggal di
   gudang riset.

## Menjalankan ingest

```bash
cd artifacts/api-server
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
  npx tsx scripts/ingest-research-matches.ts [--file Matches.csv] [--from 2020-08-01]
```

Idempoten (upsert per pertandingan) — aman diulang kapan pun.
