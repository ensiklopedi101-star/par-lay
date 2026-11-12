# Posisi Fase 0–4

Diukur pada 2026-11-10 dari Supabase `hqbuwfyiqfxpnpdlgcru` dan kode di repo.
Definisi fase diambil dari `football-betting-system-review (1)/src/lib/audit-data.ts`
(baris 491–535), bukan dari ingatan.

---

## Pembaruan 2026-11-12 — penghalang Fase 1 ternyata bukan mesin quant

PR #12 (bookmaker 1xbet/M88) **berhasil**: `odds_history` berisi 203 baris
`1xbet` dan 15 baris `M88`, `errors = 0`. Tetapi verifikasi pasca-merge
menemukan **automasi tidak pernah berjalan sama sekali**:

| Temuan | Bukti |
| --- | --- |
| Cron Vercel selalu 401 | hanya menerima `?token=`/`x-cron-secret`; Vercel mengirim `Authorization: Bearer` |
| Workflow GitHub tidak terdaftar | file berada di subfolder → `gh workflow list` kosong, API 404 |
| Cron harian dipotong sebelum analisis | `maxDuration: 60` vs 7 liga disapu lebih dulu |
| Sync "fire-and-forget" | run 568 tertinggal `running` dengan `events_fetched = 0` |

Karena itu `prediction_selections = 0` bukan kegagalan Fase 1, melainkan tidak
adanya pemanggil. Perbaikan, bukti, dan langkah verifikasi ada di
**`AUTOMATION_RECOVERY.md`**. Ringkasnya: auth Bearer, workflow dipindah ke
akar repo, urutan daily baru (analisis dijamin dapat waktu), sync ditunggu, dan
penyapu run basi.

Setelah PR ini di-merge dan secrets GitHub diisi, uji kelulusan Fase 1 tetap
sama: **`prediction_selections` > 0** setelah satu analisis nyata.

---

## Ringkasan

| Fase | Isi | Status | Bukti |
| --- | --- | --- | --- |
| 0 | Berhenti menambah kerusakan | ✅ **selesai** | 5 perubahan terpasang, 97→104 tes lulus |
| 1 | Ganti penghasil probabilitas | ⚠️ **kode selesai, belum pernah jalan** | `prediction_selections` = **0 baris** |
| 2 | Perbaiki data & ukuran kebenaran | 🟡 **~80%** | closing-odds + outcome settlement dibangun; harga sharp belum |
| 3 | Kumpulkan bukti | ⏸️ **terblokir** | Butuh data dari Fase 1 & 2 |
| 4 | Naik kelas hanya jika terbukti | ⏸️ **belum relevan** | Menunggu Fase 3 |

---

## Fase 0 — selesai ✅

Semua butir di rencana sudah terpasang:

| Butir rencana | Status | File |
| --- | --- | --- |
| Hapus blok `performance_log` & lessons WIN/LOSS dari prompt | ✅ | `services/ai-analysis.ts` |
| Cap stake ≤ 2%, matikan bucket 5% | ✅ | `lib/kelly-criterion.ts` |
| Matikan auto-promotion sampai gerbang statistik aktif | ✅ | `services/prompt-learning.ts` (`MIN_TRAINING_SAMPLES` 20 → 100, gerbang `geminiConfidence` dihapus) |
| Tambah kolom `p_market_fair`, `odds_close`, `model_version` | ✅ | diverifikasi ada di `ai_predictions` |

Catatan: `odds_close` **kolomnya ada tapi belum pernah diisi** — tidak ada job
yang menulisnya. Lihat Fase 2.

---

## Fase 1 — kode lengkap, tapi **belum menghasilkan satu baris pun**

### Yang sudah ada

- 10 modul murni di `lib/quant/` + `adapter.ts` (22 tes)
- `analyzeMatch()` memanggil semuanya
- `services/quant-shadow.ts` (`QUANT_MODEL_VERSION = 2`) dipanggil di
  `ai-analysis.ts:1731`, di dalam `try/catch`, **setelah** prediksi disimpan
- Tabel `prediction_selections` (19 kolom) sudah dibuat

### Kenapa nol

```
prediction_selections : 0 baris
ai_predictions        : 81 baris, terakhir 2026-10-25
prediksi 7 hari       : 0
```

Rantai sebabnya sederhana dan **bersih**:

1. `shadowLogQuantAnalysis` hanya dipanggil dari dalam `analyzeFixture()`
2. `analyzeFixture()` hanya dipanggil dari `routes/analyze.ts` — yaitu saat
   admin menekan analisis, atau batch scan
3. **Batch scan tidak pernah jalan** karena tidak ada fixture yang bisa discan
   (jeda internasional, sudah dibahas di `FIXTURES_DIAGNOSIS.md`)
