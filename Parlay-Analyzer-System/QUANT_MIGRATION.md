# Migrasi ke Mesin Probabilitas Deterministik

Dokumen ini mencatat **apa yang sudah dikerjakan**, **apa yang sengaja belum**,
dan **data apa yang dibutuhkan** sebelum keputusan bet boleh berubah.

Status: Fase 0 selesai · Fase 1 selesai dalam mode *shadow* (tidak mengubah bet).

---

## Fase 0 — Berhenti menambah kerusakan ✅

| Perubahan | File | Alasan |
|---|---|---|
| `performance_log` dihapus dari prompt | `services/ai-analysis.ts` | 5 baris W/L tidak membawa sinyal; instruksi "sesuaikan kepercayaan berdasarkan tren di atas" membuat model mengejar noise |
| `generateLossLesson()` → `generateProcessLesson()` | `services/settlement.ts` | Pelajaran hanya untuk kegagalan **proses** yang terverifikasi (probabilitas tidak tersimpan, odds tidak tercatat, confidence hilang). Kekalahan biasa = variance, tidak dipelajari |
| Cap stake 5% → **2%** | `lib/kelly-criterion.ts` | Galat 3 poin pada `p` bisa menggandakan stake; `p` sendiri masih estimasi |
| `MIN_TRAINING_SAMPLES` 20 → **100** | `services/prompt-learning.ts` | 20 sampel tidak bisa membedakan perbaikan nyata dari noise |
| Gerbang `geminiConfidence` dihapus | `services/prompt-learning.ts` | Model tidak boleh menilai proposalnya sendiri; dicatat untuk audit saja |

**Efek:** tidak ada lagi umpan balik LLM yang mengejar noise.

---

## Fase 1 — Mesin deterministik (mode shadow) ✅

### Modul yang disalin

`artifacts/api-server/src/lib/quant/` — 10 modul murni TypeScript, tanpa dependensi:

```
devig.ts        hapus margin bandar (Shin / power / proporsional)
poisson.ts      matriks skor Dixon-Coles, garis seperempat, invers pasar → λ
strength.ts     statistik tim → λ dengan shrinkage Bayesian
blend.ts        pooling model×pasar, fitBlendWeight (pembelajaran terukur)
kelly.ts        staking sadar ketidakpastian (z·σ, fractional, cap)
parlay.ts       korelasi, skenario pesimis, titik impas bias
evaluation.ts   CLV, Brier, kalibrasi, bootstrap, vonis
pipeline.ts     analyzeMatch() — orkestrasi + gerbang keputusan
llm-contract.ts PERSONA_V5, classifyResult
index.ts        barrel
```

### Adapter (ditulis khusus untuk data repo ini)

`lib/quant/adapter.ts` — menjembatani data Supabase yang **tidak bersih** ke
kontrak mesin yang bersih. Setiap nilai divalidasi; yang tidak valid **ditolak**,
bukan ditebak.

### Hasil terhadap data nyata

Premier League 2026-27 dari `team_season_stats` (16 tim valid):

```
rata-rata liga : 1.772 gol kandang / 1.354 gol tandang
Arsenal vs Chelsea (odds sintetis 2.10 / 3.60 / 3.40):
  overround pasar   : 4.81% (metode Shin)
  fair 1X2          : 46.9% / 26.8% / 26.2%
  market λ          : 1.56 / 1.16  (fitError 2.6e-4)
  model  λ          : 2.01 / 1.23  (reliability 0.600)
  final  λ          : 1.63 / 1.17  (modelWeight 0.180)
  keputusan         : NO_BET
```

**NO_BET adalah hasil yang benar.** Setelah margin dibuang dengan benar, tidak ada
satu pun market yang melewati ambang EV 3% + EV konservatif > 0.

### Shadow logging

`services/quant-shadow.ts` dipanggil di akhir `analyzeFixture()`, **setelah**
prediksi disimpan dan **tanpa menyentuh** rekomendasi. Setiap market yang
dihargai mesin ditulis ke `prediction_selections`.

