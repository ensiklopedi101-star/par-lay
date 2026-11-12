# Pemulihan Automasi — 2026-11-12

Dokumen ini melanjutkan PR #12 ("ganti bookmaker outbound ke 1xbet+M88 dan
cegah sync nyangkut"). PR itu **berhasil** pada bagian bookmaker, tetapi
verifikasi pasca-merge menemukan bahwa **tidak ada satu pun pemicu terjadwal
yang benar-benar berjalan**. Akibatnya seluruh rantai (sync → hasil → analisis →
closing → outcome) berhenti, dan target Fase 1 (`prediction_selections > 0`)
tidak mungkin tercapai — bukan karena mesin quant salah, tetapi karena tidak ada
yang memanggilnya.

---

## 1. Verifikasi PR #12 — berhasil

| Bukti | Nilai |
| --- | --- |
| Baris `odds_history` bookmaker `1xbet` | **203**, sejak 2026-11-11 15:53 UTC |
| Baris `odds_history` bookmaker `M88` | **15**, sejak 2026-11-11 15:53 UTC |
| `errors` pada run 566 & 567 | **0** |
| Request Bet365 baru setelah merge | tidak ada |

Bookmaker outbound sudah benar. Masalahnya ada di lapisan penjadwalan.

---

## 2. Empat cacat yang ditemukan

### Cacat 1 — Cron Vercel selalu ditolak 401 (paling fatal)

`routes/cron.ts` hanya menerima `x-cron-secret` dan `?token=`. **Vercel Cron
tidak mengirim keduanya** — ia mengirim `Authorization: Bearer <CRON_SECRET>`.
Karena penolakan terjadi sebelum handler bekerja, tidak ada error di database;
cron harian 06:00 hanya mendapat 401 setiap hari.

Bukti tidak langsung: `ai_predictions` terakhir dibuat **2026-10-25**, dan
`prediction_selections` tetap **0** meskipun cron harian sudah dijadwalkan.

**Perbaikan:** `lib/cron-auth.ts` menerima ketiga cara (Bearer, `?token=`,
`x-cron-secret`) + 8 tes.

### Cacat 2 — Workflow GitHub Actions tidak pernah terdaftar

File `odds-sync.yml` disimpan di `Parlay-Analyzer-System/.github/workflows/`.
GitHub hanya membaca `.github/workflows` di **akar repo**.

Bukti: `gh workflow list` kosong; `GET /repos/.../actions/workflows/odds-sync.yml`
→ **404**. Tidak ada satu pun jadwal 6 jam yang pernah berjalan.

Bukti data: odds terakhir **2026-11-11 15:53**, padahal seharusnya ada siklus
18:00, 00:00, dan 06:00.

**Perbaikan:** workflow dipindah ke `.github/workflows/odds-sync.yml` (akar),
ditambah job `analyze` setiap 6 jam, dan `?max=10` per liga agar kuota
100 permintaan/jam tidak habis oleh 7 job paralel.

### Cacat 3 — Cron harian memotong dirinya sendiri sebelum analisis

`vercel.json` menetapkan `maxDuration: 60`. Rangkaian `action=daily` lama
menyapu **tujuh liga** lebih dulu (satu liga saja bisa 140 event dengan jeda
300 ms per event), baru kemudian `results` → `analyze` → `closing` → `outcomes`.

Tujuh liga tidak mungkin selesai dalam 60 detik, sehingga fungsi dipotong
sebelum `analyze`. Inilah sebab langsung `prediction_selections` tetap nol.

**Perbaikan:** urutan dibalik berdasarkan nilai per detik dan diberi anggaran
waktu eksplisit (total 45 detik, di bawah batas 60):

| Urutan | Langkah | Anggaran |
| --- | --- | --- |
| 1 | `reap` — tutup run zombie | murah |
| 2 | `sync` — **satu** liga bergiliran, maks 10 event | ≤ 12 dtk |
| 3 | `analyze` — inti sistem | ≤ 18 dtk (dijamin) |
| 4 | `results` — skor akhir | bila sisa > 10 dtk |
| 5 | `closing` + `outcomes` — hanya DB | murah |

Langkah yang tidak kebagian waktu ditandai `skipped`, bukan `failed`, supaya
respons cron membedakan "gagal" dari "tidak dijalankan".

### Cacat 4 — "Fire-and-forget" meninggalkan `sync_runs` berstatus `running`

`?action=sync` (tanpa `league`) dan `POST /odds/sync/trigger` menjawab HTTP
lebih dulu, lalu melanjutkan sync di latar belakang. Di serverless, instance
boleh dibekukan setelah respons terkirim.

Bukti: run **568** (2026-11-12 11:28:47 UTC) berstatus `running` dengan
`events_fetched = 0` — lebih dari 8 menit, padahal batas fungsi 60 detik. Run
568 ditutup manual sebagai `failed` pada 11:42:42 UTC dengan pesan yang sama
seperti penyapu otomatis.

**Perbaikan:**

- Kedua jalur kini **menunggu** (`await`) dan mengembalikan ringkasan
  (`AllLeaguesSyncOutcome`). Anggaran internal 45 detik, jadi masih di bawah 60.
