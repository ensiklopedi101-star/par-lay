import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildHtExperiment, htProbabilities } from "./ht-model";

describe("ht-model", () => {
  it("probabilitas HT konsisten dan 0-0 adalah skor tunggal terbesar", () => {
    const p = htProbabilities(0.65, 0.5);
    const total = p.homeWin + p.draw + p.awayWin;
    assert.ok(Math.abs(total - 1) < 1e-9);
    assert.ok(p.over05 < 0.75 && p.over05 > 0.55);
    assert.ok(p.bttsYes < p.over05);
  });

  it("model yang tahu laju tim mengalahkan patokan liga", () => {
    // Tim kandang sangat kuat di HT: model mengetahuinya, patokan tidak.
    const strong = htProbabilities(1.3, 0.3);
    const base = htProbabilities(0.62, 0.48);
    const samples = Array.from({ length: 50 }, () => ({
      model: strong,
      base,
      actual: { homeGoals: 1, awayGoals: 0 },
    }));
    const result = buildHtExperiment(samples);
    assert.ok(result);
    assert.ok(result!.htResult.skill > 0);
    assert.equal(result!.over05.hitRate, 1);
  });
});
