# Code Review — Fix Report

Semua 10 temuan dari audit diverifikasi terhadap kode sumber sebelum diperbaiki.
Ringkasan: **8 diperbaiki sesuai rekomendasi**, **2 diperbaiki dengan pendekatan
berbeda** karena rekomendasi awal tidak sepenuhnya benar (detail di bawah).

Verifikasi: `pnpm run typecheck` bersih untuk API server dan frontend,
`pnpm --filter @workspace/api-server test` → **74 tes lulus** (40 di antaranya baru),
dan build esbuild + smoke test endpoint berjalan.

---

## Ringkasan status

| ID | Prioritas | Status | File utama |
|----|-----------|--------|------------|
| BUG-01 | Critical | ✅ Diperbaiki (+ dites) | `lib/bet-settlement.ts` |
| BUG-02 | Critical | ✅ Diperbaiki (+ dites) | `lib/bet-settlement.ts` |
| BUG-03 | Critical | ✅ Diperbaiki | `services/settlement.ts`, `services/parlay-builder.ts` |
| BUG-04 | Critical | ✅ Diperbaiki (+ diverifikasi) | `api/parlay-hooks.ts` |
| BUG-05 | High | ✅ Diperbaiki | `pages/fixtures.tsx` |
| BUG-06 | High | ✅ Diperbaiki (+ smoke test 401/503) | `routes/analyze.ts`, `odds.ts`, `csv.ts`, `season-csv.ts` |
| BUG-07 | High | ✅ Diperbaiki (+ dites) | `lib/kelly-criterion.ts` |
| BUG-08 | High | ✅ Diperbaiki | `pages/dashboard.tsx`, `routes/csv.ts`, `routes/stats-ingest.ts` |
| BUG-09 | Medium | ✅ Diperbaiki | `routes/config.ts`, `scheduler/index.ts`, `hooks/use-admin-password.ts` |
| BUG-10 | Medium | ✅ Diperbaiki (pendekatan berbeda) | `routes/odds.ts`, `lib/db/src/schema/*`, `supabase/migrations/` |

---

## BUG-01 & BUG-02 — Settlement quarter line dan BTTS No

**Terkonfirmasi.** `margin` dihitung dari selisih gol (integer) ditambah line
desimal, sehingga `margin === 0` tidak mungkin terjadi dan cabang `HALF_LOSS`
adalah dead code. `BTTS No` memang jatuh ke fallback yang menilai kedua sisi
sebagai BTTS Yes.

**Perbaikan.** Matematika settlement dipindah ke `lib/bet-settlement.ts` (murni,
tanpa Supabase) supaya bisa diuji langsung. Perbandingan dilakukan pada grid
integer seperempat gol (`Math.round(value * 4)`), sehingga:

- `AH -0.25` pada skor seri → `HALF_LOSS`
- `AH +0.75` kalah 1 gol → `HALF_LOSS`; seri → `WIN`
- `AH -0.75` menang 1 gol → `HALF_WIN`
- `Over 2.25` pada 2 gol → `HALF_LOSS`; `Under 2.75` pada 2 gol → `WIN`

Grid integer sekaligus menghilangkan noise floating point
(`0.1 + 0.2 - 0.3` tetap `PUSH`, bukan `WIN` karena 1e-17).

Sisi BTTS dibaca **sebelum** default, dan normalisasi pemisah menangani
`btts_no`, `BTTS: No`, `BTTS (No)`, `Both Teams to Score - No`.

**Bug tambahan yang ditemukan lewat tes:** `extractLine` melempar
`TypeError` untuk label yang berakhiran angka tanpa prefiks (mis. `Totals 3.5`)
karena regex fallback tidak punya capture group. Sudah diperbaiki.

---

## BUG-03 — Settlement parlay

**Terkonfirmasi.** Update leg memakai `.eq('fixture_id', ...)`, sehingga leg
manual pada fixture yang sama ikut tertimpa hasil market AI. Leg manual juga
tidak pernah disettle bila fixture-nya tidak punya prediksi, dan
`every(r => r === 'WIN')` meninggalkan parlay berstatus `settled` selamanya
saat ada `HALF_WIN`/`PUSH`.

**Perbaikan.**

