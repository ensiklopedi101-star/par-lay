# Parlay Analyzer System — Terminal.BET

> **Versi:** 1.0  
> **Platform:** Replit (pnpm monorepo)  
> **Tech Stack:** React 19 + Vite + Tailwind CSS v4 + Express.js + Drizzle ORM + Supabase + Google Gemini AI

---

## 1. Gambaran Proyek

Parlay Analyzer System (Terminal.BET) adalah platform analisis pertandingan sepak bola dengan analisis AI berbasis data. Aplikasi ini menyinkronkan data pertandingan dan odds dari API eksternal, menganalisisnya dengan Google Gemini AI untuk mencari value bet, dan mengelola parlay (taruhan multi-pertandingan) dengan fitur settlement otomatis.

### Arsitektur

```
Parlay-Analyzer-System/
├── artifacts/
│   ├── api-server/         # Backend Express.js (port 8080)
│   ├── parlay-app/         # Frontend React + Vite (port 5000)
│   └── mockup-sandbox/     # Sandbox untuk UI prototyping
└── lib/
    ├── db/                 # Drizzle ORM schemas + database client
    ├── api-spec/           # OpenAPI spec + Orval config
    ├── api-zod/            # Zod schemas untuk validasi
    ├── api-client-react/   # React Query hooks (auto-generated)
    └── supabase-client/    # Supabase client wrapper
```

---

## 2. Fitur Utama

### A. Sinkronisasi Data Pertandingan
- **Odds Sync:** Setiap 3 jam, backend mengambil data pertandingan dan odds dari `odds-api.io` untuk liga yang aktif.
- **Liga yang Didukung:** Premier League, Championship, La Liga, Serie A, Ligue 1, Eredivisie, Bundesliga, K-League 1, CSL, J1 League.
- **Bookmaker:** Bet365, Sbobet (default, bisa dikonfigurasi).

### B. AI Analysis (Quant Sniper v3)
- **Engine:** Google Gemini (`gemini-2.0-flash`).
- **Metodologi:** Value Betting berbasis Expected Value (EV).
  - Hitung probabilitas nyata dari 11 statistik tim (xG, form, BTTS%, Over%, dll).
  - Bandingkan dengan probabilitas implisit bandar: `(1 / Odds) × 100%`.
  - Jika probabilitas nyata > probabilitas bandar → **VALUE BET**.
- **Analisis Tren Pasar:** Membaca pergerakan odds (sharp money detection).
- **RAG (Retrieval-Augmented Generation):** Menggunakan `lessons_learned` dari pertandingan sebelumnya untuk memperkaya konteks analisis.

### C. Settlement Otomatis
- **Schedule:** Harian jam 06:00 server time.
- **Proses:**
  1. Ambil prediksi aktif dari `ai_predictions`.
  2. Cek fixture yang sudah selesai (status FT/AET/PEN) beserta skor.
  3. Hitung WIN/LOSS secara matematis berdasarkan pasaran bet.
  4. **LOSS:** Gemini generate evaluasi kenapa salah → simpan ke `lessons_learned`.
  5. **WIN:** Simpan catatan referensi positif ke `lessons_learned`.

### D. Odds Movement Tracking
- Setiap kali odds di-sync, snapshot pergerakan odds disimpan ke `odds_movement_history`.
- Deduplication: hanya menyimpan jika odds berubah signifikan (toleransi 0.005).
- Digunakan untuk analisis sharp money dan trend pasar.

### E. CSV Upload (Statistik Tim)
- Upload file CSV untuk mengisi data `team_season_stats` (xG, BTTS, Form, dll.).
- 11+ metrik statistik yang digunakan AI untuk analisis.
- Password upload: `parlay2024` (default, bisa di-set via `CSV_UPLOAD_PASSWORD` env).

---

## 3. Struktur Database (Supabase)

### Tabel Utama

