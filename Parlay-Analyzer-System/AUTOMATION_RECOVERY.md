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

---

## 7. Lanjutan — kenapa "140 ditarik, 1 tersimpan" (run 568)

Pertanyaan wajar dari panel: 140 event ditarik tetapi hanya 1 tersimpan.
Angka itu bukan kehilangan data; ia mencampur dua hal berbeda.

| Istilah panel | Isi sebenarnya |
| --- | --- |
| **Event ditarik (140)** | Seluruh daftar **satu liga** (EPL) dari provider, termasuk pertandingan yang sudah lewat. Sync tidak pernah sampai ke liga ke-2. |
| **Tersimpan (1)** | Event yang benar-benar ditulis: fixture + odds. Satu event = puluhan baris `odds_history`. |
| **Snapshot odds (1)** | Jumlah **event** yang odds-nya tersimpan — bukan jumlah baris harga. |

Fakta dari database:

```
fixture 72221406 (Man City–Fulham)  odds terakhir 2026-11-12 11:37:59  <-- satu-satunya yang tersimpan
fixture 72221392 (Aston Villa–Sunderland) odds terakhir 2026-11-11 15:53
fixture 72221394 (Bournemouth–Forest)     odds terakhir 2026-11-11 15:53
fixture EPL akan datang: 3
```

Jadi dari 140 event EPL, hanya **3** yang akan datang; dua di antaranya tidak
sempat diambil odds-nya.

### Penyebab lambatnya: `fetch()` tanpa timeout

Run 568 mulai **11:28:47**, tetapi statistik liga pertama baru tertulis
**11:37:59** — **9 menit 12 detik untuk satu event**. `apiGet()` memakai
`fetch(url)` polos, dan `fetch` Node tidak punya batas waktu. Anggaran 45 detik
hanya diperiksa *di antara* panggilan, jadi satu koneksi yang menggantung
membuat seluruh sync menunggu — lalu instance dibekukan sebelum `finally`.

### Perbaikan

- `lib/http.ts`: `fetchWithTimeout` + `ODDS_API_TIMEOUT_MS` (default **20 detik**).
  Semua panggilan Odds-API kini gagal cepat; kegagalan dihitung `errors` dan
  sisa event diproses siklus berikutnya, bukan menggantung.
- Panel: `zeroInsertReason` → `insertReason` (menjelaskan rasio rendah, bukan
  hanya nol), label "Snapshot odds" tidak lagi menyebut "baris harga".
- 9 tes baru (`http`, `sync-run-explain`); total **249/249** lulus.

---

## 8. Fixtures "hilang" dan sync odds yang lambat (2026-11-12, lanjutan)

Pertanyaan: dulu 200–800 fixture ditarik dari Odds-API dan bisa mencakup
beberapa bulan ke depan; sekarang hilang, dan penarikan JSON-nya lama.

### 8.1 Tidak ada yang menghapus fixture

Audit kode: `grep -rn 'from("fixtures")'` hanya menemukan operasi **baca** dan
`upsert`. Tidak ada `.delete()` yang menyentuh `fixtures` (satu-satunya
`.delete()` ada di `parlays` dan `ai_learning_prompt_versions`). Tabelnya
**897 baris**, `fixture_date` 2026-07-03 … 2026-11-21, `created_at`
2026-06-14 … 2026-11-11.

Yang terjadi adalah **penuaan**, bukan penghapusan:

| bulan `fixture_date` | baris |
|---|---|
| 2026-07 | 63 |
| 2026-08 | 245 |
| 2026-09 | 276 |
| 2026-10 | 289 |
| 2026-11 | **24** |

Dari 897 baris, hanya **3** yang kick-off-nya masih akan datang (semua EPL,
2026-11-21). Baris lama tetap ada, tetapi sudah lewat sehingga tidak muncul
sebagai jadwal.

### 8.2 Horizon menyusut dari ~3 bulan ke ~2–3 hari

Lead time = `fixture_date` − `created_at`, dikelompokkan menurut bulan pembuatan:

| dibuat | baris | rata-rata lead | maksimum |
|---|---|---|---|
| 2026-06 | 394 | **70,8 hari** | 92 |
| 2026-07 | 363 | 67,0 hari | 91 |
| 2026-08 | 105 | 76,7 hari | 89 |
| 2026-10 | 32 | **2,4 hari** | 3 |
| 2026-11 | 3 | 9,9 hari | 10 |

Per liga sejak Oktober: bundesliga 2,3 hari (18), serie-a 2,3 (8), laliga 2,4
(4), EPL 9,9 (3), ligue-1 2,2 (1), championship 2,7 (1).

Penyebabnya ada di kode, bukan di provider:

1. `fetchAndSaveLeagueOdds` menarik `/events` dengan `status=pending`, tanpa
   paginasi (`skip`), sehingga hanya menerima ~20 event per liga.
