# Posisi Fase 0–4

Diukur pada 2026-11-10 dari Supabase `hqbuwfyiqfxpnpdlgcru` dan kode di repo.
Definisi fase diambil dari `football-betting-system-review (1)/src/lib/audit-data.ts`
(baris 491–535), bukan dari ingatan.

---

## Ringkasan

| Fase | Isi | Status | Bukti |
| --- | --- | --- | --- |
| 0 | Berhenti menambah kerusakan | ✅ **selesai** | 5 perubahan terpasang, 97→104 tes lulus |
| 1 | Ganti penghasil probabilitas | ⚠️ **kode selesai, belum pernah jalan** | `prediction_selections` = **0 baris** |
| 2 | Perbaiki data & ukuran kebenaran | 🟡 **~55%** | Lapis 1–3 selesai; closing-odds & aliases belum |
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

### ❌ Butir 1 — "Job closing-odds T-10 menit"

**Belum ada sama sekali.** Saya grep `closing|closingOdds|odds_close` di seluruh
`api-server/src`: **nol hasil**. Kolom `odds_close` dan `close_fair_prob` ada di
`prediction_selections`, tapi tidak ada kode yang menulisnya.

Fungsi perhitungannya sudah ada (`clvOf`, `summarizeLedger` di
`lib/quant/evaluation.ts`), jadi yang kosong hanya **pengambilan datanya**.

Ini butir terpenting Fase 2, karena tanpa `odds_close`:
- CLV tidak bisa dihitung
- Gerbang Fase 3 (`CLV > 0, t-stat ≥ 2`) tidak bisa dievaluasi
- Vonis "supported" atau "refuted" tidak akan pernah keluar

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

## Fase 3 — terblokir, bukan tertunda

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
