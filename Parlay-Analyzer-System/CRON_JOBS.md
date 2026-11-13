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
| 3 | **analyze** | tiap jam, setelah sync | `action=analyze` | respons `analysed > 0` saat ada fixture berharga; baris baru di `ai_predictions` + `prediction_selections` |
| 4 | closing | tiap 5 mnt | `action=closing` | `odds_close` terisi pada ledger (T-10 mnt) |
| 5 | results | tiap jam | `action=results` | skor akhir terisi di `fixtures` |
| 6 | outcomes | tiap jam, ±5 mnt setelah results | `action=outcomes` | `outcome` terisi pada `prediction_selections` |

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
