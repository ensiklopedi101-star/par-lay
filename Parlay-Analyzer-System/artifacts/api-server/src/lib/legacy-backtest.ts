/**
 * Backtest replay untuk 63 prediksi lampau (WIN/LOSS) terhadap gerbang sistem
 * saat ini.
 *
 * BATAS KEJUJURAN — baca sebelum memakai angka apa pun dari modul ini:
 *
 * 1. Ini BUKAN menjalankan ulang model kuantitatif pada masa lalu. Snapshot
 *    statistik tim point-in-time tidak disimpan untuk prediksi lampau, dan
 *    statistik musim yang tersedia sekarang sudah memuat hasil pertandingan
 *    yang dinilai (look-ahead bias). Menjalankan ulang λ dari data sekarang
 *    akan menghasilkan angka yang terlihat ilmiah tetapi palsu.
 * 2. Yang diuji di sini adalah GERBANG KEPUTUSAN: bila seleksi lampau lahir
 *    hari ini, apakah kontrak data dan gerbang sistem sekarang akan
 *    meloloskannya? Probabilitas lampau direkonstruksi dari EV dan odds yang
 *    tersimpan (`p = (1 + EV) / odds`) — hanya sah untuk baris yang odds dan
 *    EV-nya nyata. Baris dengan odds 0 / EV 0 adalah placeholder warisan,
 *    bukan data, dan diklasifikasikan `insufficient_data`.
 * 3. Sampel yang dapat di-replay sangat kecil. Hasilnya adalah diagnosis
 *    kontrak data, bukan bukti keunggulan/kelemahan model.
 */

export interface LegacySample {
  predictionId: string;
  marketBet: string | null;
  outcome: "WIN" | "LOSS" | "HALF_WIN" | "HALF_LOSS" | "PUSH";
  /** Odds desimal tersimpan; 0/null berarti tidak pernah dicatat. */
  odds: number | null;
  /** EV persen tersimpan; 0 bersama odds 0 berarti placeholder. */
  evPercent: number | null;
  analysisAt?: string | null;
}

export type ReplayVerdict =
  | "kept_current"        // lolos kontrak + gerbang produksi saat ini
  | "kept_if_enforced"    // juga lolos bila gerbang kuantitatif di-enforce
  | "rejected_gate"       // data cukup, tetapi gerbang menolak
  | "insufficient_data";  // kontrak data sekarang tidak terpenuhi

export interface ReplayRow extends LegacySample {
  /** Probabilitas direkonstruksi dari EV & odds; null bila tidak sah. */
  reconstructedProbability: number | null;
  /** EV konservatif (p − σ) × odds − 1, sebagai pecahan. */
  conservativeEv: number | null;
  verdict: ReplayVerdict;
  reasons: string[];
}

export const REPLAY_SIGMA = 0.05;
export const REPLAY_MIN_EV_PERCENT = 3;

function isWin(outcome: LegacySample["outcome"]): boolean {
  return outcome === "WIN" || outcome === "HALF_WIN";
}

function netReturn(outcome: LegacySample["outcome"], odds: number): number {
  switch (outcome) {
    case "WIN": return odds - 1;
    case "HALF_WIN": return (odds - 1) / 2;
    case "HALF_LOSS": return -0.5;
    case "PUSH": return 0;
    case "LOSS": return -1;
  }
}

