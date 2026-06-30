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
  if (halfKelly < 1) {
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
 * Mencari pattern "Prob. Nyata: XX%" atau "Confidence: X.X"
 * @param predictionText - teks dari Gemini
 * @returns probabilitas (0-1) atau null
 */
export function extractProbFromPrediction(predictionText: string): number | null {
  const text = predictionText.toLowerCase();
  // Cari "prob. nyata: 55%" atau "probabilitas: 0.55"
  const probMatch = text.match(/prob(?:abilitas)?\s*(?:nyata)?:?\s*(\d+\.?\d*)\s*%/);
  if (probMatch) {
    return Math.min(0.99, Math.max(0.01, parseFloat(probMatch[1]) / 100));
  }
  // Cari "confidence: 8.5" → convert ke probabilitas kasar
  const confMatch = text.match(/confidence\s*(?:score)?:?\s*(\d+\.?\d*)/);
  if (confMatch) {
    const conf = parseFloat(confMatch[1]);
    // confidence / 10 → probabilitas kasar (8.5/10 = 0.85)
    return Math.min(0.99, Math.max(0.01, conf / 10));
  }
  return null;
}
