import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { RollingFormTracker } from "./rolling-form";

describe("RollingFormTracker (point-in-time)", () => {
  it("tim tanpa pertandingan sebelumnya menghasilkan null", () => {
    const tracker = new RollingFormTracker();
    assert.equal(tracker.ratesFor("arsenal"), null);
  });

  it("rates hanya memuat pertandingan yang sudah dicatat (anti look-ahead)", () => {
    const tracker = new RollingFormTracker();
    tracker.record("arsenal", "chelsea", 2, 1);
    const rates = tracker.ratesFor("arsenal");
    assert.equal(rates?.matches, 1);
    assert.equal(rates?.goalsFor, 2);
    assert.equal(rates?.goalsAgainst, 1);
    assert.equal(rates?.goalsForHome, 2);
    assert.equal(rates?.goalsForAway, null);
    // Pertandingan kedua belum dicatat → belum boleh terlihat.
    tracker.record("liverpool", "arsenal", 0, 3);
    const updated = tracker.ratesFor("arsenal");
    assert.equal(updated?.matches, 2);
    assert.equal(updated?.goalsForAway, 3);
  });
});