| Tabel | Tujuan |
|-------|--------|
| `fixtures` | Data pertandingan (tim, tanggal, liga, status, skor) |
| `odds_history` | Odds terkini dari bookmaker per pertandingan |
| `odds_movement_history` | Histori pergerakan odds (snapshot) |
| `ai_predictions` | Hasil analisis AI per pertandingan |
| `lessons_learned` | Pelajaran dari settlement (RAG knowledge base) |
| `team_season_stats` | Statistik tim (11+ metrik) untuk analisis AI |
| `scheduler_config` | Konfigurasi scheduler (liga, bookmaker, AI persona) |
| `leagues` | Daftar liga yang aktif |

### Kolom Penting di `ai_predictions`

```
- id, fixture_id, home_team, away_team, league
- prediction_text (output AI)
- best_market, expected_value (ev_at_analysis)
- home_score, away_score (saat settlement)
- market_bet, settled_at
- status: active | win | loss | no_bet | settled_manual
```

### View Penting

- `v_active_parlays` — Parlay yang masih aktif.
- `v_odds_movement` — Agregasi pergerakan odds.

---

## 4. API Routes

### `/api/odds/*`
- `POST /sync/trigger` — Trigger manual odds sync.
- `GET /odds/events` — List pertandingan (filter: liga, limit).
- `GET /odds/events/:id` — Detail odds per pertandingan.
- `GET /odds/leagues` — Daftar liga default.
- `GET /odds/available-leagues` — Liga yang punya data aktif.
- `GET /odds/bookmakers` — List bookmaker.

### `/api/analyze/*`
- `POST /analyze/:fixtureId` — Jalankan analisis AI baru.
- `GET /analyze/:fixtureId` — Ambil prediksi AI terbaru (cached).

### `/api/config/*`
- `GET /config` & `POST /config` — Baca/update scheduler config.
- `GET /catalog` — Daftar liga dan pasaran yang tersedia.
- `POST /sync/settle` — Trigger manual settlement.
- `GET /sync/status` — Status sinkronisasi terakhir.

### `/api/supabase/*`
- `GET /supabase/fixtures` — Data pertandingan dari Supabase.
- `GET /supabase/odds` — Data odds dari Supabase.
- `GET /supabase/parlays` — Parlay aktif.
- `GET /supabase/standings` — Klasemen.
- `GET /supabase/odds-movement` — Histori pergerakan odds.
- `GET /supabase/team-season-stats` — Statistik tim.

### `/api/csv/*`
- `POST /csv/upload` — Upload CSV statistik tim.
- `GET /csv/teams` — List tim untuk dropdown upload.
- `POST /upload-csv` — Bulk upload season CSV.

### `/api/healthz`
- Health check endpoint.

---

## 5. Environment Variables & Secrets

### Wajib (Required)

| Secret | Digunakan Di | Deskripsi |
|--------|--------------|-----------|
| `SUPABASE_URL` | Backend + lib | URL Supabase project |
| `SUPABASE_SERVICE_ROLE_KEY` | Backend + lib | Service role key untuk akses database |

### Opsional (Optional tapi Penting)

| Secret | Digunakan Di | Deskripsi |
|--------|--------------|-----------|
| `GEMINI_API_KEY` | Backend | Google Gemini API untuk analisis AI |
| `ODDS_API_KEY` | Backend | API key dari odds-api.io untuk sync data |
| `CSV_UPLOAD_PASSWORD` | Backend | Password untuk upload CSV (default: `parlay2024`) |

### Runtime (Auto-managed by Replit)

| Var | Digunakan Di | Deskripsi |
|-----|--------------|-----------|
| `PORT` | Backend | Port server (8080) |
| `PORT` | Frontend | Port dev server (5000) |
| `BASE_PATH` | Frontend | Base path (/) |
| `DATABASE_URL` | — | Replit Helium DB (jika ada) |
| `REPLIT_DEV_DOMAIN` | — | Public URL dev server |

### Cara Mengatur

Gunakan **Replit Secrets tab** (Secrets di UI Replit) atau environment variables. **JANGAN** simpan API key di file `.env` atau kode.

### Secrets GitHub (Opsional)

| Secret | Digunakan Di | Deskripsi |
|--------|--------------|-----------|
| `GITHUB_ACCESS_TOKEN` | Git push | GitHub Personal Access Token untuk push ke repo |
| `GITHUB_REPO_URL` | Git push | URL repo GitHub (e.g., `https://github.com/free2vps/par-lay`) |

