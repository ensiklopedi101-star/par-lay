import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildModelBacktest, type BacktestSample } from "./model-backtest";

function sample(partial: Partial<BacktestSample> & { actual: BacktestSample["actual"] }): BacktestSample {
  return {
    id: "x",
    league: "test",
    model: { home: 0.5, draw: 0.25, away: 0.25, over25: 0.5, bttsYes: 0.5 },
    market: { home: 0.45, draw: 0.27, away: 0.28 },
    ...partial,
  };
}

describe("buildModelBacktest", () => {
  it("model sempurna punya log-loss mendekati nol", () => {
    const samples = Array.from({ length: 40 }, () =>
      sample({
        model: { home: 0.999, draw: 0.0005, away: 0.0005, over25: 0.999, bttsYes: 0.999 },
        actual: { homeGoals: 2, awayGoals: 1 },
      }));
    const report = buildModelBacktest(samples);
    assert.ok(report.oneX2.modelLogLoss < 0.01);
    assert.equal(report.oneX2.argmaxHitRate, 1);
    assert.ok((report.calibrationEce ?? 1) < 0.05);
  });

  it("skill positif bila model lebih akurat dari pasar secara berpasangan", () => {
    const samples = Array.from({ length: 40 }, () =>
      sample({
        model: { home: 0.9, draw: 0.05, away: 0.05, over25: 0.5, bttsYes: 0.5 },
        market: { home: 0.4, draw: 0.3, away: 0.3 },
        actual: { homeGoals: 1, awayGoals: 0 },
      }));
    const report = buildModelBacktest(samples);
    assert.ok(report.oneX2.vsMarket!.skill > 0);
    assert.match(report.verdict, /mengalahkan pasar/);
  });

  it("vonis menolak bila model kalah dari pasar", () => {
    const samples = Array.from({ length: 40 }, () =>
      sample({
        model: { home: 0.34, draw: 0.33, away: 0.33, over25: 0.5, bttsYes: 0.5 },
        market: { home: 0.9, draw: 0.05, away: 0.05 },
        actual: { homeGoals: 3, awayGoals: 0 },
      }));
    const report = buildModelBacktest(samples);
    assert.ok(report.oneX2.vsMarket!.skill < 0);
    assert.match(report.verdict, /TIDAK mengalahkan pasar/);
  });

  it("sampel kecil tidak diberi vonis kualitas", () => {
    const report = buildModelBacktest([
      sample({ actual: { homeGoals: 1, awayGoals: 0 } }),
    ]);
    assert.match(report.verdict, /terlalu kecil/);
  });
});
