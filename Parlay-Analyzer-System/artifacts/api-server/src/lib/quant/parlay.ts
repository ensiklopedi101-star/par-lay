/**
 * Analisis parlay yang jujur.
 *
 * KELEMAHAN YANG DIPERBAIKI (parlay-builder.ts):
 *  1. `winProbability = Π p_i` mengasumsikan independen penuh. Antar-laga di
 *     liga/hari/market yang sama ada korelasi (tempo, cuaca, bias publik).
 *  2. Error probabilitas MENUMPUK secara perkalian: jika tiap leg dioverestimasi
 *     5 poin, parlay 5-leg dioverestimasi ~±28% relatif. EV parlay tidak boleh
 *     dipercaya tanpa uji sensitivitas → `breakEvenBias`.
 *  3. Margin bandar juga menumpuk per leg → `marginPaid`.
 *  4. Parlay lama hanya mensyaratkan confidence ≥ 6.5 (angka self-report LLM),
 *     bukan EV positif per leg. Di sini setiap leg WAJIB EV konservatif > 0.
 */

export interface ParlayLeg {
  /** probabilitas menang efektif model akhir */
  p: number;
  /** odds yang akan diambil */
  odds: number;
  /** probabilitas fair pasar untuk leg ini (de-vig), opsional */
  pMarket?: number | null;
  league?: string;
  /** "ML" | "Totals" | "AH" | "BTTS" | "HT" */
  marketFamily?: string;
  /** tanggal laga YYYY-MM-DD */
  date?: string;
}

