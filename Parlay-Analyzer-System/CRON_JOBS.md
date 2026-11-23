# Job Cron Eksternal (cron-job.org) — sumber kebenaran penjadwalan

Sejak 13 Nov 2026 pemicu terjadwal sistem ini adalah **cron-job.org**, bukan
GitHub Actions dan bukan (hanya) Vercel Cron:

| Pemicu | Status |
|---|---|
| cron-job.org | **utama** — daftar job di bawah |
| Vercel Cron `action=daily` 06:00 UTC (`vercel.json`) | jaring pengaman harian |
| GitHub Actions `odds-sync.yml` | **jadwal dimatikan**, hanya `workflow_dispatch` manual/darurat |

Semua job memanggil satu endpoint yang sudah ada sejak PR #13:

```
GET https://parwon.vercel.app/api/cron?token=<CRON_SECRET>&action=<aksi>
```

Auth menerima `?token=`, header `x-cron-secret`, atau `Authorization: Bearer`.
Token salah → **401** dan tidak ada jejak apa pun di database; jadi riwayat
eksekusi di cron-job.org adalah tempat pertama memeriksa kegagalan.

## Daftar job yang seharusnya terdaftar

| # | Job | Jadwal saran | URL (tambahkan `?token=…&`) | Bukti berhasil |
|---|---|---|---|---|
| 1 | keep-alive | tiap 30 mnt | `action=keep-alive` | 200 + `staleRunsClosed` |
| 2 | sync per liga (7 job) | tiap jam, menit bergeser (0, 8, 16, …) | `action=sync&league=<slug>&max=10` | baris baru di `odds_history` |
| 3 | **analyze** | tiap 6 jam (keputusan pemilik 17 Nov 2026) | `action=analyze` (bawaan 10 fixture/putaran, anggaran bawaan 20 detik agar respons tiba sebelum timeout ±30 detik cron-job.org; antrean dari kick-off terdekat) | respons `analysed > 0` saat ada fixture berharga; baris baru di `ai_predictions` + `prediction_selections` |
| 4 | closing | tiap 5 mnt | `action=closing` | `odds_close` terisi pada ledger (T-10 mnt) |
| 5 | results | tiap jam | `action=results` | skor akhir terisi di `fixtures` |
| 6 | outcomes | tiap jam, ±5 mnt setelah results | `action=outcomes` (batch: 1000 baris terlama, fixtures satu query, update berkelompok — perbaiki starvation & timeout 17 Nov 2026) | `outcome` terisi pada `prediction_selections` |
| 7 | notify-parlay (Telegram) | 1–2× sehari, setelah analyze pagi | `action=notify-parlay` | pesan tiket masuk ke Telegram; respons `sent: true`; tiket terkirim otomatis tercatat sebagai snapshot |
| 8 | **settle** (baru 23 Nov 2026) | tiap jam, setelah results & outcomes | `action=settle` | prediksi ter-settle; hasil per leg parlay tercatat terisi; status tiket `won`/`lost` mengikuti |

Job #7 butuh env di Vercel: `TELEGRAM_BOT_TOKEN` (dari BotFather) dan
`TELEGRAM_CHAT_ID`. Tanpa keduanya respons menjawab `sent: false`
beserta alasannya — tidak pernah error. Tiket yang dikirim identik
dengan blok "Tiket Pasar-Dulu" di panel Komposisi Parlay.

Slug liga: `england-premier-league`, `england-championship`, `spain-laliga`,
`italy-serie-a`, `germany-bundesliga`, `france-ligue-1`,
`netherlands-eredivisie`. Kuota: 7 liga × 10 event + 7 daftar ≈ 77
permintaan/jam, di bawah batas free plan 100/jam.

## Diagnosis 13 Nov 2026 — sync hidup, analyze tidak

Bukti dari Supabase (`hqbuwfyiqfxpnpdlgcru`) hari ini:

```
odds_history          terakhir 2026-11-13 10:04 UTC, 3.440 baris/7 hari  → sync (job #2) JALAN
fixture ≤10 hari      66, dan 64 di antaranya sudah berharga & belum dianalisis
ai_predictions        terakhir 2026-10-25                                → analyze (job #3) TIDAK menghasilkan
prediction_selections 0 baris                                            → konsekuensinya
```

