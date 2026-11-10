import {
  devig, scoreMatrix, matchResultProbs, totalsOutcome, handicapOutcome, fitMarketLambdas,
  analyzeMatch, analyzeParlay, normInv, summarizeLedger, bttsProb, evOfOutcome, winShare,
  fitBlendWeight, sanitizeLlmAdjustment, classifyResult, mulberry32,
} from "../src/lib/quant";

let fails = 0;
const ok = (name: string, cond: boolean, info = "") => { if (!cond) fails++; console.log(`${cond ? "PASS" : "FAIL"}  ${name} ${info}`); };
const near = (a: number, b: number, t = 1e-3) => Math.abs(a - b) < t;

// de-vig
const odds = [1.85, 3.6, 4.4];
for (const m of ["proportional", "power", "shin"] as const) {
  const r = devig(odds, m);
  ok(`devig ${m} sums to 1`, near(r.probs.reduce((a, b) => a + b, 0), 1, 1e-9), r.probs.map((p) => p.toFixed(4)).join("/") + ` overround=${r.overround.toFixed(4)} used=${r.usedMethod}`);
}
ok("shin gives longshot lower prob than proportional", devig(odds, "shin").probs[2]! < devig(odds, "proportional").probs[2]!);

// matrix
const M = scoreMatrix(1.6, 1.1);
const r = matchResultProbs(M);
ok("1X2 sums to 1", near(r.home + r.draw + r.away, 1, 1e-9), JSON.stringify(r));
for (const line of [2.25, 2.5, 2.75, 3, 1.75]) {
  const o = totalsOutcome(M, line, "over"); const u = totalsOutcome(M, line, "under");
  const s = o.win + o.halfWin + o.push + o.halfLoss + o.loss;
  ok(`totals ${line} outcome sums to 1`, near(s, 1, 1e-9));
  ok(`totals ${line} over.win == under.loss (+halves mirror)`, near(o.win, u.loss, 1e-9) && near(o.halfWin, u.halfLoss, 1e-9));
}
const ah = handicapOutcome(M, -0.25, "home");
ok("AH -0.25 has halfLoss on draw", ah.halfLoss > 0 && near(ah.halfLoss, M.m.reduce((s, row, h) => s + row[h]!, 0), 1e-9));
// fair EV symmetric: both sides at fair prob odds should be ~0
const o25 = totalsOutcome(M, 2.5, "over");
ok("EV at fair odds is 0", near(evOfOutcome(o25, 1 / winShare(o25)), 0, 1e-9));

// round-trip
const trueL = { h: 1.75, a: 0.95 };
const MT = scoreMatrix(trueL.h, trueL.a);
const rt = matchResultProbs(MT);
const over = winShare(totalsOutcome(MT, 2.5, "over"));
const fit = fitMarketLambdas({ ...rt, ouLine: 2.5, overFair: over });
ok("fit recovers lambda", near(fit.lambdaHome, trueL.h, 0.03) && near(fit.lambdaAway, trueL.a, 0.03), `fit=${fit.lambdaHome.toFixed(3)}/${fit.lambdaAway.toFixed(3)} err=${fit.error.toExponential(2)}`);

