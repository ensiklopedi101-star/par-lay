# Playbook Kuantitatif — apa yang benar-benar dilakukan sistem taruhan yang menang

Dokumen ini menjawab satu pertanyaan: **secara matematis, apa yang membuat sistem taruhan
menguntungkan, dan apa yang harus kita ubah agar sistem ini termasuk di dalamnya?**

Disusun 12 November 2026 dari riset literatur publik, lalu dibandingkan dengan data nyata
project `hqbuwfyiqfxpnpdlgcru`. Angka-angka di bawah adalah hasil pengukuran, bukan asumsi.

---

## 1. Ringkasan: lima hal yang membedakan sistem menang dari kalah

| # | Praktik | Kenapa | Kondisi kita sekarang |
|---|---------|--------|-----------------------|
| 1 | **Harga pasar dibersihkan dari margin (devig)** sebelum dibandingkan dengan model | `1/odds` selalu > 100%; tanpa devig, "edge" hanyalah margin bandar yang dibalik | ❌ devig hanya ada di mesin kuant; jalur LLM tidak memakainya |
| 2 | **EV dihitung dari probabilitas sendiri**, tidak pernah diterima dari model | Angka EV/probabilitas dari LLM bukan hasil pengukuran | ⚠️ kode *sudah* menghitung `p × odds − 1`, tetapi `p` selalu `null` → EV = 0 |
| 3 | **CLV (closing line value) sebagai tujuan**, bukan win rate | Win rate atas ≤200 taruhan hampir seluruhnya noise; CLV jadi sinyal setelah ~100–300 taruhan | ❌ mesin CLV ada, tetapi ledger kosong sehingga tidak ada yang diukur |
| 4 | **Ukuran taruhan dari Kelly fraksional**, bukan perasaan | Full Kelly menghancurkan bankroll saat `p` salah; 1/4 Kelly ≈ 50% pertumbuhan dengan drawdown jauh lebih kecil | ⚠️ Kelly ada per-leg, belum dipakai untuk tiket |
| 5 | **Kalibrasi diuji, bukan diklaim** (Brier + BSS + kurva kalibrasi) | Model yang selalu menebak base rate pun terlihat "lumayan" di Brier mentah | ❌ belum ada laporan kalibrasi sama sekali |

Kesimpulan besarnya: **keunggulan tidak datang dari memilih pertandingan, tetapi dari
pengukuran.** Sistem ini punya mesin yang cukup lengkap; yang tidak ada adalah angka yang
mengalir ke dalamnya.

---

## 2. Devig: mengubah harga bandar menjadi probabilitas jujur

Rumus mentah: `q_i = 1/odds_i`, dan `Σq_i = booksum > 1`. Kelebihannya adalah margin.

| Metode | Cara kerja | Kapan dipakai | Catatan |
|--------|-----------|---------------|---------|
| **Additive** | kurangi margin secara merata | pasar dua arah | bisa menghasilkan probabilitas negatif pada underdog ekstrem → harus ditolak |
| **Multiplicative** | bagi tiap `q_i` dengan booksum | standar; pasar dua arah | menyebar margin proporsional, sedikit melebihkan longshot |
| **Shin** | selesaikan `z` (proteksi bandar) sehingga `Σp = 1` | pasar tiga arah (1X2, HT) | untuk dua arah hasilnya identik dengan additive |
| **Power** | `p_i = q_i^k`, selesaikan `k` | favorit sangat berat | selalu berada di [0,1] |
| **Logarithmic / odds-ratio** | transformasi berbasis log | alternatif riset | perbedaannya kecil |

**Bukti empiris (Premier League 2024-25, diukur dengan RPS):** multiplicative 0.19724,
logarithmic 0.19730, Shin 0.19731, additive 0.19736. Selisih antar metode ~0.0001 —
**jauh lebih kecil daripada kerugian karena tidak melakukan devig sama sekali.**

**Konsekuensi desain untuk kita:**

1. Terapkan devig di **semua** jalur, bukan hanya mesin kuant.
2. Untuk pasar tiga arah gunakan **Shin**; untuk dua arah **multiplicative**.
3. Karena bandar kita (1xbet/M88) bukan bandar tajam, ambil **kasus terburuk**: probabilitas
   terendah di antara semua metode yang berhasil dihitung. Ini membuat edge tidak lahir dari
   asumsi yang paling menguntungkan.
4. Jangan pernah devig bandar rekreasi lalu menganggap hasilnya "fair" — margin 5–7%
   membuat ketidakpastian devig lebih besar daripada edge yang kita cari.

---

## 3. EV: definisi yang dipakai gerbang

```
p_final       = w · p_model + (1 − w) · p_market_fair      (w = 0.35)
EV            = p_final · odds − 1
EV_konservatif = (p_final − σ) · odds − 1                  (σ = 0.05)
```

