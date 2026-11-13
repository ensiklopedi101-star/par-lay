import { test } from "node:test";
import assert from "node:assert/strict";
import { buildLegacyBacktest, replayLegacySample, type LegacySample } from "./legacy-backtest.js";

const sample = (overrides: Partial<LegacySample>): LegacySample => ({
  predictionId: "x",
  marketBet: "1X2 Home",
  outcome: "WIN",
  odds: 2,
  evPercent: 10,
  ...overrides,
});

test("baris warisan ber-odds 0 adalah insufficient_data, bukan penolakan model", () => {
  const row = replayLegacySample(sample({ odds: 0, evPercent: 0 }));
  assert.equal(row.verdict, "insufficient_data");
  assert.match(row.reasons.join(" "), /odds tidak tercatat/);
});

test("probabilitas direkonstruksi dari EV dan odds", () => {
  const row = replayLegacySample(sample({ odds: 2, evPercent: 10 }));
  assert.ok(Math.abs(row.reconstructedProbability! - 0.55) < 1e-9);
});

test("EV positif tipis lolos gerbang produksi tetapi tidak lolos skenario enforced", () => {
  const row = replayLegacySample(sample({ odds: 1.533, evPercent: 4.8 }));
  assert.equal(row.verdict, "kept_current");
  assert.ok(row.conservativeEv! <= 0);
});

test("EV besar dan konservatif positif menjadi kept_if_enforced", () => {
  const row = replayLegacySample(sample({ odds: 2.9, evPercent: 45.2, outcome: "LOSS" }));
  assert.equal(row.verdict, "kept_if_enforced");
});

test("EV tidak positif ditolak gerbang", () => {
  const row = replayLegacySample(sample({ evPercent: -2 }));
  assert.equal(row.verdict, "rejected_gate");
});

test("ringkasan menghitung hit rate dan ROI hanya dari odds sah", () => {
  const report = buildLegacyBacktest([
    sample({ predictionId: "a", odds: 2, evPercent: 10, outcome: "WIN" }),
    sample({ predictionId: "b", odds: 0, evPercent: 0, outcome: "LOSS" }),
  ]);
  assert.equal(report.total, 2);
  assert.equal(report.insufficientData, 1);
  assert.equal(report.legacyAll.hitRate, 0.5);
  assert.equal(report.legacyAll.roiSamples, 1);
  assert.equal(report.legacyAll.roiPerBet, 1);
});