Gunakan token ini untuk push perubahan ke GitHub secara otomatis. Scope token: `repo`.

### Secrets Supabase Access Token (Opsional)

| Secret | Digunakan Di | Deskripsi |
|--------|--------------|-----------|
| `SUPABASE_ACCESS_TOKEN` | DDL/Schema | Management API token untuk DDL (CREATE TABLE, ALTER TABLE, dll) |

**Perbedaan penting:**
- `SUPABASE_SERVICE_ROLE_KEY` → hanya untuk DML (SELECT, INSERT, UPDATE, DELETE)
- `SUPABASE_ACCESS_TOKEN` → untuk DDL via Management API (`api.supabase.com/v1/projects/{ref}/database/query`)

Gunakan SUPABASE_ACCESS_TOKEN jika perlu mengubah schema database (menambah kolom, membuat tabel baru, dll).

---

## 6. Workflows & Deployment

### Workflows (Development)

| Workflow | Perintah | Port | Output |
|----------|----------|------|--------|
| **Start Backend** | `cd Parlay-Analyzer-System && PORT=8080 pnpm --filter @workspace/api-server run dev` | 8080 | Console |
| **Start application** | `cd Parlay-Analyzer-System && PORT=5000 BASE_PATH=/ pnpm --filter @workspace/parlay-app run dev` | 5000 | Webview |
| **Project** | Menjalankan backend + frontend secara paralel | — | — |

### Konfigurasi `.replit`

```toml
[workflows]
runButton = "Project"

[[workflows.workflow]]
name = "Project"
mode = "parallel"

[[workflows.workflow.tasks]]
task = "workflow.run"
args = "Start Backend"

[[workflows.workflow.tasks]]
task = "workflow.run"
args = "Start application"

[[ports]]
localPort = 5000
externalPort = 80

[[ports]]
localPort = 8080
externalPort = 8080
```

### Deployment

```toml
[deployment]
deploymentTarget = "autoscale"
run = ["bash", "-c", "cd Parlay-Analyzer-System && PORT=8080 pnpm --filter @workspace/api-server run start & PORT=5000 BASE_PATH=/ pnpm --filter @workspace/parlay-app run serve"]
build = ["bash", "-c", "cd Parlay-Analyzer-System && pnpm install && PORT=8080 pnpm --filter @workspace/api-server run build && PORT=5000 BASE_PATH=/ pnpm --filter @workspace/parlay-app run build"]
```

**Catatan Deployment:**
- Frontend build ke `dist/public` (Vite config).
- Backend build ke `dist/index.mjs` (esbuild).
- Frontend proxy `/api` ke `http://localhost:8080` saat dev.
- Saat production, backend harus dijalankan bersama frontend.

---

## 7. Cara Menjalankan (Quick Start)

```bash
# 1. Install dependencies
cd Parlay-Analyzer-System
pnpm install

# 2. Start backend (tab 1)
PORT=8080 pnpm --filter @workspace/api-server run dev

# 3. Start frontend (tab 2)
PORT=5000 BASE_PATH=/ pnpm --filter @workspace/parlay-app run dev
```

### Build & Serve (Production)

```bash
# Build backend
cd Parlay-Analyzer-System
PORT=8080 pnpm --filter @workspace/api-server run build

# Build frontend
PORT=5000 BASE_PATH=/ pnpm --filter @workspace/parlay-app run build

# Serve (backend & frontend)
PORT=8080 pnpm --filter @workspace/api-server run start &
PORT=5000 BASE_PATH=/ pnpm --filter @workspace/parlay-app run serve
```

---

## 8. Paket & Dependency

### Tech Stack

