import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { huntBestPrice, ticketPriceImpact } from "./price-hunt";

describe("price-hunt", () => {
  it("menemukan harga terbaik lintas bandar dan menghitung kenaikannya", () => {
    const result = huntBestPrice(1.66, [
      { bookmaker: "1xbet", odds: 1.66 },
      { bookmaker: "bet365", odds: 1.72 },
      { bookmaker: "pinnacle", odds: 1.7 },
    ]);
    assert.equal(result.bestOdds, 1.72);
    assert.equal(result.bestBookmaker, "bet365");
    assert.equal(result.offers, 3);
    assert.ok(Math.abs(result.uplift - (1.72 / 1.66 - 1)) < 1e-9);
  });

  it("drift menajam bila harga memendek, menjauh bila memanjang", () => {
    const sharpening = huntBestPrice(1.8, [], [
      { odds: 1.95, capturedAt: "2026-11-15T00:00:00Z" },
      { odds: 1.8, capturedAt: "2026-11-15T06:00:00Z" },
    ]);
    assert.equal(sharpening.drift, "menajam");
    const drifting = huntBestPrice(1.8, [], [
      { odds: 1.7, capturedAt: "2026-11-15T00:00:00Z" },
      { odds: 1.85, capturedAt: "2026-11-15T06:00:00Z" },
    ]);
    assert.equal(drifting.drift, "menjauh");
  });

  it("dampak tiket mengalikan kenaikan per leg", () => {
    const impact = ticketPriceImpact([
      { usedOdds: 1.5, bestOdds: 1.55 },
      { usedOdds: 1.5, bestOdds: 1.5 },
      { usedOdds: 1.4, bestOdds: 1.47 },
    ]);
    assert.ok(Math.abs(impact.usedCombined - 3.15) < 1e-9);
    assert.ok(impact.bestCombined > impact.usedCombined);
    assert.ok(impact.uplift > 0.08 && impact.uplift < 0.09);
  });
});