4. Maka sejak kode shadow dipasang, belum ada satu pun pemanggilan

**Ini bukan bug.** Kode dan tesnya benar. Yang belum terjadi adalah
kesempatannya berjalan. Konsekuensinya: kita belum tahu apakah
`shadowLogQuantAnalysis` berhasil di data produksi — hanya terbukti di tes
dengan data buatan.

### Yang dibutuhkan agar Fase 1 bisa dinilai

Satu analisis nyata pada satu fixture nyata. Setelah EPL kembali **21 November**,
itu akan terjadi sendiri. Kalau ingin lebih cepat, satu fixture Liga Arab Saudi
atau liga yang sedang aktif juga cukup — asalkan `team_season_stats` untuk
kedua tim tersedia, karena `adapter.ts` akan menolak baris yang tidak valid.

**Uji kelulusan Fase 1:** setelah satu analisis, `prediction_selections` > 0.
Kalau tetap 0 padahal `ai_predictions` bertambah, berarti ada yang gagal dan
tertelan oleh `catch` di baris 1752 — perlu dibaca dari log, bukan dari DB.

---

## Fase 2 — sekitar 55%, dan sisanya butuh keputusan Anda

Rencana Fase 2 punya 4 butir. Statusnya berbeda-beda:

### ✅ Butir 2 — "Tabel teams/team_aliases kanonik; ingest tak lagi skip diam-diam"

**Selesai**, dan ini yang terbesar:

| Komponen | Status |
| --- | --- |
| `teams` (175 baris, 4 kolom) | ✅ terisi |
| `team_aliases` | ⚠️ **tabel ada, 4 kolom, 0 baris** |
| Ingest tak skip diam-diam | ✅ `stats-ingest.ts` kini melaporkan `results[]` per tim + 422 |

Tapi ada temuan yang perlu Anda tahu: **`teams` dan `team_aliases` tidak
dirujuk oleh satu baris kode pun.** Saya grep seluruh `api-server/src` — tidak
ada `from("teams")` atau `from("team_aliases")`. Keduanya tabel yatim.

Pekerjaan identitas tim yang benar-benar dipakai produksi justru ada di tempat
lain: fungsi SQL `team_key()` + unique index
`team_season_stats_league_season_teamkey_uniq`, yang **sudah aktif dan bekerja**
(301 → 233 baris, duplikat 0).

Jadi butir ini **berfungsi**, hanya lewat mekanisme yang berbeda dari yang
ditulis di rencana. Tidak ada yang perlu diperbaiki; dokumennya yang perlu
diperbarui.

### ✅ Butir 1 — "Job closing-odds T-10 menit" — **DIBANGUN**

| Komponen | File | Isi |
|---|---|---|
| Pemilihan harga penutup | `lib/closing-odds.ts` | snapshot terakhir sebelum kick-off, de-vig `shin` |
| Job pengisian | `services/closing-odds-capture.ts` | `runClosingOddsCapture()` |
| Endpoint | `routes/cron.ts` | `?action=closing` |
| Jadwal | `scheduler/index.ts` | tiap 5 menit |

**Biaya kuota nol.** Job membaca `odds_movement_history` yang sudah tersimpan
oleh sync odds; tidak ada panggilan ke penyedia. Itu memenuhi syarat "hemat
kuota" di rencana.

Tiga penjagaan yang diuji:
- Snapshot **setelah** kick-off tidak dipakai (harga in-play bukan harga tutup)
- Fixture yang kick-off-nya masih > 10 menit **dilewati** — harga 60 menit
  sebelum kick-off bukan harga penutup
- `odds_close` yang sudah terisi **tidak ditimpa**, jadi job aman dijalankan
  berulang

### 🔴 Lubang yang ditemukan: `outcome` tidak pernah diisi siapa pun

Ini tidak tertulis di rencana Fase 2, tapi akan menggagalkan Fase 3 sepenuhnya.

`settlement.ts` hanya menulis ke `ai_predictions`. **Tidak ada satu baris kode
pun** yang menulis `prediction_selections.outcome`. Artinya meski
`odds_close` terisi dan CLV bisa dihitung, baris "≥ 300 selection **ber-hasil**"
tidak akan pernah tercapai — berapa lama pun ditunggu.

Sudah dibangun:

| Komponen | File | Isi |
|---|---|---|
| Penilai market | `lib/selection-outcome.ts` | `outcomeOfMarket()` dari skor akhir |
| Job pengisian | `services/closing-odds-capture.ts` | `runOutcomeSettlement()` |
| Endpoint | `routes/cron.ts` | `?action=outcomes` |
| Jadwal | `scheduler/index.ts` | tiap jam (menit ke-20) |