| Layer | Technology | Versi |
|-------|------------|-------|
| Frontend | React + Vite | React 19.1.0, Vite 7.3.2 |
| Styling | Tailwind CSS v4 | v4.1.14 |
| UI | Radix UI + Shadcn | — |
| Routing | Wouter | v3.3.5 |
| State | TanStack Query | v5.90.21 |
| Backend | Express.js | v5.2.1 |
| ORM | Drizzle ORM | v0.45.2 |
| Database | Supabase (PostgreSQL) | — |
| AI | Google Generative AI | v0.24.1 |
| Scheduler | node-cron | v4.2.1 |
| Logging | pino + pino-http | v9.14.0 |
| API Client | Orval | — |
| Validation | Zod | v3.25.76 |
| Build | esbuild | v0.27.3 |
| Monorepo | pnpm workspaces | — |

---

## 9. Penggunaan Fitur

### A. Dashboard
- Buka `/` untuk melihat overview sistem.
- Menampilkan: Total Events, Active Leagues, Last Sync, AI Parlays, Upcoming Fixtures.

### B. Fixtures
- Buka `/fixtures` untuk melihat daftar pertandingan.
- Klik pertandingan untuk melihat detail odds dan analisis AI.

### C. AI Parlays
- Buka `/parlays` untuk melihat parlay aktif.
- Klik "Analyze" pada pertandingan untuk generate prediksi AI.

### D. Settings
- Buka `/settings` untuk mengkonfigurasi:
  - Liga aktif (mana yang di-sync)
  - Bookmaker
  - AI persona (personality AI)
  - Interval sync

### E. CSV Upload
- Buka `/upload` untuk upload statistik tim.
- Password: `parlay2024` (default).

---

## 10. Debugging & Troubleshooting

### A. Backend tidak bisa connect ke Supabase
```
Error: Cannot read properties of null (reading 'from')
```
**Solusi:** Pastikan `SUPABASE_URL` dan `SUPABASE_SERVICE_ROLE_KEY` sudah di-set di Replit Secrets.

### B. Scheduler tidak jalan
```
ODDS_API_KEY not set — scheduler disabled.
```
**Solusi:** Set `ODDS_API_KEY` di Replit Secrets. Jika tidak ada, scheduler akan dimatikan (tidak fatal).

### C. AI Analysis gagal
```
GEMINI_API_KEY is not set
```
**Solusi:** Set `GEMINI_API_KEY` di Replit Secrets.

### D. Rate Limit dari Odds API
```
Rate limited fetching leagues — will retry next cycle
```
**Solusi:** Normal. API punya rate limit. Tunggu 3 jam untuk cycle berikutnya.

### E. Frontend tidak bisa connect ke API
```
Failed to load resource: the server responded with a status of 500
```
**Solusi:** Cek backend sudah jalan di port 8080. Vite proxy `/api` ke `http://localhost:8080`.

### F. Database Schema tidak sesuai
**Solusi:** Gunakan Drizzle ORM migrations. Jika Supabase schema belum ada, buat tabel melalui Supabase Dashboard atau gunakan management API.

### G. GitHub Push
```bash
# Pastikan semua perubahan sudah di-commit
git add .
git commit -m "update: deskripsi perubahan"
git push origin main
```
**Catatan:** Jika membutuhkan GITHUB_ACCESS_TOKEN, simpan di Replit Secrets dengan key `GITHUB_ACCESS_TOKEN`.

---

## 11. Catatan Teknis

### Authentication
- **Tidak ada user authentication.** Aplikasi ini adalah internal tool.
- Supabase digunakan hanya sebagai PostgreSQL data store (service role key).
- Tidak ada login, signup, atau session management.

### CSV Upload Security
- Password dilindungi dengan env var `CSV_UPLOAD_PASSWORD`.
- Default: `parlay2024`.

### AI Prompt System
- Persona AI bisa dikonfigurasi via `scheduler_config.ai_persona`.
- Default: "Quant Sniper v3" — analis kuantitatif untuk value betting.
- RAG: `lessons_learned` diinject ke prompt sebelum analisis.

### Odds Movement Deduplication
- Hanya menyimpan snapshot jika odds berubah > 0.005.
- Menghemat storage dan membuat tren lebih jelas.

### Settlement Math
- WIN/LOSS dihitung secara matematis murni dari skor.
- Tidak ada panggilan API eksternal saat settlement.
- Skor sudah disimpan oleh odds-fetcher saat sync.

---

