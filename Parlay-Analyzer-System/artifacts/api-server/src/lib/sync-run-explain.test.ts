import { test } from "node:test";
import assert from "node:assert/strict";
import { LOW_INSERT_RATIO, explainInsertRatio } from "./sync-run-explain";

test("rasio sehat tidak diberi penjelasan tambahan", () => {
  assert.equal(explainInsertRatio(3, 3), null);
  assert.equal(explainInsertRatio(10, 5), null);
  assert.equal(explainInsertRatio(10, 9), null);
});

test("nol tersimpan dijelaskan, bukan dibiarkan tampak seperti kegagalan", () => {
  const reason = explainInsertRatio(140, 0);
  assert.ok(reason);
  assert.match(reason!, /Tidak ada event baru/);
  assert.match(reason!, /seluruh daftar liga/i);
});

test("rasio rendah (1 dari 140) dijelaskan dengan angka sebenarnya", () => {
  const reason = explainInsertRatio(140, 1);
  assert.ok(reason);
  assert.match(reason!, /Hanya 1 dari 140/);
  assert.match(reason!, /scan_days/);
  assert.match(reason!, /Error/);
});

test("tanpa event ditarik tidak ada yang perlu dijelaskan", () => {
  assert.equal(explainInsertRatio(0, 0), null);
  assert.equal(explainInsertRatio(-1, 0), null);
  assert.equal(explainInsertRatio(Number.NaN, 0), null);
});

test("ambang rendah tetap 50 persen", () => {
  assert.equal(LOW_INSERT_RATIO, 0.5);
  assert.notEqual(explainInsertRatio(100, 49), null);
  assert.equal(explainInsertRatio(100, 50), null);
});
