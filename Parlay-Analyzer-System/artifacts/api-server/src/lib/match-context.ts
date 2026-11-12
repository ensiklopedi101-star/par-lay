/**
 * Lapisan fitur turunan (L2) untuk analisis pertandingan.
 *
 * MASALAH YANG DIPERBAIKI: `ai-analysis.ts` mengirim 11 blok JSON mentah per tim
 * ke LLM dan berharap model bahasa itu membandingkan sendiri. Akibatnya:
 *
 *  1. Tidak ada perbandingan — hanya dua daftar berdampingan.
 *  2. Split kandang/tandang (yang ada di blok gol, FTS, BTTS) tidak pernah
 *     dipakai, padahal justru itu yang membedakan "kekuatan tim" dari
 *     "kekuatan tim di kandang".
 *  3. `xG vs Actual` (residual penyelesaian) ada tetapi tidak ditafsirkan,
 *     sehingga overperform/underperform tidak pernah dipakai sebagai sinyal.
 *  4. Semua market dinilai terpisah, sehingga probabilitas Over 2.5, BTTS, dan
 *     1X2 bisa saling bertentangan. Di sini semuanya diturunkan dari SATU
 *     matriks skor, jadi koheren menurut definisi.
 *
 * Modul ini murni: tanpa jaringan, tanpa LLM, bisa diuji.
 */

import {
  bttsProb,
  matchResultProbs,
  scoreMatrix,
  totalsOutcome,
  winShare,
  type ScoreMatrix,
} from "./quant/poisson.js";
import type { LeagueAverages } from "./quant/strength.js";

/** Rata-rata liga bawaan bila tidak ada data liga; selalu ditandai di dataGaps. */
export const DEFAULT_LEAGUE: LeagueAverages = { homeGoals: 1.45, awayGoals: 1.15 };

/** Kekuatan shrinkage: n laga dibagi (n + K). K = 6 ≈ 6 laga sebelum 50% percaya data. */
export const SHRINK_MATCHES = 6;

/** Bobot xG terhadap gol aktual saat menaksir kekuatan. */
export const XG_WEIGHT = 0.6;

/* ═══════════════════════════════════════════════════════════════
   PARSING NILAI MENTAH
   ═══════════════════════════════════════════════════════════════ */

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

/**
 * Ambil angka pertama dari sebuah nilai mentah.
 * Contoh: "1.20 / match" → 1.2, "'+53%" → 53, "-0.54" → -0.54, 8 → 8.
 */
