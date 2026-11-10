import assert from "node:assert/strict";
import test from "node:test";
import { calculateKelly, extractProbFromPrediction } from "./kelly-criterion";

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

test("Kelly units grow with the edge and are capped", () => {
  const small = calculateKelly(1.95, 0.55);
  const large = calculateKelly(4.0, 0.6);
  assert.notEqual(small.recommendedUnit, "0%");
  assert.equal(large.recommendedUnit, "5% (max)");
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
