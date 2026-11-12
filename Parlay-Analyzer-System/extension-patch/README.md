# Ekstensi Chrome v3.2.0 (FootyStats → Parlay Data Ingest)

Perbaikan ekstensi setelah audit 12 Nov 2026: satu bug yang **merusak data
diam-diam** (blok "Goals Conceded" tersimpan di kolom gol-dicetak untuk 18/18
tim La Liga), plus lima celah yang membuat masalah lain tidak terlihat.

| File | Isi |
|---|---|
| `content.js` | v3.2.0 lengkap, siap pakai |
| `manifest.json` | v3.2.0, `host_permissions` diperbaiki |
| `v3.1.0-to-v3.2.0.patch` | unified diff dari v3.1.0 → v3.2.0 |
| `verify-content.mjs` | 17 pemeriksaan otomatis (`node extension-patch/verify-content.mjs`) |

## Cara pakai

**Opsi A — timpa langsung (paling mudah).** Salin `content.js` dan
`manifest.json` dari folder ini ke folder ekstensi Anda, lalu
`chrome://extensions` → **Reload**.

**Opsi B — pakai patch.** Dari folder ekstensi (berisi `content.js` v3.1.0):

```bash
git apply -p1 /path/ke/extension-patch/v3.1.0-to-v3.2.0.patch
# atau: patch -p1 < v3.1.0-to-v3.2.0.patch
```

Patch sudah diuji: hasilnya identik byte-per-byte dengan `content.js` v3.2.0.

Setelah reload, buka Config dan pastikan endpoint terisi
`https://parwon.vercel.app/api/stats/ingest` dan API Key = `EXTENSION_API_KEY`.

---

## PATCH 4 — penjaga label vs `stat_type` (penyebab kerusakan La Liga)

**Bug:** koreksi `detectStatTypeFromHeaders()` hanya berjalan saat mode
**auto**:

```js
if (statMode !== 'manual') { ... }   // mode manual tidak pernah dikoreksi
```

Ketika dropdown di-set manual ke "Goals Scored" sementara tabel yang di-paste
adalah tabel *Goals Conceded*, seluruh payload dikirim sebagai
`stats_goals_scored`. Di database hasilnya:

```json
"stats_goals_scored": {"Per Match":"1.00 Conceded / match","Goals Conceded":"6"}
```

18 dari 18 baris La Liga 2026-27 (update 10 Nov 05:23) berbentuk seperti ini,
dan `stats_goals_conceded` berisi blok yang sama persis. Server aplikasi
sebenarnya sudah punya penjaga untuk kasus ini (`detectStatTypeContradiction`,
HTTP 422), tetapi ekstensi saat itu memanggil Edge Function Supabase yang tidak
punya penjaga tersebut.

**Perbaikan:** guard baru berjalan di **semua mode**, dua kali — saat paste dan
tepat sebelum `fetch`. Jika blok berlabel "Conceded" akan dikirim ke
`stats_goals_scored` (atau sebaliknya), tombol Push dimatikan dan pesannya
menyebut kolom yang benar.

## PATCH 5 — endpoint default & izin host

- `DEFAULT_ENDPOINT = https://parwon.vercel.app/api/stats/ingest`. Route ini
  punya empat penjaga yang tidak dimiliki Edge Function: kontradiksi label,
  resolusi `league_slug` (`la-liga` → `spain-la-liga`), validasi `stat_type`,
  dan dedupe `team_key`.
- `manifest.json` sebelumnya hanya mengizinkan `*.footystats.org` dan
  `*.replit.*`, sehingga permintaan ke `parwon.vercel.app` maupun
  `*.supabase.co` bergantung pada header CORS pihak ketiga. Keduanya sekarang
  masuk `host_permissions`.

## PATCH 6 — kegagalan per tim tidak lagi hilang

Handler lama hanya membaca `message`, padahal server membalas
`result_rows[]` (per tim) dan 422 berisi `rejected[]`, `suggestions[]`,
`known_leagues[]`. Akibatnya tim yang ditolak tampil seolah berhasil.

Sekarang status memisahkan "tersimpan" dan "ditolak", menampilkan sampai enam
tim yang gagal beserta alasannya, dan menyertakan slug hasil resolusi server.

## PATCH 7 — `league_slug` dikirim lengkap

`buildPayload()` kini menyertakan `league_slug` = `{negara}-{kompetisi}`
(`spain-la-liga`), tidak hanya `raw_url_path`. Server memang sudah menormalkan
sendiri, tetapi ini menghilangkan ketergantungan pada satu lapisan saja.

## PATCH 8 — peringatan data basi

Server menolak statistik lebih tua dari `TEAM_STATS_STALE_DAYS = 14` dan
gejalanya di aplikasi hanya "data statistik belum lengkap". Ekstensi kini
mencatat setiap push sukses per `(liga|season|stat_type)` di
`chrome.storage.local` dan menampilkan:

- `⏳` bila liga terakhir dipush ≥ 7 hari,
- `⚠️` bila > 14 hari (data pasti ditolak server),

sehingga liga yang tertinggal (EPL, Championship, Ligue 1, Serie A, Eredivisie —
28 hari per 12 Nov) langsung terlihat saat halaman dibuka.

---

## Verifikasi

```bash
node --check extension-patch/content.js
node extension-patch/verify-content.mjs
```

`verify-content.mjs` mengekstrak blok `// === PATCH 4 === GUARD:START` dan
mengujinya dengan payload nyata dari database, termasuk blok La Liga, lalu
memeriksa enam perubahan struktural lain dan isi `manifest.json`.

## Yang masih harus dilakukan manual

Perbaikan ini mencegah kerusakan **baru**, bukan memulihkan yang sudah ada:

1. **La Liga** — buka halaman *Goals Scored* La Liga di FootyStats dan push
   ulang. Data conceded tidak bisa diturunkan menjadi scored; sampai itu
   dilakukan, analisis La Liga memakai GF yang salah.
2. **27 tim tanpa `stats_over_25`** (Serie A 7, Eredivisie 7, Ligue 1 5,
   Bundesliga 4, La Liga 4) — push tabel *Over 2.5*. Ke-27 tim masih menyimpan
   `stats_team_form["Over 2.5"]`, jadi server juga bisa mengisinya lewat
   fallback (lihat backlog server).
3. **Lima liga basi** — push ulang semua tabelnya.
