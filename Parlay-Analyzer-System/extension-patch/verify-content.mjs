#!/usr/bin/env node
/**
 * Verifikasi content.js v3.2.0 tanpa membuka Chrome.
 *
 * Guard "label vs stat_type" (PATCH 4) adalah satu-satunya bagian yang murni
 * logika, jadi ia diekstrak dari file lalu diuji langsung terhadap payload
 * nyata — termasuk blok La Liga yang pada 10 Nov 2026 masuk ke kolom
 * stats_goals_scored. Sisanya diperiksa secara struktural (string wajib ada,
 * manifest valid), karena sisanya adalah kode DOM.
 *
 * Jalankan: node extension-patch/verify-content.mjs
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import assert from "node:assert/strict";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "content.js"), "utf8");
const manifest = JSON.parse(readFileSync(join(here, "manifest.json"), "utf8"));

let checks = 0;
function check(name, fn) {
  fn();
  checks += 1;
  console.log(`  ok  ${name}`);
}

/* ── 1. Guard: ekstrak & jalankan ─────────────────────────────────────── */
const guardStart = src.indexOf("// === PATCH 4 === GUARD:START");
const guardEnd = src.indexOf("// === GUARD:END ===");
assert.ok(guardStart > 0 && guardEnd > guardStart, "blok GUARD tidak ditemukan di content.js");

const guard = new Function(
  src.slice(guardStart, guardEnd) + "\nreturn { contradictingTeams, describeContradiction };",
)();

/* Bentuk blok nyata dari database (La Liga 2026-27, 10 Nov 2026). */
const CONCEDED_BLOCK = {
  MP: "6",
  Away: "1.00 / match",
  Home: "1.00 / match",
  "Per Match": "1.00 Conceded / match",
  "Goals Conceded": "6",
  "Home Advantage": "0%",
};

/* Bentuk blok yang benar untuk kolom gol-dicetak. */
const SCORED_BLOCK = {
  MP: "6",
  Away: "1.00 / match",
  Home: "1.50 / match",
  "Per Match": "1.17 Scored / match",
  "Goals Scored": "7",
  "Home Advantage": "+14%",
};

const XG_BLOCK = { MP: "6", "Per Match": "1.42", "Home Advantage": "+9%" };

const team = (name, stat_data) => ({ raw_team_name: name, stat_data });

console.log("guard: label vs stat_type");

check("blok Conceded di stats_goals_scored ditolak (kasus La Liga)", () => {
  const bad = guard.contradictingTeams("stats_goals_scored", [
    team("Bilbao", CONCEDED_BLOCK),
    team("Deportivo Alaves", CONCEDED_BLOCK),
  ]);
  assert.deepEqual(bad, ["Bilbao", "Deportivo Alaves"]);
  const msg = guard.describeContradiction("stats_goals_scored", [
    team("Bilbao", CONCEDED_BLOCK),
  ]);
  assert.match(msg, /Goals Conceded/);
  assert.match(msg, /stats_goals_conceded/);
});

check("blok Scored di stats_goals_scored diterima", () => {
  assert.deepEqual(guard.contradictingTeams("stats_goals_scored", [team("Bilbao", SCORED_BLOCK)]), []);
  assert.equal(guard.describeContradiction("stats_goals_scored", [team("Bilbao", SCORED_BLOCK)]), null);
});

check("blok Conceded di stats_goals_conceded diterima", () => {
  assert.deepEqual(
    guard.contradictingTeams("stats_goals_conceded", [team("Bilbao", CONCEDED_BLOCK)]),
    [],
  );
});

check("blok Scored di stats_goals_conceded ditolak (arah sebaliknya)", () => {
  assert.deepEqual(
    guard.contradictingTeams("stats_goals_conceded", [team("Bilbao", SCORED_BLOCK)]),
    ["Bilbao"],
  );
});

check("stat_type lain tidak pernah difilter (xG)", () => {
  assert.deepEqual(guard.contradictingTeams("stats_xg", [team("Bilbao", XG_BLOCK)]), []);
  assert.deepEqual(guard.contradictingTeams("stats_over_25", [team("Bilbao", CONCEDED_BLOCK)]), []);
});

check("payload campuran: hanya tim yang salah dilaporkan", () => {
  const bad = guard.contradictingTeams("stats_goals_scored", [
    team("Benar FC", SCORED_BLOCK),
    team("Salah FC", CONCEDED_BLOCK),
  ]);
  assert.deepEqual(bad, ["Salah FC"]);
});

check("stat_data kosong / bukan objek tidak bikin crash", () => {
  assert.deepEqual(guard.contradictingTeams("stats_goals_scored", [team("X", null), team("Y", "junk")]), []);
  assert.deepEqual(guard.contradictingTeams("stats_goals_scored", []), []);
});

/* ── 2. Pemeriksaan struktural ────────────────────────────────────────── */
console.log("struktur content.js");

check("PATCH 1: league_slug = negara-kompetisi", () => {
  assert.match(
    src,
    /var leagueSlug = parts\.length >= 2 \? \(parts\[0\] \+ '-' \+ parts\[1\]\) : \(parts\[0\] \|\| ''\);/,
  );
  assert.doesNotMatch(src, /var leagueSlug = parts\[1\] \|\| parts\[0\] \|\| '';/);
});

check("PATCH 4: guard dipanggil saat paste dan sebelum push", () => {
  const calls = src.match(/describeContradiction\(/g) || [];
  assert.ok(calls.length >= 3, `diharapkan >=3 pemakaian, dapat ${calls.length}`);
});

check("PATCH 5: endpoint default = route aplikasi, bukan Edge Function", () => {
  assert.match(src, /DEFAULT_ENDPOINT = 'https:\/\/parwon\.vercel\.app\/api\/stats\/ingest'/s);
  assert.doesNotMatch(src, /DEFAULT_ENDPOINT = '[^']*supabase\.co/);
});

check("PATCH 6: kegagalan per tim & alasan penolakan ditampilkan", () => {
  assert.match(src, /result_rows/);
  assert.match(src, /rejected/);
  assert.match(src, /suggestions/);
});

check("PATCH 7: league_slug ikut dikirim di payload", () => {
  assert.match(src, /league_slug:\s*ctx\.league_slug \|\| ''/);
});

check("PATCH 8: riwayat push & peringatan basi", () => {
  assert.match(src, /PUSH_HISTORY_KEY/);
  assert.match(src, /function showStaleness/);
  assert.match(src, /STALE_DAYS/);
  assert.match(src, /showStaleness\(\);/);
});

check("versi 3.2.0 tampil di header widget", () => {
  assert.match(src, /var VERSION\s+= '3\.2\.0'/);
  assert.match(src, /fsi-ver/);
});

/* ── 3. Manifest ──────────────────────────────────────────────────────── */
console.log("manifest.json");

check("versi manifest 3.2.0", () => {
  assert.equal(manifest.version, "3.2.0");
});

check("host_permissions mencakup endpoint aplikasi & Supabase", () => {
  const hosts = manifest.host_permissions.join(" ");
  assert.match(hosts, /parwon\.vercel\.app/);
  assert.match(hosts, /supabase\.co/);
});

check("content script memakai content.js", () => {
  assert.deepEqual(manifest.content_scripts[0].js, ["content.js"]);
  assert.equal(manifest.manifest_version, 3);
});

console.log(`\n${checks} pemeriksaan lulus.`);
