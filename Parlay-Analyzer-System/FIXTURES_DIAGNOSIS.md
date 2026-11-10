# Diagnosis: kenapa tidak ada fixtures

Semua angka di bawah dibaca langsung dari Supabase `hqbuwfyiqfxpnpdlgcru` dan
dari kode di repo. Tanggal query: 2026-11-10.

---

## Jawaban singkat

**Bukan odds-api.io. Bukan Replit mati. Ini jendela scan yang terlalu pendek
bertemu jeda internasional.**

Ketiganya bisa dibuktikan satu per satu.

| Tuduhan | Vonis | Bukti |
| --- | --- | --- |
| odds-api.io bermasalah | **Tidak** | Hari ini API mengembalikan **811 event** per siklus, `errors: 0` |
| Tidak ada jadwal liga | **Sebagian benar** | 9–17 Nov jeda internasional FIFA; EPL baru kembali **21 Nov** |
| Replit tidak menjalankan fungsi | **Tidak** | **3 sync run hari ini, semuanya `completed`** |

---

## 1. odds-api.io sehat — ini terbukti dari angkanya

`sync_runs` mencatat setiap siklus. Tiga run hari ini:

| run | waktu mulai | status | events_fetched | events_inserted | odds_fetched | errors |
| --- | --- | --- | --- | --- | --- | --- |
| 560 | 2026-11-10 05:24:46 | completed | **811** | **0** | 0 | 0 |
| 559 | 2026-11-10 05:13:48 | completed | **811** | **0** | 0 | 0 |
| 558 | 2026-11-10 00:48:19 | completed | **811** | **0** | 0 | 0 |
| 557 | 2026-10-26 15:02:22 | completed | 819 | **10** | 10 | 0 |

**811 event diterima, 0 error.** Kalau API-nya bermasalah, `events_fetched`
akan 0 atau `errors` akan naik. Tidak ada keduanya. Jadi API **sehat** dan
Replit **berhasil memanggilnya**.

Bandingkan dengan run tanggal 26 Oktober: dari 819 event, 10 lolos disimpan.
Hari ini: dari 811 event, **nol** lolos. Penyaringnya bukan API.

---

## 2. Replit memang menjalankan tugasnya

- 560 baris di `sync_runs` total
- Hari ini 3 run, semua `completed`, `errors: 0`
- `scheduler_config.cron_expression = "0 */6 * * *"` → 00, 06, 12, 18 UTC
- Run hari ini terjadi 00:48 dan 05:13 serta 05:24 UTC — sesuai jadwal

Tidak ada tanda Replit tidur. Scheduler jalan, memanggil API, menerima data,
lalu menyaringnya habis. **Ini beda penting:** "tidak ada data" di sini bukan
karena prosesnya mati, tapi karena prosesnya **bekerja dan memutuskan tidak
menyimpan apa pun.**

---

## 3. Penyebab sebenarnya: jendela 10 hari bertemu jeda FIFA

Di `services/odds-fetcher.ts`:

```ts
const UPCOMING_WINDOW_DAYS = 10;                    // baris 18
const windowEnd = now + upcomingWindowDays * 24 * 60 * 60 * 1000;  // baris 913
const upcomingEvents = events.filter((e) => {
  const eventTime = new Date(e.date).getTime();
  return Number.isFinite(eventTime) && eventTime >= now && eventTime <= windowEnd;
});
```

Hanya event dalam **10 hari ke depan** yang lolos. `scan_days` di
`scheduler_config` = 3, tapi nilai itu di-clamp oleh `normalizeScanDays` dan
default yang dipakai tetap `UPCOMING_WINDOW_DAYS`.

**Hitungannya:**

```
Sekarang (run 560) : 2026-11-10 05:24 UTC
windowEnd          : 2026-11-20 05:24 UTC
```

