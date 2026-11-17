import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { friendlyMarketLabel, substitutionHint } from "./market-label";

describe("market-label", () => {
  it("label manusiawi", () => {
    assert.equal(friendlyMarketLabel("TOT:over:2"), "Over 2 Gol");
    assert.equal(friendlyMarketLabel("AH:away:1.75"), "Asian Handicap — Tim Tamu +1.75");
  });

  it("panduan pengganti hanya untuk line bulat Totals, arah sama", () => {
    assert.ok(substitutionHint("TOT:over:2")?.includes("Over 2.5"));
    assert.ok(substitutionHint("TOT:under:3")?.includes("Under 3.5"));
    assert.equal(substitutionHint("TOT:over:2.5"), null);
    assert.equal(substitutionHint("TOT:over:2.25"), null);
    assert.equal(substitutionHint("ML:home"), null);
    assert.equal(substitutionHint("BTTS:yes"), null);
  });
});
