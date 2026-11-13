import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/*
 * Penjaga regresi untuk bug "16 tersimpan, 2 ditolak" (Eredivisie 2026-27).
 *
 * `team_season_stats` TIDAK punya kolom `created_at` (diverifikasi dari
 * information_schema produksi: id, league_slug, season, team_name, 11 kolom
 * stats_*, updated_at, team_key). Jalur insert di stats-ingest menulisnya,
 * sehingga setiap tim baru — FC Twente, Go Ahead Eagles, dan semua tim
 * promosi di liga mana pun — gagal diam-diam per tim.
 *
 * Tes ini membaca sumber route dan memastikan kolom karangan itu tidak
 * kembali. Ini bukan pengganti tes integrasi DB; ini rem termurah agar
 * kesalahan yang sama tidak masuk lagi lewat edit berikutnya.
 */
const source = readFileSync(new URL("./stats-ingest.ts", import.meta.url), "utf8");

test("stats-ingest tidak menulis kolom yang tidak ada di team_season_stats", () => {
  assert.ok(
    !/payload\.created_at/.test(source),
    "payload insert tidak boleh memuat created_at — kolom itu tidak ada di team_season_stats",
  );
  assert.ok(
    !/payload\.team_key/.test(source),
    "team_key adalah kolom turunan DB — tidak boleh ditulis pemanggil",
  );
});

test("stats-ingest tetap menulis updated_at (kolom sah untuk kesegaran data)", () => {
  assert.match(source, /updated_at: new Date\(\)\.toISOString\(\)/);
});
