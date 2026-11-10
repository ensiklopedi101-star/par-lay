/**
 * Evaluasi & pembelajaran berbasis bukti.
 *
 * KELEMAHAN YANG DIPERBAIKI (learning-policy / prompt-learning / settlement):
 *  1. Metrik utama lama = hit rate + ROI dari ±10–30 bet. Pada odds ~2.0 satu
 *     bet punya simpangan baku ≈ 1 unit; dengan n=10 galat baku ROI ≈ ±32%.
 *     Itu murni noise. Metrik yang konvergen jauh lebih cepat adalah CLV
 *     (Closing Line Value) dan skor probabilistik vs pasar (log-loss / Brier).
 *  2. Brier lama hanya dibandingkan dengan kebijakan lama sendiri, bukan
 *     dengan BASELINE PASAR. Model yang kalah dari harga penutupan tidak
 *     punya edge, seberapa pun hit rate-nya.
 *  3. Tidak ada uji signifikansi → di sini bootstrap CI dan estimasi n yang
 *     dibutuhkan agar edge dapat dibedakan dari keberuntungan.
 */

import { mulberry32 } from "./parlay";

export type BetOutcome = "win" | "half_win" | "push" | "half_loss" | "loss" | "void";

export interface LedgerBet {
  /** probabilitas model murni (statistik saja), opsional */
  pModel: number | null;
  /** probabilitas fair pasar SAAT bet dibuat (de-vig) */
  pMarketFair: number | null;
  /** probabilitas akhir sistem (blend) — dipakai untuk kalibrasi */
  pFinal: number | null;
  oddsTaken: number;
  oddsClose: number | null;
  /** probabilitas fair penutupan (de-vig) bila tersedia */
  closeFairProb: number | null;
  outcome: BetOutcome | null;
  stakeUnits: number;
}

/** Profit bersih per bet, dalam unit (stake × hasil). */
export function profitUnits(outcome: BetOutcome, odds: number, stake = 1): number {
  switch (outcome) {
    case "win": return stake * (odds - 1);
    case "half_win": return (stake * (odds - 1)) / 2;
    case "push":
    case "void": return 0;
    case "half_loss": return -stake / 2;
    case "loss": return -stake;
  }
}

/** Nilai biner untuk skor probabilistik; push/void dikeluarkan. */
export function binaryOutcome(outcome: BetOutcome | null): 0 | 1 | null {
  if (outcome === "win" || outcome === "half_win") return 1;
  if (outcome === "loss" || outcome === "half_loss") return 0;
  return null;
}

const clampP = (p: number) => Math.min(0.995, Math.max(0.005, p));
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
function sd(xs: number[]): number {
  if (xs.length < 2) return NaN;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
}

export function brier(ps: number[], ys: number[]): number {
  return mean(ps.map((p, i) => (clampP(p) - ys[i]!) ** 2));
}

export function logLoss(ps: number[], ys: number[]): number {
  return mean(ps.map((p, i) => (ys[i] === 1 ? -Math.log(clampP(p)) : -Math.log(1 - clampP(p)))));
}

export interface CalibrationBin {
  label: string;
  n: number;
  meanPredicted: number;
  observed: number;
}

export function calibrationBins(ps: number[], ys: number[], edges = [0, 0.4, 0.5, 0.6, 0.7, 1.0001]): CalibrationBin[] {
  const out: CalibrationBin[] = [];
  for (let i = 0; i < edges.length - 1; i++) {
    const lo = edges[i]!;
    const hi = edges[i + 1]!;
    const idx = ps.map((p, k) => (p >= lo && p < hi ? k : -1)).filter((k) => k >= 0);
    if (idx.length === 0) continue;
    out.push({
      label: `${Math.round(lo * 100)}–${Math.round(Math.min(hi, 1) * 100)}%`,
      n: idx.length,
      meanPredicted: mean(idx.map((k) => ps[k]!)),
      observed: mean(idx.map((k) => ys[k]!)),
    });
  }
  return out;
}

export function bootstrapMean(xs: number[], resamples = 2000, seed = 7): { lo: number; hi: number; pLeZero: number } {
  if (xs.length < 2) return { lo: NaN, hi: NaN, pLeZero: NaN };
  const rnd = mulberry32(seed);
  const means: number[] = [];
  let le = 0;
  for (let r = 0; r < resamples; r++) {
    let s = 0;
    for (let i = 0; i < xs.length; i++) s += xs[Math.floor(rnd() * xs.length)]!;
    const m = s / xs.length;
    means.push(m);
    if (m <= 0) le++;
  }
  means.sort((a, b) => a - b);
  return {
    lo: means[Math.floor(0.025 * resamples)]!,
    hi: means[Math.floor(0.975 * resamples)]!,
    pLeZero: le / resamples,
  };
}

