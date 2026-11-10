# Migrasi Replit → Vercel

Dokumen ini berdasarkan pembacaan kode di repo ini, bukan asumsi. Setiap klaim
di bawah bisa dicek ulang di file yang disebutkan.

---

## 1. Ringkasan: bisa, tapi **bukan pekerjaan sekali deploy**

Aplikasi ini terdiri dari dua bagian yang sangat berbeda sifatnya:

| Bagian | Isi | Cocok di Vercel? |
| --- | --- | --- |
| `artifacts/parlay-app` | React + Vite, static SPA | **Ya, mudah.** Ini memang kasus terbaik Vercel. |
| `artifacts/api-server` | Express, cron, pino, `ws` | **Ya, dengan 4 perubahan.** |

Frontend tidak masalah. Backend perlu diubah, dan satu di antaranya **menyangkut
keputusan Anda**, bukan kode saya.

---

## 2. Temuan yang menentukan: Vercel Hobby tidak bisa menjalankan cron tiap 6 jam

Saya cek batas plan Hobby yang berlaku sekarang:

- **Maksimal 2 cron job per project**
- **Frekuensi maksimal sekali sehari** — ekspresi seperti `0 */6 * * *` **ditolak
  saat deploy**, bukan hanya diabaikan. Build gagal.
- Semua jadwal dalam UTC
- Eksekusi cron hanya di deployment **production**

