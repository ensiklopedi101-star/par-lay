import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateResult,
  extractLine,
  isQuarterLine,
  parlayLegMarketText,
  settleAgainstLine,
} from "./bet-settlement";

/* ─── Asian Handicap quarter lines (BUG-01) ─── */

test("AH -0.25 on a draw is HALF_LOSS, not a full LOSS", () => {
  assert.equal(calculateResult(1, 1, "Asian Handicap Home -0.25", null), "HALF_LOSS");
});

test("AH -0.25 when the selected team wins is a full WIN", () => {
  assert.equal(calculateResult(2, 1, "Asian Handicap Home -0.25", null), "WIN");
});

test("AH -0.75 splits a one-goal win and loses outright when the team loses", () => {
  /* Betting -0.75 on the home team: half the stake is -0.5, half is -1.0. */
  assert.equal(calculateResult(2, 1, "Asian Handicap Home -0.75", null), "HALF_WIN");
  assert.equal(calculateResult(3, 1, "Asian Handicap Home -0.75", null), "WIN");
  assert.equal(calculateResult(1, 2, "Asian Handicap Home -0.75", null), "LOSS");
  assert.equal(calculateResult(1, 1, "Asian Handicap Home -0.75", null), "LOSS");
});

test("AH +0.75 losing by one goal is HALF_LOSS and a draw is a full WIN", () => {
  assert.equal(calculateResult(1, 2, "Asian Handicap Home +0.75", null), "HALF_LOSS");
  assert.equal(calculateResult(1, 1, "Asian Handicap Home +0.75", null), "WIN");
});

test("AH +0.25 on a draw is HALF_WIN", () => {
  assert.equal(calculateResult(0, 0, "Asian Handicap Away +0.25", null), "HALF_WIN");
});

test("whole-line and half-line handicaps still push or settle fully", () => {
  assert.equal(calculateResult(1, 1, "Asian Handicap Home 0", null), "PUSH");
  assert.equal(calculateResult(1, 1, "Asian Handicap Home -0.5", null), "LOSS");
  assert.equal(calculateResult(2, 1, "Asian Handicap Away +0.5", null), "LOSS");
  assert.equal(calculateResult(1, 1, "AH Home -0.25", null), "HALF_LOSS");
});

test("away selections mirror the home handicap", () => {
  assert.equal(calculateResult(1, 2, "Asian Handicap Away +0.25", null), "WIN");
  assert.equal(calculateResult(1, 2, "Asian Handicap Away -0.25", null), "WIN");
  assert.equal(calculateResult(1, 1, "Asian Handicap Away -0.25", null), "HALF_LOSS");
});

/* ─── Over / Under quarter lines (BUG-01) ─── */

test("Over 2.25 on exactly two goals is HALF_LOSS", () => {
  assert.equal(calculateResult(1, 1, "Over 2.25 Goals", null), "HALF_LOSS");
});

test("Over 2.25 on three goals is a full WIN", () => {
  assert.equal(calculateResult(2, 1, "Over 2.25 Goals", null), "WIN");
});

test("Under 2.75 on three goals is HALF_LOSS and on two goals a full WIN", () => {
  assert.equal(calculateResult(2, 1, "Under 2.75 Goals", null), "HALF_LOSS");
  assert.equal(calculateResult(1, 1, "Under 2.75 Goals", null), "WIN");
});

test("Under 2.25 on exactly two goals is HALF_WIN", () => {
  assert.equal(calculateResult(1, 1, "Under 2.25 Goals", null), "HALF_WIN");
});

test("whole and half totals keep WIN / PUSH / LOSS", () => {
  assert.equal(calculateResult(2, 1, "Over 2.5", null), "WIN");
  assert.equal(calculateResult(1, 1, "Over 2", null), "PUSH");
  assert.equal(calculateResult(1, 0, "Under 1.5", null), "WIN");
  assert.equal(calculateResult(2, 1, "Over 3.5 Goals", null), "LOSS");
});

/* ─── BTTS Yes / No (BUG-02) ─── */

test("BTTS No wins when one side fails to score", () => {
  assert.equal(calculateResult(2, 0, "BTTS No", null), "WIN");
  assert.equal(calculateResult(0, 0, "BTTS No", null), "WIN");
  assert.equal(calculateResult(1, 1, "BTTS No", null), "LOSS");
});

