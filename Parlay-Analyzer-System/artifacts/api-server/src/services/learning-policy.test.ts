import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BASELINE_LEARNING_POLICY,
  buildLearningPolicyAddendum,
  parseLearningPolicy,
} from "./learning-policy";

/**
 * Kebijakan ini adalah tempat NO_BET berlebihan pernah lahir.
 *
 * Sebelumnya `minConfidence` dasar 6.5 dan `parseLearningPolicy` memaksa
 * `Math.max(6.5, ...)` sehingga bahkan admin tidak bisa menurunkannya. Akibatnya
 * rekomendasi dengan EV kuat tetap ditolak hanya karena confidence 6.0.
 *
 * Tes ini mengunci keputusan bahwa EV — bukan confidence — adalah gerbang.
 */

test("kebijakan dasar tidak memakai confidence sebagai gerbang", () => {
  assert.equal(
    BASELINE_LEARNING_POLICY.minConfidence,
    0,
    "confidence bukan gerbang; kalau nilai ini kembali > 0, NO_BET akan melonjak lagi",
  );
});

test("admin bisa menurunkan minConfidence sampai 0", () => {
  const parsed = parseLearningPolicy({ minConfidence: 0 });
  assert.equal(parsed.minConfidence, 0, "clamp bawah harus 0, bukan 6.5");
});

test("admin tetap bisa MENAIKKAN minConfidence bila backtest mendukung", () => {
  const parsed = parseLearningPolicy({ minConfidence: 8 });
  assert.equal(parsed.minConfidence, 8);
});

test("minConfidence di atas 9.5 tetap dibatasi", () => {
  const parsed = parseLearningPolicy({ minConfidence: 99 });
  assert.equal(parsed.minConfidence, 9.5);
});

test("nilai tidak valid jatuh ke kebijakan dasar, bukan NaN", () => {
  const parsed = parseLearningPolicy({ minConfidence: "abc", minEvPercent: null });
  assert.equal(parsed.minConfidence, BASELINE_LEARNING_POLICY.minConfidence);
  assert.equal(parsed.minEvPercent, BASELINE_LEARNING_POLICY.minEvPercent);
});

test("addendum default menyatakan confidence bukan gerbang", () => {
  const addendum = buildLearningPolicyAddendum({});
  assert.match(addendum, /BUKAN gerbang keputusan/i);
  assert.doesNotMatch(
    addendum,
    /confidence di bawah 0\.0/,
    "tidak boleh menyuruh NO_BET karena confidence 0.0",
  );
});

test("addendum menyebut confidence bila admin menaikkannya secara sadar", () => {
  const addendum = buildLearningPolicyAddendum({ minConfidence: 7.5 });
  assert.match(addendum, /confidence di bawah 7\.5/i);
});

test("keluarga market yang dikecualikan tetap dilaporkan", () => {
  const addendum = buildLearningPolicyAddendum({ excludedMarketFamilies: ["HT"] });
  assert.match(addendum, /HT/);
});