Sumber: [docs Vercel](https://vercel.com/docs/cron-jobs/usage-and-pricing),
[ringkasan limit 2026](https://runhooks.app/blog/vercel-hobby-cron-job-limits-explained/),
[SteadyCron](https://steadycron.com/guides/vercel-cron-limits/).

Kode Anda sekarang memakai, di `artifacts/api-server/src/scheduler/index.ts`:

| Tugas | Ekspresi | Keterangan |
| --- | --- | --- |
| Odds sync | `0 */6 * * *` (dari `scheduler_config`) | **Ditolak Hobby** |
| Settlement | `0 6 * * *` | OK untuk Hobby |
| Revalidation | `15 */3 * * *` | **Ditolak Hobby** |

Jadi `vercel.json` yang menyalin jadwal ini apa adanya **tidak akan pernah
ter-deploy** di akun Hobby.

**Kabar baiknya:** di dalam aplikasi sudah ada jalan keluarnya, dan sudah
dirancang untuk ini. `artifacts/api-server/src/routes/cron.ts` sudah menyediakan:

```
GET /api/cron?token=<CRON_SECRET>&action=keep-alive
GET /api/cron?token=<CRON_SECRET>&action=sync
GET /api/cron?token=<CRON_SECRET>&action=revalidate
GET /api/cron?token=<CRON_SECRET>&action=backfill
GET /api/cron?token=<CRON_SECRET>&action=reanalyze
```

Endpoint ini sudah ada, sudah pakai secret, dan komentarnya pun sudah menyebut
cron eksternal. Artinya: **pemicunya dipindah ke luar Vercel.**

### Dua pilihan yang harus Anda tentukan

**Opsi A — Cron eksternal (gratis, cadangan 6 jam tetap jalan)**
Vercel hanya hosting fungsi. Yang memanggil `/api/cron?action=sync` tiap 6 jam
adalah layanan luar, misalnya `cron-job.org` (gratis, bisa tiap menit) atau
GitHub Actions schedule. Di `vercel.json` cukup 1 cron harian untuk settlement.

- Biaya: Rp0
- Cadangan 6 jam: **tetap seperti sekarang**
- Kekurangan: satu akun pihak ketiga lagi yang harus Anda jaga

**Opsi B — Hanya cron Vercel (tanpa pihak ketiga)**
Maksimal 2 cron harian.

- Biaya: Rp0
- Cadangan jadi **1x sehari**, bukan 4x. Untuk pasar taruhan, harga 24 jam
  terlalu basi — peluang taruhan yang bagus sudah lewat.
- Saya tidak menyarankan ini untuk aplikasi taruhan.

**Cadangan saya: Opsi A.** Dan itu bukan pilihan yang mengikat — kalau nanti
Anda upgrade ke Pro ($20/bln), `vercel.json` tinggal diubah ke `0 */6 * * *`
dan cron eksternal dimatikan. Kode tidak perlu disentuh lagi.

---

## 3. Empat perubahan kode yang wajib

### 3.1 `index.ts` crash tanpa `PORT`

```ts
const rawPort = process.env["PORT"];
if (!rawPort) {
  throw new Error("PORT environment variable is required but was not provided.");
}
```

Di Vercel, fungsi **tidak** mendapat `PORT` — platform yang mengatur port.
Selama baris ini ada, setiap request akan gagal saat cold start.

Perlu: ekspor `app` sebagai handler, dan hanya panggil `app.listen()` bila
`PORT` ada (supaya `pnpm dev` di lokal tetap jalan).

### 3.2 `startScheduler()` tidak boleh dipanggil saat serverless

`startScheduler()` di `index.ts` memanggil `node-cron` dan menjalankan sync saat
startup. Di serverless, instance hidup beberapa detik lalu mati — timer tidak
pernah tiba waktunya. Efeknya cuma: kerja sia-sia dan log menyesatkan.

Perlu: pemicu cron di Vercel **tidak boleh** lewat `node-cron` sama sekali.
Scheduler hanya aktif bila dijalankan sebagai proses panjang (lokal, atau host
berbayar).

### 3.3 Logger pino: `pino-pretty` tidak ada di bundle

`artifacts/api-server/src/lib/logger.ts` mengaktifkan `pino-pretty` bila
`NODE_ENV !== "production"`. Vercel **tidak mengeset `NODE_ENV=production`**
secara otomatis di semua konteks, dan `build.mjs` meng-inline transport pino
lewat `esbuild-plugin-pino`. Di fungsi yang dibundel, ini bisa gagal saat cold
start dengan `unable to determine transport target`.

Perlu: paksa mode JSON di Vercel (deteksi `process.env.VERCEL`), lepas
ketergantungan pada berkas transport.

### 3.4 `ws` tidak diperlukan

`lib/supabase-client.ts` mengimpor `ws` untuk opsi Realtime. Saya sudah
memastikan dengan grep: **tidak ada satu pun** panggilan `.channel()` atau
`.subscribe()` di seluruh `api-server`. Artinya opsi itu tidak pernah dipakai.
Di serverless, `ws` hanya menambah ukuran bundle dan risiko.

Perlu: buang impor `ws`, atau buat kondisional.

---

## 4. Yang ternyata **tidak** jadi masalah

Ini penting supaya Anda tidak khawatir berlebihan:

- **Tidak ada WebSocket/SSE di API.** Tidak ada `.channel()`, tidak ada
  `text/event-stream`, tidak ada `res.write()`. Semua request/response biasa.
  Ini justru syarat utama agar Express bisa jalan di serverless, dan Anda sudah
  memenuhinya tanpa sadar.
- **Tidak ada tulis ke disk.** `multer` di `routes/csv.ts` dan
  `routes/season-csv.ts` memakai `memoryStorage()`, bukan disk. Aman di
  filesystem read-only Vercel.
- **Semua state ada di Supabase.** Tidak ada variabel in-memory yang harus
  bertahan antar request. Kecuali `syncRunning` di `odds-fetcher.ts` — dan itu
  pengaman anti-tumpang-tindih, jadi hilang antar instance justru netral.
- **Build static frontend sudah disiapkan.** `vite.config.ts` sudah punya
  komentar tentang Vercel dan sudah membuat `PORT`/`BASE_PATH` opsional saat
  `command !== "serve"`. Sepertinya sudah pernah disesuaikan untuk kasus ini.

---

## 5. Batas durasi menjalankan sync

`MAX_EVENTS_PER_SYNC = 40` dan `MAX_RATE_LIMIT_BACKOFF_SECONDS = 300` di
`odds-fetcher.ts`. Satu siklus sync bisa lama karena backoff rate limit.

- Hobby: 60 detik per request fungsi
- Pro: 300 detik, hingga 800 detik dengan Fluid Compute

**Konsekuensi:** `action=sync` di Hobby akan sering kena timeout 504 sebelum
selesai. Ini bukan bug kode Anda — ini plafon platform.

Jalan keluarnya: jangan jalankan `sync` sebagai satu panggilan yang menunggu
selesai. Pecah per liga (`?action=sync&league=...`), sehingga tiap panggilan
pendek dan muat dalam batas. Itu perubahan kecil di `routes/cron.ts`, dan perlu
dibuat **sebelum** migrasi, bukan sesudah.

---

## 6. Rencana kerja (berurutan, bisa berhenti di titik mana pun)

| # | Langkah | Risiko | Hasil |
| --- | --- | --- | --- |
| 1 | `pnpm` tanpa `packageManager` di root `package.json` → Vercel menebak versi. Tambahkan pin versi. | Rendah | Build deterministik |
| 2 | Tambah `packageManager` + `vercel.json` (rewrite `/api/*` → fungsi, 1 cron harian) | Rendah | Deploy bisa dimulai |
| 3 | Entrypoint serverless: ekspor `app`, `listen` hanya bila `PORT` ada | Sedang | API hidup di Vercel |
| 4 | Logger aman untuk serverless | Rendah | Tidak crash cold start |
| 5 | Buang `ws` | Rendah | Bundle lebih kecil |
| 6 | Pecah `action=sync` per liga | Sedang | Muat dalam 60 detik |
| 7 | Deploy project `parlay` ke tim `free2vps` | — | URL produksi |
| 8 | Pasang cron eksternal 6 jam → `/api/cron?action=sync` | — | Data kembali segar |
| 9 | Arahkan ekstensi Chrome ke URL Vercel | Rendah | Ingest jalan lagi |

Langkah 1–5 bisa saya kerjakan sekarang tanpa menyentuh data apa pun.

---

## 7. Soal fixtures yang kosong — ini terpisah dari Vercel

Supaya tidak salah harap: **migrasi ke Vercel tidak dengan sendirinya
mengembalikan fixtures.**

Penyebabnya sudah saya pastikan dari database, bukan dugaan:

- `fixtures`: 894 baris, **0 yang akan datang**, rentang 2026-07-03 → 2026-11-07
- Route `/supabase/fixtures` memakai `.gte("fixture_date", now)` — jadi daftar
  kosong itu **benar**, bukan bug render

Artinya penjadwal yang mengambil fixtures baru sudah berhenti, konsisten dengan
Replit yang tidur. Fixtures akan kembali terisi begitu langkah 8 selesai —
selama `ODDS_API_KEY` masih valid. Kalau kuota API-nya habis, itu masalah lain
lagi dan perlu dicek terpisah.

---

## 8. Catatan: `vercel.json` sekarang diabaikan di root repo

Repo ini punya **dua** root: `par-lay/` dan `par-lay/Parlay-Analyzer-System/`.
Yang merupakan project sebenarnya adalah yang kedua. Saat membuat project di
Vercel, **set Root Directory = `Parlay-Analyzer-System`**. Kalau tidak, Vercel
membaca `package.json` yang salah dan build gagal sebelum mulai.
