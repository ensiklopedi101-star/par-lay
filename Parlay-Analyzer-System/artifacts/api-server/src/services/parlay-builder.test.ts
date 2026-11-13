import assert from "node:assert/strict";
import test from "node:test";
import { calculateParlayMetrics, parlayStatusFromLegResults, type ParlayCandidate } from "./parlay-builder";

const candidate = (i: number): ParlayCandidate => ({
  fixtureId: 100 + i,
  homeTeam: `Home ${i}`,
  awayTeam: `Away ${i}`,
  league: "england-premier-league",
  date: "2026-11-21",
  market: "Match Winner",
  selection: "Home Win",
  odds: 1.9,
  confidence: 8,
  probability: 0.6,
  evPercent: 14,
});

test("P5: calculateParlayMetrics memakai pDecision terkoreksi korelasi + stake tiket", () => {
  const m = calculateParlayMetrics([candidate(1), candidate(2), candidate(3)]);
  assert.ok(m.pIndependent > 0);
  assert.ok(m.winProbability <= m.pIndependent + 1e-9);
  assert.ok(m.evPessimistic < m.expectedValue);
  assert.ok(m.ticketStake != null);
  assert.ok(m.ticketStake!.stakePct >= 0 && m.ticketStake!.stakePct <= 2);
});

test("P5: kandidat kosong tidak menghasilkan tiket karangan", () => {
  const m = calculateParlayMetrics([]);
  assert.equal(m.winProbability, 0);
  assert.equal(m.ticketStake, null);
});

test("every leg winning makes the parlay won", () => {
  assert.equal(parlayStatusFromLegResults(["WIN", "WIN", "WIN"]), "won");
});

test("half wins and pushes are counted as winning legs, not stuck states", () => {
  /* Regression: `every(r => r === "WIN")` left these parlays on "settled". */
  assert.equal(parlayStatusFromLegResults(["WIN", "HALF_WIN"]), "won");
  assert.equal(parlayStatusFromLegResults(["WIN", "HALF_WIN", "PUSH"]), "won");
});

test("a single losing leg loses the parlay regardless of other legs", () => {
  assert.equal(parlayStatusFromLegResults(["WIN", "LOSS"]), "lost");
  assert.equal(parlayStatusFromLegResults(["WIN", "HALF_LOSS"]), "lost");
  assert.equal(parlayStatusFromLegResults(["HALF_WIN", "HALF_LOSS"]), "lost");
});

test("a loss is final even while another leg is still pending", () => {
  assert.equal(parlayStatusFromLegResults(["LOSS", ""]), "lost");
});

test("unsettled legs leave the parlay pending", () => {
  assert.equal(parlayStatusFromLegResults(["WIN", ""]), null);
  assert.equal(parlayStatusFromLegResults(["", ""]), null);
  assert.equal(parlayStatusFromLegResults([]), null);
});

test("an all-push parlay is settled rather than won", () => {
  assert.equal(parlayStatusFromLegResults(["PUSH", "PUSH"]), "settled");
});

test("lowercase leg results from the database are normalised", () => {
  assert.equal(parlayStatusFromLegResults(["win", "half_win"]), "won");
  assert.equal(parlayStatusFromLegResults(["win", "loss"]), "lost");
});