export function parseStatNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  /* Apostrof liar muncul di data nyata: "'+53%". */
  const cleaned = value.replace(/'/g, "");
  const match = cleaned.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Persentase → pecahan 0..1. "80%" → 0.8; "0.8" tetap 0.8. */
export function parsePercent(value: unknown): number | null {
  const raw = parseStatNumber(value);
  if (raw == null) return null;
  const isPercentText = typeof value === "string" && value.includes("%");
  const scaled = isPercentText || raw > 1 ? raw / 100 : raw;
  return clamp(scaled, 0, 1);
}

/** Per-match rate dari string seperti "0.40 / match" atau "1.7 Conceded / match". */
export function parseRate(value: unknown): number | null {
  const raw = parseStatNumber(value);
  if (raw == null) return null;
  return raw >= 0 && raw < 20 ? raw : null;
}

function block(row: Record<string, unknown> | null | undefined, key: string): Record<string, unknown> {
  const value = row?.[key];
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function pick(source: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (source[key] !== undefined && source[key] !== null) return source[key];
  }
  return undefined;
}

/* ═══════════════════════════════════════════════════════════════
   FITUR PER TIM
   ═══════════════════════════════════════════════════════════════ */

export interface TeamRatesParsed {
  matches: number | null;
  /** gol per laga, seluruh laga */
  goalsFor: number | null;
  goalsAgainst: number | null;
  /** split kandang/tandang — inti dari modul ini */
  goalsForHome: number | null;
  goalsForAway: number | null;
  goalsAgainstHome: number | null;
  goalsAgainstAway: number | null;
  xgFor: number | null;
  xgAgainst: number | null;
  xgResidual: number | null;
  btts: number | null;
  bttsHome: number | null;
  bttsAway: number | null;
  fts: number | null;
  ftsHome: number | null;
  shotsOver105: number | null;
  formPoints: number | null;
  formMatches: number | null;
  formPpg: number | null;
  last6: string | null;
  htWin: number | null;
}

export function parseTeamRates(row: Record<string, unknown> | null | undefined): TeamRatesParsed {
  const xg = block(row, "stats_xg");
  const scored = block(row, "stats_goals_scored");
  const conceded = block(row, "stats_goals_conceded");
  const btts = block(row, "stats_btts");
  const fts = block(row, "stats_fts");
  const form = block(row, "stats_team_form");
  const shots = block(row, "stats_shots");
  const ht = block(row, "stats_ht");

  const matches = parseStatNumber(pick(xg, ["MP"])) ?? parseStatNumber(pick(form, ["MP"]));

  return {
    matches,
    goalsFor: parseRate(pick(scored, ["Per Match", "per_match"])) ?? parseStatNumber(pick(xg, ["GF"])),
    goalsAgainst:
      parseRate(pick(conceded, ["Per Match", "per_match"])) ?? parseStatNumber(pick(xg, ["GA"])),
    goalsForHome: parseRate(pick(scored, ["Home", "home"])),
    goalsForAway: parseRate(pick(scored, ["Away", "away"])),
    goalsAgainstHome: parseRate(pick(conceded, ["Home", "home"])),
    goalsAgainstAway: parseRate(pick(conceded, ["Away", "away"])),
    xgFor: parseRate(pick(xg, ["xG", "XG"])),
    xgAgainst: parseRate(pick(xg, ["xGA"])),
    xgResidual: parseStatNumber(pick(xg, ["xG vs Actual", "xG vs actual"])),
    btts: parsePercent(pick(btts, ["BTTS %"])),
    bttsHome: parsePercent(pick(btts, ["Home %"])),
    bttsAway: parsePercent(pick(btts, ["Away %"])),
    fts: parsePercent(pick(fts, ["FTS %"])),
    ftsHome: parsePercent(pick(fts, ["Home %"])),
    shotsOver105: parsePercent(pick(shots, ["Over 10.5"])),
    formPoints: parseStatNumber(pick(form, ["Pts"])),
    formMatches: parseStatNumber(pick(form, ["MP"])),
    formPpg: parseStatNumber(pick(form, ["PPG"])),
    last6: typeof form["Last 6"] === "string" ? (form["Last 6"] as string) : null,
    htWin: parsePercent(pick(ht, ["Win %"])),
  };
}

/* ═══════════════════════════════════════════════════════════════
   λ (gol yang diharapkan) — split kandang/tandang + shrinkage
   ═══════════════════════════════════════════════════════════════ */

export interface LambdaEstimate {
  lambdaHome: number;
  lambdaAway: number;
  reliability: number;
  /** perbandingan terhadap rata-rata liga; 1.0 = rata-rata */
  attackHome: number;
  defenseHome: number;
  attackAway: number;
  defenseAway: number;
}

function shrink(ratio: number, matches: number | null, k = SHRINK_MATCHES): number {
  const n = matches && matches > 0 ? matches : 0;
  return (n * ratio + k * 1) / (n + k);
}

/**
 * λ dari kekuatan serang/bertahan **per venue**:
 *
 *   λ_home = liga_home × serang_kandang(home) × bertahan_tandang(away)
 *   λ_away = liga_away × serang_tandang(away) × bertahan_kandang(home)
 *
 * Ini berbeda dari `modelLambdas` di mesin kuant yang memakai rata-rata musim
 * untuk kedua sisi: di sini split kandang/tandang dipakai langsung, sesuai
 * temuan bahwa Sunderland mencetak 0.40 gol/laga di kandang tetapi 1.20 di
 * tandang — perbedaan yang hilang total bila hanya memakai rata-rata 0.80.
 */
export function estimateLambdas(
  home: TeamRatesParsed,
  away: TeamRatesParsed,
  league: LeagueAverages = DEFAULT_LEAGUE,
): LambdaEstimate {
  const teamAvg = Math.max(0.2, (league.homeGoals + league.awayGoals) / 2);
  const blend = (xg: number | null, actual: number | null, fallback: number) => {
    if (xg != null && actual != null) return XG_WEIGHT * xg + (1 - XG_WEIGHT) * actual;
    return xg ?? actual ?? fallback;
  };

  const attackHomeRatio = blend(home.xgFor, home.goalsForHome, home.goalsFor ?? teamAvg) / teamAvg;
  const defenseHomeRatio =
    blend(home.xgAgainst, home.goalsAgainstHome, home.goalsAgainst ?? teamAvg) / teamAvg;
  const attackAwayRatio = blend(away.xgFor, away.goalsForAway, away.goalsFor ?? teamAvg) / teamAvg;
  const defenseAwayRatio =
    blend(away.xgAgainst, away.goalsAgainstAway, away.goalsAgainst ?? teamAvg) / teamAvg;

  const attackHome = shrink(attackHomeRatio, home.matches);
  const defenseHome = shrink(defenseHomeRatio, home.matches);
  const attackAway = shrink(attackAwayRatio, away.matches);
  const defenseAway = shrink(defenseAwayRatio, away.matches);

  const n = Math.max(0, Math.min(home.matches ?? 0, away.matches ?? 0));
  return {
    lambdaHome: clamp(league.homeGoals * attackHome * defenseAway, 0.2, 4.5),
    lambdaAway: clamp(league.awayGoals * attackAway * defenseHome, 0.15, 4.0),
    reliability: n / (n + SHRINK_MATCHES),
    attackHome,
    defenseHome,
    attackAway,
    defenseAway,
  };
}

/* ═══════════════════════════════════════════════════════════════
   MARKET & KORELASI
   ═══════════════════════════════════════════════════════════════ */

type CellTest = (homeGoals: number, awayGoals: number) => boolean;

export function jointProbability(matrix: ScoreMatrix, tests: CellTest[]): number {
  let total = 0;
  for (let h = 0; h <= matrix.maxGoals; h += 1) {
    for (let a = 0; a <= matrix.maxGoals; a += 1) {
      if (tests.every((test) => test(h, a))) total += matrix.m[h]![a]!;
    }
  }
  return total;
}

export interface MarketProbabilities {
  homeWin: number;
  draw: number;
  awayWin: number;
  over25: number;
  under25: number;
  bttsYes: number;
  bttsNo: number;
  over15: number;
  over35: number;
  topScores: Array<{ score: string; p: number }>;
}

export function marketProbabilities(matrix: ScoreMatrix): MarketProbabilities {
  const result = matchResultProbs(matrix);
  const btts = bttsProb(matrix);
  const over25 = winShare(totalsOutcome(matrix, 2.5, "over"));
  const over15 = winShare(totalsOutcome(matrix, 1.5, "over"));
  const over35 = winShare(totalsOutcome(matrix, 3.5, "over"));
  const flat: Array<{ score: string; p: number }> = [];
  for (let h = 0; h <= 5; h += 1) {
    for (let a = 0; a <= 5; a += 1) flat.push({ score: `${h}-${a}`, p: matrix.m[h]![a]! });
  }
  return {
    homeWin: result.home,
    draw: result.draw,
    awayWin: result.away,
    over25,
    under25: 1 - over25,
    bttsYes: btts.yes,
    bttsNo: btts.no,
    over15,
    over35,
    topScores: flat.sort((x, y) => y.p - x.p).slice(0, 3),
  };
}

export interface CorrelationFinding {
  pair: string;
  joint: number;
  independent: number;
  /** joint / independent; > 1 berarti dua market cenderung terjadi bersama. */
  ratio: number;
  note: string;
}

/**
 * Korelasi antar-market dihitung dari matriks skor yang sama, bukan diasumsikan.
 * Inilah alasan dua leg dari satu pertandingan tidak boleh dikalikan biasa:
 * P(Over 2.5) × P(BTTS) selalu lebih kecil daripada kenyataannya.
 */
export function correlationFindings(matrix: ScoreMatrix): CorrelationFinding[] {
  const m = marketProbabilities(matrix);
  const over25: CellTest = (h, a) => h + a > 2.5;
  const btts: CellTest = (h, a) => h > 0 && a > 0;
  const homeWin: CellTest = (h, a) => h > a;
  const under25: CellTest = (h, a) => h + a < 2.5;

  const pairs: Array<{ pair: string; tests: CellTest[]; p1: number; p2: number; note: string }> = [
    {
      pair: "Over 2.5 + BTTS",
      tests: [over25, btts],
      p1: m.over25,
      p2: m.bttsYes,
      note: "dua market paling sering digabung; perkalian biasa melebihkan risiko",
    },
    {
      pair: "Tuan rumah menang + Over 2.5",
      tests: [homeWin, over25],
      p1: m.homeWin,
      p2: m.over25,
      note: "kemenangan besar biasanya menghasilkan banyak gol",
    },
    {
      pair: "BTTS + Tuan rumah menang",
      tests: [btts, homeWin],
      p1: m.bttsYes,
      p2: m.homeWin,
      note: "tuan rumah menang sambil kebobolan tetap very mungkin",
    },
    {
      pair: "Under 2.5 + BTTS No",
      tests: [under25, (h, a) => h === 0 || a === 0],
      p1: m.under25,
      p2: m.bttsNo,
      note: "pola khas laga tertutup; korelasinya positif",
    },
  ];

  return pairs.map(({ pair, tests, p1, p2, note }) => {
    const joint = jointProbability(matrix, tests);
    const independent = p1 * p2;
    return {
      pair,
      joint,
      independent,
      ratio: independent > 0 ? joint / independent : 0,
      note,
    };
  });
}

/* ═══════════════════════════════════════════════════════════════
   KONTEKS LENGKAP
   ═══════════════════════════════════════════════════════════════ */

export interface MatchContextInput {
  homeTeam: string;
  awayTeam: string;
  homeStats: Record<string, unknown> | null | undefined;
  awayStats: Record<string, unknown> | null | undefined;
  league?: LeagueAverages | null;
  /** sisa hari sejak laga terakhir, bila diketahui */
  restDays?: { home: number | null; away: number | null };
  /** posisi klasemen, bila tersedia */
  standings?: {
    home?: { position: number | null; points: number | null } | null;
    away?: { position: number | null; points: number | null } | null;
  };
}

export interface MatchContext {
  home: TeamRatesParsed;
  away: TeamRatesParsed;
  league: LeagueAverages;
  leagueIsDefault: boolean;
  lambdas: LambdaEstimate;
  matrix: ScoreMatrix;
  markets: MarketProbabilities;
  signals: string[];
  correlation: CorrelationFinding[];
  dataGaps: string[];
}

const pct = (value: number) => `${(value * 100).toFixed(1)}%`;
const num = (value: number) => value.toFixed(2);

export function buildMatchContext(input: MatchContextInput): MatchContext {
  const home = parseTeamRates(input.homeStats);
  const away = parseTeamRates(input.awayStats);
  const leagueIsDefault = !input.league;
  const league = input.league ?? DEFAULT_LEAGUE;
  const lambdas = estimateLambdas(home, away, league);
  const matrix = scoreMatrix(lambdas.lambdaHome, lambdas.lambdaAway);
  const markets = marketProbabilities(matrix);
  const correlation = correlationFindings(matrix);
  const dataGaps: string[] = [];
  const signals: string[] = [];

  if (leagueIsDefault) {
    dataGaps.push("Rata-rata gol liga tidak tersedia; dipakai default 1.45/1.15.");
  }
  if (home.matches == null || away.matches == null) {
    dataGaps.push("Jumlah laga musim berjalan tidak terbaca; kekuatan tim tidak bisa di-shrink.");
  }
  if (home.xgFor == null || away.xgFor == null) {
    dataGaps.push("xG tidak lengkap; kekuatan dihitung dari gol aktual (lebih bising).");
  }
  if (home.goalsForHome == null || away.goalsForAway == null) {
    dataGaps.push("Split kandang/tandang tidak tersedia; λ memakai rata-rata musim.");
  }

  signals.push(
    `λ model: ${num(lambdas.lambdaHome)} – ${num(lambdas.lambdaAway)} ` +
      `(keandalan data ${pct(lambdas.reliability)}).`,
  );
  signals.push(
    `Serang kandang ${input.homeTeam} = ${num(lambdas.attackHome)}× rata-rata liga; ` +
      `bertahan tandang ${input.awayTeam} = ${num(lambdas.defenseAway)}× rata-rata.`,
  );
  signals.push(
    `Serang tandang ${input.awayTeam} = ${num(lambdas.attackAway)}×; ` +
      `bertahan kandang ${input.homeTeam} = ${num(lambdas.defenseHome)}×.`,
  );

  /* Split venue: sinyal paling sering hilang pada sistem lama. */
  if (home.goalsForHome != null && home.goalsForAway != null) {
    const gap = home.goalsForHome - home.goalsForAway;
    signals.push(
      `Split ${input.homeTeam}: ${num(home.goalsForHome)} gol/laga di kandang vs ` +
        `${num(home.goalsForAway)} di tandang (selisih ${num(gap)}).`,
    );
  }
  if (away.goalsAgainstHome != null && away.goalsAgainstAway != null) {
    signals.push(
      `Kebobolan ${input.awayTeam}: ${num(away.goalsAgainstHome)} di kandang vs ` +
        `${num(away.goalsAgainstAway)} di tandang.`,
    );
  }
  if (home.bttsHome != null && away.bttsAway != null) {
    signals.push(
      `BTTS: ${input.homeTeam} ${pct(home.bttsHome)} di kandang, ` +
        `${input.awayTeam} ${pct(away.bttsAway)} di tandang.`,
    );
  }

  /* Residual xG = overperform/underperform yang biasanya regresi. */
  for (const [name, rates] of [
    [input.homeTeam, home],
    [input.awayTeam, away],
  ] as const) {
    if (rates.xgResidual != null && Math.abs(rates.xgResidual) >= 0.3) {
      const arah = rates.xgResidual > 0 ? "di atas" : "di bawah";
      const implikasi = rates.xgResidual > 0 ? "waspadai penurunan" : "potensi kenaikan";
      signals.push(
        `Residual xG ${name}: ${num(rates.xgResidual)} gol ${arah} xG — ${implikasi} ` +
          `(penyelesaian belum berkelanjutan).`,
      );
    }
  }

  if (home.formPpg != null && away.formPpg != null) {
    signals.push(
      `Form: ${input.homeTeam} ${num(home.formPpg)} PPG, ${input.awayTeam} ${num(away.formPpg)} PPG` +
        `${home.last6 ? ` (home: ${home.last6})` : ""}.`,
    );
  }

  if (input.restDays) {
    const { home: restH, away: restA } = input.restDays;
    if (restH != null && restA != null) {
      const diff = restH - restA;
      signals.push(
        `Istirahat: ${input.homeTeam} ${restH} hari, ${input.awayTeam} ${restA} hari` +
          `${Math.abs(diff) >= 2 ? ` (selisih ${Math.abs(diff)} hari)` : ""}.`,
      );
    } else if (restH != null || restA != null) {
      signals.push(`Istirahat: home ${restH ?? "?"} hari, away ${restA ?? "?"} hari.`);
    }
  }

  if (input.standings?.home?.position != null && input.standings?.away?.position != null) {
    signals.push(
      `Klasemen: ${input.homeTeam} #${input.standings.home.position}, ` +
        `${input.awayTeam} #${input.standings.away.position}.`,
    );
  }

  return {
    home,
    away,
    league,
    leagueIsDefault,
    lambdas,
    matrix,
    markets,
    signals,
    correlation,
    dataGaps,
  };
}

/** Blok teks ringkas untuk prompt: yang dibandingkan, bukan yang didaftar. */
export function formatMatchContextBlock(ctx: MatchContext, homeTeam: string, awayTeam: string): string {
  const m = ctx.markets;
  const lines: string[] = [];
  lines.push("");
  lines.push("--- MODEL PERTANDINGAN (dihitung kode, bukan opini) ---");
  lines.push(
    `Probabilitas turunan: 1X2 ${pct(m.homeWin)} / ${pct(m.draw)} / ${pct(m.awayWin)} | ` +
      `Over 2.5 ${pct(m.over25)} | BTTS ${pct(m.bttsYes)}`,
  );
  lines.push(
    `Skor paling mungkin: ${m.topScores.map((s) => `${s.score} (${pct(s.p)})`).join(", ")}`,
  );
  lines.push(`Sinyal:`);
  for (const signal of ctx.signals) lines.push(`  • ${signal}`);

  const related = ctx.correlation
    .filter((item) => item.ratio >= 1.15)
    .sort((a, b) => b.ratio - a.ratio)
    .slice(0, 3);
  if (related.length > 0) {
    lines.push("Korelasi market (joint vs perkalian independen):");
    for (const item of related) {
      lines.push(
        `  • ${item.pair}: ${pct(item.joint)} vs ${pct(item.independent)} ` +
          `(${item.ratio.toFixed(2)}×) — jangan perlakukan sebagai dua taruhan terpisah.`,
      );
    }
  }

  if (ctx.dataGaps.length > 0) {
    lines.push(`Data hilang: ${ctx.dataGaps.join(" ")}`);
  }
  lines.push(
    "ATURAN: gunakan angka di atas sebagai dasar; jangan menghitung ulang probabilitas sendiri. " +
      "Pertimbangkan konteks (berita, motivasi, jadwal) sebagai penyesuaian kecil, bukan pengganti.",
  );
  return lines.join("\n");
}
