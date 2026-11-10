# Deploy ke Vercel — panduan langkah demi langkah

Prasyarat teknis sudah selesai di repo (commit `c236d2f` + commit ini). Dokumen
ini adalah bagian yang **hanya bisa Anda lakukan**, karena melibatkan akun,
kredensial, dan keputusan biaya.

Analisis lengkapnya ada di `VERCEL_MIGRATION.md`. Dokumen ini hanya langkah.

---

## Yang sudah dikerjakan di repo

| # | Perubahan | File |
| --- | --- | --- |
| 1 | `PORT` tidak lagi wajib — aplikasi diekspor sebagai handler | `src/index.ts` |
| 2 | Logger tidak memakai `pino-pretty` di serverless | `src/lib/logger.ts` |
| 3 | `ws` dibuang, kredensial dibaca saat dipakai | `src/lib/supabase-client.ts`, `lib/supabase-client/src/index.ts` |
| 4 | `sync` bisa dipecah per liga | `src/routes/cron.ts` |
| 5 | Handler serverless + pemulihan path `/api` | `api/index.ts` |
| 6 | Konfigurasi Vercel | `vercel.json`, `.vercelignore` |
| 7 | Pin pnpm & Node | `package.json` |

**Bukti sudah diuji:**

- Tanpa `PORT`: proses **hidup**, tidak crash (sebelumnya `throw` saat load)
- Dengan `PORT`: `healthz=200`, scheduler jalan seperti biasa
- Handler di-bundle esbuild → 750 kB, dan `/healthz` mengembalikan `200 {"status":"ok"}`
  pada tiga bentuk URL: dengan header rewrite, tanpa header, dan sudah berprefiks `/api`
- `?action=sync` tanpa `league` → mengembalikan daftar 12 liga
- `?action=sync&league=palsu` → **404**
- Suite tes: **141/141 lulus**, `tsc --build` bersih

---

## Yang harus Anda putuskan dulu: pemicu cron

Ini menentukan isi `vercel.json` dan tidak bisa saya putuskan untuk Anda.

**Vercel Hobby hanya mengizinkan 2 cron, maksimal sekali sehari.** Jadwal
`0 */6 * * *` **ditolak saat deploy** — build gagal, bukan hanya diabaikan.

| Pilihan | Biaya | Cadangan odds | Cara |
| --- | --- | --- | --- |
| **A. Cron eksternal** | Rp0 | **tetap 6 jam** | cron-job.org / GitHub Actions memanggil `/api/cron?action=sync&league=<slug>` |
| B. Hanya cron Vercel | Rp0 | 1× sehari | tidak disarankan untuk taruhan |
| C. Vercel Pro | $20/bln | tetap 6 jam | ubah `vercel.json` ke `0 */6 * * *` |

`vercel.json` saat ini memakai **satu** cron harian (settlement pagi) — sah di
Hobby. Ini cocok dengan **Pilihan A**.

### Kalau memilih A: skrip untuk cron-job.org

Buat satu cron per liga, atau satu cron yang menggilir semuanya. Contoh dengan
GitHub Actions (gratis, tanpa akun pihak ketiga):

```yaml
# .github/workflows/odds-sync.yml
name: odds-sync
on:
  schedule:
    - cron: "0 */6 * * *"
  workflow_dispatch: {}

jobs:
  sync:
    runs-on: ubuntu-latest
    strategy:
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
```

`API_BASE_URL` = `https://<project>.vercel.app` (tanpa `/api`).
`CRON_SECRET` = nilai yang sama dengan di Vercel.

Untuk closing-odds dan outcome (yang berjalan tiap 5 menit dan tiap jam di
Replit), tambahkan dua job terjadwal lain yang memanggil
`?action=closing` dan `?action=outcomes`. Keduanya murah dan tidak memakai
kuota odds.

---

## Langkah deploy

### 1. Buat project

Di Vercel → **Add New → Project** → pilih repo `ensiklopedi101-star/par-lay`.