2. Baris `fixtures` **hanya** lahir di dalam `saveEventAndOdds`, yaitu sebagai
   efek samping pengambilan odds.
3. `toFetch` diurutkan **dari kick-off terdekat**, lalu loop berhenti saat
   anggaran 45 detik habis. Jadi yang sempat ditulis hanya pertandingan 2–3
   hari ke depan; sisa jadwal tidak pernah sampai ke database.

Juni–Agustus bisa 70–92 hari karena saat itu penarikan massal (seed/bulk) masih
memasukkan seluruh daftar event, bukan karena provider berubah.

### 8.3 Odds memang tidak bisa jauh di muka

Dokumentasi Odds-API menyatakan harga pra-pertandingan muncul setelah bandar
membuka pasar, biasanya **beberapa hari** sebelum kick-off. Ini sesuai dugaan
pengguna: **jadwal bisa ditarik berbulan-bulan, odds tidak.** Karena kedua
urusan itu digabung dalam satu loop, jadwal ikut tertahan oleh odds.

### 8.4 Kenapa lambat

- **N+1 request**: satu event = satu `GET /odds`, plus jeda 300 ms. 40 event =
  40 round-trip.
- **Payload penuh**: respons memuat semua pasar (corners, exact goals, team
  totals) — puluhan ribu baris untuk 140 event.
- **Baca riwayat tanpa filter**: `getAlreadySyncedEventIds` mengunduh
  `odds_history` per halaman 1.000 baris untuk semua event kandidat.
- **Tulis per baris**: setiap baris pasar di-`UPDATE` satu per satu (70+
  request paralel per event).
- **Tanpa timeout** sampai `34faaa2`: satu koneksi menggantung menahan seluruh
  sync (9 menit 12 detik untuk satu event pada run 568).

### 8.5 Perbaikan yang dikirim

| perubahan | berkas | dampak |
|---|---|---|
| Jadwal disimpan lebih dulu, massal, tanpa menunggu odds | `saveScheduleFixtures` di `services/odds-fetcher.ts` | satu `GET /events` + upsert 500 baris/permintaan ⇒ fixture berminggu-minggu ke depan kembali tersimpan |
| Hanya kick-off yang belum lewat yang di-upsert jadwal | `isScheduleCandidate` (`lib/sync-plan.ts`, grace 0) | status "pending" tidak menimpa status akhir pertandingan |
| Odds per batch 10 event | `fetchEventsOddsMulti` → `/v3/odds/multi` | 40 event = 4 request, bukan 40 |
| Bentuk respons tak dikenal = error → fallback per-event | `fetchEventsOddsMulti` | tidak ada batch yang hilang diam-diam |
| `odds_history` disaring `captured_at >= now-6 jam` **di SQL** | `getAlreadySyncedEventIds` | puluhan ribu baris → hanya yang relevan |
| 5 tes baru | `lib/sync-plan.test.ts` | total **254/254** lulus |

Batas yang tetap ada dan harus jujur disebut: kalau provider hanya
mengembalikan 20 event per liga tanpa paginasi, jadwal yang bisa disimpan
tetap 20 event terdekat per liga. Untuk menembus itu perlu `skip`/`limit`
berulang di `/events` — langkah berikutnya, bukan yang sudah dikerjakan.

---

## 9. Verifikasi langsung ke Odds-API (2026-11-12)

Kunci API diuji manual dari luar sandbox (sandbox hanya boleh menghubungi
domain tertentu). **Kunci tidak disimpan di repo.**

### 9.1 Akar masalah horizon: `/events` default hanya 20 event

| permintaan | hasil |
|---|---|
| `/events?sport=football&status=pending` (tanpa `limit`, seperti kode lama) | **20 event** — hanya putaran terdekat |
| `...&league=england-premier-league&limit=200` | **200 event**, 2026-11-21 → **2027-02-06** |
| `...&limit=200&skip=200` | `[]` (habis) |
| `...&limit=500` | tetap 200 → **200 adalah plafon** |

Jadi jadwal sampai Februari memang tersedia; kode lama tidak pernah memintanya.
Ini juga menjelaskan matematika 140: 7 liga × 20 event.

### 9.2 Nama pasar dan filter `markets`

Satu event EPL (1xbet) mengembalikan: `ML`, `Double Chance`, `Spread`,
`Totals`, `Both Teams To Score`, `Team Total Home`, `Team Total Away`,
`Corners Spread`, `Corners Totals`, `Corners Totals Home`, `Correct Score`
(100+ hasil), dll — sekitar 60 KB untuk satu event.

| uji | hasil |
|---|---|
| `markets=ML,Spread,Totals,Both Teams To Score` | hanya 4 pasar itu; payload satu event ±4 KB (**turun ~15×**) |
| `markets=ML,HT` | hanya `ML` (nama tak dikenal diabaikan, bukan error) |
| `markets=HT` saja | `[]` → penyedia **tidak punya** pasar 1X2 babak pertama |

