/**
 * Staking yang sadar ketidakpastian.
 *
 * KELEMAHAN YANG DIPERBAIKI: `calculateKelly` lama memperlakukan probabilitas
 * yang ditulis LLM sebagai kebenaran. Kelly sangat sensitif: error 3 poin
 * persen pada p dapat menggandakan stake. Karena bet dipilih dari kandidat
 * dengan EV tertinggi, estimasi p cenderung terlalu optimis (winner's curse).
 * Perbaikan: (1) kurangi p dengan z·σ, (2) fractional Kelly, (3) cap keras.
 */

export interface StakeInput {
  /** probabilitas menang efektif hasil model akhir (0-1) */
  p: number;
  odds: number;
  /** ketidakpastian estimasi p (simpangan baku, satuan probabilitas) */
  sigma?: number;
  /** berapa σ dikurangkan; 1 ≈ batas bawah ~84% */
  z?: number;
  /** fraksi Kelly, 0.25 = quarter Kelly */
  fraction?: number;
  /** cap stake sebagai % bankroll */
  maxStakePct?: number;
}

export interface StakeResult {
  pAdjusted: number;
  fullKellyPct: number;
  stakePct: number;
  evNaive: number;
  evConservative: number;
  capped: boolean;
}

export function stakePlan(input: StakeInput): StakeResult {
  const { p, odds } = input;
  const sigma = input.sigma ?? 0.03;
  const z = input.z ?? 1;
  const fraction = input.fraction ?? 0.25;
  const cap = input.maxStakePct ?? 2;
  if (!(odds > 1) || !(p > 0 && p < 1)) {
    return { pAdjusted: 0, fullKellyPct: 0, stakePct: 0, evNaive: -1, evConservative: -1, capped: false };
  }
  const pAdj = Math.max(0.001, p - z * sigma);
  const b = odds - 1;
  const f = Math.max(0, (b * pAdj - (1 - pAdj)) / b);
  const raw = f * fraction * 100;
  return {
    pAdjusted: pAdj,
    fullKellyPct: f * 100,
    stakePct: Math.min(cap, raw),
    evNaive: p * odds - 1,
    evConservative: pAdj * odds - 1,
    capped: raw > cap,
  };
}

/** Odds minimum agar bet tetap bernilai setelah margin keamanan. */
export function minimumOdds(p: number, minEv = 0.03): number {
  return p > 0 ? (1 + minEv) / p : Infinity;
}
