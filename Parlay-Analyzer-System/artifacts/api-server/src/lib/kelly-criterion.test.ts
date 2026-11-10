import assert from "node:assert/strict";
import test from "node:test";
import { calculateKelly, extractProbFromPrediction, MAX_RECOMMENDED_UNIT } from "./kelly-criterion";

/* ─── Stake recommendation (BUG-07) ─── */

test("a negative-EV bet gets no stake at all", () => {
  /* p=0.40 at 2.00 odds: edge = -0.10, Kelly is negative. */
  const result = calculateKelly(2.0, 0.4);
  assert.ok(result.edge < 0);
  assert.equal(result.recommendedUnit, "0%");
  assert.equal(result.isPositiveEdge, false);
  assert.equal(result.stakePercent, 0);
  assert.equal(result.stakePercentHalf, 0);
});

test("a break-even bet gets no stake", () => {
  const result = calculateKelly(2.0, 0.5);
  assert.equal(result.edge, 0);
  assert.equal(result.recommendedUnit, "0%");
  assert.equal(result.isPositiveEdge, false);
});

test("a small positive edge still recommends a stake unit", () => {
  const result = calculateKelly(2.1, 0.52);
  assert.ok(result.edge > 0);
  assert.notEqual(result.recommendedUnit, "0%");
});

test("Kelly units grow with the edge and are hard-capped at 2%", () => {
  const small = calculateKelly(1.95, 0.55);
  const large = calculateKelly(4.0, 0.6);
  assert.notEqual(small.recommendedUnit, "0%");
  /*
   * The stake cap is a risk control, not an output of the Kelly formula: a
   * 3-point error in the probability input roughly doubles the stake, and the
   * probability is itself an estimate. 2% is the ceiling until the ledger
   * proves calibration.
   */
  assert.equal(large.recommendedUnit, MAX_RECOMMENDED_UNIT);
  assert.equal(large.recommendedUnit, "2%");
});

test("no recommendation can exceed the 2% ceiling", () => {
  for (const odds of [1.5, 2, 3, 5, 10]) {
    for (const prob of [0.2, 0.4, 0.6, 0.8]) {
      const unit = calculateKelly(odds, prob).recommendedUnit;
      assert.ok(
        unit === "0%" || unit === "0.5%" || unit === "1%" || unit === "2%",
        `unexpected unit ${unit} for odds=${odds} p=${prob}`,
      );
    }
  }
});

test("invalid inputs stay at zero stake", () => {
  assert.equal(calculateKelly(1.0, 0.6).recommendedUnit, "0%");
  assert.equal(calculateKelly(2.0, 1).recommendedUnit, "0%");
  assert.equal(calculateKelly(2.0, 0).recommendedUnit, "0%");
});

/* ─── Probability extraction (BUG-07) ─── */

test("reads the percentage form used by the prompt", () => {
  assert.equal(extractProbFromPrediction("Probabilitas nyata: 55%"), 0.55);
  assert.equal(extractProbFromPrediction("prob. nyata: 55%"), 0.55);
  assert.equal(extractProbFromPrediction("PROB NYATA 62.5%"), 0.625);
  assert.equal(extractProbFromPrediction("probabilitas: 55,5 %"), 0.555);
});

test("reads the bare decimal form", () => {
  assert.equal(extractProbFromPrediction("probabilitas: 0.55"), 0.55);
  assert.equal(extractProbFromPrediction("prob. nyata: 0,55"), 0.55);
  assert.equal(extractProbFromPrediction("probability 0.62"), 0.62);
});

test("probability is clamped into a usable Kelly range", () => {
  assert.equal(extractProbFromPrediction("probabilitas: 100%"), 0.99);
  assert.equal(extractProbFromPrediction("probabilitas: 0.5%"), 0.01);
});

test("prose without an explicit probability returns null", () => {
  assert.equal(extractProbFromPrediction("confidence 8.5/10, value bet tinggi"), null);
  assert.equal(extractProbFromPrediction("probabilitas: tidak tersedia"), null);
  assert.equal(extractProbFromPrediction(""), null);
});
