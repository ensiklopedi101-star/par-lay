---
name: AI Backend Rules
author: Replit Agent
updated: 2026-06-14
---

# PERHATIAN UNTUK AI ASSISTANT: Sebelum Anda menulis, memodifikasi, atau melakukan refactor pada fungsi backend, fetching data, atau routing di proyek ini, ANDA WAJIB MEMBACA DAN MEMATUHI ATURAN DI FILE INI.

## 1. Prinsip Off-Loading (Jangan Bebani Gemini dengan Matematika Dasar)

Gemini AI (LLM) buruk dalam kalkulasi desimal yang kompleks. **JANGAN** menyuruh Gemini menghitung nilai Expected Value (EV), perubahan selisih odds (Sharp Money), atau kalkulasi Win/Loss settlement.

**SEMUA perhitungan matematis harus dilakukan di Backend (TypeScript/Node.js).**

- Hitung % tren penurunan odds (Misal: Odds turun 15% dari 2.10 ke 1.80).
- Hitung status Settlement (Asian Handicap 0.25, 0.75, dsb) murni menggunakan logika if/else di kode Anda.
- Kirimkan hasil perhitungan yang sudah matang (angka final) tersebut ke Gemini agar Gemini hanya fokus pada **Reasoning (Analisis Logis)**.

## 2. Penanganan Data Kosong (Graceful Degradation)

Saat menggabungkan 11 laci statistik dari `team_season_stats` atau data `league_standings`, **SANGAT MUNGKIN** ada data yang null atau belum ter-update.

- **JANGAN** biarkan sistem crash atau melempar error 500 hanya karena 1 kolom statistik kosong.
- Gunakan **Optional Chaining (?.)** dan **Nullish Coalescing (??)**.
- Berikan label eksplisit **"DATA_UNAVAILABLE"** pada payload yang dikirim ke Gemini agar LLM tahu bahwa ia harus menganalisis tanpa indikator tersebut, alih-alih berhalusinasi.

## 3. Manajemen Rate-Limit & Optimasi Fetching

Provider data kita (Odds-API & API Klasemen) memiliki rate-limit (batas request).

- Saat melakukan agregasi data batch, **hindari** melakukan looping request API di dalam iterasi array (Promise.all secara membabi buta).
- Gunakan sistem **Caching memori** atau baca langsung dari Supabase untuk data yang tidak berubah setiap menit (seperti statistik mingguan dan klasemen). Hanya tembak API eksternal untuk Odds terkini dan Settlement hasil akhir.

## 4. Struktur Payload untuk LLM (Context Window Optimization)

Saat merangkai data untuk dikirim ke Gemini dalam `POST /api/analyze/auto-parlay`, format JSON harus sangat padat (minify) untuk menghemat token.

**Hapus kunci (keys) yang tidak relevan.** Struktur payload harus berisi:

- **ai_memory**: 5 log performa terakhir dari `performance_log`.
- **fixtures_data**: Array berisi laga yang tersedia, lengkap dengan `current_odds`, `sharp_money_trend` (hasil kalkulasi backend dari `odds_movement_history`), `home_team_stats` (11 JSONB + standings), dan `away_team_stats` (11 JSONB + standings).

## 5. Aturan Insert vs Upsert

- **UPSERT (ON CONFLICT DO UPDATE)**: Wajib untuk tabel state: `fixtures`, `team_season_stats`, `league_standings`.
- **INSERT (Append)**: Wajib untuk tabel time-series: `odds_movement_history`, `ai_predictions`, `performance_log`.

## 6. Audit Skema

- **JANGAN** membuat tabel/kolom baru tanpa persetujuan user. Jika butuh tabel baru, berikan script SQL agar user eksekusi manual di Supabase untuk menghemat kredit Replit.
- File Audit: Pindai folder/file eksisting. JANGAN membuat file baru jika fungsi serupa sudah ada (misal: settlement atau cron-job). Lakukan refactor.

## 7. Protokol Keamanan

- **JANGAN** hardcode season/tahun. Gunakan `new Date().getFullYear()` atau ekstrak dari data pertandingan.
- **JANGAN** simpan API key di file `.env` atau kode. Gunakan Replit Secrets.
- **JANGAN** push ke GitHub tanpa permintaan user.

---

*Ingat: Anda adalah otak di balik layar yang menyiapkan bahan baku kualitas tinggi. Semakin rapi dan presisi kode fetching & calculating yang Anda buat, semakin tajam hasil prediksi Gemini.*
