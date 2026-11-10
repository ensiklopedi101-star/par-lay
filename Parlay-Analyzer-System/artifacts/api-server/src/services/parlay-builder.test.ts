import assert from "node:assert/strict";
import test from "node:test";
import { parlayStatusFromLegResults } from "./parlay-builder";

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
