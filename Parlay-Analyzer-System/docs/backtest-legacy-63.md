# Backtest 63 Prediksi Lampau vs Sistem Sekarang (13 Nov 2026)

## Pertanyaan

Bila 63 prediksi lampau yang sudah settled (31 WIN, 32 LOSS) dinilai ulang
dengan sistem sekarang, apakah hasilnya berbeda — dan seberapa besar?

## Jawaban singkat

**Perbedaan terbesarnya bukan pada hasil pertandingan, melainkan pada
kontrak data.** Sistem sekarang akan menolak hampir semua prediksi lampau
bukan karena modelnya pasti lebih pintar, tetapi karena data lampau tidak
menyimpan bahan yang kini wajib ada: probabilitas eksplisit dan odds nyata.
Hanya **5 dari 63 (7,9%)** baris yang dapat di-replay secara sah. Pada 5
baris kecil itu gerbang produksi sekarang meloloskan semuanya (hasilnya
tetap merugi), sedangkan skenario gerbang kuantitatif yang di-*enforce*
hanya meloloskan 1 — dan yang lolos itu justru LOSS.

Kesimpulan jujurnya: backtest ini **membuktikan sistem lama tidak dapat
diaudit**, bukan membuktikan sistem baru lebih akurat. Bukti akurasi hanya
bisa datang dari seleksi baru yang tercatat lengkap (ledger P3).

## Metodologi (dan batasnya)

Yang diuji adalah **replay gerbang keputusan**, bukan menjalankan ulang
model pada masa lalu:

- Probabilitas lampau direkonstruksi dari EV dan odds tersimpan:
  `p = (1 + EV) / odds`. Hanya sah bila odds > 1 dan EV tercatat.
- Gerbang produksi saat ini: probabilitas valid + odds terverifikasi +
  EV hitung-ulang > 0.
- Skenario *enforced*: tambahan EV ≥ 3% dan EV konservatif
  `(p − 0,05) × odds − 1 > 0` (gerbang ini di produksi masih *shadow*).
- Menjalankan ulang model λ/Poisson pada masa lalu **tidak dilakukan**:
  snapshot statistik point-in-time tidak disimpan, dan statistik musim
  yang ada sekarang sudah memuat hasil yang dinilai (look-ahead bias).

Implementasi: `artifacts/api-server/src/lib/legacy-backtest.ts`
(dengan tes) dan `scripts/backtest-legacy.ts` (read-only).

## Hasil

### Sistem lama — apa adanya

| Ukuran | Hasil |
|---|---|
| Settled | 63 (31 WIN / 32 LOSS) |
| Hit rate keseluruhan | **49,2%** |
| 31 prediksi pertama (28 Jul–31 Agu) | 51,6% |
| 32 prediksi terakhir (2 Sep–25 Okt) | 46,9% |
| ROI yang dapat dihitung | hanya 5 baris ber-odds nyata: **−6,0%** |

Hit rate per keluarga market (sampel kecil, indikatif saja):

| Market | n | Hit |
|---|---:|---:|
| BTTS | 18 | 55,6% |
| Totals (Over/Under) | 20 | 45,0% |
| 1X2 | 13 | 38,5% |
| HT | 6 | 50,0% |
| AH/lainnya | 4 | 100% (n terlalu kecil) |

### Replay dengan sistem sekarang

| Skenario | Lolos | Hit | ROI | Catatan |
|---|---:|---:|---:|---|
| Sistem lama (semua diambil) | 63 | 49,2% | −6,0% (n=5) | 58 baris tidak punya odds/probabilitas sah |
| Gerbang produksi saat ini | 5 | 60,0% (3/5) | −6,0% | Brier 0,131 · log-loss 0,444 pada p rekonstruksi |
| Bila gerbang kuantitatif di-enforce | 1 | 0% (0/1) | −100% | Satu-satunya yang lolos: EV +45,2% @2,90 — dan kalah |

58 baris gugur sebagai `insufficient_data`: odds tersimpan 0 pada 23 baris,
dan probabilitas tidak pernah disimpan pada satu pun dari 63 baris.

## Interpretasi

1. **Hasil lampau pada dasarnya koin yang sedikit miring.** 49,2% tanpa
   penyebut odds yang lengkap tidak mengatakan apa-apa tentang edge; pada
   5 baris yang bisa dihitung ROI-nya, hasilnya negatif.
2. **Gerbang sekarang tidak terbukti lebih baik dari data ini.** Pada
   sampel replay yang sangat kecil, gerbang produksi meloloskan 3 WIN dan
   2 LOSS dengan ROI tetap negatif; skenario *enforced* bahkan hanya
   menyisakan satu LOSS berseleksi EV ekstrem (+45,2% — angka yang pada
   sistem sekarang justru akan dicurigai sebagai kesalahan estimasi).
   Mengklaim perbaikan dari n=5 adalah penipuan statistik.
3. **Yang benar-benar berubah adalah keterlacakan.** Sistem lama membiarkan
   92% keputusannya tanpa odds/probabilitas yang dapat diperiksa ulang.
   Sistem sekarang memaksa NO BET/technical-review pada kondisi itu,
   menyimpan vektor probabilitas, snapshot odds, dan p final — sehingga
   pertanyaan yang sama, 300 seleksi dari sekarang, dapat dijawab dengan
   angka yang sah (gerbang Fase 3 di `PHASE_STATUS.md`).
4. **1X2 adalah keluarga terlemah** pada data lampau (38,5%, n=13) dan
   BTTS yang terkuat (55,6%, n=18). Ini sinyal awal untuk ledger, bukan
   alasan menonaktifkan market: ambang pembuktian tetap ≥300 seleksi
   tercatat pada model yang sama.
