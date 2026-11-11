import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_BOOKMAKERS,
  getSyncTimeBudgetMs,
  normalizeConfiguredBookmakers,
} from "./odds-fetcher";

test("default bookmaker mengikuti paket free: 1xbet + M88, bukan Bet365", () => {
  assert.equal(DEFAULT_BOOKMAKERS, "1xbet,M88");
});

test("konfigurasi admin diubah menjadi parameter koma", () => {
  assert.equal(normalizeConfiguredBookmakers(["1xbet", "M88"]), "1xbet,M88");
  assert.equal(normalizeConfiguredBookmakers([" M88 ", "1xbet"]), "M88,1xbet");
});

test("konfigurasi kosong atau rusak jatuh ke default, bukan ke Bet365", () => {
  assert.equal(normalizeConfiguredBookmakers([]), DEFAULT_BOOKMAKERS);
  assert.equal(normalizeConfiguredBookmakers(null), DEFAULT_BOOKMAKERS);
  assert.equal(normalizeConfiguredBookmakers("Bet365"), DEFAULT_BOOKMAKERS);
  assert.equal(normalizeConfiguredBookmakers(["", "  "]), DEFAULT_BOOKMAKERS);
});

test("anggota kosong dibuang tanpa menghasilkan koma ganda", () => {
  assert.equal(normalizeConfiguredBookmakers(["1xbet", null, "M88"]), "1xbet,M88");
});

test("batas waktu sync memakai default 45 detik bila env tidak diatur", () => {
  const original = process.env["SYNC_TIME_BUDGET_MS"];
  try {
    delete process.env["SYNC_TIME_BUDGET_MS"];
    assert.equal(getSyncTimeBudgetMs(), 45_000);
  } finally {
    if (original === undefined) delete process.env["SYNC_TIME_BUDGET_MS"];
    else process.env["SYNC_TIME_BUDGET_MS"] = original;
  }
});

test("SYNC_TIME_BUDGET_MS meng-override batas waktu bila valid", () => {
  const original = process.env["SYNC_TIME_BUDGET_MS"];
  try {
    process.env["SYNC_TIME_BUDGET_MS"] = "12000";
    assert.equal(getSyncTimeBudgetMs(), 12_000);
    process.env["SYNC_TIME_BUDGET_MS"] = "negatif";
    assert.equal(getSyncTimeBudgetMs(), 45_000, "nilai non-angka jatuh ke default");
  } finally {
    if (original === undefined) delete process.env["SYNC_TIME_BUDGET_MS"];
    else process.env["SYNC_TIME_BUDGET_MS"] = original;
  }
});
