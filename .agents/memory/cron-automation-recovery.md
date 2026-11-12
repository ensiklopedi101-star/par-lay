# Automasi cron: tiga cara auth, satu batas 60 detik

**Konteks (2026-11-12):** `prediction_selections` nol bukan karena mesin quant,
tetapi karena tidak ada pemicu terjadwal yang berjalan.

- **Vercel Cron mengirim `Authorization: Bearer <CRON_SECRET>`**, bukan
  `?token=` dan bukan `x-cron-secret`. Endpoint `/api/cron` wajib menerima
  ketiganya; kalau tidak, cron harian dijawab 401 tanpa jejak di database.
- **GitHub hanya membaca `.github/workflows` di AKAR repo.** Workflow di
  subfolder (`Parlay-Analyzer-System/.github/...`) tidak terdaftar sama sekali
  — `gh workflow list` kosong, API 404.
- **`vercel.json` → `maxDuration: 60`.** Rangkaian `action=daily` tidak boleh
  menyapu banyak liga lebih dulu; analisis AI harus dijamin dapat anggaran.
  Anggaran total 45 dtk: reap → 1 liga×10 event (≤12 dtk) → analyze (≤18 dtk) →
  results → closing → outcomes.
- **Jangan fire-and-forget di serverless.** Respons terkirim = instance boleh
  dibekukan; `sync_runs` tertinggal `running` (run 568). Tunggu pekerjaannya,
  dan sediakan penyapu: run `running` > 10 menit ditutup `failed`
  (`services/sync-runs.ts`), dipanggil dari keep-alive.
- **Kuota odds 100/jam**: satu event = satu permintaan odds. Matriks 7 liga
  wajib memakai `?max=10` (≈77 permintaan termasuk daftar event).
- **`pnpm test` butuh `tsx`** di devDependencies api-server (sebelumnya script
  gagal `tsx: not found`).
- **`api/index.js` adalah bundle yang dipakai Vercel.** Setelah mengubah
  `src/`, jalankan `pnpm --filter @workspace/api-server run build:vercel` dan
  commit hasilnya; build Vercel hanya membangun frontend.

- **`fetch()` Node tidak punya timeout.** `ODDS_API_TIMEOUT_MS` (default 20 dtk)
  wajib dipakai lewat `lib/http.ts`; tanpa itu satu koneksi menggantung bisa
  menahan satu event 9 menit (run 568).
- **`events_fetched` ≠ kandidat.** Angka itu seluruh daftar liga dari provider,
  termasuk laga yang sudah lewat. `events_inserted` = event yang disimpan;
  `odds_fetched` juga menghitung **event**, bukan baris harga.

## 2026-11-12 — fixtures menua & sync lambat

- `fixtures` **tidak pernah dihapus** kodenya; 897 baris, hanya 3 yang akan datang. Horizon menyusut karena baris fixture hanya ditulis di dalam `saveEventAndOdds` (efek samping odds), diurutkan kick-off terdekat, lalu berhenti saat anggaran waktu habis.
- Lead time per bulan pembuatan: 06=70,8 hari, 07=67, 08=76,7, 10=2,4, 11=9,9 → jauh di muka dulu dari penarikan massal, bukan perilaku provider.
- Odds memang baru dibuka bandar beberapa hari sebelum kick-off; jadwal bisa berbulan-bulan. Karena itu jadwal dan odds harus dipisah.
- Perbaikan: `saveScheduleFixtures` (upsert massal 500/permintaan, hanya kick-off belum lewat), `fetchEventsOddsMulti` (`/odds/multi`, ≤10 id, fallback per-event bila bentuk respons aneh), filter `captured_at` di SQL untuk `getAlreadySyncedEventIds`. Tes **254/254**.
- Sisa batas: `/events` masih tanpa paginasi (`skip`), jadi maksimal ~20 event terdekat per liga.
