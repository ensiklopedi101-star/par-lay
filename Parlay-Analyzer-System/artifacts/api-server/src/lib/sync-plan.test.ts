import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ODDS_MULTI_BATCH_SIZE,
  chunkItems,
  isScheduleCandidate,
} from "./sync-plan";

test("batch multi-odds tidak pernah melebihi 10 event", () => {
  assert.equal(ODDS_MULTI_BATCH_SIZE, 10);
  const ids = Array.from({ length: 23 }, (_, i) => i + 1);
  const chunks = chunkItems(ids);
  assert.deepEqual(chunks.map((c) => c.length), [10, 10, 3]);
  assert.equal(chunks.flat().length, ids.length);
});

test("potongan kosong dan ukuran tidak masuk akal tetap aman", () => {
  assert.deepEqual(chunkItems([]), []);
  assert.deepEqual(chunkItems([1, 2, 3], 0), [[1, 2, 3]]);
  assert.deepEqual(chunkItems([1, 2, 3], -5), [[1, 2, 3]]);
});

test("jadwal berbulan-bulan ke depan tetap disimpan", () => {
  const now = new Date("2026-11-12T12:00:00Z");
  assert.equal(isScheduleCandidate("2026-12-26T15:00:00Z", now), true);
  assert.equal(isScheduleCandidate("2027-02-01T15:00:00Z", now), true);
});

test("pertandingan yang baru mulai masih diterima, yang sudah lama tidak", () => {
  const now = new Date("2026-11-12T12:00:00Z");
  assert.equal(isScheduleCandidate("2026-11-12T09:00:00Z", now), true);
  assert.equal(isScheduleCandidate("2026-11-11T12:00:00Z", now), false);
  assert.equal(isScheduleCandidate("2026-06-01T12:00:00Z", now), false);
});

test("tanggal rusak tidak pernah disimpan", () => {
  assert.equal(isScheduleCandidate("", new Date()), false);
  assert.equal(isScheduleCandidate("bukan tanggal", new Date()), false);
});