- `p_market_fair` berasal dari devig (kasus terburuk).
- `p_model` adalah probabilitas eksplisit model; bila tidak ada, **tidak boleh diisi
  dengan `confidence`** — itu kesalahan kategori yang sudah ada di kode.
- `w = 0.35` karena model belum punya bukti kalibrasi; makin kecil bobot model, makin kecil
  peluang edge palsu. Angka ini harus naik hanya setelah Brier/ECE terbukti lebih baik
  daripada pasar.
- `σ = 0.05` adalah anggaran ketidakpastian. Pada pasar tiga arah, **edge di bawah 3%
  dianggap noise** — ketidakpastian devig saja bisa membalik tandanya.

Gerbang: `EV ≥ 3%` **dan** `EV_konservatif > 0`.

---

## 4. CLV: satu-satunya fungsi objektif yang jujur

- CLV = `odds_kita / odds_penutup − 1`, diukur terhadap **garis penutup tanpa margin**.
- Secara teori, CLV ≈ ROI jangka panjang; +2–4% dianggap edge yang layak, >5% elite.
- Butuh **~100–300 taruhan** agar rata-rata CLV bisa dipercaya; 2.000+ taruhan untuk
  memisahkan skill lewat ROI. Jadi: **jangan mengklaim apa pun sebelum ~50 seleksi**, dan
  jangan menyimpulkan apa pun sebelum ~200.

Kolom `prediction_selections` sudah menyediakan `odds`, `p_final`, `p_market_fair`,
`p_model_only`, `odds_close`, `close_fair_prob`, `ev`, `ev_conservative`, `outcome`.
**Tidak perlu migrasi skema** untuk mulai mengukur CLV dan Brier.

---

## 5. Kelly dan parlay

- `f* = (p·b − q)/b` dengan `b = odds − 1`; ekuivalen `(p·odds − 1)/(odds − 1)`.
- 1/4 Kelly adalah norma praktisi: ~50% pertumbuhan penuh, drawdown maksimum jauh lebih
  rendah. Full Kelly hanya masuk akal bila `p` benar-benar diketahui.
- **Kelly tidak sah untuk parlay**: asumsi independensi dilanggar oleh leg yang berkorelasi
  (satu pertandingan, Over 2.5 + BTTS, favorit + Over).
- Koreksi yang dipakai: probabilitas gabungan = perkalian × haircut korelasi
  (ρ < 0.2 → tanpa haircut; 0.2–0.5 → potong 25–50%; > 0.5 → potong ≥50% atau buang leg),
  lalu stake dihitung dari probabilitas yang sudah dikoreksi, dengan pagar per tiket.
- Banyak pemain tajam **melewati parlay sepenuhnya** untuk penempatan uang. Fitur parlay
  tetap berguna sebagai alat eksplorasi, bukan sebagai mesin uang utama.

---

## 6. Kalibrasi: cara menguji apakah angka kita berarti

- **Brier** = rata-rata `(p − o)²`; dekomposisinya (reliability/resolution/uncertainty)
  lebih informatif daripada angkanya sendiri.
- Wajib melaporkan **Brier Skill Score terhadap base rate** — tanpa itu, penebak base rate
  terlihat kompeten pada kejadian jarang.
- Tambahan: **log loss** (dengan clipping), **kurva kalibrasi per bin beserta jumlah
  sampelnya**, dan **ECE**.
- Validasi harus **kronologis (out-of-sample)**, dengan pembanding baseline (pasar dan
  base rate), bukan acak.

`lib/betting-math.ts` sudah menyediakan `brierScore`, `logLoss`, `calibrationBuckets`, dan
`expectedCalibrationError` untuk ini.

---

## 7. Yang diukur dari data kita sendiri (12 Nov 2026)

Diagnosis awal saya sebelumnya salah pada satu hal penting, dan koreksinya mengubah urutan
pekerjaan:

```
ai_predictions (72 baris dengan manual_context)
  probability (manual_context) ................ 72/72 NULL
  recommendation.marketBet .................... 72/72 NULL
  readinessStatus ............................. 49 NULL, 23 "analytical_no_bet"
  bet_ready ................................... 0
  selectedMarketOddsStatus = verified .......... 0
  prediction_selections ....................... 0 baris
  parlays / parlay_legs ....................... 2 / 4 (terakhir 4 Agustus)
```

Artinya:

1. Kode **sudah** menghitung ulang EV secara deterministik
   (`computedEvPercent = p × odds − 1` di `ai-analysis.ts`). Jadi EV bukan "disalin dari
   model" seperti dugaan awal saya.