Kalender 2026-27 ([PremierLeagueNow](https://premierleaguenow.co.uk/2026/10/05/the-international-breaks-in-the-2026-27-premier-league-season-and-why-they-are-different/),
[OddSonar](https://oddsonar.com/en/magazine/international-breaks-2026-27-when-leagues-resume)):

| Kompetisi | Pertandingan terakhir | Kembali |
| --- | --- | --- |
| Premier League | 8 Nov 2026 | **21 Nov 2026** |
| Serie A | 8 Nov 2026 | 21 Nov 2026 |
| La Liga | 8 Nov 2026 | 20 Nov 2026 |
| Bundesliga | 8 Nov 2026 | 20 Nov 2026 |
| Ligue 1 | 8 Nov 2026 | 20 Nov 2026 |
| Jeda FIFA | — | 9–17 Nov 2026 (Nations League) |

**Semua pertandingan EPL berikutnya jatuh SETELAH 20 November**, sementara
jendela hanya sampai 20 November 05:24. Selisihnya beberapa jam saja.

Itu sebabnya 811 event terbuang semua — bukan karena rusak, tapi karena
**semuanya di luar jendela**.

### Konsekuensi penting: ini akan sembuh sendiri

```
EPL kembali       : 2026-11-21 15:00 UTC
Masuk jendela saat: now >= 2026-11-11 15:00 UTC  ← BESOK
```

**Mulai run cron 18:00 UTC tanggal 11 November (02:00 WITA tanggal 12),
fixtures EPL akan mulai masuk lagi dengan sendirinya.**

Ini prediksi yang bisa Anda uji sendiri. Kalau besok malam data masih kosong
padahal jamnya sudah lewat, berarti analisis saya salah di titik ini dan perlu
dibongkar ulang — bukan ditambal.

---

## 4. Kenapa 894 fixtures terlihat "lama"

Ini temuan terpisah yang saya temukan saat memeriksa. Distribusi
`fixtures.created_at`:

| Dibuat | Jumlah | Rentang jadwal |
| --- | --- | --- |
| Jun–Agu 2026 | **~793** | Jul–Nov 2026 |
| Okt 2026 (14–26) | ~37 | Okt 2026 |

Dari 894 fixtures, **793 adalah unduhan massal jadwal musim** di bulan
Juni–Agustus, bukan hasil sinkronisasi harian. Yang benar-benar masuk lewat
sinkronisasi odds cuma sekitar 37 baris.

Artinya: aplikasi ini tidak pernah punya mesin pengisi jadwal. Ia bergantung
pada:
1. Unduhan jadwal musim sekali di awal, lalu
2. Sync odds yang hanya menangkap event bila kebetulan masuk jendela 10 hari

Ketika jeda internasional datang, sumber (2) mati, dan tidak ada sumber lain.
Jadwal musim penuh untuk 2026-27 **tidak pernah diimpor**.

---

## 5. Tiga hal yang saya rekomendasikan, berurutan

### A. Perlebar jendela scan (perbaikan satu baris, paling cepat)

`UPCOMING_WINDOW_DAYS` 10 → 21. Dengan 21 hari, run hari ini pun akan lolos:
EPL 21 Nov masih di dalam 21 hari dari 10 Nov.

Efek samping: `MAX_EVENTS_PER_SYNC = 40` akan cepat penuh karena ada lebih
banyak event. Perlu dinaikkan juga, atau disesuaikan dengan kuota odds-api.io.
**Ini perlu dicek ke kuota plan Anda sebelum diubah.**

### B. Impor kalender musim sebagai sumber terpisah

Ini akar masalahnya. Selama jadwal hanya datang dari sync odds, setiap jeda
internasional akan mengulang kejadian ini — dan ada 2 jeda lagi sampai Mei 2027
(Maret 2027), ditambah jeda musim panas.

odds-api.io punya endpoint jadwal terpisah dari odds. Mengambil jadwal penuh
sekali per minggu, tanpa memanggil odds, jauh lebih murah kuotanya daripada
memperlebar jendela odds.

### C. Pecah `action=sync` per liga

Sudah saya catat di `VERCEL_MIGRATION.md` §5. Dengan jendela lebih lebar,
volume per siklus naik, dan batas 60 detik Vercel Hobby akan makin cepat kena.
Ini jadi prasyarat kalau nanti pindah ke Vercel.

---

## 6. Yang saya tidak bisa pastikan dari sini

Supaya jelas batasnya:

- **Apakah 811 event itu memang semua di luar jendela, atau sebagian tidak
  punya tanggal valid.** Saya menyimpulkan dari aritmetika jendela + kalender,
  bukan dari melihat respons mentah API. Untuk memastikan, perlu satu run
  dengan log `Events found` per liga (baris 929–932 sudah mencatat `total`,
  `alreadySynced`, `toFetch`) — log Replit tersebut yang akan menjawab pasti.
- **Kuota odds-api.io Anda tersisa berapa.** Tidak terlihat dari database.
- **`sync_runs` yang berstatus `running` dan tidak pernah selesai** (id 555,
  dan beberapa di Oktober). Ini sisa proses yang terpotong, bukan penyebab
  masalah hari ini, tapi menandakan siklus pernah berhenti di tengah jalan.
