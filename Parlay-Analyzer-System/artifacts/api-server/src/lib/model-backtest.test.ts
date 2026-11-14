import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildBlendExperiment, buildCalibrationExperiment, buildModelBacktest, type BacktestSample } from "./model-backtest";

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

describe("segmentasi periode & eksperimen kalibrasi", () => {
  it("byPeriod mengelompokkan per bulan kick-off", () => {
    const samples = [
      sample({ kickoff: "2026-08-15T14:00:00Z", actual: { homeGoals: 1, awayGoals: 0 } }),
      sample({ kickoff: "2026-11-02T14:00:00Z", actual: { homeGoals: 0, awayGoals: 1 } }),
    ];
    const report = buildModelBacktest(samples);
    assert.deepEqual(report.byPeriod.map((p) => p.period), ["2026-08", "2026-11"]);
  });

  it("adopsi hanya bila menang di validasi, bukan di latih", () => {
    const combos = [
      { xgWeight: 0.6, shrinkK: 6 },
      { xgWeight: 0, shrinkK: 0 },
    ];
    const paired = (skill: number) => ({
      n: 50, modelLogLoss: 1, marketLogLoss: 1 + skill, skill, tStat: 2.5,
    });
    // Menang besar di latih, kalah di validasi → overfitting, tolak.
    const rejected = buildCalibrationExperiment(
      combos, [-0.02, 0.09], [paired(-0.01), paired(-0.03)], combos[0]!, 50, 50,
    );
    assert.equal(rejected.adoptionJustified, false);
    assert.match(rejected.note, /overfitting/);
    // Menang di validasi dengan skill positif → layak adopsi.
    const adopted = buildCalibrationExperiment(
      combos, [-0.02, 0.09], [paired(-0.01), paired(0.02)], combos[0]!, 50, 50,
    );
    assert.equal(adopted.adoptionJustified, true);
  });
});

describe("pasar biner & eksperimen bobot campuran", () => {
  it("over25VsMarket positif bila probabilitas totals model lebih akurat dari pasar", () => {
    const rows = Array.from({ length: 30 }, (_, i) => sample({
      actual: i % 2 === 0 ? { homeGoals: 2, awayGoals: 1 } : { homeGoals: 0, awayGoals: 0 },
      model: { home: 0.45, draw: 0.27, away: 0.28, over25: i % 2 === 0 ? 0.85 : 0.15, bttsYes: 0.5 },
      marketOver25: 0.5,
    }));
    const report = buildModelBacktest(rows);
    assert.ok(report.over25VsMarket && report.over25VsMarket.skill > 0);
    assert.equal(report.bttsVsMarket, null);
  });

  it("blend memilih bobot pasar murni bila model menyesatkan, dan mengakuinya", () => {
    const bad = Array.from({ length: 20 }, () => sample({
      actual: { homeGoals: 1, awayGoals: 0 },
      model: { home: 0.1, draw: 0.2, away: 0.7, over25: 0.5, bttsYes: 0.5 },
    }));
    const exp = buildBlendExperiment(bad, bad);
    assert.equal(exp.bestWeight, 0);
    assert.equal(exp.modelAddsValue, false);
  });

  it("blend memberi bobot positif bila model sempurna", () => {
    const perfect = Array.from({ length: 20 }, () => sample({
      actual: { homeGoals: 1, awayGoals: 0 },
      model: { home: 0.98, draw: 0.01, away: 0.01, over25: 0.5, bttsYes: 0.5 },
    }));
    const exp = buildBlendExperiment(perfect, perfect);
    assert.ok(exp.bestWeight != null && exp.bestWeight > 0);
    assert.equal(exp.modelAddsValue, true);
  });
});
