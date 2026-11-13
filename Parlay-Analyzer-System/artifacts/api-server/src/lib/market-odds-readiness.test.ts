import assert from "node:assert/strict";
import test from "node:test";
import {
  ledgerMarketKey,
  normalizeStructuredMarketSelection,
  resolveMarketOdds,
  type MarketOddsSnapshot,
} from "./market-odds-readiness";

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

test("structured provider market fields normalize into a resolvable selection", () => {
  const selection = normalizeStructuredMarketSelection({
    marketType: "Totals",
    outcome: "under",
    line: 2.5,
  });
  assert.equal(selection, "Under 2.5 Goals");

  const result = resolveMarketOdds(
    selection ?? "",
    [row("Alternate Totals 2.5", 1.91, 1.95, 2.5)],
    { now },
  );
  assert.equal(result.status, "verified");
  assert.equal(result.odds, 1.95);
});

test("structured selections normalize team outcomes and preserve signed handicap lines", () => {
  assert.equal(
    normalizeStructuredMarketSelection(
      { marketType: "ML", outcome: "home" },
      { homeTeam: "Harbor City" },
    ),
    "Home Win",
  );
  assert.equal(
    normalizeStructuredMarketSelection({ marketType: "AH", outcome: "away", line: -0.5 }),
    "Asian Handicap Away -0.5",
  );
  assert.equal(
    normalizeStructuredMarketSelection({ marketType: "HT", outcome: "draw" }),
    "HT Draw",
  );
});

test("structured market normalization does not guess unsupported double-chance bets", () => {
  assert.equal(
    normalizeStructuredMarketSelection({ marketType: "ML", outcome: "1X" }),
    null,
  );
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

/* ─── ledgerMarketKey — kunci baris prediction_selections (P3) ─── */

test("ledgerMarketKey: ML tanpa garis termasuk hasil seri", () => {
  assert.deepEqual(ledgerMarketKey("Home Win"), { key: "ML:home", family: "ML", line: null });
  assert.deepEqual(ledgerMarketKey("Draw"), { key: "ML:draw", family: "ML", line: null });
  assert.deepEqual(ledgerMarketKey("Away Win"), { key: "ML:away", family: "ML", line: null });
});

test("ledgerMarketKey: label tanpa nomor yang dikenal mengembalikan null", () => {
  assert.equal(ledgerMarketKey("No Bet"), null);
  assert.equal(ledgerMarketKey("Over Goals"), null, "totals tanpa line tidak boleh dipetakan");
  assert.equal(ledgerMarketKey("Value pick"), null);
});

test("ledgerMarketKey: HT ditolak — settlement tidak mengenal kunci HT", () => {
  assert.equal(ledgerMarketKey("HT Home"), null);
  assert.equal(ledgerMarketKey("First Half Home"), null);
  assert.equal(ledgerMarketKey("1X2 HT Away"), null);
});

test("ledgerMarketKey: Totals memakai garis provider (matchedLine diutamakan)", () => {
  assert.deepEqual(ledgerMarketKey("Over 2.5 Goals"), {
    key: "TOT:over:2.5",
    family: "Totals",
    line: 2.5,
  });
  assert.deepEqual(
    ledgerMarketKey("Under 3.5 Goals", {}, { line: 3.5, matchedLine: 3.5 }),
    { key: "TOT:under:3.5", family: "Totals", line: 3.5 },
  );
  /* matchedLine (garis snapshot provider) menang atas garis label bila keduanya
   * berbeda — kunci baris harus selaras dengan harga yang benar-benar diambil. */
  assert.deepEqual(
    ledgerMarketKey("Over 2.5 Goals", {}, { line: 2.5, matchedLine: 2.75 }),
    { key: "TOT:over:2.75", family: "Totals", line: 2.75 },
  );
});

test("ledgerMarketKey: AH away menegasi garis provider (konvensi garis kandang)", () => {
  /* Provider hdp -0.25 = garis kandang. Kunci engine: AH:away:-(-0.25) = +0.25. */
  assert.deepEqual(
    ledgerMarketKey("Asian Handicap Away -0.25", {}, { line: -0.25, matchedLine: -0.25 }),
    { key: "AH:away:0.25", family: "AH", line: 0.25 },
  );
  assert.deepEqual(
    ledgerMarketKey("Asian Handicap Home -0.25", {}, { line: -0.25, matchedLine: -0.25 }),
    { key: "AH:home:-0.25", family: "AH", line: -0.25 },
  );
});

test("ledgerMarketKey: AH tanpa garis tidak boleh dipetakan", () => {
  assert.equal(ledgerMarketKey("Asian Handicap Home"), null);
});

test("ledgerMarketKey: BTTS tanpa garis", () => {
  assert.deepEqual(ledgerMarketKey("BTTS Yes"), { key: "BTTS:yes", family: "BTTS", line: null });
  assert.deepEqual(ledgerMarketKey("BTTS No"), { key: "BTTS:no", family: "BTTS", line: null });
});
