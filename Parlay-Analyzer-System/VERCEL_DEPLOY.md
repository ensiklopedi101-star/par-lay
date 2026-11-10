# Deploy ke Vercel — langkah demi langkah

Ditulis 2026-11-10, berdasarkan repo pada commit `43726ee`.

---

## ⚠️ Baca ini dulu: kode yang akan di-deploy belum ada di `main`

Vercel melakukan deploy **dari sebuah branch di GitHub**, bukan dari repo lokal
saya. Branch `main` sekarang masih di `82e3963` dan **belum punya**:

- `Parlay-Analyzer-System/vercel.json`
- `Parlay-Analyzer-System/api/index.ts`
- Perbaikan `PORT` di `index.ts`

Semua itu ada di branch `arena/2cf51fe1-par-lay` (7 commit di depan `main`),
yang saat ini terbuka sebagai **PR #3**.

**Jadi pilihannya:**

| | Cara | Hasil |
| --- | --- | --- |
| **A** | **Gabung PR #3 ke `main` dulu**, lalu deploy dari `main` | Produksi stabil, sesuai praktik |
| **B** | Deploy langsung dari branch `arena/2cf51fe1-par-lay` | Cepat, tapi produksi mengikuti branch kerja |

Untuk aplikasi yang dipakai harian, **pilih A**. Tanpa salah satu dari
keduanya, deploy akan gagal karena Vercel membaca `package.json` tanpa
`vercel.json`.

---

## Prasyarat: yang sudah ada di repo

Setelah PR #3 digabung, ini sudah siap dan tidak perlu Anda sentuh:

| # | Perubahan | File |
| --- | --- | --- |
| 1 | `PORT` tidak lagi wajib — aplikasi diekspor sebagai handler | `artifacts/api-server/src/index.ts` |
| 2 | Logger tanpa `pino-pretty` di serverless | `artifacts/api-server/src/lib/logger.ts` |
| 3 | `ws` dibuang, kredensial dibaca saat dipakai | `artifacts/api-server/src/lib/supabase-client.ts` |
| 4 | `sync` bisa dipecah per liga | `artifacts/api-server/src/routes/cron.ts` |
| 5 | Handler serverless + pemulihan path `/api` | `api/index.ts` |
| 6 | Konfigurasi Vercel | `vercel.json`, `.vercelignore` |
| 7 | Pin pnpm 9.15.9 + Node ≥ 20 | `package.json` |

Sudah diuji lokal: tanpa `PORT` proses hidup (dulu crash), dengan `PORT`
`healthz=200`, handler di-bundle dan mengembalikan `200 {"status":"ok"}` pada
tiga bentuk URL, 141/141 tes lulus.

---

## Langkah 1 — Gabungkan PR #3

Buka `https://github.com/ensiklopedi101-star/par-lay/pull/3` → **Merge pull
request**. Tunggu sampai `main` berisi `43726ee`.

Cek dari terminal (opsional):

```bash
git fetch origin main
git ls-tree -r --name-only origin/main -- Parlay-Analyzer-System/vercel.json
# harus mengeluarkan nama file, bukan kosong
```

---

## Langkah 2 — Buat project di Vercel

1. **Add New… → Project**
2. Pilih repo `ensiklopedi101-star/par-lay` → **Import**
3. **Ini bagian yang paling mudah salah:**

   > **Root Directory** → klik **Edit** → isi **`Parlay-Analyzer-System`**

   Repo ini punya dua tingkat. Kalau Root Directory dibiarkan kosong, Vercel
   membaca `package.json` di tingkat atas yang bukan project sebenarnya, dan
   build gagal sebelum mulai.

4. **Framework Preset**: biarkan **Other** (sudah dipaksa `"framework": null`
   di `vercel.json`)
5. **Build & Output Settings**: **jangan diubah**, biarkan `vercel.json` yang
   mengatur (`buildCommand`, `outputDirectory` sudah terisi)

---

## Langkah 3 — Isi Environment Variables

Masih di layar import, buka **Environment Variables**. Salin nilainya dari
Replit Secrets. **Jangan kirim ke chat mana pun.**

| Variabel | Wajib | Dipakai untuk |
| --- | --- | --- |
| `SUPABASE_URL` | ya | semua akses database |
| `SUPABASE_SERVICE_ROLE_KEY` | ya | kunci ini sensitif — set sebagai **Sensitive** |
| `ODDS_API_KEY` | ya | tanpa ini sync tidak jalan |
| `ADMIN_PASSWORD` | ya | endpoint admin |
| `CRON_SECRET` | ya | `/api/cron` dan skrip pemicu |
| `EXTENSION_API_KEY` | ya | dipakai ekstensi Chrome |
| `GEMINI_API_KEY` | untuk analisis AI | |
| `LOG_LEVEL` | opsional | default `info` |

Biarkan kosong (jangan diisi) variabel Replit yang tidak relevan:
`REPL_ID`, `REPLIT_*`.

---

## Langkah 4 — Deploy

Klik **Deploy**. Yang seharusnya terjadi:

1. `pnpm install --no-frozen-lockfile`
   — sengaja tidak *frozen*, karena `pnpm-lock.yaml` di repo lebih lama dari
   `pnpm-workspace.yaml`; mode frozen gagal dengan
   `ERR_PNPM_LOCKFILE_CONFIG_MISMATCH`