2. Yang benar-benar putus adalah **pasokan `p`**: model tidak pernah mengembalikan
   probabilitas terstruktur, sehingga `recommendationIsEligible` selalu `false`, seluruh
   rekomendasi dinolkan, dan tidak ada satu pun seleksi yang bisa ditulis ke ledger.
3. `confidence` tidak boleh menggantikan `probability` — kode sudah menolak itu dengan
   benar. Yang salah adalah membiarkan kegagalan kontrak itu berakhir sebagai **0 yang
   menyamar sebagai analisis**.

**Kesimpulan: urutan pekerjaan harus dibalik.** Memperbaiki matematika EV sebelum
probabilitas mengalir berarti menyempurnakan gerbang yang tidak pernah dilewati.

---

## 8. Urutan implementasi yang direvisi

| Urutan | Item | Isi | Alasan urutan |
|--------|------|-----|----------------|
| **1** | **P2** | Kontrak keluaran tertutup: `market_type` + `outcome` + `line` numerik + `probability` eksplisit; keluaran tidak valid ⇒ **NO BET dengan alasan tercatat**, bukan 0 | Tanpa `p` tidak ada EV, ledger, atau kalibrasi. Ini pintu masuknya. |
| **2** | **P1** | Devig + `p_final` blend + EV & EV konservatif + Kolom audit (`p_market_fair`, `p_model_only`, `p_final`) | Begitu `p` ada, angkanya harus benar dan konservatif |
| **3** | **P3** | Setiap analisis menulis `prediction_selections`; laporan Brier/BSS/ECE + CLV setelah ambang sampel | Tanpa catatan, tidak ada cara membedakan keberuntungan dari skill |
| **4** | **P4** | Pencocokan line eksak untuk Totals/AH + devig di jalur LLM | Memperluas cakupan setelah fondasi terbukti |
| 5 | P5 | Matematika parlay: haircut korelasi, stake tingkat tiket | Butuh `p_final` yang terkalibrasi dulu |
| 6 | P6 | Persona Gemini: berhenti meminta model melaporkan EV sendiri | Terakhir, karena persona adalah sumber kontrak yang gagal |

---

## 9. Pagar yang tidak boleh dilanggar

1. **Tidak ada taruhan tanpa `p` eksplisit.** NO BET adalah jawaban yang sah dan harus
   tercatat dengan alasan.
2. **Edge < 3% pada pasar tiga arah = tidak ada taruhan.**
3. **EV konservatif harus positif**, bukan hanya EV point estimate.
4. **Tidak ada klaim kualitas model sebelum ~50 seleksi terselesaikan**; CLV baru
   disimpulkan setelah ~200.
5. **Selalu simpan:** vektor probabilitas penuh, sumber odds, timestamp, metode devig.
   Tanpa itu, CLV tidak bisa dihitung ulang dan audit mustahil.
6. **Devig dari bandar rekreasi adalah perkiraan, bukan kebenaran.** Bila suatu saat ada
   akses ke Pinnacle/PS3838, garis penutup tajam itu yang menjadi acuan CLV.

---

## 10. Sumber

- Pena.lt — *From biased odds to fair probabilities* (uji RPS tujuh metode devig, EPL 2024-25):
  https://pena.lt/y/2025/09/14/from-biased-odds-to-fair-probabilities/
- Outlier.bet — *How to devig odds: comparing the methods*:
  https://help.outlier.bet/en/articles/8208129-how-to-devig-odds-comparing-the-methods
- SharkBetting — *Devig explained* (routing metode + peringatan edge <3%):
  https://www.sharkbetting.com/blog/devig-explained
- GamblingCalc — *Advanced devigger* (contoh kerja tiga arah, batas model Shin):
  https://gamblingcalc.com/betting/advanced-devigger/
- MarketMath — *Closing line value*: https://marketmath.io/blog/closing-line-value
- SportsBettingPrime — *Closing line value explained*:
  https://sportsbettingprime.com/closing-line-value-explained.html
- SharkBetting — *CLV explained* (ambang signifikansi ~50 taruhan untuk 3–5% CLV):
  https://www.sharkbetting.com/blog/closing-line-value-clv-explained
- PropsBot — *Kelly criterion*: https://propsbot.ai/glossary/kelly-criterion/
- Statz — *Kelly criterion & bankroll management*:
  https://statz.ai/nba/betting/bankroll-management-kelly-criterion
- Wizard of Odds — *Variance and bankroll management for player props* (banda korelasi):
  https://wizardofodds.com/article/variance-and-bankroll-management-for-player-props/
- Wikipedia — *Brier score*: https://en.wikipedia.org/wiki/Brier_score
- MetricGate — *Brier score*: https://metricgate.com/docs/brier-score/
- ImpliedScore — *Football probability calibration* (checklist pelaporan 1X2):
  https://impliedscore.com/football-probability-calibration/
