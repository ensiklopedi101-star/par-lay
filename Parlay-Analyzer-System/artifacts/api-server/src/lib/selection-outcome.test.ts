import { test } from "node:test";
import assert from "node:assert/strict";
import { outcomeOfMarket, outcomeMapForFixture } from "./selection-outcome";

test("ML: hasil sesuai skor", () => {
  assert.equal(outcomeOfMarket("ML:home", { home: 2, away: 1 }), "win");
  assert.equal(outcomeOfMarket("ML:away", { home: 2, away: 1 }), "loss");
  assert.equal(outcomeOfMarket("ML:draw", { home: 2, away: 1 }), "loss");
  assert.equal(outcomeOfMarket("ML:draw", { home: 1, away: 1 }), "win");
  assert.equal(outcomeOfMarket("ML:home", { home: 0, away: 0 }), "loss");
});

test("BTTS: kedua sisi", () => {
  assert.equal(outcomeOfMarket("BTTS:yes", { home: 1, away: 1 }), "win");
  assert.equal(outcomeOfMarket("BTTS:yes", { home: 2, away: 0 }), "loss");
  assert.equal(outcomeOfMarket("BTTS:no", { home: 2, away: 0 }), "win");
  assert.equal(outcomeOfMarket("BTTS:no", { home: 0, away: 0 }), "win");
});

test("Totals: garis utuh dan setengah", () => {
  assert.equal(outcomeOfMarket("TOT:over:2.5", { home: 2, away: 1 }), "win");
  assert.equal(outcomeOfMarket("TOT:over:2.5", { home: 1, away: 1 }), "loss");
  assert.equal(outcomeOfMarket("TOT:under:2.5", { home: 1, away: 1 }), "win");
  assert.equal(outcomeOfMarket("TOT:over:3", { home: 2, away: 1 }), "push");
  assert.equal(outcomeOfMarket("TOT:under:3", { home: 2, away: 1 }), "push");
});

test("Totals: garis seperempat dibagi dua", () => {
  /* total 3, garis 2.75 → setengah menang */
  assert.equal(outcomeOfMarket("TOT:over:2.75", { home: 2, away: 1 }), "half_win");
  assert.equal(outcomeOfMarket("TOT:under:2.75", { home: 2, away: 1 }), "half_loss");
  /* total 2, garis 2.25 → over setengah kalah */
  assert.equal(outcomeOfMarket("TOT:over:2.25", { home: 1, away: 1 }), "half_loss");
  assert.equal(outcomeOfMarket("TOT:under:2.25", { home: 1, away: 1 }), "half_win");
});

test("AH: garis kandang, sisi tandang dicerminkan", () => {
  /* AH home -0.5, menang 2-1 → margin 1-0.5 = +0.5 → WIN */
  assert.equal(outcomeOfMarket("AH:home:-0.5", { home: 2, away: 1 }), "win");
  assert.equal(outcomeOfMarket("AH:away:0.5", { home: 2, away: 1 }), "loss");

  /* AH home -0.5, seri 1-1 → margin -0.5 → LOSS */
  assert.equal(outcomeOfMarket("AH:home:-0.5", { home: 1, away: 1 }), "loss");
  assert.equal(outcomeOfMarket("AH:away:0.5", { home: 1, away: 1 }), "win");

  /* AH home -0.25, seri → setengah kalah */
  assert.equal(outcomeOfMarket("AH:home:-0.25", { home: 1, away: 1 }), "half_loss");
  assert.equal(outcomeOfMarket("AH:away:0.25", { home: 1, away: 1 }), "half_win");

  /* AH home -1, menang 2-1 → margin 0 → PUSH */
  assert.equal(outcomeOfMarket("AH:home:-1", { home: 2, away: 1 }), "push");
  assert.equal(outcomeOfMarket("AH:away:1", { home: 2, away: 1 }), "push");
});

test("market_key tak dikenal → null, bukan tebakan", () => {
  assert.equal(outcomeOfMarket("???", { home: 1, away: 0 }), null);
  assert.equal(outcomeOfMarket("ML:sideways", { home: 1, away: 0 }), null);
});

test("skor tidak valid → null", () => {
  assert.equal(outcomeOfMarket("ML:home", { home: NaN, away: 0 }), null);
  assert.equal(outcomeOfMarket("ML:home", { home: 1, away: Infinity }), null);
});

test("outcomeMapForFixture hanya memuat yang bisa dinilai", () => {
  const map = outcomeMapForFixture(
    ["ML:home", "BTTS:yes", "garbage"],
    { home: 1, away: 1 },
  );
  assert.equal(map.size, 2);
  assert.equal(map.get("ML:home"), "loss");
  assert.equal(map.get("BTTS:yes"), "win");
  assert.equal(map.has("garbage"), false);
});