## 12. Roadmap & Improvement Ideas

- [ ] Dark/Light mode toggle (saat ini dark mode saja).
- [ ] Multi-language support (saat ini Indonesia + English mixed).
- [ ] Real-time odds push (WebSocket) untuk pergerakan live.
- [ ] Mobile responsive optimization.
- [ ] Integration dengan Replit Auth jika ingin multi-user.
- [ ] Backup/restore database schema via Drizzle.
- [ ] Unit testing (saat ini belum ada).
- [ ] Docker support untuk local development.

---

## 13. User Preferences

```
Tidak ada preferensi spesifik yang diberikan user.
```

---

## 14. Changelog & Migration History

### 2026-06-14 — Import ke Replit
- **Migration:** Import dari eksternal ke Replit environment.
- **Secrets:** SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GEMINI_API_KEY, ODDS_API_KEY di-set via Replit Secrets.
- **Workflows:** Dibuat: `Start Backend` (port 8080), `Start application` (port 5000), `Project` (parallel).
- **Port:** 5000 (frontend) dan 8080 (backend) di-map di `.replit`.
- **Deployment:** Configured autoscale deployment.
- **Status:** Berjalan dengan normal. API berfungsi, AI analysis available, scheduler aktif.
- **GitHub:** `GITHUB_ACCESS_TOKEN` dan `GITHUB_REPO_URL` ditambahkan untuk push ke GitHub.
- **replit.md:** Dibuat untuk dokumentasi agar agent AI lain paham arsitektur dan alur kerja.
- **SUPABASE_ACCESS_TOKEN:** Ditambahkan untuk DDL access via Supabase Management API.

---

## 15. Kontak & Repository

- **GitHub Repository:** https://github.com/free2vps/par-lay
- **Stack:** Replit + React + Express + Supabase + Gemini AI
- **License:** Private

---

## 16. Catatan Kesinambungan — Revalidasi Prediksi (2026-08-05)

### Sudah selesai
- Menambahkan service revalidasi ringan untuk prediksi `ai_predictions` yang masih `active` dan fixture-nya belum kickoff.
- Service membaca odds terbaru, membandingkan `best_odds` dan `ev_at_analysis`, lalu memberi status terpisah: `keep`, `review`, atau `invalidated`.
- Status settlement tetap memakai kolom `status`; revalidasi tidak mengubah `parlays` atau `parlay_legs`, sehingga histori parlay yang sudah dibuat tetap immutable.
- Menambahkan kolom live Supabase `revalidation_status`, `revalidation_note`, dan `last_revalidated_at`, plus migration lokal `supabase/migrations/20260805_prediction_revalidation.sql`.
- Analisis baru sekarang menyimpan `best_odds` sebagai baseline revalidasi.
- Scheduler menjalankan revalidasi setiap 3 jam pada menit ke-15, setelah cadence odds sync; endpoint admin manual tersedia di `POST /api/sync/revalidate`.
- Endpoint cron aman tersedia sebagai `GET /api/cron?token=<CRON_SECRET>&action=revalidate`.
- Modal analisis frontend menampilkan status dan alasan revalidasi.
- Typecheck monorepo sudah bersih dan API workflow sudah berhasil restart.

### Batasan yang sengaja dipertahankan
- Revalidasi ini tidak memanggil Gemini ulang. Ia hanya mengukur perubahan harga/EV dan memberi sinyal risiko agar quota AI tidak terbakar.
- Belum ada intelligence lineup/cedera atau versioning prediksi. Itu adalah pekerjaan lanjutan yang perlu desain dan quota budget terpisah.

### Jika dilanjutkan
- Tambahkan tombol/filter dashboard untuk menampilkan semua prediksi `review` dan `invalidated`.
- Jika diperlukan, tambahkan AI re-call hanya untuk trigger tertentu (misalnya EV menjadi negatif atau odds turun keras), dengan versioning dan aturan jelas untuk parlay yang belum ditempatkan.

---

**Dokumentasi ini dibuat untuk agen AI Replit.** Update file ini setiap kali ada perubahan signifikan pada arsitektur, fitur, atau konfigurasi proyek.
