import { test } from "node:test";
import assert from "node:assert/strict";
import {
  STALE_RUN_CLOSE_MESSAGE,
  STALE_SYNC_RUN_SECONDS,
  isSyncRunStale,
  staleSyncRunCutoffIso,
} from "./sync-runs";

const NOW = new Date("2026-11-12T12:00:00.000Z");

test("ambang basi default adalah 10 menit", () => {
  assert.equal(STALE_SYNC_RUN_SECONDS, 600);
  assert.equal(staleSyncRunCutoffIso(NOW), "2026-11-12T11:50:00.000Z");
});

test("cutoff mengikuti ambang kustom dan mengabaikan nilai tidak masuk akal", () => {
  assert.equal(staleSyncRunCutoffIso(NOW, 60), "2026-11-12T11:59:00.000Z");
  assert.equal(staleSyncRunCutoffIso(NOW, Number.NaN), "2026-11-12T11:50:00.000Z");
  assert.equal(staleSyncRunCutoffIso(NOW, 0), "2026-11-12T11:50:00.000Z");
  assert.equal(staleSyncRunCutoffIso(NOW, -5), "2026-11-12T11:50:00.000Z");
});

test("run yang masih di bawah ambang tidak dianggap basi", () => {
  assert.equal(isSyncRunStale("2026-11-12T11:51:00.000Z", NOW), false);
});

test("run yang menggantung melewati ambang dianggap basi", () => {
  assert.equal(isSyncRunStale("2026-11-12T11:49:59.000Z", NOW), true);
  assert.equal(isSyncRunStale("2026-11-12T11:28:47.321Z", NOW), true);
});

test("waktu mulai yang tidak valid tidak pernah ditutup", () => {
  assert.equal(isSyncRunStale("bukan tanggal", NOW), false);
  assert.equal(isSyncRunStale("", NOW), false);
});

test("pesan penutupan menjelaskan sebabnya, bukan sekadar 'failed'", () => {
  assert.match(STALE_RUN_CLOSE_MESSAGE, /otomatis/i);
  assert.match(STALE_RUN_CLOSE_MESSAGE, /serverless/i);
});
