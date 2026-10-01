import assert from "node:assert/strict";
import test from "node:test";
import { appendSettlementContext } from "./settlement-context";

const evaluatedAt = "2026-10-01T00:00:00.000Z";

test("appends settlement data to an object snapshot without changing its analysis input", () => {
  const snapshot = {
    schemaVersion: 1,
    input: { teamStats: { home: { stats_xg: { xG: 1.4 } } } },
    recommendation: { marketBet: "Over 2.5", probability: 0.58 },
  };

  const result = appendSettlementContext(
    snapshot,
    { homeScore: 2, awayScore: 1 },
    "fixture_final_score",
    evaluatedAt,
  );

  assert.deepEqual(result, {
    ...snapshot,
    settlement: {
      homeScore: 2,
      awayScore: 1,
      evaluatedAt,
      evaluationSource: "fixture_final_score",
    },
  });
  assert.equal("settlement" in snapshot, false);
});

test("parses a JSON-string snapshot before appending settlement data", () => {
  const snapshot = {
    schemaVersion: 1,
    input: { odds: { snapshot: [{ market_type: "ML" }] } },
    recommendation: { marketBet: "Home", probability: 0.62 },
  };

  const result = appendSettlementContext(
    JSON.stringify(snapshot),
    { homeScore: 1, awayScore: 0 },
    "fixture_final_score",
    evaluatedAt,
  );

  assert.deepEqual(result, {
    ...snapshot,
    settlement: {
      homeScore: 1,
      awayScore: 0,
      evaluatedAt,
      evaluationSource: "fixture_final_score",
    },
  });
});

test("retains unparseable legacy context instead of replacing it", () => {
  const legacyContext = "legacy analysis context";
  const result = appendSettlementContext(
    legacyContext,
    { homeScore: 0, awayScore: 0 },
    "manual_score_entry",
    evaluatedAt,
  );

  assert.deepEqual(result, {
    legacyManualContext: legacyContext,
    settlement: {
      homeScore: 0,
      awayScore: 0,
      evaluatedAt,
      evaluationSource: "manual_score_entry",
    },
  });
});