import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { SelectionEval } from "./pipeline";
import { buildMarketFirstTicket, classifyLeg, type MarketFirstCandidate } from "./market-first";

function selection(partial: Partial<SelectionEval>): SelectionEval {
  return {
    key: "ml_home",
    label: "Home",
    family: "ML",
    odds: 1.5,
    line: null,
    pFinal: 0.62,
    pMarket: 0.63,
    pModelOnly: 0.63,
    outcome: "win" as never,
    ev: 0,
    evConservative: 0,
    sigma: 0.05,
    stakePct: 0,
    minOdds: 1.6,
    passes: false,
    rejectReasons: [],
    ...partial,
  };
}

function candidate(
  fixtureId: number,
  sel: Partial<SelectionEval>,
  marketKey = `m${fixtureId}`,
): MarketFirstCandidate {
  return {
    marketKey,
    fixtureId,
    league: "england-premier-league",
    date: "2026-11-21",
    selection: selection(sel),
  };
}

describe("market-first", () => {
  it("classifyLeg membedakan dukungan, kerapuhan, dan kontradiksi statistik", () => {
    assert.equal(classifyLeg(selection({ pMarket: 0.6, pModelOnly: 0.72 })).character, "didukung-statistik");
    assert.equal(classifyLeg(selection({ pMarket: 0.6, pModelOnly: 0.6 })).character, "pasar-stabil");
    assert.equal(classifyLeg(selection({ pMarket: 0.6, pModelOnly: 0.52 })).character, "rapuh");
    assert.equal(classifyLeg(selection({ pMarket: 0.6, pModelOnly: 0.4 })).character, "kontradiktif");
  });

  it("tiket selalu terbentuk dari peluang pasar tanpa syarat EV positif", () => {
    const candidates = Array.from({ length: 8 }, (_, i) =>
      candidate(i + 1, { odds: 1.45, pMarket: 0.65, pModelOnly: 0.65, pFinal: 0.6 }));
    const ticket = buildMarketFirstTicket(candidates, { targetOdds: 2 });
    assert.ok(ticket);
    assert.ok(ticket!.legs.length >= 5 && ticket!.legs.length <= 8);
    assert.ok(ticket!.pCombined > 0 && ticket!.pCombined < 1);
    // EV jujur boleh negatif — dan tiket tetap dikembalikan.
    assert.ok(ticket!.targetReached);
  });

  it("satu leg per pertandingan: karakter lebih baik mengalahkan odds mentah", () => {
    const candidates = [
      candidate(1, { odds: 1.3, pMarket: 0.72, pModelOnly: 0.5 }, "kontra"),
      candidate(1, { odds: 1.9, pMarket: 0.5, pModelOnly: 0.62 }, "dukung"),
      ...Array.from({ length: 5 }, (_, i) =>
        candidate(i + 2, { odds: 1.9, pMarket: 0.46, pModelOnly: 0.46 })),
    ];
    const ticket = buildMarketFirstTicket(candidates, { minMarketProb: 0.45 });
    assert.ok(ticket);
    const fixture1 = ticket!.legs.filter((l) => l.fixtureId === 1);
    assert.equal(fixture1.length, 1);
    assert.equal(fixture1[0]!.character, "didukung-statistik");
  });
});