1. Leg AI di-update via `.eq('prediction_id', prediction.id)`.
2. Pass baru `settleManualParlayLegs()` menyelesaikan leg dengan
   `prediction_id IS NULL` memakai `market` + `selection` leg itu sendiri;
   fixture yang belum dimuat di-resolve dengan satu query tambahan, sehingga
   leg manual pada fixture tanpa prediksi AI tetap tersettle.
   `parlayLegMarketText()` memetakan nama tim pada `selection` kembali ke token
   `Home`/`Away` yang dikenali `calculateResult`.
3. `parlayStatusFromLegResults()`: `HALF_LOSS` = kalah, `HALF_WIN`/`PUSH` =
   leg menang, dan parlay baru `won` setelah semua leg selesai.

Satu nuansa: audit menyarankan `results.every(r => WIN || HALF_WIN || PUSH)`
yang akan menandai parlay **won** walau semua legnya `PUSH` (stake kembali).
Implementasi memakai `some(WIN || HALF_WIN)`; all-push menjadi `settled`.

---

## BUG-04 — `undefined` pada URLSearchParams

**Terkonfirmasi dan diperbaiki dengan `buildQueryString()`** yang melewati
`undefined`, `null`, dan string kosong. Berlaku untuk `useListStandings`,
`useListTeamStats`, `useListEvents`, dan `useListSupabaseFixtures`.

Catatan: sebagian dampak yang dilaporkan berasal dari tipe parameter
(`league_slug?: string` sudah `undefined` di level tipe, jadi tidak pernah
menjadi literal `'undefined'`). Perbaikan tetap diperlukan karena
`useListSupabaseFixtures` bertipe `Record<string, string | number>` dan
`useListTeamStats`/`useListStandings` mengirim `season: undefined` saat kolom
season dikosongkan. Perilaku sekarang diverifikasi dengan 6 kasus.

---

## BUG-05 — Tabel odds fixtures

**Terkonfirmasi.** Cabang `home && away` mendahului cabang `draw`, sehingga
harga seri tidak pernah tampil untuk ML/HT. Backend mengirim `line`, bukan `hdp`.

**Perbaikan.** `describeOddsEntry()` mendahulukan 1X2 (menampilkan `1 | X | 2`)
dan `line ?? hdp` ditampilkan sebagai `Line …`. Nilai `null`/string kosong
diperlakukan seperti `undefined`.

---

## BUG-06 — Auth dan password hardcoded

**Terkonfirmasi.** `POST /api/analyze/:fixtureId` dan `/api/odds/bookmakers`
tanpa `requireAdmin`; `CSV_UPLOAD_PASSWORD` punya fallback `"parlay2024"`.

**Perbaikan.** Kedua endpoint memakai `requireAdmin`; daftar bookmaker
di-cache 1 jam. Password CSV tidak lagi punya default — endpoint mengembalikan
**503** sampai secret di-set. Dokumentasi (`replit.md`) diperbarui.

Smoke test pada server hasil build:

```
POST /api/analyze/12345                 -> 401
GET  /api/odds/bookmakers               -> 401
POST /api/csv/upload (tanpa body)       -> 503
POST /api/upload-csv  (tanpa body)      -> 503
```

Dua status 500 sebelumnya (crash `Cannot destructure property 'password' of
'req.body'`) juga diperbaiki: `req.body` bisa `undefined` bila request tidak
membawa body multipart.

Karena endpoint analyze kini butuh admin, hook `useRunAIAnalysis` ikut mengirim
`x-admin-password` (dan menghapus password tersimpan saat 401) agar fitur tidak
rusak.

---

## BUG-07 — Kelly criterion

**Terkonfirmasi.** `halfKelly = 0` (edge ≤ 0) tetap jatuh ke cabang
`halfKelly < 1` → `"0.5%"`. Ekstraksi probabilitas gagal untuk `"prob. nyata"`,
desimal tanpa `%`, dan koma desimal.

**Perbaikan.** Edge/probabilitas tidak positif → `"0%"`. Ekstraksi menerima
bentuk persen dan desimal, koma atau titik, lalu di-clamp ke `[0.01, 0.99]`.

---

## BUG-08 — Refetch dashboard dan N+1 CSV

**Terkonfirmasi.** `new Date()` di body render menghasilkan query key baru tiap
render (setiap polling 1,5 detik saat batch scan), dan query
`team_season_stats` berada di dalam loop baris di `csv.ts` **dan**
`stats-ingest.ts`.