/** Closing Line Value per bet. Memakai probabilitas fair penutupan bila ada. */
export function clvOf(b: Pick<LedgerBet, "oddsTaken" | "oddsClose" | "closeFairProb">): { value: number; fairBased: boolean } | null {
  if (b.closeFairProb != null && b.closeFairProb > 0 && b.closeFairProb < 1) {
    return { value: b.oddsTaken * b.closeFairProb - 1, fairBased: true };
  }
  if (b.oddsClose != null && b.oddsClose > 1) {
    return { value: b.oddsTaken / b.oddsClose - 1, fairBased: false };
  }
  return null;
}

export type VerdictLevel = "insufficient" | "early" | "supported" | "refuted";

export interface LedgerSummary {
  nTotal: number;
  nSettled: number;
  nDecisive: number;
  profit: number;
  staked: number;
  roi: number | null;
  roiCI: { lo: number; hi: number; pLeZero: number } | null;
  hitRate: number | null;
  avgOdds: number | null;
  avgClaimedEv: number | null;
  clv: {
    n: number;
    mean: number;
    ci: { lo: number; hi: number; pLeZero: number };
    positiveRate: number;
    tStat: number;
    fairBasedShare: number;
  } | null;
  scores: {
    n: number;
    brierModel: number;
    brierMarket: number | null;
    logLossModel: number;
    logLossMarket: number | null;
    /** 1 − LL_model / LL_market; > 0 berarti model mengalahkan pasar */
    skillVsMarket: number | null;
  } | null;
  calibration: CalibrationBin[];
  /** jumlah bet yang dibutuhkan untuk membedakan EV yang diklaim dari 0 (power 80%, α 5%) */
  betsNeeded: number | null;
  verdict: { level: VerdictLevel; headline: string; reasons: string[] };
}

