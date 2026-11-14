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
  handicapOutcome,
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

/**
 * `findTeamStats` dapat mengembalikan baris datar ATAU bungkus dua musim:
 * `{ current_season, baseline_reference, _meta: "COMBINED" | "BASELINE_ONLY" }`.
 *
 * Bungkus itu dibuat ketika musim berjalan masih < 6 laga (atau belum ada),
 * dengan musim sebelumnya sebagai jangkar. Parser lama hanya membaca kolom
 * `stats_*` di level teratas, sehingga pada format terbungkus SEMUA rate
 * terbaca null dan λ diam-diam jatuh ke rata-rata/default liga — padahal
 * prompt LLM menerima statistiknya dan terlihat “dipakai”.
 *
 * Di sini bungkus dibuka secara eksplisit. Untuk COMBINED, baseline dipilih
 * sebagai sumber rate utama sesuai aturan jangkar musim sebelumnya; data
 * musim berjalan tetap tampil di prompt dan dapat memengaruhi narasi/λ LLM,
 * tetapi tidak boleh berpura-pura menjadi sampel besar untuk model skor.
 */
export function effectiveStatsRow(
  row: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!row) return null;
  const baseline = row["baseline_reference"];
  if (baseline && typeof baseline === "object" && !Array.isArray(baseline)) {
    return baseline as Record<string, unknown>;
  }
  const current = row["current_season"];
  if (current && typeof current === "object" && !Array.isArray(current)) {
    return current as Record<string, unknown>;
  }
  return row;
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
  const effective = effectiveStatsRow(row);
  const xg = block(effective, "stats_xg");
  const scored = block(effective, "stats_goals_scored");
  const conceded = block(effective, "stats_goals_conceded");
  const btts = block(effective, "stats_btts");
  const fts = block(effective, "stats_fts");
  const form = block(effective, "stats_team_form");
  const shots = block(effective, "stats_shots");
  const ht = block(effective, "stats_ht");

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
export interface LambdaParams {
  /** Bobot xG terhadap gol aktual (bawaan XG_WEIGHT). */
  xgWeight?: number;
  /** Kekuatan shrinkage dalam laga (bawaan SHRINK_MATCHES). */
  shrinkK?: number;
}

export function estimateLambdas(
  home: TeamRatesParsed,
  away: TeamRatesParsed,
  league: LeagueAverages = DEFAULT_LEAGUE,
  params: LambdaParams = {},
): LambdaEstimate {
  const xgWeight = params.xgWeight ?? XG_WEIGHT;
  const shrinkK = params.shrinkK ?? SHRINK_MATCHES;
  const teamAvg = Math.max(0.2, (league.homeGoals + league.awayGoals) / 2);
  const blend = (xg: number | null, actual: number | null, fallback: number) => {
    if (xg != null && actual != null) return xgWeight * xg + (1 - xgWeight) * actual;
    return xg ?? actual ?? fallback;
  };

  const attackHomeRatio = blend(home.xgFor, home.goalsForHome, home.goalsFor ?? teamAvg) / teamAvg;
  const defenseHomeRatio =
    blend(home.xgAgainst, home.goalsAgainstHome, home.goalsAgainst ?? teamAvg) / teamAvg;
  const attackAwayRatio = blend(away.xgFor, away.goalsForAway, away.goalsFor ?? teamAvg) / teamAvg;
  const defenseAwayRatio =
    blend(away.xgAgainst, away.goalsAgainstAway, away.goalsAgainst ?? teamAvg) / teamAvg;

  const attackHome = shrink(attackHomeRatio, home.matches, shrinkK);
  const defenseHome = shrink(defenseHomeRatio, home.matches, shrinkK);
  const attackAway = shrink(attackAwayRatio, away.matches, shrinkK);
  const defenseAway = shrink(defenseAwayRatio, away.matches, shrinkK);

  const n = Math.max(0, Math.min(home.matches ?? 0, away.matches ?? 0));
  return {
    lambdaHome: clamp(league.homeGoals * attackHome * defenseAway, 0.2, 4.5),
    lambdaAway: clamp(league.awayGoals * attackAway * defenseHome, 0.15, 4.0),
    reliability: n / (n + shrinkK),
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
   PROBABILITAS MODEL UNTUK SEBUAH SELEKSI
   ═══════════════════════════════════════════════════════════════ */

export type SelectionFamily = "ML" | "BTTS" | "Totals" | "AH" | "HT";

export interface SelectionModelProbability {
  probability: number | null;
  family: SelectionFamily | null;
  /** alasan bila probabilitas tidak tersedia — jangan pernah mengembalikan 0 diam-diam */
  note: string | null;
}

/**
 * Memetakan label market kanonik (keluaran `normalizeStructuredMarketSelection`)
 * ke probabilitas dari matriks skor yang sama.
 *
 * Label yang tidak dikenali menghasilkan `probability: null` dan catatan, bukan 0.
 * Angka 0 yang menyamar sebagai analisis adalah bug yang sedang diperbaiki di sini.
 */
export function modelProbabilityForSelection(
  matrix: ScoreMatrix,
  markets: MarketProbabilities,
  label: string | null | undefined,
): SelectionModelProbability {
  const text = String(label ?? "").trim();
  if (!text) return { probability: null, family: null, note: "Market tidak dipilih." };

  const lower = text.toLowerCase();
  if (lower === "home win") return { probability: markets.homeWin, family: "ML", note: null };
  if (lower === "away win") return { probability: markets.awayWin, family: "ML", note: null };
  if (lower === "draw") return { probability: markets.draw, family: "ML", note: null };
  if (lower === "btts yes") return { probability: markets.bttsYes, family: "BTTS", note: null };
  if (lower === "btts no") return { probability: markets.bttsNo, family: "BTTS", note: null };

  const totals = lower.match(/^(over|under)\s+(\d+(?:\.\d+)?)/);
  if (totals) {
    const side = totals[1] === "over" ? "over" : "under";
    const line = Number(totals[2]);
    if (!Number.isFinite(line)) {
      return { probability: null, family: "Totals", note: "Line totals tidak valid." };
    }
    return {
      probability: winShare(totalsOutcome(matrix, line, side)),
      family: "Totals",
      note: null,
    };
  }

  const handicap = lower.match(/^asian handicap\s+(home|away)\s+([+-]?\d+(?:\.\d+)?)/);
  if (handicap) {
    const side = handicap[1] === "home" ? "home" : "away";
    const line = Number(handicap[2]);
    if (!Number.isFinite(line)) {
      return { probability: null, family: "AH", note: "Line handicap tidak valid." };
    }
    return {
      probability: winShare(handicapOutcome(matrix, line, side)),
      family: "AH",
      note: null,
    };
  }

  if (lower.startsWith("ht ")) {
    return {
      probability: null,
      family: "HT",
      note: "Model gol saat ini tidak memodelkan babak pertama; HT tidak diberi probabilitas.",
    };
  }

  return {
    probability: null,
    family: null,
    note: `Label market "${text}" tidak dapat dipetakan ke matriks skor.`,
  };
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
  if (input.homeStats?.["_meta"] || input.awayStats?.["_meta"]) {
    dataGaps.push("Satu atau kedua tim memakai jangkar musim sebelumnya untuk model skor karena musim berjalan belum mencapai 6 laga; musim berjalan tetap ditampilkan terpisah di prompt.");
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