Jadi bukan sync yang putus. Kemungkinan untuk job #3, berurutan dari yang
paling mungkin:

1. **Job analyze belum terdaftar di cron-job.org** (hanya sync/keep-alive).
2. **Job terdaftar tapi 401** — token di URL job tidak sama dengan
   `CRON_SECRET` di Vercel.
3. **Job 200 tapi `analysed = 0` / `failed > 0`** — baca isi responsnya di
   riwayat cron-job.org: ringkasan `runAutoAnalysis` memuat `candidates`,
   `analysed`, `failed`, dan `notes` yang menyebut sebabnya (mis. kuota
   Gemini). Respons itu satu-satunya jejak; kegagalan analyze tidak ditulis
   ke database.

Cara memeriksa dalam 2 menit: buka riwayat eksekusi job analyze di
cron-job.org → lihat kode HTTP terakhir dan badan responsnya. Setelah PR #19
di-merge, satu eksekusi analyze yang berhasil atas 64 kandidat di atas akan
langsung membuat `prediction_selections > 0` (baris v1 LLM + v2 quant) —
itulah uji kelulusan Fase 1/P3 yang sebenarnya.

## Yang tidak boleh dilakukan

- Menghidupkan lagi jadwal di `odds-sync.yml` bersamaan dengan cron-job.org
  (kuota dobel, race pada `sync_runs`).
- Menilai dari win rate sebelum ledger mencapai ±300 seleksi ber-hasil;
  pakai `GET /api/learning/ledger`.

## Diagnosis 15 Nov 2026 — panel salah membaca bukti

Panel "Jadwal Otomatis" berteriak "terjadwal, belum terbukti" dengan
"run sync terakhir selesai 111,4 jam lalu". Pemeriksaan database
membuktikan sync cron-job.org **hidup**: 2.812 baris `odds_history`
dalam 24 jam terakhir, snapshot terbaru hari yang sama 04:04 UTC.
Yang basi adalah tabel perantara `sync_runs` (completed terakhir
10 Nov) — panel menilai sync dari tabel yang tidak ditulis jalur
sync per liga. Sejak PR ini, panel menilai setiap tugas dari artefak
aslinya (`jobEvidence`): sync dari `odds_history`, analyze dari
`ai_predictions`, results dari fixture tanpa skor, closing dari
`odds_close`, outcomes dari `outcome`. Dan karena 588 seleksi saat
ini seluruhnya berada di 6 fixture berkick-off 20–21 Nov, closing &
outcomes berstatus sah **"menunggu bukti pertama"** — jatuh temponya
setelah kick-off pertama itu, bukan hari ini.

## Diagnosis 17 Nov 2026 — panel membingungkan & analisis terjadwal belum terbukti

Panel "Transparansi Sync" dulu hanya membaca `sync_runs` (yang hanya
ditulis sync PENUH), jadi tertulis "2 hari lalu" padahal snapshot odds
masuk beberapa menit lalu. Panel kini membuka dengan ringkasan tiga
jam terpisah: odds terakhir (dari `odds_history`), analisis terakhir
(dari `ai_predictions`), dan sync penuh terakhir.

Status "partial" pada sync penuh **bukan gagal**: `error_message`
selalu "Batas waktu tercapai — sisa liga dijadwalkan ulang", `errors=0`.
Sync penuh memang berhenti di batas 45 detik setelah ±2 liga; sisa
liga diambil job per-liga cron-job.org yang tidak menulis `sync_runs`.

Bukti produksi 17 Nov 11:10 UTC: odds segar (2.816 baris hari itu),
fixtures terjadwal jauh ke depan, **tetapi analisis hanya muncul pada
13, 14, dan 17 Nov** (17 Nov = pemanggilan manual pemilik sistem).
Artinya job `analyze` di cron-job.org **belum terbukti berjalan
terjadwal** — periksa keberadaan/riwayat job #3 di cron-job.org
(token salah → 401 tanpa jejak di database; lihat diagnosis 13 Nov).

Catatan ritme 6 jam (17 Nov 2026): pada ±12 putaran sebelum kick-off
20 Nov, kapasitas ±10/putaran cukup untuk menguras antrean dari yang
paling mendesak. Bila `remaining` masih besar mendekati hari-H,
naikkan sementara ke tiap jam atau tambahkan `&limit=20` pada URL job.