Menangani ML, BTTS, Totals (termasuk garis seperempat 2.25/2.75), dan AH
dengan pencerminan garis kandang→tandang. Mengembalikan `null` — bukan
menebak — untuk skor kosong atau `market_key` tak dikenal.

**Catatan penting:** fungsi ini bisa dinilai dari skor saja. Sesuai catatan
`QUANT_MIGRATION.md`, `fixtures` hampir tidak punya skor akhir. Jadi job
`outcomes` akan menghasilkan nol sampai skor terisi — itu keterbatasan data,
bukan bug.'', 1)

s = s.replace(### ❌ Butir 3 — "Satu sumber harga sharp sebagai acuan fair & closing"

### ❌ Butir 3 — "Satu sumber harga sharp sebagai acuan fair & closing"

**Belum ada.** `scheduler_config.bookmakers = ["Bet365"]`, dan komentar di
`services/odds-fetcher.ts` menjelaskan alasannya: plan gratis menolak bandar
sharp/exchange (Sbobet dan sejenisnya ditolak).

Jadi ini bukan sesuatu yang bisa dikerjakan di kode. Ini **keputusan biaya**:
butuh plan berbayar odds-api.io untuk mendapat harga sharp.

### ❌ Butir 4 — "Sumber line-up/cedera → ekstraksi berbukti (PERSONA_V5)"

**Belum ada.** `quant-shadow.ts` baris 1727 menjelaskan sendiri: prompt sekarang
meminta prosa + probabilitas, bukan kontrak λ-adjustment, jadi
`llmAdjustment: null` dikirim ke mesin. Mesin berjalan tanpa penyesuaian LLM —
memang begitu desain baseline-nya, tapi berarti butir ini belum dikerjakan.

---

## Fase 3 — masih terblokir, tapi penghalangnya berkurang

Sebelum pekerjaan di atas, Fase 3 terhalang **tiga** hal. Sekarang tinggal dua:

| Penghalang | Status |
|---|---|
| `odds_close` tidak pernah terisi → CLV mustahil | ✅ **dibangun** |
| `outcome` tidak pernah terisi → "ber-hasil" mustahil | ✅ **dibangun** |
| Belum ada selection sama sekali | ⏳ menunggu fixture kembali (21 Nov) |

Artinya: begitu fixture mengalir dan analisis berjalan, ledger akan terisi
otomatis tanpa pekerjaan tambahan.

Fase 3 minta "≥ 300 selection ber-hasil". Kondisinya sekarang:

```
prediction_selections          : 0
selection dengan outcome       : 0
```

Mustahil dievaluasi. Yang dibutuhkan berurutan:

1. Fixtures kembali mengalir (21 Nov)
2. `prediction_selections` mulai terisi (Fase 1 terbukti jalan)
3. `odds_close` mulai terisi (Fase 2 butir 1)
4. 300 selection terkumpul → ini **berbulan-bulan**, bukan berminggu-minggu

Untuk memberi gambaran: pada 14–26 Oktober, sync menghasilkan 10 fixture per
siklus dan analisis manual ~1–6 prediksi per hari. Pada laju itu, 300 selection
butuh waktu lama. Justru karena satu fixture menghasilkan **banyak** baris
selection (satu per market), 300 bisa tercapai lebih cepat daripada 300 bet.

---

## Angka verifikasi

- Tes: **141 lulus** (dari 104) — 21 tes `closing-odds`, 8 tes `selection-outcome`,
  8 tes orkestrasi job
- `tsc --build` bersih, `tsc -p api-server` bersih, `node build.mjs` sukses
- Smoke test: `/api/cron?action=closing` → 200 + ringkasan nol,
  `/api/cron?action=outcomes` → 200 + ringkasan nol, tanpa Supabase tidak crash
- 401 bila `token` salah — diuji ulang

## Urutan yang saya sarankan

| # | Langkah | Kenapa sekarang |
| --- | --- | --- |
| 1 | Tunggu 21 Nov, verifikasi `prediction_selections` > 0 | Membuktikan Fase 1 benar-benar jalan |
| 2 | Bangun job closing-odds T-10 | Tanpa ini Fase 3 mustahil, dan ini satu-satunya butir Fase 2 yang murni kode |
| 3 | Rapikan dokumen: butir 2 Fase 2 sudah selesai lewat jalur lain | Supaya tidak dikerjakan dua kali |
| 4 | Putuskan: bayar plan sharp odds atau tidak | Ini keputusan Anda, bukan keputusan kode |

**Langkah 2 bisa saya kerjakan sekarang** tanpa menunggu 21 November: job-nya
hanya membaca fixture yang diprediksi dan menulis `odds_close` sebelum kick-off.
Bisa saya buat, tapi tidak bisa saya uji lawan jadwal nyata sampai ada fixture
yang akan datang.
