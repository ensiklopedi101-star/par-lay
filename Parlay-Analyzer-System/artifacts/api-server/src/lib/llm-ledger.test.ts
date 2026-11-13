import { test } from "node:test";
import assert from "node:assert/strict";
import { buildLlmSelectionRows, marketKeyForLabel } from "./llm-ledger.js";
import { marketProbabilities } from "./match-context.js";
import { scoreMatrix } from "./quant/poisson.js";
import { parseMarketKey } from "./closing-odds.js";

const matrix = scoreMatrix(1.6, 1.1);
const markets = marketProbabilities(matrix);

const odds = {
  matchWinner: [{ bookmaker: "TestBook", home: 2.1, draw: 3.3, away: 3.4 }],
  overUnder: [
    { bookmaker: "TestBook", line: 2.5, over: 1.95, under: 1.85 },
    { bookmaker: "TestBook", line: 3.5, over: 3.1, under: 1.35 },
  ],
  asianHandicap: [{ bookmaker: "TestBook", line: -0.5, home: 2.05, away: 1.8 }],
  btts: [{ bookmaker: "TestBook", yes: 1.8, no: 2.0 }],
};

test("marketKeyForLabel memetakan label kanonik ke market_key engine", () => {
  assert.equal(marketKeyForLabel("Home Win"), "ML:home");
  assert.equal(marketKeyForLabel("Over 2.5"), "TOT:over:2.5");
  assert.equal(marketKeyForLabel("Asian Handicap Away 0.5"), "AH:away:0.5");
  assert.equal(marketKeyForLabel("BTTS No"), "BTTS:no");
  assert.equal(marketKeyForLabel("HT Home Win"), null);
  assert.equal(marketKeyForLabel(null), null);
});

test("buildLlmSelectionRows menulis semua market dengan kunci yang dikenal selection-outcome", () => {
  const { rows, skipped } = buildLlmSelectionRows({
    fixtureId: 42,
    analysedAt: "2026-11-13T00:00:00.000Z",
    matrix,
    markets,
    odds,
    betLabel: "Over 2.5",
  });
  assert.equal(skipped.length, 0);
  // 3 ML + 2 BTTS + 4 Totals + 2 AH
  assert.equal(rows.length, 11);
  for (const r of rows) {
    assert.equal(r.model_version, 1);
    assert.ok(parseMarketKey(r.market_key), `kunci tidak dikenal: ${r.market_key}`);
    assert.ok(r.p_final > 0 && r.p_final < 1, `p_final tidak sah: ${r.market_key}`);
    assert.ok(r.odds > 1);
  }
  const bet = rows.filter((r) => r.was_bet);
  assert.equal(bet.length, 1);
  assert.equal(bet[0]!.market_key, "TOT:over:2.5");
});

test("p_final adalah blend 0.35 model / 0.65 pasar, bukan tebakan LLM", () => {
  const { rows } = buildLlmSelectionRows({
    fixtureId: "7", analysedAt: "2026-11-13T00:00:00.000Z", matrix, markets, odds,
  });
  const home = rows.find((r) => r.market_key === "ML:home")!;
  const expected = 0.35 * home.p_model_only! + 0.65 * home.p_market_fair!;
  assert.ok(Math.abs(home.p_final - expected) < 1e-6);
  assert.ok(Math.abs(home.ev! - (home.p_final * home.odds - 1)) < 1e-6);
});

test("pasar tidak lengkap tidak ditulis setengah-setengah", () => {
  const { rows } = buildLlmSelectionRows({
    fixtureId: "7",
    analysedAt: "2026-11-13T00:00:00.000Z",
    matrix,
    markets,
    odds: {
      matchWinner: [{ bookmaker: "X", home: 2.0, draw: 3.2 }], // away hilang
      overUnder: [{ bookmaker: "X", line: 2.5, over: 1.9 }], // under hilang
      asianHandicap: [],
      btts: [{ bookmaker: "X", yes: 1.8, no: 2.0 }],
    },
  });
  assert.deepEqual(rows.map((r) => r.family), ["BTTS", "BTTS"]);
});

test("tidak mencampur bookmaker: pasar lain mengikuti bandar baris 1X2", () => {
  const { rows } = buildLlmSelectionRows({
    fixtureId: "7",
    analysedAt: "2026-11-13T00:00:00.000Z",
    matrix,
    markets,
    odds: {
      ...odds,
      overUnder: [
        { bookmaker: "BandarLain", line: 2.5, over: 5.0, under: 1.2 },
        { bookmaker: "TestBook", line: 2.5, over: 1.95, under: 1.85 },
      ],
    },
  });
  const totals = rows.filter((r) => r.family === "Totals");
  assert.ok(totals.length > 0);
  assert.ok(totals.every((r) => r.bookmaker === "TestBook"));
  assert.equal(totals.find((r) => r.market_key === "TOT:over:2.5")!.odds, 1.95);
});

test("baris AH memakai konvensi garis kandang seperti engine quant", () => {
  const { rows } = buildLlmSelectionRows({
    fixtureId: "7", analysedAt: "2026-11-13T00:00:00.000Z", matrix, markets, odds,
  });
  const ah = rows.filter((r) => r.family === "AH");
  assert.deepEqual(ah.map((r) => r.market_key).sort(), ["AH:away:0.5", "AH:home:-0.5"]);
});
