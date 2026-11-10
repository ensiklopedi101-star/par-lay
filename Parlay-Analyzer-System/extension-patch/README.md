# Perbaikan Ekstensi Chrome (FootyStats → Parlay)

Tiga bug di `content.js` yang menyebabkan data masuk ke liga salah, duplikat
tim, dan tim ter-skip tanpa pemberitahuan.

**Cara pakai:** buka `content.js` ekstensi Anda, terapkan tiga perubahan di
bawah (cari tanda `// === PATCH N ===`), lalu muat ulang ekstensi di
`chrome://extensions`.

---

## PATCH 1 — `league_slug` dari URL (penyebab utama)

**Bug:** `parts[1]` pada URL FootyStats adalah **kompetisi**, bukan slug liga.
`footystats.org/spain/la-liga` → `"la-liga"`, lalu server menyimpannya sebagai
liga baru. Hasilnya 20 tim Spanyol masuk ke `england-premier-league`.

**Cari:**

```js
var leagueSlug = parts[1] || parts[0] || '';
```

**Ganti dengan:**

```js
// === PATCH 1 ===
// FootyStats memakai /{negara}/{kompetisi}. League slug di database adalah
// gabungan keduanya: "spain" + "la-liga" → "spain-la-liga".
// Baris lama (parts[1] saja) menghasilkan "la-liga", yang tidak cocok dengan
// slug mana pun sehingga server membuat baris di liga yang salah.
var leagueSlug = parts.length >= 2
  ? (parts[0] + '-' + parts[1])
  : (parts[0] || '');
```

Dan pada `readContext()`, pastikan `raw_url_path` juga mengirim dua bagian:

```js
// === PATCH 1b ===
var rawPath = parts.length >= 2 ? (parts[0] + '/' + parts[1]) : (parts[0] || '');
ctx = {
  raw_url_path: rawPath,          // "spain/la-liga" bukan "la-liga"
  stat_type: statType,
  season: elSeason.value || '',
  league_slug: leagueSlug,
};
```

> Server sekarang **menolak** (HTTP 422) slug yang tidak ada di tabel
> `leagues`, jadi kesalahan ini akan langsung terlihat alih-alih merusak data.

---

## PATCH 2 — Tampilkan tim yang gagal

**Bug:** respons server sudah berisi `results[]` per tim, tetapi ekstensi hanya
menghitung `payload.teams.length` sehingga tim yang ditolak tidak pernah
terlihat.

**Cari di handler `btnPush`:**

```js
'✅ ' + payload.teams.length + ' tim dikirim.\n' +
```

**Ganti dengan:**

```js
// === PATCH 2 ===
// Server mengembalikan results[] per tim. Tampilkan yang gagal supaya tim
// ter-skip tidak lagi tidak terlihat.
```

Lalu sesudah `res.json()` diterima, tambahkan:

```js
var failed = (data.result_rows || data.results || data.details || [])
  .filter(function (r) { return !r.success; });

var msg = '✅ ' + payload.teams.length + ' tim dikirim.';
if (failed.length) {
  msg += '\n\n⚠️ ' + failed.length + ' tim DITOLAK:\n' +
    failed.map(function (r) {
      return '  • ' + r.team + ' — ' + (r.error || 'unknown');
    }).join('\n');
  setBadge('warn', '⚠️ ' + failed.length + ' tim ditolak');
} else {
  setBadge('', '');
}
alert(msg + '\n\nLeague: ' + data.league_slug + '\nSeason: ' + data.season);
```

---

## PATCH 3 — Deteksi `stat_type` yang lebih ketat

**Bug:** `'over-25'` tidak cocok dengan `'over-2-5-goals-table'` (ada strip),
sehingga URL jatuh ke fallback dan menghasilkan
`stats_over_2_5_goals_table` → ditolak server (400).

**Cari di `STAT_TYPE_MAP`:**

```js
{ keywords: ['over-25', 'over-2-5'], stat: 'stats_over_25' },
{ keywords: ['over-35', 'over-3-5'], stat: 'stats_over_35' },
```

**Ganti dengan:**

```js
// === PATCH 3 ===
// FootyStats menulis garis sebagai "2-5" atau "2.5". Cocokkan keduanya,
// termasuk nama tabel panjang seperti "over-2-5-goals-table".
{ keywords: ['over-25', 'over-2-5', 'over-2.5', 'over25'], stat: 'stats_over_25' },
{ keywords: ['over-35', 'over-3-5', 'over-3.5', 'over35'], stat: 'stats_over_35' },
```

**Penting:** urutkan `STAT_TYPE_MAP` dari yang **paling spesifik** ke paling
umum. `shots` harus dicek sebelum `over`, dan `goals-conceded` sebelum
`goals-scored`, karena `"goals-scored"` juga mengandung `"goals"`.

---

## PATCH 4 (opsional) — Kirim `season` yang benar

`buildSeasonOptions()` menandai musim berjalan berdasarkan `month >= 8`.
Untuk liga lintas tahun (EPL, La Liga) itu benar, tetapi liga kalender
(J1 League, K League, Chinese Super League) berganti pada Januari. Jika Anda
meng-import liga kalender, pilih musim secara manual di dropdown — server akan
mencatatnya apa adanya.

---

## Setelah patch

1. Muat ulang ekstensi (`chrome://extensions` → Reload).
2. Buka halaman FootyStats, pastikan panel konfigurasi menampilkan slug liga
   yang **lengkap** (`spain la liga`, bukan `la liga`).
3. Import ulang. Jika slug salah, server akan membalas 422 dengan daftar
   `suggestions` — perbaiki sesuai saran itu.

## Perubahan server yang menyertai

- `stats/ingest` menolak `league_slug` yang tidak ada (HTTP 422 + saran).
- `stats/ingest` menolak blok yang labelnya bertentangan dengan kolom tujuan
  (mis. data "Conceded" dikirim sebagai `stats_goals_scored`).
- Unique index `(league_slug, season, team_key)` membuat duplikat tim mustahil
  di level database.
