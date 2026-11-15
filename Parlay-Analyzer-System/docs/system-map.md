# Peta Sistem — satu halaman

## Yang dilihat setiap hari
1. **Telegram** — tiga tiket terkirim otomatis (cron `notify-parlay`).
2. **Halaman "Hari Ini"** — tiket yang sama + status sistem sekilas.
3. Halaman lain hanya untuk memeriksa: **Bukti Sistem** (alasan tiket),
   **Pembelajaran** (hasil & perbaikan), **Pengaturan** (liga & jadwal).

## Tiga tiket
| Tiket | Isi | Untuk |
|---|---|---|
| 🎯 Utama | 5–8 leg stabil, target odds 4× | peluang kena tertinggi |
| 🚀 Booster | Utama + 1 leg ⭐ penguat (odds 1,85–2,30, didukung statistik) | bayaran lebih besar, risiko terpusat di satu leg |
| 💎 Jackpot | leg odds 1,80–3,00 yang lolos syarat nilai, target ≥20× | kejutan terukur; sah tidak terbentuk bila tak layak |

## Cara tiket dipilih (4 langkah)
1. Odds dari banyak bandar masuk tiap jam (cron-job.org).
2. AI + mesin statistik menganalisis laga → probabilitas model.
3. Pasar (de-vig) menjadi hakim peluang; statistik memberi label leg:
   *statistik mendukung / stabil / kurang kokoh / statistik menolak*.
4. Gerbang kualitas membuang leg murahan (odds < 1,25), leg nyaris-pasti
   (peluang > 90%), dan line pajangan (Totals di luar 1,5–3,5, |AH| > 2).

## Yang berjalan sendiri
cron-job.org: sync odds → analisis → harga penutup (T-10 mnt) → hasil →
outcome → Telegram. Pembelajaran AI hanya berubah lewat gerbang statistik
(≥100 sampel latih + holdout), tidak pernah liar.

## Kejujuran angka
Peluang tiket selalu tertulis. EV tiket biasanya negatif karena margin
bandar menumpuk — ditampilkan, bukan disembunyikan. Tidak ada jaminan
menang; yang dijanjikan sistem adalah disiplin memilih + bukti tercatat
(gerbang Fase 3: 300 seleksi ber-hasil, menunggu outcome sejak 20 Nov 2026).

## Sistem lama (status)
- Komposer EV lama: **pensiun** (PR #52) — preview hanya bila `?legacy=1`.
- `parlay-builder` lama: masih dipakai halaman Tiket Tersimpan &
  settlement; tiketnya adalah arsip manual/otomatis lama, bukan
  rekomendasi harian. Rekomendasi resmi = tiga tiket di atas.
- Tabel `teams`/`team_aliases`: yatim, keputusan hapus terpisah.