- Dijalankan setelah prediksi tersimpan → tidak ada perubahan perilaku
- Kegagalan ditelan (`logger.warn`) → batch scan tidak pernah gagal karenanya
- Baris ditulis **sebelum kick-off** → data out-of-sample yang bersih

---

## Temuan data yang harus diperbaiki sebelum Fase 2

Audit 301 baris `team_season_stats` (2026-11-09):

| Masalah | Jumlah | Dampak |
|---|---|---|
| `stats_goals_scored` == `stats_goals_conceded` (identik) | 83 (28%) | Model tidak bisa membedakan serang/bertahan |
| `stats_goals_scored` kosong | 76 (25%) | Tim tidak bisa dimodelkan |
| Blok `scored` berlabel "Conceded" | 19 | Nilai menyerang ditolak adapter |
| Tim terdaftar di liga yang salah (Real Madrid di EPL) | ≥4 | Rata-rata liga terdistorsi |
| Nama duplikat dengan angka berbeda | Espanyol, Getafe, Real Betis, Levante | λ berubah tergantung baris terpilih |

Adapter menangani semuanya secara defensif (tolak + `warnings`), tetapi **akarnya
belum diperbaiki**.

---

## Cara membaca hasil setelah beberapa minggu

```sql
-- Apakah mesin lebih baik dari pasar? (log-loss pada selection yang dihargai)
SELECT family,
       COUNT(*) AS n,
       ROUND(AVG(ev)::numeric, 4)        AS ev_diklaim,
       ROUND(AVG(p_final)::numeric, 4)   AS p_model,
       ROUND(AVG(p_market_fair)::numeric,4) AS p_pasar
FROM prediction_selections
WHERE outcome IS NOT NULL
GROUP BY family;

-- Kalibrasi per bin probabilitas
SELECT width_bucket(p_final, 0.3, 0.7, 8) AS bin,
       COUNT(*) AS n,
       ROUND(AVG(p_final)::numeric, 3)  AS prediksi,
       ROUND(AVG(CASE WHEN outcome IN ('win','half_win') THEN 1 ELSE 0 END)::numeric, 3) AS aktual
FROM prediction_selections
WHERE outcome IS NOT NULL AND p_final BETWEEN 0.3 AND 0.7
GROUP BY bin ORDER BY bin;
```

Gerbang untuk menaikkan risiko (dari dokumen review):

- ≥ 300 selection selesai pada `model_version` yang sama
- CLV rata-rata > 0 dengan t-stat ≥ 2
- Skill log-loss vs pasar > 0
- Kalibrasi tiap bin tidak menyimpang > 5 poin (n ≥ 20)

ROI sebaiknya **tidak** dipakai sebagai gerbang: pada n=300 dan odds ~2.0,
deviasi standar ROI sekitar ±5.8% bahkan ketika modelnya sempurna.

---

## Yang sengaja BELUM dilakukan

1. **Keputusan bet belum diambil alih mesin.** LLM masih menentukan; mesin hanya
   mencatat. Ini disengaja sampai data kalibrasi cukup.
2. **`fixtures` hampir tidak punya skor akhir** (1–24 dari 100+ per liga),
   sehingga settlement dari skor masih bergantung sumber lain.
3. **CLV belum bisa dihitung** — butuh job closing-odds T-10 menit (Fase 2).
4. **Tabel `teams` / `team_aliases` dibuat tapi belum diisi.**
5. **Pembersihan data lintas-liga belum dilakukan** — perlu file CSV aslinya
   untuk tahu apakah masalahnya di file atau di proses upload.

---

## Verifikasi

- `tsc --build` + typecheck API & frontend: bersih
- **97 tes lulus** (23 baru: 22 adapter + 1 cap stake)
- `node build.mjs` → `dist/index.mjs` (2.5 MB)
- Smoke test: `/api/healthz` 200, `/api/analyze/batch` 401, `/api/csv/upload` 503
- Migrasi `20261110_quant_ledger.sql` diterapkan ke `hqbuwfyiqfxpnpdlgcru`
- Upsert `prediction_selections` diuji dengan data nyata (lalu dihapus)
