import assert from "node:assert/strict";
import test from "node:test";
import { resolveMarketOdds, type MarketOddsSnapshot } from "./market-odds-readiness";

const now = Date.parse("2026-10-17T12:00:00.000Z");

function row(
  market_type: string,
  odds_1: number | null,
  odds_2: number | null,
  odds_draw: number | null,
  captured_at = "2026-10-17T11:30:00.000Z",
): MarketOddsSnapshot {
  return { bookmaker: "Bet365", market_type, odds_1, odds_2, odds_draw, captured_at };
}

test("totals selection resolves only an exact provider line", () => {
  const rows = [
    row("Alternate Totals 2.5", 1.91, 1.95, 2.5),
    row("Alternate Totals 3.5", 1.72, 2.10, 3.5),
  ];

  const result = resolveMarketOdds("Under 2.5 Goals", rows, { now });
  assert.equal(result.status, "verified");
  assert.equal(result.odds, 1.95);
  assert.equal(result.matchedLine, 2.5);
});

test("a different totals line is not used as a fallback", () => {
  const result = resolveMarketOdds(
    "Over 2.5 Goals",
    [row("Alternate Totals 3.5", 1.72, 2.1, 3.5)],
    { now },
  );
  assert.equal(result.status, "line_mismatch");
  assert.equal(result.odds, null);
});

test("a line-based market without provider line data is rejected", () => {
  const result = resolveMarketOdds(
    "Over 2.5 Goals",
    [row("Totals", 1.9, 1.9, null)],
    { now },
  );
  assert.equal(result.status, "missing_line");
});

test("Asian Handicap resolves the correct side and exact signed line", () => {
  const result = resolveMarketOdds(
    "Asian Handicap Away +0.5",
    [row("Asian Handicap -0.5", 2.0, 1.9, -0.5)],
    { now },
  );
  assert.equal(result.status, "line_mismatch");

  const matched = resolveMarketOdds(
    "Asian Handicap Away -0.5",
    [row("Asian Handicap -0.5", 2.0, 1.9, -0.5)],
    { now },
  );
  assert.equal(matched.status, "verified");
  assert.equal(matched.odds, 1.9);
});

test("stale exact odds are visible as unverified, not as usable prices", () => {
  const result = resolveMarketOdds(
    "Home Win",
    [row("1X2", 2.1, 3.2, 3.4, "2026-10-17T08:00:00.000Z")],
    { now },
  );
  assert.equal(result.status, "stale");
  assert.equal(result.odds, 2.1);
});

test("HT selection does not consume full-time 1X2 odds", () => {
  const result = resolveMarketOdds(
    "HT Home",
    [
      row("1X2", 2.1, 3.2, 3.4),
      row("HT", 2.4, 4.5, 2.0),
    ],
    { now },
  );
  assert.equal(result.status, "verified");
  assert.equal(result.odds, 2.4);
});

test("unrecognized selection fails closed", () => {
  const result = resolveMarketOdds(
    "Value pick",
    [row("1X2", 2.1, 3.2, 3.4)],
    { now },
  );
  assert.equal(result.status, "unsupported");
  assert.equal(result.odds, null);
});
