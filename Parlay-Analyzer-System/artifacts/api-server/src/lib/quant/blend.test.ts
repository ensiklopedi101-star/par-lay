import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateBlendHoldout,
  MIN_BLEND_HOLDOUT_SAMPLES,
  MIN_BLEND_TRAIN_SAMPLES,
  type BlendHoldoutSample,
} from "./blend";

/** Sampel sintetis deterministik: y mengikuti pTrue; pm/pk/pf diturunkan darinya. */
function sample(i: number, pTrue: number, modelShift: number, marketNoise: number): BlendHoldoutSample {
  const y = ((i * 2654435761) % 1000) / 1000 < pTrue ? 1 : 0;
  const clamp = (p: number) => Math.min(0.97, Math.max(0.03, p));
  const pMarket = clamp(pTrue + marketNoise * Math.sin(i * 1.7));
  const pModel = clamp(pTrue + modelShift + marketNoise * Math.cos(i * 2.3));
  return {
    pModel,
    pMarket,
    pFinal: clamp((pModel + pMarket) / 2),
    outcome: y as 0 | 1,
    analysedAt: new Date(Date.UTC(2026, 0, 1) + i * 60_000).toISOString(),
  };
}

function series(n: number, modelShift: number, marketNoise = 0.06): BlendHoldoutSample[] {
  return Array.from({ length: n }, (_, i) => sample(i, 0.25 + 0.5 * (((i * 37) % 100) / 100), modelShift, marketNoise));
}

test("insufficient_data below the Fase C statistical gate", () => {
  const result = evaluateBlendHoldout(series(150, 0));
  assert.equal(result.status, "insufficient_data");
  assert.equal(result.adoption.adoptCandidate, false);
  assert.ok(result.trainN < MIN_BLEND_TRAIN_SAMPLES || result.holdoutN < MIN_BLEND_HOLDOUT_SAMPLES);
});

test("adopts the fitted weight when the model genuinely beats market and incumbent on holdout", () => {
  /* Model hampir sempurna (shift 0, noise kecil); pasar berisik besar.
   * Fitting latih harus memilih w tinggi dan kandidat menang di holdout. */
  const samples = series(400, 0).map((s, i) => ({
    ...s,
    pMarket: Math.min(0.97, Math.max(0.03, s.pMarket + 0.18 * Math.sin(i * 3.1))),
    pModel: Math.min(0.97, Math.max(0.03, s.pModel + 0.01 * Math.sin(i))),
  }));
  /* pFinal incumbent = rata-rata keduanya → ikut tercemar noise pasar. */
  const withIncumbent = samples.map((s) => ({ ...s, pFinal: (s.pModel + s.pMarket) / 2 }));
  const result = evaluateBlendHoldout(withIncumbent);
  assert.equal(result.status, "evaluated");
  assert.ok(result.trainN >= MIN_BLEND_TRAIN_SAMPLES && result.holdoutN >= MIN_BLEND_HOLDOUT_SAMPLES);
  assert.ok((result.fittedWeight ?? 0) > 0.3, `fittedWeight=${result.fittedWeight}`);
  assert.equal(result.adoption.adoptCandidate, true);
  assert.ok((result.adoption.gainVsIncumbent ?? 0) > 0);
});

test("keeps production weight when the model adds nothing over the market", () => {
  /* Model = pasar + noise murni → w* latih ≈ 0 dan kandidat tidak boleh
   * dinyatakan mengalahkan incumbent secara berarti. */
  const samples = series(400, 0).map((s, i) => ({
    ...s,
    pModel: Math.min(0.97, Math.max(0.03, s.pMarket + 0.05 * Math.sin(i * 5.3))),
  }));
  const result = evaluateBlendHoldout(samples.map((s) => ({ ...s, pFinal: s.pMarket })));
  assert.equal(result.status, "evaluated");
  assert.equal(result.adoption.adoptCandidate, false);
});

test("chronological split never leaks identical timestamps across the boundary", () => {
  const samples = series(400, 0).map((s, i) => ({
    ...s,
    /* Kelompokkan timestamp per 10 baris agar batas 70% jatuh di tengah grup. */
    analysedAt: new Date(Date.UTC(2026, 0, 1) + Math.floor(i / 10) * 60_000).toISOString(),
  }));
  const result = evaluateBlendHoldout(samples);
  assert.equal(result.status, "evaluated");
  const trainTimes = new Set(samples.slice(0, result.trainN).map((s) => s.analysedAt));
  const holdoutTimes = new Set(samples.slice(result.trainN).map((s) => s.analysedAt));
  for (const t of holdoutTimes) assert.ok(!trainTimes.has(t), `timestamp bocor: ${t}`);
});