**Perbaikan.** Window fixture di-anchor ke `startOfDay()` lewat `useMemo`
(kunci hanya berubah saat `scanDays` berubah). Kedua endpoint memuat
league/season sekali per request, lalu memperbarui snapshot in-memory setelah
setiap write agar baris berikutnya untuk tim yang sama tetap merge dengan nilai
terbaru. Upsert kini memakai `.select("id")` supaya id baris baru diketahui.

---

## BUG-09 — Cron, slug default, dan lockout password admin

**Terkonfirmasi.** `POST /api/config` hanya menulis ke Supabase tanpa
me-reload `node-cron`; default config memakai `"serie-a"`; password salah
disimpan permanen sehingga semua aksi admin berikutnya 401.

**Perbaikan.**

- `reloadOddsSchedule()` di `scheduler/index.ts` memvalidasi ekspresi
  (`cron.validate`) lalu mendaftar ulang task. Endpoint mengembalikan
  `schedulerReloaded` dan menolak ekspresi tidak valid dengan 400.
- Default config → `"italy-serie-a"` (sesuai `LEAGUES_CATALOG`).
- **Perbaikan lockout:** `clearStoredAdminPassword()` dipanggil pada setiap
  respons 401 (`parlay-hooks.ts`, dashboard batch scan). Hook mendengarkan event
  `admin-password-cleared` sehingga state React ikut kosong dan dialog muncul
  kembali pada aksi berikutnya — tanpa perlu menghapus localStorage manual.

Catatan: dialog tetap menyimpan password setelah dikirim (perilaku lama), tetapi
password tersebut otomatis dibuang bila server menolaknya, sehingga tidak ada
lagi loop 401 permanen.

---

## BUG-10 — Odds events dan skema Drizzle

**Terkonfirmasi (keduanya).** `/api/odds/events` mem-paging seluruh
`odds_history` + `odds_movement_history` hanya untuk menghitung jumlah baris,
dan `lib/db` mendefinisikan `odds_events`/`odds_data`/`team_stats` yang tidak
dipakai kode mana pun sementara `scripts/post-merge.sh` menjalankan
`drizzle-kit push`.

**Perbaikan (pendekatan berbeda dari rekomendasi awal).**

1. Agregasi dilakukan di Postgres, bukan dengan VIEW baru. Dua fungsi SQL
   `fixture_odds_summary()` dan `fixture_odds_movement_summary()` ditambahkan di
   `supabase/migrations/20261109_odds_summary_functions.sql`, dipanggil lewat
   `supabase.rpc()`. Alasannya: view tanpa filter akan memaksa agregasi seluruh
   tabel, sedangkan RPC bisa dibatasi `= ANY(p_ids)` dan hanya mengembalikan
   satu baris per fixture.
   Bila migrasi belum diterapkan, route memakai fallback yang dibatasi
   (`.limit()` + collapse per bookmaker/market) sehingga tetap berfungsi.
   `fetchAllPages` yang kini tak terpakai dihapus dari `odds.ts`.
2. `lib/db` diselaraskan dengan tabel produksi: `team_season_stats` (11 kolom
   JSONB) dan `odds_history`. `odds_events`/`odds_data` dipertahankan sebagai
   stub bertanda `@deprecated` agar import lama tetap kompilasi, dengan catatan
   eksplisit bahwa keduanya tidak dipakai runtime.

**Yang perlu dijalankan di Supabase:** terapkan
`supabase/migrations/20261109_odds_summary_functions.sql`.

Status: **sudah diterapkan** ke project `parlayfb` (`hqbuwfyiqfxpnpdlgcru`)
pada 2026-11-09. Verifikasi:

```
fixture_odds_summary(['72036250'])  -> 136 baris odds, 125 market, 279 movement
EXPLAIN ANALYZE (100 fixture)       -> 70 ms
anon / authenticated EXECUTE        -> false
service_role EXECUTE                -> true
```

---

## Catatan operasional

- `CSV_UPLOAD_PASSWORD` sekarang **wajib**. Set di Secrets sebelum upload CSV,
  jika tidak endpoint mengembalikan 503.
- Migrasi RPC odds summary perlu diterapkan agar `/api/odds/events` memakai
  jalur cepat (fallback tetap aman bila belum).
- `pnpm --filter @workspace/api-server test` menjalankan seluruh tes backend.
