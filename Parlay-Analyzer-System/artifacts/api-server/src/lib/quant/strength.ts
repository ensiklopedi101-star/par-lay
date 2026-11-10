/**
 * Kekuatan tim → λ gol yang diharapkan.
 *
 * KELEMAHAN YANG DIPERBAIKI:
 *  1. Aturan lama "musim berjalan < 6 laga → pakai musim lalu, ≥ 6 → pakai
 *     musim berjalan penuh" adalah tebing keras. Pada laga ke-6 sampel hanya
 *     6 data, noise-nya sangat besar (contoh nyata di repo: Beijing Guoan
 *     MP=6, FTS 0%). Diganti shrinkage Bayesian: bobot data musim berjalan
 *     = n / (n + K), meningkat mulus.
 *  2. xG dan gol aktual dicampur (xG lebih prediktif daripada gol mentah).
 *  3. Statistik dinormalisasi terhadap rata-rata liga, sehingga lawan dan
 *     keunggulan kandang ikut dihitung (statistik persen mentah tidak
 *     menyesuaikan kekuatan lawan).
 */

export interface TeamRates {
  /** jumlah laga pada sampel musim berjalan */
  matches: number;
  /** gol dicetak per laga */
  goalsFor: number;
  /** gol kebobolan per laga */
  goalsAgainst: number;
  /** xG per laga (opsional) */
  xgFor?: number | null;
  /** xGA per laga (opsional) */
  xgAgainst?: number | null;
  /**
   * Prior dari musim lalu SUDAH dalam rasio terhadap rata-rata liga
   * (1.0 = rata-rata). Jika kosong, prior = 1.0 (rata-rata liga).
   */
  priorAttack?: number | null;
  priorDefense?: number | null;
}

export interface LeagueAverages {
  /** rata-rata gol tuan rumah per laga di liga */
  homeGoals: number;
  /** rata-rata gol tamu per laga di liga */
  awayGoals: number;
}

export interface StrengthOptions {
  /** kekuatan prior dalam satuan "laga setara" */
  priorStrength?: number;
  /** bobot xG terhadap gol aktual */
  xgWeight?: number;
}

export interface ModelLambdas {
  lambdaHome: number;
  lambdaAway: number;
  /** 0..1 — seberapa besar data cukup untuk dipercaya; dasar bobot blend */
  reliability: number;
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

function shrunkRatio(
  observedPerMatch: number,
  xgPerMatch: number | null | undefined,
  leagueTeamAvg: number,
  n: number,
  prior: number,
  K: number,
  xgWeight: number,
): number {
  const blended =
    xgPerMatch != null && Number.isFinite(xgPerMatch)
      ? xgWeight * xgPerMatch + (1 - xgWeight) * observedPerMatch
      : observedPerMatch;
  const ratio = blended / Math.max(0.2, leagueTeamAvg);
  return (n * ratio + K * prior) / (n + K);
}

export function modelLambdas(
  home: TeamRates,
  away: TeamRates,
  league: LeagueAverages,
  opts: StrengthOptions = {},
): ModelLambdas {
  const K = opts.priorStrength ?? 8;
  const xgW = opts.xgWeight ?? 0.6;
  const teamAvg = (league.homeGoals + league.awayGoals) / 2;

  const atkH = shrunkRatio(home.goalsFor, home.xgFor, teamAvg, home.matches, home.priorAttack ?? 1, K, xgW);
  const defH = shrunkRatio(home.goalsAgainst, home.xgAgainst, teamAvg, home.matches, home.priorDefense ?? 1, K, xgW);
  const atkA = shrunkRatio(away.goalsFor, away.xgFor, teamAvg, away.matches, away.priorAttack ?? 1, K, xgW);
  const defA = shrunkRatio(away.goalsAgainst, away.xgAgainst, teamAvg, away.matches, away.priorDefense ?? 1, K, xgW);

  const minN = Math.max(0, Math.min(home.matches, away.matches));
  return {
    lambdaHome: clamp(league.homeGoals * atkH * defA, 0.2, 4.5),
    lambdaAway: clamp(league.awayGoals * atkA * defH, 0.15, 4.0),
    reliability: minN / (minN + K),
  };
}

/**
 * Batas penyesuaian kualitatif dari LLM (cedera, line-up, rotasi). LLM tidak
 * boleh menghasilkan probabilitas; ia hanya boleh menggeser λ dalam rentang
 * sempit dan WAJIB menyertakan bukti. Tanpa bukti → multiplier dipaksa 1.0.
 */
export const MAX_LLM_LAMBDA_ADJUST = 0.12;

export interface LlmAdjustment {
  lambdaHomeMult: number;
  lambdaAwayMult: number;
  evidence: Array<{ type: string; detail: string; sourceUrl?: string }>;
}

export function sanitizeLlmAdjustment(raw: unknown): LlmAdjustment {
  const neutral: LlmAdjustment = { lambdaHomeMult: 1, lambdaAwayMult: 1, evidence: [] };
  if (!raw || typeof raw !== "object") return neutral;
  const r = raw as Record<string, unknown>;
  const evidence = Array.isArray(r.evidence)
    ? r.evidence
        .filter((e): e is Record<string, unknown> => !!e && typeof e === "object")
        .map((e) => ({
          type: String(e.type ?? "other"),
          detail: String(e.detail ?? "").slice(0, 300),
          sourceUrl: typeof e.source_url === "string" ? e.source_url : typeof e.sourceUrl === "string" ? e.sourceUrl : undefined,
        }))
        .filter((e) => e.detail.length >= 10)
    : [];
  if (evidence.length === 0) return neutral;
  const lo = 1 - MAX_LLM_LAMBDA_ADJUST;
  const hi = 1 + MAX_LLM_LAMBDA_ADJUST;
  const h = Number(r.lambda_home_mult ?? r.lambdaHomeMult);
  const a = Number(r.lambda_away_mult ?? r.lambdaAwayMult);
  return {
    lambdaHomeMult: Number.isFinite(h) ? clamp(h, lo, hi) : 1,
    lambdaAwayMult: Number.isFinite(a) ? clamp(a, lo, hi) : 1,
    evidence,
  };
}