> **Penting:** isi **Root Directory** = `Parlay-Analyzer-System`.
> Repo ini punya dua tingkat; tanpa ini Vercel membaca `package.json` yang
> salah dan gagal sebelum mulai.

Framework Preset: **Other** (sudah diatur `"framework": null` di `vercel.json`).

### 2. Environment variables

Ambil nilainya dari Replit Secrets. **Jangan kirim ke chat.**

| Variabel | Wajib | Keterangan |
| --- | --- | --- |
| `SUPABASE_URL` | ya | |
| `SUPABASE_SERVICE_ROLE_KEY` | ya | sensitif |
| `ODDS_API_KEY` | ya | tanpa ini sync tidak jalan |
| `ADMIN_PASSWORD` | ya | |
| `CRON_SECRET` | ya | dipakai `/api/cron` dan skrip pemicu |
| `EXTENSION_API_KEY` | ya | dipakai ekstensi Chrome |
| `GEMINI_API_KEY` | untuk analisis AI | |
| `LOG_LEVEL` | opsional | default `info` |

Catatan: `ADMIN_PASSWORD` dan retry API adalah **snapshot saat modul diimpor**
(`middlewares/admin.ts`, `routes/cron.ts`). Di serverless itu aman karena
setiap instance dingin membaca environment terbaru — tetapi mengganti nilainya
di Vercel butuh **redeploy** agar berlaku.

### 3. Deploy

Klik Deploy. Yang diharapkan terjadi:

1. `pnpm install --no-frozen-lockfile` — sengaja tidak frozen karena
   `pnpm-lock.yaml` di repo lebih lama dari `pnpm-workspace.yaml`
   (`ERR_PNPM_LOCKFILE_CONFIG_MISMATCH`)
2. `pnpm --filter @workspace/parlay-app run build` → `artifacts/parlay-app/dist/public`
3. `api/index.ts` dibundel jadi fungsi dengan `maxDuration: 60`

### 4. Verifikasi setelah deploy

Ganti `<base>` dengan URL produksi.

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
# harapan: 200 + {"candidates":0,...}

# 5. Sync satu liga
curl -s "<base>/api/cron?token=<CRON_SECRET>&action=sync&league=england-premier-league"
# harapan: 200 + result dari fetchAndSaveLeagueOdds
```

Kalau nomor 5 mengembalikan 504, berarti satu liga masih melebihi 60 detik.
Itu bukan kegagalan konfigurasi — itu plafon Hobby. Solusinya memecah lebih
lanjut (per rentang tanggal) atau memakai Pro.

### 5. Arahkan ekstensi Chrome

Di `content.js`, ganti endpoint dari
`https://par-lay--libertyisketan1.replit.app` ke `<base>`. Header `x-api-key`
tetap `EXTENSION_API_KEY`. Patch lain di `extension-patch/README.md` tetap
berlaku.

### 6. Pasang pemicu cron

Lihat bagian "Pilihan A" di atas.

---

## Yang **tidak** saya uji dan tidak bisa saya uji dari sini

Supaya jelas, ini daftar jujurnya:

1. **Deploy sungguhan ke Vercel.** Saya tidak punya kredensial deploy, dan
   Connector Vercel tidak mengekspos pembuatan project. Semua yang saya uji
   adalah bundling + pemanggilan handler secara lokal.
2. **`pnpm install` di lingkungan Vercel.** Saya menguji dengan pnpm 9.15.9
   lokal. Hasil Vercel bisa berbeda bila ia memilih versi Node lain.
3. **`maxDuration: 60` benar-benar berlaku.** Tergantung plan akun.
4. **Satu siklus sync penuh di bawah 60 detik.** Ini risiko terbesar yang saya
   sebut di atas, dan hanya bisa diketahui setelah deploy.
5. **Supabase dari jaringan Vercel.** Tidak ada alasan teknis untuk gagal,
   tetapi tidak teruji.

Kalau ada yang gagal, kirimkan log build atau respons curl-nya — dari situ saya
bisa menunjuk baris yang salah alih-alih menebak.