// pipeline: with a 5% margin and w=0, nothing should pass
const mk = (p: number, margin = 0.05) => (1 / p) / (1 + margin);
const input = {
  odds1x2: { home: mk(rt.home), draw: mk(rt.draw), away: mk(rt.away) },
  totals: [{ line: 2.5, overOdds: mk(over), underOdds: mk(1 - over) }],
  btts: { yes: mk(bttsProb(MT).yes), no: mk(bttsProb(MT).no) },
  league: { homeGoals: 1.5, awayGoals: 1.2 },
  home: { matches: 20, goalsFor: 2.0, goalsAgainst: 0.9, xgFor: 1.9, xgAgainst: 1.0 },
  away: { matches: 20, goalsFor: 1.0, goalsAgainst: 1.6 },
};
const a0 = analyzeMatch({ ...input, modelWeight: 0 });
ok("pure market, 5% margin → NO_BET", a0.decision === "NO_BET", `best=${a0.best?.label}`);
ok("w=0 final lambdas == market lambdas", near(a0.finalLambdas.lambdaHome, a0.marketLambdas.lambdaHome, 1e-9));
const a1 = analyzeMatch(input);
console.log("auto weight", a1.modelWeight.toFixed(3), "decision", a1.decision, a1.best?.label ?? "-", "model λ", a1.modelLambdas.lambdaHome.toFixed(2), a1.modelLambdas.lambdaAway.toFixed(2), "market λ", a1.marketLambdas.lambdaHome.toFixed(2), a1.marketLambdas.lambdaAway.toFixed(2));
const a2 = analyzeMatch({ ...input, modelWeight: 1, minEv: 0.03 });
console.log("w=1 decision", a2.decision, a2.best?.label ?? "-", a2.best ? (a2.best.ev * 100).toFixed(1) + "% stake " + a2.best.stakePct.toFixed(2) : "");

// parlay
ok("normInv(0.975)", near(normInv(0.975), 1.95996, 1e-3));
const legs = [0.6, 0.55, 0.58, 0.62].map((p) => ({ p, odds: 1 / p * 1.03, league: "EPL", marketFamily: "Totals", date: "2026-01-01" }));
const pr = analyzeParlay(legs);
ok("correlated >= independent roughly", pr.pCorrelated >= pr.pIndependent - 3 * pr.simStdErr, `ind=${pr.pIndependent.toFixed(4)} corr=${pr.pCorrelated.toFixed(4)}`);
console.log("breakEvenBias", pr.breakEvenBias.toFixed(4), "ev ind", pr.evIndependent.toFixed(3), "ev pess", pr.evPessimistic.toFixed(3));

// ledger: unskilled noisy model
const rnd = mulberry32(5);
const bets = [];
for (let i = 0; i < 400; i++) {
  const pt = 0.35 + rnd() * 0.35; const pm = pt; const pModel = Math.min(0.9, Math.max(0.1, pt + (rnd() - 0.5) * 0.14));
  const odds = (1 / pm) / 1.05; if (pModel * odds - 1 < 0.03) continue;
  const close = (1 / (pt + (rnd() - 0.5) * 0.02)) / 1.05;
  bets.push({ pModel, pMarketFair: pm, pFinal: pModel, oddsTaken: odds, oddsClose: close, closeFairProb: null, outcome: rnd() < pt ? "win" as const : "loss" as const, stakeUnits: 1 });
}
const s = summarizeLedger(bets);
console.log("ledger n", s.nSettled, "roi", s.roi?.toFixed(3), "claimed", s.avgClaimedEv?.toFixed(3), "clv", s.clv?.mean.toFixed(3), "skill", s.scores?.skillVsMarket?.toFixed(4), "verdict", s.verdict.level);
ok("unskilled noisy model is NOT 'supported'", s.verdict.level !== "supported");
ok("claimed EV > realised ROI (winner's curse)", (s.avgClaimedEv ?? 0) > (s.roi ?? 0));

const fb = fitBlendWeight(bets.map((b) => ({ pModel: b.pFinal, pMarket: b.pMarketFair, outcome: b.outcome === "win" ? 1 : 0 } as const)));
ok("fitted blend weight for unskilled model is small", fb != null && fb.weight <= 0.35, `w*=${fb?.weight}`);

// llm contract
ok("llm adjustment without evidence is neutral", sanitizeLlmAdjustment({ lambda_home_mult: 1.5 }).lambdaHomeMult === 1);
ok("llm adjustment clamped", sanitizeLlmAdjustment({ lambda_home_mult: 1.5, evidence: [{ type: "injury", detail: "Striker utama cedera hamstring", source_url: "x" }] }).lambdaHomeMult === 1.12);
ok("variance loss not a lesson", classifyResult({ outcome: "loss", clv: 0.02 }) === "variance");

console.log(fails ? `\n${fails} FAILED` : "\nALL PASSED");
process.exit(fails ? 1 : 0);