/** mulberry32 — RNG deterministik (hasil simulasi dapat direproduksi). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Invers CDF normal baku (Acklam). */
export function normInv(p: number): number {
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const pl = 0.02425;
  const q0 = Math.min(1 - 1e-12, Math.max(1e-12, p));
  if (q0 < pl) {
    const q = Math.sqrt(-2 * Math.log(q0));
    return (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) /
      ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  }
  if (q0 > 1 - pl) {
    const q = Math.sqrt(-2 * Math.log(1 - q0));
    return -(((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) /
      ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  }
  const q = q0 - 0.5;
  const r = q * q;
  return (((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q /
    (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1);
}

/**
 * Prior korelasi antar-leg (heuristik, BUKAN fakta). Harus diestimasi ulang
 * dari residual ledger begitu sampel cukup. Dibatasi 0..0.25.
 */
export function pairwiseCorrelation(a: ParlayLeg, b: ParlayLeg): number {
  let rho = 0.02;
  if (a.league && a.league === b.league) rho += 0.03;
  if (a.date && a.date === b.date) rho += 0.02;
  const ta = a.marketFamily === "Totals" || a.marketFamily === "BTTS";
  const tb = b.marketFamily === "Totals" || b.marketFamily === "BTTS";
  if (ta && tb) rho += 0.05; // faktor "lingkungan gol" bersama
  return Math.min(0.25, rho);
}

function cholesky(matrix: number[][]): number[][] {
  const n = matrix.length;
  let scale = 1;
  for (let attempt = 0; attempt < 6; attempt++) {
    const L: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
    let ok = true;
    for (let i = 0; i < n && ok; i++) {
      for (let j = 0; j <= i; j++) {
        const off = i === j ? matrix[i]![j]! : matrix[i]![j]! * scale;
        let sum = off;
        for (let k = 0; k < j; k++) sum -= L[i]![k]! * L[j]![k]!;
        if (i === j) {
          if (sum <= 1e-10) {
            ok = false;
            break;
          }
          L[i]![j] = Math.sqrt(sum);
        } else L[i]![j] = sum / L[j]![j]!;
      }
    }
    if (ok) return L;
    scale *= 0.5;
  }
  return Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
}

export interface ParlayResult {
  legs: number;
  combinedOdds: number;
  pIndependent: number;
  pCorrelated: number;
  /** standard error simulasi Monte Carlo */
  simStdErr: number;
  evIndependent: number;
  evCorrelated: number;
  /**
   * Nilai yang BOLEH dipakai untuk keputusan: min(independen, berkorelasi).
   * Korelasi positif antar-leg menaikkan P(semua menang) dan akan memperindah
   * EV — itu tidak boleh dijadikan alasan mengambil parlay.
   */
  pDecision: number;
  evDecision: number;
  /** batas bawah: tiap leg dikurangi sigma */
  pPessimistic: number;
  evPessimistic: number;
  /** fair combined odds menurut probabilitas model (berkorelasi) */
  fairOddsCorrelated: number;
  /** fraksi nilai fair yang dibayar sebagai margin gabungan (jika pMarket lengkap) */
  marginPaid: number | null;
  /** berapa poin-persen SETIAP leg boleh overestimasi sebelum EV = 0 */
  breakEvenBias: number;
  correlationMatrix: number[][];
}

export interface ParlayOptions {
  sims?: number;
  seed?: number;
  /** ketidakpastian per-leg untuk skenario pesimis */
  sigma?: number;
  /** override odds gabungan dari bandar (jika berbeda dari hasil kali) */
  offeredOdds?: number;
}

export function analyzeParlay(legs: ParlayLeg[], opts: ParlayOptions = {}): ParlayResult {
  if (legs.length < 1) throw new Error("Parlay butuh minimal 1 leg.");
  const sims = opts.sims ?? 40000;
  const sigma = opts.sigma ?? 0.03;
  const probs = legs.map((l) => Math.min(0.995, Math.max(0.005, l.p)));
  const combinedOdds = opts.offeredOdds ?? legs.reduce((acc, l) => acc * l.odds, 1);
  const pIndependent = probs.reduce((acc, p) => acc * p, 1);

  const n = legs.length;
  const corr: number[][] = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => (i === j ? 1 : pairwiseCorrelation(legs[i]!, legs[j]!))),
  );
  const L = cholesky(corr);
  const thresholds = probs.map((p) => normInv(p));
  const rnd = mulberry32(opts.seed ?? 20260101);
  const gauss = () => {
    const u1 = Math.max(1e-12, rnd());
    const u2 = rnd();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  };
  let hits = 0;
  const z = new Array<number>(n).fill(0);
  for (let s = 0; s < sims; s++) {
    for (let i = 0; i < n; i++) z[i] = gauss();
    let all = true;
    for (let i = 0; i < n && all; i++) {
      let x = 0;
      for (let j = 0; j <= i; j++) x += L[i]![j]! * z[j]!;
      if (x >= thresholds[i]!) all = false;
    }
    if (all) hits++;
  }
  const pCorrelated = hits / sims;
  const simStdErr = Math.sqrt((pCorrelated * (1 - pCorrelated)) / sims);

  const pPessimistic = probs.reduce((acc, p) => acc * Math.max(0.001, p - sigma), 1);

  // titik impas bias seragam per leg: Π(p_i − δ)·O = 1
  const g = (delta: number) => probs.reduce((acc, p) => acc * Math.max(0, p - delta), 1) * combinedOdds - 1;
  let breakEvenBias = 0;
  if (g(0) > 0) {
    let lo = 0;
    let hi = Math.min(...probs);
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      if (g(mid) > 0) lo = mid;
      else hi = mid;
    }
    breakEvenBias = lo;
  } else {
    breakEvenBias = -1; // sudah negatif tanpa bias
  }

  const allMarket = legs.every((l) => l.pMarket != null && l.pMarket > 0);
  const marketProd = allMarket ? legs.reduce((acc, l) => acc * (l.pMarket as number), 1) : null;

  return {
    legs: n,
    combinedOdds,
    pIndependent,
    pCorrelated,
    simStdErr,
    evIndependent: pIndependent * combinedOdds - 1,
    evCorrelated: pCorrelated * combinedOdds - 1,
    pDecision: Math.min(pIndependent, pCorrelated),
    evDecision: Math.min(pIndependent, pCorrelated) * combinedOdds - 1,
    pPessimistic,
    evPessimistic: pPessimistic * combinedOdds - 1,
    fairOddsCorrelated: pCorrelated > 0 ? 1 / pCorrelated : Infinity,
    marginPaid: marketProd != null ? 1 - combinedOdds * marketProd : null,
    breakEvenBias,
    correlationMatrix: corr,
  };
}
