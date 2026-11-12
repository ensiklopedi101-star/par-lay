import { test } from "node:test";
import assert from "node:assert/strict";
import { leaguesForDailySync, remainingMs, stepBudgetMs } from "./daily-plan";
import { DEFAULT_LEAGUES } from "./odds-fetcher";

test("liga yang dipilih selalu unik dan tidak melebihi jumlah liga", () => {
  const picked = leaguesForDailySync(DEFAULT_LEAGUES, new Date("2026-11-12T06:00:00Z"), 3);
  assert.equal(picked.length, 3);
  assert.equal(new Set(picked.map((l) => l.slug)).size, 3);

  const all = leaguesForDailySync(DEFAULT_LEAGUES, new Date("2026-11-12T06:00:00Z"), 999);
  assert.equal(all.length, DEFAULT_LEAGUES.length);
  assert.equal(new Set(all.map((l) => l.slug)).size, DEFAULT_LEAGUES.length);
});

test("rotasi bergeser setiap hari, sehingga semua liga mendapat giliran", () => {
  const day1 = leaguesForDailySync(DEFAULT_LEAGUES, new Date("2026-11-12T06:00:00Z"), 2);
  const day2 = leaguesForDailySync(DEFAULT_LEAGUES, new Date("2026-11-13T06:00:00Z"), 2);
  assert.notDeepEqual(
    day1.map((l) => l.slug),
    day2.map((l) => l.slug),
  );

  /* 12 hari rotasi (6 hari x 2 liga) harus menyentuh semua liga default. */
  const seen = new Set<string>();
  for (let day = 0; day < DEFAULT_LEAGUES.length; day++) {
    const date = new Date(Date.UTC(2026, 11, 1 + day, 6));
    for (const league of leaguesForDailySync(DEFAULT_LEAGUES, date, 2)) {
      seen.add(league.slug);
    }
  }
  assert.equal(seen.size, DEFAULT_LEAGUES.length);
});

test("permintaan nol atau daftar kosong menghasilkan sync kosong, bukan crash", () => {
  assert.deepEqual(leaguesForDailySync(DEFAULT_LEAGUES, new Date(), 0), []);
  assert.deepEqual(leaguesForDailySync([], new Date(), 2), []);
  assert.deepEqual(leaguesForDailySync(DEFAULT_LEAGUES, new Date(), -3), []);
});

test("sisa anggaran tidak pernah negatif", () => {
  assert.equal(remainingMs(1_000, 400), 600);
  assert.equal(remainingMs(1_000, 1_500), 0);
});

test("anggaran langkah menyisakan cadangan untuk langkah berikutnya", () => {
  const deadline = 10_000;
  /* sisa 10.000 ms, maksimal 20.000, cadangan 10.000 → 0 */
  assert.equal(stepBudgetMs(deadline, 20_000, 10_000, 0), 0);
  /* sisa 10.000 ms, maksimal 4.000, cadangan 1.000 → 4.000 */
  assert.equal(stepBudgetMs(deadline, 4_000, 1_000, 0), 4_000);
  /* sisa 5.000 ms, maksimal 20.000, cadangan 2.000 → 3.000 */
  assert.equal(stepBudgetMs(deadline, 20_000, 2_000, 5_000), 3_000);
});
