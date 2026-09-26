import assert from "node:assert/strict";
import test from "node:test";
import { predictionProbabilityFromContext } from "./prediction-probability";

test("explicit snapshot probability remains separate from confidence", () => {
  const context = {
    confidence: 8.5,
    recommendation: { marketBet: "Over 2.5 Goals", probability: 0.5313 },
  };
  assert.equal(predictionProbabilityFromContext(context), 0.5313);
  assert.notEqual(predictionProbabilityFromContext(context), 0.85);
});