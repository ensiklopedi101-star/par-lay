/**
 * Kelly Criterion Calculator
 * f* = (bp - q) / b
 * di mana b = desimal odds - 1, p = prob menang, q = 1 - p
 * Semua kalkulasi di backend, tidak di Gemini.
 */

export interface KellyResult {
  stakePercent: number;        // f* dalam persen (0-100%)
  stakePercentHalf: number;    // Half Kelly (0-50%)
  stakePercentQuarter: number; // Quarter Kelly (0-25%)
  recommendedUnit: string;     // "1%", "2.5%", dll
  edge: number;                // edge = p - (1/b+1)
  isPositiveEdge: boolean;
}

/**
 * Hitung Kelly Criterion dari odds dan probabilitas
 * @param odds    - Odds desimal (misal: 1.85)
 * @param probWin - Probabilitas menang (0-1, misal: 0.55)
 * @returns KellyResult dengan stakePercent, half, quarter, edge
 */
export function calculateKelly(odds: number, probWin: number): KellyResult {
  if (odds <= 1 || probWin <= 0 || probWin >= 1) {
    return {
      stakePercent: 0,
      stakePercentHalf: 0,
      stakePercentQuarter: 0,
      recommendedUnit: "0%",
      edge: 0,
      isPositiveEdge: false,
    };
  }

  const b = odds - 1;           // net odds (desimal dikurangi 1)
  const p = probWin;            // probabilitas menang
  const q = 1 - p;              // probabilitas kalah
  const edge = p - (1 / odds);  // edge = p - probabilitas implisit

  const f = (b * p - q) / b;   // Kelly formula
  const stakePercent = Math.max(0, f * 100); // f dalam persen
  const stakePercentHalf = stakePercent / 2;
  const stakePercentQuarter = stakePercent / 4;

  // Rekomendasi unit: gunakan half Kelly untuk konservatif
  const halfKelly = stakePercentHalf;
  let recommendedUnit: string;
  if (edge <= 0 || halfKelly <= 0) {
    // Taruhan tanpa edge tidak boleh mendapat unit sama sekali. Sebelumnya
    // `halfKelly < 1` juga menangkap nilai 0 dan menyarankan "0.5%".
    recommendedUnit = "0%";
  } else if (halfKelly < 1) {
    recommendedUnit = "0.5%";
  } else if (halfKelly >= 1 && halfKelly < 2) {
    recommendedUnit = "1%";
  } else if (halfKelly >= 2 && halfKelly < 3.5) {
    recommendedUnit = "2%";
  } else if (halfKelly >= 3.5 && halfKelly < 5) {
    recommendedUnit = "3%";
  } else if (halfKelly >= 5 && halfKelly < 7.5) {
    recommendedUnit = "4%";
  } else if (halfKelly >= 7.5 && halfKelly < 12) {
    recommendedUnit = "5%";
  } else {
    recommendedUnit = "5% (max)";
  }

  return {
    stakePercent,
    stakePercentHalf,
    stakePercentQuarter,
    recommendedUnit,
    edge,
    isPositiveEdge: edge > 0,
  };
}

/**
 * Ekstrak probabilitas dari teks prediksi Gemini
 * Hanya menerima probabilitas nyata eksplisit. Confidence bukan probabilitas
 * dan tidak boleh dipakai sebagai input Kelly.
 * @param predictionText - teks dari Gemini
 * @returns probabilitas (0-1) atau null
 */
export function extractProbFromPrediction(predictionText: string): number | null {
  const text = predictionText.toLowerCase();

  // "prob. nyata: 55%", "probabilitas: 55,5 %", "probability 55%"
  const percentMatch = text.match(
    /prob(?:abilitas|abilitiy|ability)?\.?\s*(?:nyata|real|riil)?\s*:?\s*(\d+(?:[.,]\d+)?)\s*%/,
  );
  if (percentMatch) {
    return clampProbability(parseFloat(percentMatch[1]!.replace(",", ".")) / 100);
  }

  // "probabilitas: 0,55" / "prob nyata = 0.55" — a bare decimal, never a bare
  // integer, because "probabilitas: 1" is far more likely prose than 100%.
  const decimalMatch = text.match(
    /prob(?:abilitas|abilitiy|ability)?\.?\s*(?:nyata|real|riil)?\s*[:=]?\s*(0[.,]\d+)/,
  );
  if (decimalMatch) {
    return clampProbability(parseFloat(decimalMatch[1]!.replace(",", ".")));
  }

  return null;
}

function clampProbability(value: number): number {
  return Math.min(0.99, Math.max(0.01, value));
}
