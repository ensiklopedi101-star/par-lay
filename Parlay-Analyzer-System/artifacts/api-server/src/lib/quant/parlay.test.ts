import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeParlay, ticketStakePlan, type ParlayLeg } from "./parlay.js";

const leg = (p: number, odds: number, extra: Partial<ParlayLeg> = {}): ParlayLeg => ({
  p, odds, league: "EPL", marketFamily: "ML", date: "2026-11-21", ...extra,
});

test("ticketStakePlan: 1/4 Kelly dari p tiket, cap keras 2%", () => {
  const result = analyzeParlay([leg(0.6, 1.9), leg(0.6, 1.9), leg(0.6, 1.9)], { sims: 4000 });
  const plan = ticketStakePlan(result, [0.03, 0.03, 0.03]);
  assert.ok(plan.stakePct > 0 && plan.stakePct <= 2, `stake ${plan.stakePct}`);
  assert.equal(plan.noStake, false);
});

test("ticketStakePlan: EV pesimis <= 0 memaksa stake 0 berapa pun EV point-estimate", () => {
  const plan = ticketStakePlan(
    { pDecision: 0.2, combinedOdds: 6, evPessimistic: -0.05 },
    [0.05, 0.05, 0.05, 0.05],
  );
  assert.equal(plan.stakePct, 0);
  assert.equal(plan.noStake, true);
});

test("analyzeParlay: pDecision tidak pernah lebih besar dari independen (korelasi tidak memperindah)", () => {
  const result = analyzeParlay(
    [leg(0.55, 2.0), leg(0.55, 2.0, { marketFamily: "Totals" }), leg(0.55, 2.0, { marketFamily: "BTTS" })],
    { sims: 4000 },
  );
  assert.ok(result.pDecision <= result.pIndependent + 1e-9);
  assert.ok(result.evPessimistic < result.evDecision);
});
