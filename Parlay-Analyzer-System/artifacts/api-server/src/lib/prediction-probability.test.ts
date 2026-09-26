import assert from "node:assert/strict";
import test from "node:test";
import { predictionProbabilityFromContext } from "./prediction-probability";

test("reads the compact probability value", () => {
  assert.equal(predictionProbabilityFromContext({ probability: 0.58 }), 0.58);
});

test("falls back to the versioned recommendation snapshot", () => {
  assert.equal(
    predictionProbabilityFromContext({
      recommendation: { marketBet: "Over 2.5", probability: 0.61 },
    }),
    0.61,
  );
  assert.equal(
    predictionProbabilityFromContext({
      evaluation_snapshot: { recommendation: { probability: "62%" } },
    }),
    0.62,
  );
});

test("does not use confidence or invalid values as probability", () => {
  assert.equal(
    predictionProbabilityFromContext({
      confidence: 8.5,
      recommendation: { confidence: 9, probability: 1.2 },
    }),
    0,
  );
});