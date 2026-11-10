/**
 * De-vig (penghapusan margin bandar).
 *
 * KELEMAHAN YANG DIPERBAIKI: sistem lama memakai `(1 / odds) × 100%` sebagai
 * "probabilitas implisit bandar". Angka itu masih mengandung margin (overround)
 * sehingga jumlahnya > 100%. Membandingkan probabilitas model dengan angka itu
 * membuat EV tampak lebih kecil/besar secara sistematis dan tidak bisa dipakai
 * sebagai benchmark kalibrasi. Probabilitas pasar yang benar adalah "fair
 * probability" setelah margin dibuang.
 *
 * Tiga metode:
 *  - proportional : margin dibagi rata (sederhana, bias terhadap longshot)
 *  - power        : p_i = (1/o_i)^k, k dicari agar Σp = 1
 *  - shin         : model Shin (1993), memperhitungkan favourite-longshot bias
 *                   — default untuk 1X2.
 */

export type DevigMethod = "proportional" | "power" | "shin";

export interface DevigResult {
  /** probabilitas fair, jumlah = 1 */
  probs: number[];
  /** Σ(1/odds) − 1, mis. 0.05 = margin 5% */
  overround: number;
  method: DevigMethod;
  /** method yang benar-benar dipakai (bisa fallback) */
  usedMethod: DevigMethod;
  /** parameter Shin z (proporsi insider) bila dipakai */
  z?: number;
  /** eksponen power bila dipakai */
  k?: number;
}

export function overround(odds: number[]): number {
  return odds.reduce((sum, o) => sum + 1 / o, 0) - 1;
}

function assertOdds(odds: number[]): void {
  if (odds.length < 2) throw new Error("De-vig butuh minimal 2 outcome.");
  for (const o of odds) {
    if (!Number.isFinite(o) || o <= 1) throw new Error(`Odds tidak valid: ${o}`);
  }
}

function proportional(odds: number[]): number[] {
  const inv = odds.map((o) => 1 / o);
  const total = inv.reduce((a, b) => a + b, 0);
  return inv.map((v) => v / total);
}

function bisect(
  f: (x: number) => number,
  lo: number,
  hi: number,
  iterations = 80,
): number {
  let a = lo;
  let b = hi;
  const fa = f(a);
  for (let i = 0; i < iterations; i++) {
    const mid = (a + b) / 2;
    const fm = f(mid);
    if (Math.sign(fm) === Math.sign(fa)) a = mid;
    else b = mid;
  }
  return (a + b) / 2;
}

export function devig(odds: number[], method: DevigMethod = "shin"): DevigResult {
  assertOdds(odds);
  const margin = overround(odds);
  const base = { overround: margin, method };

  // Tanpa margin (atau arbitrase) tidak ada yang perlu dibuang.
  if (margin <= 1e-9 || method === "proportional") {
    return { ...base, probs: proportional(odds), usedMethod: "proportional" };
  }

  const inv = odds.map((o) => 1 / o);

  if (method === "power") {
    const f = (k: number) => inv.reduce((s, v) => s + Math.pow(v, k), 0) - 1;
    const k = bisect(f, 1, 25);
    const probs = inv.map((v) => Math.pow(v, k));
    const total = probs.reduce((a, b) => a + b, 0);
    return { ...base, probs: probs.map((p) => p / total), usedMethod: "power", k };
  }

  // Shin
  const B = inv.reduce((a, b) => a + b, 0);
  const shinProbs = (z: number) =>
    inv.map(
      (pi) => (Math.sqrt(z * z + (4 * (1 - z) * pi * pi) / B) - z) / (2 * (1 - z)),
    );
  const g = (z: number) => shinProbs(z).reduce((a, b) => a + b, 0) - 1;
  const hi = 0.45;
  if (g(0) > 0 && g(hi) < 0) {
    const z = bisect(g, 0, hi);
    const probs = shinProbs(z);
    const total = probs.reduce((a, b) => a + b, 0);
    return { ...base, probs: probs.map((p) => p / total), usedMethod: "shin", z };
  }
  return { ...base, probs: proportional(odds), usedMethod: "proportional" };
}