test("BTTS No is recognised across separators and long form", () => {
  for (const market of [
    "BTTS No",
    "btts_no",
    "BTTS-NO",
    "BTTS: No",
    "Both Teams to Score - No",
    "both_teams_to_score_no",
    "BTTS (No)",
  ]) {
    assert.equal(calculateResult(1, 1, market, null), "LOSS", `${market} should lose on 1-1`);
    assert.equal(calculateResult(3, 0, market, null), "WIN", `${market} should win on 3-0`);
  }
});

test("BTTS Yes still wins only when both teams score", () => {
  assert.equal(calculateResult(1, 1, "BTTS Yes", null), "WIN");
  assert.equal(calculateResult(1, 0, "BTTS Yes", null), "LOSS");
  assert.equal(calculateResult(1, 0, "Both Teams to Score Yes", null), "LOSS");
});

test("bare BTTS market falls back to the prediction prose side", () => {
  assert.equal(calculateResult(2, 0, "BTTS", "rekomendasi: BTTS No"), "WIN");
  assert.equal(calculateResult(2, 0, "BTTS", "rekomendasi: BTTS Yes"), "LOSS");
});

/* ─── 1X2 / DNB regression guards ─── */

test("1X2 and DNB outcomes are unchanged", () => {
  assert.equal(calculateResult(2, 1, "Home Win", null), "WIN");
  assert.equal(calculateResult(2, 1, "1X2 Away", null), "LOSS");
  assert.equal(calculateResult(1, 1, "Draw", null), "WIN");
  assert.equal(calculateResult(1, 1, "Draw No Bet Home", null), "PUSH");
  assert.equal(calculateResult(2, 1, "DNB Away", null), "LOSS");
});

test("half-time markets evaluate the half-time score", () => {
  assert.equal(calculateResult(2, 1, "HT Home", null, 1, 0), "WIN");
  assert.equal(calculateResult(2, 1, "HT Draw", null, 1, 0), "LOSS");
  assert.equal(calculateResult(2, 1, "HT Home", null, null, null), null);
});

test("markets that cannot be interpreted stay unresolved instead of guessing", () => {
  /* Guards the fail-closed contract: null keeps the row retryable. */
  assert.equal(calculateResult(1, 0, "some exotic prop", null), null);
  assert.equal(calculateResult(1, 0, null, null), null);
});

/* ─── Helpers ─── */

test("isQuarterLine recognises .25 and .75 only", () => {
  assert.equal(isQuarterLine(0.25), true);
  assert.equal(isQuarterLine(-0.75), true);
  assert.equal(isQuarterLine(2.25), true);
  assert.equal(isQuarterLine(0), false);
  assert.equal(isQuarterLine(0.5), false);
  assert.equal(isQuarterLine(1.5), false);
});

test("settleAgainstLine handles floating point noise", () => {
  assert.equal(settleAgainstLine(0.1 + 0.2 - 0.3, 2.5), "PUSH");
  assert.equal(settleAgainstLine(0.30000000000000004, 2.25), "HALF_WIN");
});

test("extractLine reads every stored label shape", () => {
  assert.equal(extractLine("Over 2.25 Goals"), 2.25);
  assert.equal(extractLine("over_2_5"), 2.5);
  assert.equal(extractLine("Asian Handicap Home -0.25"), -0.25);
  assert.equal(extractLine("AH Away +0.75"), 0.75);
  assert.equal(extractLine("Totals 3.5"), 3.5);
  assert.equal(extractLine("BTTS Yes"), null);
});

test("parlayLegMarketText maps manual leg selections onto settlement tokens", () => {
  const teams = { homeTeam: "Arsenal", awayTeam: "Chelsea" };
  assert.equal(
    parlayLegMarketText({ market: "ML 2.5", selection: "Arsenal" }, teams),
    "ML 2.5 Home",
  );
  assert.equal(
    parlayLegMarketText({ market: "AH -0.5", selection: "Chelsea" }, teams),
    "AH -0.5 Away",
  );
  assert.equal(
    parlayLegMarketText({ market: "Totals 2.5", selection: "Over 2.5" }, teams),
    "Totals 2.5 Over 2.5",
  );
  /* AI legs store the full market label in both columns — left untouched. */
  assert.equal(
    parlayLegMarketText({ market: "Over 2.5 Goals", selection: "Over 2.5 Goals" }, teams),
    "Over 2.5 Goals",
  );
  assert.equal(parlayLegMarketText({ market: null, selection: null }, teams), null);
});

test("a manual Over leg settles with the combined leg label", () => {
  const label = parlayLegMarketText({ market: "Totals 2.5", selection: "Over 2.5" });
  assert.equal(calculateResult(2, 1, label, null), "WIN");
  assert.equal(calculateResult(1, 0, label, null), "LOSS");
});
