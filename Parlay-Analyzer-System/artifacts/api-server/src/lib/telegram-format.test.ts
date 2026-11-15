import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatTicketMessage } from "./telegram-format";
import type { MarketFirstTicket } from "./quant/market-first";

const ticket: MarketFirstTicket = {
  legs: [
    {
      marketKey: "ML:home",
      fixtureId: 1,
      league: "england-premier-league",
      date: "2026-11-21",
      pUsed: 0.72,
      homeTeam: "Arsenal",
      awayTeam: "Chelsea",
      displayLabel: "Menang — Tuan Rumah (1X2)",
      character: "didukung-statistik",
      stability: 0.8,
      characterNote: "",
      selection: {
        key: "ML:home", label: "1X2 — Home", family: "ML", odds: 1.5, line: null,
        pFinal: 0.7, pMarket: 0.72, pModelOnly: 0.78,
        outcome: "win" as never, ev: 0, evConservative: 0, sigma: 0.05,
        stakePct: 0, minOdds: 1.4, passes: true, rejectReasons: [],
      },
    },
  ],
  combinedOdds: 1.5,
  pCombined: 0.72,
  fairOdds: 1.39,
  evVsBook: 0.08,
  marginPaid: null,
  targetOdds: 2,
  targetReached: false,
  notes: ["Target odds 2.00 tidak tercapai"],
  priceImpact: { usedCombined: 1.5, bestCombined: 1.55, uplift: 0.033 },
};

describe("telegram-format", () => {
  it("memuat leg, peluang jujur, dan peringatan target", () => {
    const msg = formatTicketMessage(ticket, new Date("2026-11-15T00:00:00Z"));
    assert.ok(msg.includes("PARLAY UTAMA"));
    assert.ok(msg.includes("Arsenal vs Chelsea"));
    assert.ok(msg.includes("Menang — Tuan Rumah (1X2)"));
    assert.ok(msg.includes("72.0%"));
    assert.ok(msg.includes("tidak tercapai"));
    assert.ok(msg.includes("bukan janji"));
  });
});