2. `pnpm --filter @workspace/parlay-app run build` → `artifacts/parlay-app/dist/public`
3. `api/index.ts` dibundel menjadi fungsi dengan `maxDuration: 60`

Kalau langkah 2 gagal karena `mockup-sandbox` menuntut `PORT`, itu sudah
diperbaiki: `buildCommand` sengaja **hanya** membangun `parlay-app`.

---

## Langkah 5 — Verifikasi

Ganti `<base>` dengan URL produksi yang diberikan Vercel
(`https://<project>.vercel.app`).

```bash
# 1. API hidup?
curl -s <base>/api/healthz
# harapan: {"status":"ok"}

# 2. Frontend tersaji?
curl -s -o /dev/null -w "%{http_code}\n" <base>/
# harapan: 200

# 3. Cron terlindungi?
curl -s -o /dev/null -w "%{http_code}\n" "<base>/api/cron?action=closing"
# harapan: 401

# 4. Cron dengan secret?
curl -s "<base>/api/cron?token=<CRON_SECRET>&action=closing"
# harapan: 200 {"candidates":0,...}

# 5. Sync satu liga
curl -s "<base>/api/cron?token=<CRON_SECRET>&action=sync&league=england-premier-league"
# harapan: 200 + result dari fetchAndSaveLeagueOdds
```

Kalau nomor 5 mengembalikan **504**, artinya satu liga masih melebihi 60 detik.
Itu batas Vercel Hobby, bukan salah konfigurasi — lihat Langkah 7.

---

## Langkah 6 — Arahkan ekstensi Chrome

Di `content.js`, ganti endpoint
`https://par-lay--libertyisketan1.replit.app` menjadi `<base>`.
Header `x-api-key` tetap berisi `EXTENSION_API_KEY`.

Patch lain di `extension-patch/README.md` tetap berlaku.

---

## Langkah 7 — Pasang pemicu cron

**Vercel Hobby menolak jadwal sub-daily saat deploy.** `0 */6 * * *` akan
membuat build gagal, bukan hanya diabaikan. Karena itu `vercel.json` hanya
memuat **satu** cron harian.

| Pilihan | Biaya | Cadangan odds |
| --- | --- | --- |
| **A. Pemicu eksternal** | Rp0 | **tetap 6 jam** |
| B. Hanya cron Vercel | Rp0 | 1× sehari — tidak disarankan untuk taruhan |
| C. Vercel Pro | $20/bln | tetap 6 jam, cukup ubah `vercel.json` |

### Kalau memilih A — GitHub Actions (gratis, tanpa akun pihak ketiga)

Buat berkas `.github/workflows/odds-sync.yml` di repo:

```yaml
name: odds-sync
on:
  schedule:
    - cron: "0 */6 * * *"
  workflow_dispatch: {}

jobs:
  sync:
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        league:
          - england-premier-league
          - england-championship
          - spain-laliga
          - italy-serie-a
          - france-ligue-1
          - netherlands-eredivisie
          - germany-bundesliga
    steps:
      - name: Sync ${{ matrix.league }}
        run: |
          curl -fsS --max-time 55 \
            "${{ secrets.API_BASE_URL }}/api/cron?token=${{ secrets.CRON_SECRET }}&action=sync&league=${{ matrix.league }}"

  closing:
    runs-on: ubuntu-latest
    steps:
      - name: Closing odds (tiap 5 menit tidak mungkin di GH Actions)
        run: echo "lihat catatan di bawah"

  outcomes:
    runs-on: ubuntu-latest
    steps:
      - name: Settlement outcome
        run: |
          curl -fsS --max-time 55 \
            "${{ secrets.API_BASE_URL }}/api/cron?token=${{ secrets.CRON_SECRET }}&action=outcomes"
```

Tambahkan dua **repository secret**: `API_BASE_URL` (`https://<project>.vercel.app`,
tanpa `/api`) dan `CRON_SECRET`.

**Catatan penting:** GitHub Actions tidak bisa dijadwalkan tiap 5 menit
(minimum 5 menit tapi sering terlambat). Untuk `action=closing` yang butuh
presisi T-10, pakai **cron-job.org** (gratis, bisa 1 menit) atau gabungkan
`closing` ke dalam jadwal sync 6 jam — dengan konsekuensi banyak fixture
terlewat jendela 10 menitnya.

---

## Yang tidak bisa saya uji — daftar jujur

1. **Deploy sungguhan.** Saya tidak punya kredensial deploy; konektor Vercel
   tidak mengekspos pembuatan project. Semua uji saya lakukan lokal
   (bundling + pemanggilan handler).
2. **`pnpm install` di lingkungan Vercel.** Diuji dengan pnpm 9.15.9 lokal;
   hasil di Vercel bisa berbeda bila ia memilih versi Node lain.
3. **`maxDuration: 60` benar-benar berlaku.** Tergantung plan akun.
4. **Satu siklus sync per liga selesai di bawah 60 detik.** Ini risiko
   terbesar, dan hanya bisa diketahui setelah deploy.
5. **Koneksi Supabase dari jaringan Vercel.** Tidak ada alasan teknis gagal,
   tetapi belum teruji.

Kalau ada yang gagal, kirimkan **log build** atau **respons curl**-nya. Dari
situ saya bisa menunjuk baris yang salah, bukan menebak.