- `services/sync-runs.ts` menambahkan **penyapu**: setiap run `running` yang
  lebih tua dari 10 menit ditutup `failed` dengan penjelasan. Dipanggil dari
  `action=keep-alive` (biasanya tiap 30 menit) dan dari awal `action=daily`.
  `finally` tetap ada, tetapi status sekarang tidak lagi bergantung padanya.

---

## 3. Yang berubah

| File | Perubahan |
| --- | --- |
| `artifacts/api-server/src/lib/cron-auth.ts` *(baru)* | Otorisasi Bearer/token/header, murni + dites |
| `artifacts/api-server/src/lib/cron-params.ts` *(baru)* | `?max=` dibatasi 1–40 |
| `artifacts/api-server/src/services/sync-runs.ts` *(baru)* | Penyapu run basi + ambang bersama |
| `artifacts/api-server/src/services/daily-plan.ts` *(baru)* | Rotasi liga & anggaran langkah, murni + dites |
| `artifacts/api-server/src/routes/cron.ts` | Auth Bearer, sync ditunggu, urutan daily baru, keep-alive menyapu |
| `artifacts/api-server/src/routes/odds.ts` | `POST /sync/trigger` menunggu dan mengembalikan hasil |
| `artifacts/api-server/src/services/odds-fetcher.ts` | `fetchAndSaveAllLeagues` mengembalikan ringkasan |
| `artifacts/api-server/src/routes/config.ts` | Ambang basi memakai satu sumber |
| `artifacts/api-server/package.json` | `tsx` ditambahkan (script `test` sebelumnya tidak bisa jalan) |
| `.github/workflows/odds-sync.yml` | Dipindah ke akar + job `analyze` + `?max=10` |
| `api/index.js` | Bundle serverless dibangun ulang (wajib; Vercel memakai file ini) |

**Verifikasi:** `tsc --build` + typecheck api-server bersih, **240/240 tes
lulus**, build esbuild & bundle serverless sukses, smoke test endpoint:

```
tanpa auth                     -> 401
Authorization: Bearer <secret> -> 200  (sebelumnya 401 — inilah bug-nya)
?token=<secret>                -> 200
?token=salah                   -> 401
?action=sync (tanpa API key)   -> 200 {status:"skipped",reason:"no-api-key"}
?action=daily                  -> 200, semua langkah tercatat (analyze ikut)
```

---

## 4. Yang masih perlu Anda lakukan (tidak bisa dari kode)

1. **Merge PR ini ke `main`** agar Vercel mendeploy `api/index.js` baru.
2. **Isi GitHub repo secrets** di *Settings → Secrets and variables → Actions*:
   - `API_BASE_URL` = `https://parwon.vercel.app` (tanpa `/api`)
   - `CRON_SECRET` = nilai yang sama dengan env Vercel
   Tanpa ini, workflow terdaftar tetapi setiap job sengaja berhenti dengan
   pesan jelas (bukan gagal senyap).
3. **Opsional:** daftarkan `?action=closing` di cron-job.org tiap 5 menit
   (CLV butuh T-10 menit; jadwal GitHub terlalu kasar).

---

## 5. Cara membuktikan pemulihan (setelah deploy)

| # | Yang diperiksa | Cara | Lulus bila |
| --- | --- | --- | --- |
| 1 | Cron Vercel menerima Bearer | panggil `action=keep-alive` dengan header Bearer | 200 + `staleRunsClosed` |
| 2 | Tidak ada "Berjalan" abadi | panel Sync / `GET /api/sync/status` | `staleRunning: false` |
| 3 | Workflow terdaftar | `gh workflow list` | `odds-sync` muncul |
| 4 | Sync berjalan | jalankan workflow manual | 7 job OK; baris `1xbet`/`M88` bertambah |
| 5 | **Fase 1 terbukti** | tunggu job `analyze` atau tekan Analyze | `prediction_selections > 0` |

Kesiapan data untuk uji Fase 1 (dicek 2026-11-12):

```
fixture akan datang : 3 (EPL, 21 Nov 2026)
odds per fixture    : 72–73 baris, 2 bookmaker (1xbet, M88)
stats tim           : tersedia untuk keenam tim
prediction_selections: 0  <-- target yang harus berubah
```

---

## 6. Kesalahan yang TIDAK diperbaiki di sini

- **Harga sharp (Fase 2 butir 3)** — tetap keputusan biaya: plan berbayar.
- **Kontrak λ-adjustment line-up/cedera (Fase 2 butir 4)** — desain prompt baru.
- **`action=reanalyze` masih fire-and-forget** — tidak membuat baris `running`,
  tetapi bisa terpotong di tengah. Dampaknya kecil (pekerjaan diulang besok).
- **Kuota**: 7 liga × 10 event + daftar event ≈ 77 permintaan/jam. Bila
  `results` dan refresh manual ikut berjalan di jam yang sama, batas 100 bisa
  tersentuh; `scheduler_config.scan_days` dan `?max=` adalah dua kendali yang
  tersedia.
