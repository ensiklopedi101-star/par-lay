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

  it("gerbang kualitas membuang leg nyaris-pasti berharga ~1,00 (Under 8.5)", () => {
    const junk = candidate(99, {
      odds: 1.01, pMarket: 0.985, pModelOnly: 0.985, pFinal: 0.98, key: "TOT:under:8.5",
    });
    junk.selection = selection({ odds: 1.01, pMarket: 0.985, pModelOnly: 0.985, family: "Totals", line: 8.5 });
    const deepLine = candidate(98, {
      odds: 1.13, pMarket: 0.84, pModelOnly: 0.84, pFinal: 0.82, key: "TOT:under:5.5",
    });
    deepLine.selection = selection({ odds: 1.13, pMarket: 0.84, pModelOnly: 0.84, family: "Totals", line: 5.5 });
    const good = Array.from({ length: 6 }, (_, i) =>
      candidate(i + 1, { odds: 1.5, pMarket: 0.64, pModelOnly: 0.64, pFinal: 0.62 }));
    const ticket = buildMarketFirstTicket([junk, deepLine, ...good], { targetOdds: 2 });
    assert.ok(ticket);
    assert.ok(ticket!.legs.every((l) => l.fixtureId !== 99 && l.fixtureId !== 98));
    assert.ok(ticket!.notes.some((n) => n.includes("gerbang kualitas")));
  });
});

describe("parlay variants", () => {
  const stable = Array.from({ length: 6 }, (_, i) =>
    candidate(i + 1, { odds: 1.5, pMarket: 0.64, pModelOnly: 0.64, pFinal: 0.62 }));
  const boosterCand = candidate(7, { odds: 2.0, pMarket: 0.5, pModelOnly: 0.6, pFinal: 0.55 });
  const jackpotCands = Array.from({ length: 5 }, (_, i) =>
    candidate(10 + i, { odds: 1.95, pMarket: 0.48, pModelOnly: 0.56, pFinal: 0.52, evConservative: 0.01 }));

  it("utama, booster, dan jackpot terbentuk dengan karakternya masing-masing", async () => {
    const { buildParlayVariants } = await import("./market-first");
    const v = buildParlayVariants([...stable, boosterCand, ...jackpotCands]);
    assert.ok(v.utama && v.utama.legs.length >= 5);
    assert.ok(v.booster, "booster harus terbentuk dari leg penguat yang didukung statistik");
    assert.equal(v.booster!.legs.filter((l) => l.fixtureId === 7).length, 1);
    assert.ok(v.jackpot, "jackpot harus terbentuk bila syarat nilai dan lantai peluang terpenuhi");
    assert.ok(v.jackpot!.combinedOdds >= 20);
    assert.ok(v.jackpot!.pCombined >= 0.025);
  });

  it("diagnostik kolam dilaporkan dan catatan utama menyebut angka saat kolam kurang", async () => {
    const { buildParlayVariants } = await import("./market-first");
    /* Hanya 3 laga dengan leg stabil — di bawah minimum 5 leg. */
    const few = [1, 2, 3].map((i) =>
      candidate(i, { odds: 1.5, pMarket: 0.64, pModelOnly: 0.64, pFinal: 0.62 }));
    const v = buildParlayVariants(few);
    assert.equal(v.utama, null);
    assert.equal(v.diagnostics.stablePoolSize, 3);
    assert.equal(v.diagnostics.minLegs, 5);
    assert.equal(v.diagnostics.candidatesIn, 3);
    assert.match(v.variantNotes.utama ?? "", /hanya 3 leg/);
  });

  it("jackpot ditolak terbuka bila leg nilai tidak cukup", async () => {
    const { buildParlayVariants } = await import("./market-first");
    const v = buildParlayVariants(stable);
    assert.equal(v.jackpot, null);
    assert.ok(v.variantNotes.jackpot && v.variantNotes.jackpot.length > 0);
  });
});
