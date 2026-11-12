import { test } from "node:test";
import assert from "node:assert/strict";
import {
  brierScore,
  blendProbability,
  booksum,
  calibrationBuckets,
  conservativeEv,
  devigAdditive,
  devigMultiplicative,
  devigShin,
  expectedCalibrationError,
  expectedValue,
  fairProbability,
  kellyFraction,
  logLoss,
  parlayProbability,
  stakingPlan,
  worstCaseFairProbability,
} from "./betting-math.js";

const close = (actual: number, expected: number, tolerance = 1e-3) =>
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${expected}, got ${actual}`,
  );

/* ── Devig ─────────────────────────────────────────────────────────────── */

test("devig multiplicative: pasar dua arah seimbang", () => {
  /* 1.93 / 1.93 → booksum 103.63%, wajar 50/50. */
  close(booksum([1.93, 1.93]), 1.03627);
  const result = devigMultiplicative([1.93, 1.93])!;
  close(result.fair[0]!, 0.5);
  close(result.fair[1]!, 0.5);
  close(result.overround, 0.03627);
});

test("devig multiplicative: 1X2 (1.72 / 4.00 / 4.80)", () => {
  const result = devigMultiplicative([1.72, 4.0, 4.8])!;
  close(result.fair[0]!, 0.5592);
  close(result.fair[1]!, 0.2404);
  close(result.fair[2]!, 0.2004);
  close(result.fair.reduce((a, b) => a + b, 0), 1);
});

test("devig additive menolak pasar yang membuat probabilitas negatif", () => {
  /* Margin merata bisa melewati probabilitas mentah outcome ber-odds sangat
     panjang; hasil negatif harus ditolak, bukan dipaksa dinormalisasi. */
  assert.equal(devigAdditive([1.01, 1.01, 500]), null);
  assert.ok(devigAdditive([1.9, 2.05]) !== null);
});

test("pasar dua arah: additive identik dengan Shin", () => {
  const additive = devigAdditive([1.25, 4.2])!;
  const shin = devigShin([1.25, 4.2])!;
  close(additive.fair[0]!, shin.fair[0]!, 2e-3);
  close(additive.fair[1]!, shin.fair[1]!, 2e-3);
});

test("devig Shin: jumlah = 1, menaikkan favorit, menurunkan longshot", () => {
  const mult = devigMultiplicative([1.25, 4.2])!;
  const shin = devigShin([1.25, 4.2])!;
  close(shin.fair.reduce((a, b) => a + b, 0), 1);
  /* Koreksi favorite–longshot bias: probabilitas favorit naik, longshot turun. */
  assert.ok(shin.fair[0]! > mult.fair[0]!);
  assert.ok(shin.fair[1]! < mult.fair[1]!);
});

test("devig Shin pada pasar tanpa margin jatuh ke multiplicative", () => {
  const shin = devigShin([2.0, 2.0])!;
  close(shin.fair[0]!, 0.5);
});

test("devig menolak input yang tidak bisa dipakai", () => {
  assert.equal(devigMultiplicative([1.9]), null);
  assert.equal(devigMultiplicative([null, undefined]), null);
  assert.equal(devigMultiplicative([1.0, 1.0]), null);
  assert.equal(fairProbability([1.9, 2.0], 5), null);
});

test("worst case mengambil probabilitas terendah antar metode, di kedua sisi", () => {
  const odds = [1.72, 4.0, 4.8];
  const lowest = (index: number) =>
    Math.min(
      fairProbability(odds, index, "multiplicative")!,
      fairProbability(odds, index, "additive")!,
      fairProbability(odds, index, "shin")!,
    );
  const multHome = fairProbability(odds, 0, "multiplicative")!;
  const multAway = fairProbability(odds, 2, "multiplicative")!;
  /* Metode paling konservatif berbeda menurut sisi pasar: favorit → multiplicative,
     longshot → additive/Shin. Karena itu gerbang tidak boleh memihak satu metode. */
  close(worstCaseFairProbability(odds, 0)!, lowest(0));
  close(worstCaseFairProbability(odds, 2)!, lowest(2));
  assert.ok(worstCaseFairProbability(odds, 0)! <= multHome);
  assert.ok(worstCaseFairProbability(odds, 2)! <= multAway);
});

/* ── EV ────────────────────────────────────────────────────────────────── */

test("EV: 55% pada odds 2.10 → +15.5%", () => {
  close(expectedValue(0.55, 2.1), 0.155);
  close(expectedValue(0.5, 2.0), 0);
  close(expectedValue(0.4, 2.0), -0.2);
});

test("EV konservatif memotong sigma sebelum dihitung", () => {
  /* p=0.55, σ=0.05, odds 2.10 → 0.50 × 2.10 − 1 = +5%. */
  close(conservativeEv(0.55, 2.1, 0.05), 0.05);
  /* Edge tipis bisa hilang sepenuhnya — memang tujuan gerbangnya. */
  assert.ok(conservativeEv(0.5, 2.1, 0.05) < 0);
});

test("EV menolak odds yang tidak valid", () => {
  assert.equal(expectedValue(0.6, 1), 0);
  assert.equal(expectedValue(Number.NaN, 2), 0);
});

/* ── Penggabungan model & pasar ────────────────────────────────────────── */

test("blend memberi bobot kecil pada model", () => {
  close(blendProbability(0.6, 0.5, 0.35), 0.535);
  /* Bobot 0 berarti sepenuhnya percaya pasar. */
  close(blendProbability(0.9, 0.5, 0), 0.5);
  /* Bobot 1 berarti sepenuhnya percaya model. */
  close(blendProbability(0.9, 0.5, 1), 0.9);
  /* Probabilitas pasar tidak tersedia → pakai model apa adanya. */
  close(blendProbability(0.9, Number.NaN, 0.35), 0.9);
});

/* ── Kelly & stake ─────────────────────────────────────────────────────── */

test("Kelly: 55% pada 2.10 → 14.09%", () => {
  close(kellyFraction(0.55, 2.1), 0.1409, 1e-4);
});

test("Kelly tidak pernah menyarankan taruhan tanpa edge", () => {
  assert.equal(kellyFraction(0.4, 2.0), 0);
  assert.equal(kellyFraction(0.5, 1.5), 0);
  assert.equal(kellyFraction(0.5, 1), 0);
});

test("stake memakai 1/4 Kelly dengan pagar 3%", () => {
  /* 1/4 × 14.09% = 3.52%, dipangkas pagar 3%. */
  const capped = stakingPlan(0.55, 2.1);
  close(capped.fullFraction, 0.1409, 1e-4);
  close(capped.recommendedFraction, 0.03, 1e-4);
  /* Tanpa pagar, angkanya 3.52%. */
  const uncapped = stakingPlan(0.55, 2.1, { maxPercent: 10 });
  close(uncapped.recommendedFraction, 0.0352, 1e-4);
  /* Edge sangat besar tetap dibatasi pagar. */
  close(stakingPlan(0.9, 5).recommendedPercent, 3);
});

/* ── Parlay ────────────────────────────────────────────────────────────── */

test("probabilitas parlay = perkalian, dengan haircut korelasi", () => {
  close(parlayProbability([0.6, 0.5]), 0.3);
  close(parlayProbability([0.6, 0.5], 0.85), 0.255);
  assert.equal(parlayProbability([]), 0);
  assert.equal(parlayProbability([0, 0.5]), 0.5, "leg tidak valid diabaikan");
});

test("parlay berkorelasi menghasilkan EV lebih rendah", () => {
  const independent = parlayProbability([0.6, 0.5]);
  const correlated = parlayProbability([0.6, 0.5], 0.8);
  assert.ok(correlated < independent);
});

/* ── Kalibrasi ─────────────────────────────────────────────────────────── */

test("Brier score dan log loss pada contoh kecil", () => {
  const pairs = [
    { probability: 0.7, outcome: 1 as const },
    { probability: 0.4, outcome: 0 as const },
  ];
  /* (0.09 + 0.16) / 2 = 0.125 */
  close(brierScore(pairs)!, 0.125);
  const loss = logLoss(pairs)!;
  close(loss, (-Math.log(0.7) - Math.log(0.6)) / 2, 1e-6);
});

test("kalibrasi: model yang selalu 60% dengan hit rate 60% ber-ECE rendah", () => {
  const pairs = Array.from({ length: 10 }, (_, index) => ({
    probability: 0.6,
    outcome: (index < 6 ? 1 : 0) as 0 | 1,
  }));
  close(expectedCalibrationError(pairs)!, 0, 1e-9);
  const buckets = calibrationBuckets(pairs);
  assert.equal(buckets.length, 1);
  assert.equal(buckets[0]!.count, 10);
  close(buckets[0]!.observedRate, 0.6);
});

test("kalibrasi: model terlalu yakin terdeteksi ECE", () => {
  const pairs = Array.from({ length: 10 }, (_, index) => ({
    probability: 0.9,
    outcome: (index < 5 ? 1 : 0) as 0 | 1,
  }));
  close(expectedCalibrationError(pairs)!, 0.4, 1e-9);
});

test("metrik kalibrasi mengembalikan null tanpa data", () => {
  assert.equal(brierScore([]), null);
  assert.equal(logLoss([]), null);
  assert.equal(expectedCalibrationError([]), null);
});
