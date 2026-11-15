import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { clampLimit, safeEqual } from "./security";

describe("security utils", () => {
  it("safeEqual hanya benar untuk rahasia identik", () => {
    assert.equal(safeEqual("rahasia", "rahasia"), true);
    assert.equal(safeEqual("rahasia", "lainnya"), false);
    assert.equal(safeEqual("pendek", "jauh-lebih-panjang"), false);
    assert.equal(safeEqual(undefined, "rahasia"), false);
    assert.equal(safeEqual("rahasia", ""), false);
  });

  it("clampLimit tidak pernah NaN atau tak terbatas", () => {
    assert.equal(clampLimit(undefined), 200);
    assert.equal(clampLimit("abc"), 200);
    assert.equal(clampLimit("999999"), 500);
    assert.equal(clampLimit("-5"), 1);
    assert.equal(clampLimit("25"), 25);
  });
});