export function replayLegacySample(sample: LegacySample): ReplayRow {
  const reasons: string[] = [];
  const odds = sample.odds != null && Number.isFinite(sample.odds) ? Number(sample.odds) : null;
  const evPercent = sample.evPercent != null && Number.isFinite(sample.evPercent) ? Number(sample.evPercent) : null;

  if (!sample.marketBet) reasons.push("market tidak tercatat");
  if (odds == null || odds <= 1) reasons.push("odds tidak tercatat (0/kosong pada data warisan)");
  if (evPercent == null) reasons.push("EV tidak tercatat");

  if (reasons.length > 0 || odds == null || evPercent == null) {
    return { ...sample, reconstructedProbability: null, conservativeEv: null, verdict: "insufficient_data", reasons };
  }

  const p = (1 + evPercent / 100) / odds;
  if (!(p > 0 && p < 1)) {
    return {
      ...sample,
      reconstructedProbability: null,
      conservativeEv: null,
      verdict: "insufficient_data",
      reasons: ["probabilitas rekonstruksi di luar (0,1) — EV/odds warisan tidak konsisten"],
    };
  }

  const conservativeEv = (Math.max(0, p - REPLAY_SIGMA)) * odds - 1;

  /* Gerbang produksi saat ini: probabilitas eksplisit valid + odds
     terverifikasi + EV hasil hitung ulang > 0 (kebijakan belajar baseline
     tidak menambah ambang). Gerbang kuantitatif EV ≥ 3% dan EV konservatif
     > 0 masih shadow — diuji sebagai skenario `kept_if_enforced`. */
  if (evPercent <= 0) {
    return { ...sample, reconstructedProbability: p, conservativeEv, verdict: "rejected_gate", reasons: ["EV ≤ 0 pada hitung ulang"] };
  }
  if (evPercent >= REPLAY_MIN_EV_PERCENT && conservativeEv > 0) {
    return { ...sample, reconstructedProbability: p, conservativeEv, verdict: "kept_if_enforced", reasons: [] };
  }
  return {
    ...sample,
    reconstructedProbability: p,
    conservativeEv,
    verdict: "kept_current",
    reasons: [
      evPercent < REPLAY_MIN_EV_PERCENT ? "EV < 3% (akan ditolak bila gerbang kuantitatif di-enforce)" : null,
      conservativeEv <= 0 ? "EV konservatif ≤ 0 (akan ditolak bila gerbang kuantitatif di-enforce)" : null,
    ].filter((reason): reason is string => Boolean(reason)),
  };
}

export interface BacktestMetrics {
  n: number;
  wins: number;
  losses: number;
  hitRate: number | null;
  /** ROI per taruhan pada baris ber-odds sah; null bila tidak ada. */
  roiPerBet: number | null;
  roiSamples: number;
  brier: number | null;
  logLoss: number | null;
  probabilitySamples: number;
}

export function summarize(rows: ReplayRow[]): BacktestMetrics {
  const decisive = rows.filter((row) => row.outcome !== "PUSH");
  const wins = decisive.filter((row) => isWin(row.outcome)).length;
  const roiRows = rows.filter((row) => row.odds != null && row.odds > 1);
  const probRows = decisive.filter(
    (row) => row.reconstructedProbability != null && row.reconstructedProbability > 0 && row.reconstructedProbability < 1,
  );
  const clamp = (value: number) => Math.min(1 - 1e-9, Math.max(1e-9, value));
  return {
    n: rows.length,
    wins,
    losses: decisive.length - wins,
    hitRate: decisive.length ? wins / decisive.length : null,
    roiPerBet: roiRows.length
      ? roiRows.reduce((sum, row) => sum + netReturn(row.outcome, row.odds!), 0) / roiRows.length
      : null,
    roiSamples: roiRows.length,
    brier: probRows.length
      ? probRows.reduce((sum, row) => sum + (row.reconstructedProbability! - (isWin(row.outcome) ? 1 : 0)) ** 2, 0) / probRows.length
      : null,
    logLoss: probRows.length
      ? probRows.reduce((sum, row) => {
          const p = clamp(row.reconstructedProbability!);
          return sum - Math.log(isWin(row.outcome) ? p : 1 - p);
        }, 0) / probRows.length
      : null,
    probabilitySamples: probRows.length,
  };
}

export interface LegacyBacktestReport {
  total: number;
  legacyAll: BacktestMetrics;
  replayable: number;
  insufficientData: number;
  keptCurrent: BacktestMetrics;
  keptIfEnforced: BacktestMetrics;
  rejectedByGate: BacktestMetrics;
  rows: ReplayRow[];
}

export function buildLegacyBacktest(samples: LegacySample[]): LegacyBacktestReport {
  const rows = samples.map(replayLegacySample);
  const kept = rows.filter((row) => row.verdict === "kept_current" || row.verdict === "kept_if_enforced");
  return {
    total: rows.length,
    legacyAll: summarize(rows),
    replayable: rows.filter((row) => row.verdict !== "insufficient_data").length,
    insufficientData: rows.filter((row) => row.verdict === "insufficient_data").length,
    keptCurrent: summarize(kept),
    keptIfEnforced: summarize(rows.filter((row) => row.verdict === "kept_if_enforced")),
    rejectedByGate: summarize(rows.filter((row) => row.verdict === "rejected_gate")),
    rows,
  };
}