export function summarizeLedger(bets: LedgerBet[], opts: { resamples?: number; seed?: number } = {}): LedgerSummary {
  const settled = bets.filter((b) => b.outcome != null);
  const profits = settled.map((b) => profitUnits(b.outcome!, b.oddsTaken, b.stakeUnits));
  const staked = settled.reduce((s, b) => s + (b.outcome === "void" ? 0 : b.stakeUnits), 0);
  const profit = profits.reduce((a, b) => a + b, 0);
  const perUnit = settled
    .filter((b) => b.outcome !== "void")
    .map((b) => profitUnits(b.outcome!, b.oddsTaken, 1));
  const roi = staked > 0 ? profit / staked : null;
  const roiCI = perUnit.length >= 5 ? bootstrapMean(perUnit, opts.resamples ?? 2000, opts.seed ?? 7) : null;

  const decisive = settled.filter((b) => binaryOutcome(b.outcome) != null);
  const wins = decisive.filter((b) => binaryOutcome(b.outcome) === 1).length;

  const claimed = bets
    .filter((b) => b.pFinal != null && b.pFinal > 0 && b.pFinal < 1)
    .map((b) => b.pFinal! * b.oddsTaken - 1);

  const clvs = bets.map((b) => clvOf(b)).filter((c): c is { value: number; fairBased: boolean } => c != null);
  const clvVals = clvs.map((c) => c.value);
  let clv: LedgerSummary["clv"] = null;
  if (clvVals.length >= 3) {
    const m = mean(clvVals);
    const s = sd(clvVals);
    clv = {
      n: clvVals.length,
      mean: m,
      ci: bootstrapMean(clvVals, opts.resamples ?? 2000, (opts.seed ?? 7) + 1),
      positiveRate: clvVals.filter((v) => v > 0).length / clvVals.length,
      tStat: s > 0 ? m / (s / Math.sqrt(clvVals.length)) : 0,
      fairBasedShare: clvs.filter((c) => c.fairBased).length / clvs.length,
    };
  }

  const scored = decisive.filter((b) => b.pFinal != null && b.pFinal > 0 && b.pFinal < 1);
  let scores: LedgerSummary["scores"] = null;
  let calibration: CalibrationBin[] = [];
  if (scored.length >= 5) {
    const ps = scored.map((b) => b.pFinal!);
    const ys = scored.map((b) => binaryOutcome(b.outcome)!);
    const withMarket = scored.filter((b) => b.pMarketFair != null && b.pMarketFair > 0 && b.pMarketFair < 1);
    const pm = withMarket.map((b) => b.pMarketFair!);
    const ym = withMarket.map((b) => binaryOutcome(b.outcome)!);
    const llModel = logLoss(ps, ys);
    // bandingkan pada himpunan bet yang sama
    const llModelSame = withMarket.length ? logLoss(withMarket.map((b) => b.pFinal!), ym) : null;
    const llMarket = withMarket.length ? logLoss(pm, ym) : null;
    scores = {
      n: scored.length,
      brierModel: brier(ps, ys),
      brierMarket: withMarket.length ? brier(pm, ym) : null,
      logLossModel: llModel,
      logLossMarket: llMarket,
      skillVsMarket: llMarket != null && llModelSame != null ? 1 - llModelSame / llMarket : null,
    };
    calibration = calibrationBins(ps, ys);
  }

  const sdProfit = sd(perUnit);
  const claimedEv = claimed.length ? mean(claimed) : null;
  const betsNeeded =
    claimedEv != null && claimedEv > 0.005 && Number.isFinite(sdProfit)
      ? Math.ceil(((1.645 + 0.842) * sdProfit / claimedEv) ** 2)
      : null;

  // ── vonis ──
  const reasons: string[] = [];
  let level: VerdictLevel = "insufficient";
  let headline = "Sampel belum cukup untuk menyimpulkan apa pun.";
  const n = settled.length;
  const clvSig = clv != null && clv.n >= 30 && clv.tStat >= 2 && clv.mean > 0;
  const clvBad = clv != null && clv.n >= 30 && clv.tStat <= -2;
  const skill = scores?.skillVsMarket ?? null;
  const roiNeg = roiCI != null && roiCI.hi < 0 && n >= 100;

  if (n >= 100 || (clv?.n ?? 0) >= 50) {
    level = "early";
    headline = "Indikasi awal — belum bisa dibedakan dari keberuntungan.";
  }
  if (clvBad || roiNeg || (skill != null && skill < -0.01 && (scores?.n ?? 0) >= 100)) {
    level = "refuted";
    headline = "Bukti menunjukkan model TIDAK mengalahkan pasar saat ini.";
  } else if (n >= 300 && clvSig && (skill == null || skill > 0)) {
    level = "supported";
    headline = "Edge didukung bukti: CLV positif signifikan dan model tidak kalah dari pasar.";
  }

  if (n < 100) reasons.push(`Hanya ${n} bet selesai; minimum praktis 100 untuk indikasi, 300+ untuk kesimpulan.`);
  if (clv == null) reasons.push("Belum ada data closing odds — CLV (metrik tercepat & paling andal) tidak dapat dihitung.");
  else if (clv.n < 30) reasons.push(`CLV baru ${clv.n} sampel (butuh ≥ 30 untuk uji t).`);
  else reasons.push(`CLV rata-rata ${(clv.mean * 100).toFixed(2)}% (t = ${clv.tStat.toFixed(2)}, n = ${clv.n}).`);
  if (skill != null) reasons.push(`Skill log-loss vs pasar: ${(skill * 100).toFixed(2)}% (${skill > 0 ? "model lebih baik" : "pasar lebih baik"}).`);
  if (roi != null && claimedEv != null) {
    reasons.push(`ROI aktual ${(roi * 100).toFixed(1)}% vs EV yang diklaim ${(claimedEv * 100).toFixed(1)}% — selisih ${((claimedEv - roi) * 100).toFixed(1)} poin menandakan ${claimedEv - roi > 0.05 ? "overestimasi probabilitas" : "kalibrasi wajar"}.`);
  }
  if (betsNeeded != null) reasons.push(`Untuk membuktikan EV klaim ${((claimedEv ?? 0) * 100).toFixed(1)}% via ROI saja dibutuhkan ≈ ${betsNeeded.toLocaleString("id-ID")} bet.`);

  return {
    nTotal: bets.length,
    nSettled: n,
    nDecisive: decisive.length,
    profit,
    staked,
    roi,
    roiCI,
    hitRate: decisive.length ? wins / decisive.length : null,
    avgOdds: bets.length ? mean(bets.map((b) => b.oddsTaken)) : null,
    avgClaimedEv: claimedEv,
    clv,
    scores,
    calibration,
    betsNeeded,
    verdict: { level, headline, reasons },
  };
}

/**
 * Circuit breaker staking. Bukan berdasarkan "5 hari terakhir menang/kalah"
 * (itu noise), melainkan CLV rolling: bila harga yang kita ambil secara
 * konsisten lebih buruk daripada harga penutupan, edge kemungkinan tidak ada.
 */
export function stakingMode(recentClv: number[], window = 50): {
  mode: "normal" | "reduced" | "paused";
  stakeMultiplier: number;
  reason: string;
} {
  const xs = recentClv.slice(-window);
  if (xs.length < 30) {
    return { mode: "reduced", stakeMultiplier: 0.5, reason: `CLV baru ${xs.length} sampel (< 30): staking dibatasi 50% sampai bukti cukup.` };
  }
  const m = mean(xs);
  const s = sd(xs);
  const t = s > 0 ? m / (s / Math.sqrt(xs.length)) : 0;
  if (m < 0 && t <= -1.5) return { mode: "paused", stakeMultiplier: 0, reason: `CLV ${window} bet terakhir ${(m * 100).toFixed(2)}% (t=${t.toFixed(2)}): jeda staking & audit model.` };
  if (m <= 0) return { mode: "reduced", stakeMultiplier: 0.5, reason: `CLV rolling ${(m * 100).toFixed(2)}% tidak positif: stake 50%.` };
  return { mode: "normal", stakeMultiplier: 1, reason: `CLV rolling ${(m * 100).toFixed(2)}% positif.` };
}