### 9.3 `/odds/multi` benar-benar ada

`GET /v3/odds/multi?eventIds=72221406,72221392&bookmakers=1xbet` →
array event lengkap dengan `bookmakers`. Parameter `eventIds` (koma), batas
10 id, dan `markets` juga berlaku. `/odds` (single) juga menerima `markets`.

### 9.4 Perubahan kode

| perubahan | berkas |
|---|---|
| `/events` memakai `limit=200` + `skip` bertingkat (maks 2 halaman), dedupe per id, cache 90 detik | `fetchLeagueEvents` |
| **Pass 1**: jadwal semua liga disimpan lebih dulu, baru pass odds | `fetchAndSaveAllLeagues` |
| Upsert jadwal tidak diulang dalam siklus yang sama | `ensureScheduleSaved` |
| Filter `markets` di `/odds` **dan** `/odds/multi` | `fetchEventOdds`, `fetchEventsOddsMulti`, `providerMarketNames` |
| Tes URL nyata dengan `fetch` tiruan (paginasi, `eventIds`, `markets`, bentuk respons aneh) | `odds-fetcher.pagination.test.ts`, `odds-fetcher.multi.test.ts` |

Total tes: **260/260**, typecheck bersih, `api/index.js` dibangun ulang.

### 9.5 Efek samping yang perlu dicatat

Filter `markets` juga menghentikan masuknya pasar **corners** dan **team
totals** ke `odds_history`. Selama ini `Corners Totals 9.5` ikut
terklasifikasi sebagai `Totals` (kata "total" cocok), dan `Team Total Home`
juga — jadi analisis gol bisa tercampur pasar corners. Data lama masih ada
(`Total Corners` 2.108 baris, `Corners Totals*` ribuan) dan perlu dibersihkan
terpisah; data baru sudah bersih di sumbernya.

---

## 10. Merge PR #13, deploy produksi, dan status verifikasi (2026-11-12)

### 10.1 Yang sudah terverifikasi

| langkah | bukti |
|---|---|
| PR #13 merged ke `main` | merge commit `5653385`, 2026-11-12 12:17:05Z |
| Deploy produksi baru | `dpl_6inMvjodAREj7qAiuro7ugTLctoW` **READY** 12:17:31Z, alias `parwon.vercel.app` |
| Kode baru benar-benar live | `GET /api/sync/status` mengembalikan `insertReason` (kunci yang baru ada di PR #13) |
| Workflow terdaftar | `gh workflow list` → `odds-sync active 415964807` (sebelumnya tidak ada) |
| Workflow bisa dipicu | `gh workflow run odds-sync.yml` → run `43216683930`, `43217007651` |

### 10.2 Yang GAGAL: cron tidak pernah sampai ke aplikasi

Semua job (7 liga + analyze + outcomes) berhenti dengan `exit code 1` dalam
hitungan detik, dan **tidak ada satu pun baris baru di `sync_runs`**.
Anotasi check-run membuktikan sebabnya:

```
Repository secrets API_BASE_URL / CRON_SECRET belum diisi.
```

Jadi bukan bug kode: GitHub Actions belum punya kredensial untuk memanggil
`/api/cron`. Catatan: `CRON_SECRET` di Vercel bertipe **sensitive** sehingga
tidak bisa dibaca ulang (bukan hanya oleh agen — UI Vercel pun tidak
menampilkannya). Karena itu nilainya harus ditetapkan ulang di kedua sisi.

### 10.3 Langkah yang dibutuhkan (di luar repo)

1. Vercel → Settings → Environment Variables → `CRON_SECRET`: set nilai baru
   (Production + Preview), lalu **redeploy** agar env terbaca.
2. GitHub → Settings → Secrets and variables → Actions:
   - `API_BASE_URL` = `https://parwon.vercel.app` (tanpa akhiran `/api`)
   - `CRON_SECRET` = nilai yang sama dengan langkah 1.
3. Jalankan ulang `odds-sync`; verifikasi di Supabase: baris baru `sync_runs`,
   `fixtures` bertambah sampai berbulan-bulan ke depan, `odds_history` dapat
   `captured_at` baru.

Jalur cadangan yang **tidak** butuh Actions: cron harian Vercel
(`/api/cron?action=daily`, `0 6 * * *` UTC) memakai `CRON_SECRET` dari
environment sendiri, jadi otomatis berjalan 06:00 UTC berikutnya.

### 10.4 Perbaikan diagnosa (PR #14)

Kegagalan cron sebelumnya tidak meninggalkan jejak yang bisa dibaca: log
mentah tidak selalu bisa diunduh dari CLI. Workflow sekarang menulis anotasi
berisi kode HTTP dan potongan body (`401` = token beda, `404` = base URL salah,
`000` = host tak terjangkau) **tanpa mencetak secret**.
