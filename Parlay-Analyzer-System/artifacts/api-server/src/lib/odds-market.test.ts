import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyOddsMarket, normalizeMarketToken, providerMarketNames } from "./odds-market";

test("normalisasi token pasar", () => {
  assert.equal(normalizeMarketToken("Both Teams To Score"), "both_teams_to_score");
  assert.equal(normalizeMarketToken("Totals 2.5"), "totals_2.5");
});

test("kelas pasar yang dikenali", () => {
  assert.equal(classifyOddsMarket("ML"), "ML");
  assert.equal(classifyOddsMarket("Spread -0.5"), "AH");
  assert.equal(classifyOddsMarket("Totals 2.5"), "Totals");
  assert.equal(classifyOddsMarket("Both Teams To Score"), "BTTS");
  assert.equal(classifyOddsMarket("Correct Score"), null);
});

test("filter markets hanya memakai nama yang benar-benar ada di penyedia", () => {
  assert.deepEqual(providerMarketNames(["ML", "Totals"]), ["ML", "Totals"]);
  assert.deepEqual(
    providerMarketNames(["ML", "Totals", "AH", "HT", "BTTS"]),
    ["ML", "Totals", "Spread", "Both Teams To Score"],
  );
  assert.deepEqual(providerMarketNames([]), []);
});
