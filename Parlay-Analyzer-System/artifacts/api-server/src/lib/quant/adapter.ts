/**
 * Adapter: Supabase rows → input for the deterministic quant engine.
 *
 * The database is messier than the engine's contract assumes, so every value
 * that crosses this boundary is validated and either coerced or rejected. The
 * engine itself must never see `NaN`, a missing block, or a team that appears
 * twice with different numbers.
 *
 * What the live data actually looks like (audited 2026-11-09, 301 rows):
 *   • exactly one of `stats_goals_scored` / `stats_goals_conceded` is normally
 *     populated; 83 rows (28%) have both blocks identical and 76 (25%) have the
 *     scored block null, so neither may be assumed present;
 *   • values are STRINGS with units mixed in: "1.84 / match", "36", "+2%";
 *   • team names are duplicated with different spellings ("Espanyol" vs
 *     "Espanyol Barcelona"), sometimes with different numbers;
 *   • some rows are attributed to the wrong league entirely (Real Madrid in
 *     england-premier-league).
 *
 * Everything this file cannot defend against is recorded in `warnings` and
 * surfaces as `rejected` — the caller decides whether to shadow-log anyway.
 */

import type { MatchInput, OfferedAH, OfferedTotals } from "./pipeline";
import type { LeagueAverages, TeamRates } from "./strength";
import { analyzeMatch, type MatchAnalysis } from "./pipeline";
import type { LlmAdjustment } from "./strength";

/* ── String → number ─────────────────────────────────────────────── */

/**
 * Parse a numeric value that may be wrapped in text ("1.84 / match",
 * "36", "+2%", "1,05"). Returns null for anything that is not a real number.
 */
export function parseStatNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const cleaned = value
    .replace(/['"`]/g, "")
    .replace(/,/g, ".")
    .match(/-?\d+(?:\.\d+)?/);
  if (!cleaned) return null;
  const n = Number(cleaned[0]);
  return Number.isFinite(n) ? n : null;
}

/* ── Team stats → TeamRates ──────────────────────────────────────── */

export interface TeamStatsRow {
  team_name?: string | null;
  league_slug?: string | null;
  season?: string | null;
  stats_goals_scored?: Record<string, unknown> | null;
  stats_goals_conceded?: Record<string, unknown> | null;
  stats_xg?: Record<string, unknown> | null;
}

export interface TeamRatesResult {
  rates: TeamRates | null;
  warnings: string[];
}

/**
 * Extractor for goals scored per match, preferring the overall rate and
 * falling back to home/away. The live data labels the overall rate
 * "Per Match" with a trailing description ("1.05 Conceded / match").
 */
function perMatch(block: Record<string, unknown> | null | undefined): number | null {
  if (!block) return null;
  return (
    parseStatNumber(block["Per Match"]) ??
    parseStatNumber(block["Goals Scored"]) ??
    parseStatNumber(block["Goals Conceded"])
  );
}

/**
 * Convert a `team_season_stats` row into engine-ready rates.
 *
 * `goalsFor` comes from `stats_goals_scored`, `goalsAgainst` from
 * `stats_goals_conceded`. When a block is missing we try the other one only if
 * its label matches, because the two columns are occasionally cross-filled —
 * silently substituting would invert the team's attack/defence strength, which
 * is worse than refusing to produce numbers.
 */
export function toTeamRates(row: TeamStatsRow | null | undefined): TeamRatesResult {
  const warnings: string[] = [];
  if (!row) {
    return { rates: null, warnings: ["statistik tim tidak ditemukan"] };
  }

  const scored = row.stats_goals_scored ?? null;
  const conceded = row.stats_goals_conceded ?? null;

  const matches =
    parseStatNumber(scored?.["MP"]) ??
    parseStatNumber(conceded?.["MP"]) ??
    0;

  let goalsFor = perMatch(scored);
  let goalsAgainst = perMatch(conceded);

  if (goalsFor != null && scored?.["Per Match"] != null &&
      String(scored["Per Match"]).toLowerCase().includes("conceded")) {
    warnings.push("blok stats_goals_scored berlabel 'Conceded' — nilai menyerang diabaikan");
    goalsFor = null;
  }
  if (goalsAgainst != null && conceded?.["Per Match"] != null &&
      String(conceded["Per Match"]).toLowerCase().includes("scored")) {
    warnings.push("blok stats_goals_conceded berlabel 'Scored' — nilai bertahan diabaikan");
    goalsAgainst = null;
  }

  if (goalsFor == null) warnings.push("gol dicetak per laga tidak tersedia");
  if (goalsAgainst == null) warnings.push("gol kebobolan per laga tidak tersedia");
  if (matches <= 0) warnings.push("jumlah laga (MP) tidak tersedia");

  const rates: TeamRates = {
    matches,
    goalsFor: goalsFor ?? 0,
    goalsAgainst: goalsAgainst ?? 0,
    xgFor: parseStatNumber(row.stats_xg?.["xG"]),
    xgAgainst: parseStatNumber(row.stats_xg?.["xGA"]),
    priorAttack: null,
    priorDefense: null,
  };

  /* A team with no usable rate cannot be modelled; refuse rather than feed 0. */
  const usable = goalsFor != null && goalsAgainst != null && matches > 0;
  return { rates: usable ? rates : null, warnings };
}

/* ── Duplicate team detection ────────────────────────────────────── */

const CLUB_NOISE = /\b(fc|cf|ud|sc|ac|as|ss|ssc|cd|rc|afc|club|de|futbol|calcio|sad|sd)\b/g;

/** Loose comparison key: lowercase, strip accents, punctuation and suffixes. */
export function teamKey(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(CLUB_NOISE, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * True when two spellings plausibly name the same club.
 *
 * The live data contains pairs like "Espanyol" / "Espanyol Barcelona" and
 * "Real Betis" / "Real Betis Seville": the longer form keeps the city, which no
 * suffix list can enumerate. Matching on token *prefix* (all tokens of the
 * shorter name appear first, in order, in the longer one) covers those without
 * merging genuinely different clubs — "Manchester United" and "Manchester City"
 * share a prefix but not a full token sequence.
 */
export function sameTeamName(a: string, b: string): boolean {
  const ka = teamKey(a);
  const kb = teamKey(b);
  if (!ka || !kb) return false;
  if (ka === kb) return true;
  const ta = ka.split(" ");
  const tb = kb.split(" ");
  const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  /* Require at least one distinctive token and an exact leading match. */
  return short.length >= 1 && short.every((t, i) => long[i] === t);
}

export interface DuplicateGroup {
  key: string;
  rows: Array<{ teamName: string; matches: number }>;
  conflicting: boolean;
}

/**
 * Find teams that appear more than once under different spellings. When the
 * duplicates disagree on goals per match we flag `conflicting`, because picking
 * one at random changes the prediction.
 */
export function findDuplicateTeams(rows: TeamStatsRow[]): DuplicateGroup[] {
  const entries = rows
    .map((row) => {
      const teamName = String(row.team_name ?? "").trim();
      const { rates } = toTeamRates(row);
      return { teamName, rate: rates?.goalsFor ?? null, matches: rates?.matches ?? 0 };
    })
    .filter((e) => e.teamName.length > 0);

  const clusters: Array<typeof entries> = [];
  for (const entry of entries) {
    const cluster = clusters.find((c) => sameTeamName(c[0]!.teamName, entry.teamName));
    if (cluster) cluster.push(entry);
    else clusters.push([entry]);
  }

  const out: DuplicateGroup[] = [];
  for (const cluster of clusters) {
    if (cluster.length < 2) continue;
    const rates = cluster.map((r) => r.rate).filter((r): r is number => r != null);
    const conflicting = rates.length >= 2 && Math.max(...rates) - Math.min(...rates) > 0.05;
    out.push({
      key: teamKey(cluster[0]!.teamName),
      rows: cluster.map(({ teamName, matches }) => ({ teamName, matches })),
      conflicting,
    });
  }
  return out;
}

/** Pick the spelling with the longest sample; tie-break on the shortest name. */
export function preferCanonicalRow<T extends TeamStatsRow>(rows: T[]): T | null {
  if (rows.length === 0) return null;
  return [...rows].sort((a, b) => {
    const ma = toTeamRates(a).rates?.matches ?? 0;
    const mb = toTeamRates(b).rates?.matches ?? 0;
    if (mb !== ma) return mb - ma;
    return String(a.team_name ?? "").length - String(b.team_name ?? "").length;
  })[0]!;
}

/**
 * Resolve a team's row from the league slice, tolerating the known duplicate
 * names. Returns null when the team is absent or every candidate is unusable.
 */
export function resolveTeamRow(
  rows: TeamStatsRow[],
  teamName: string,
): { row: TeamStatsRow | null; warnings: string[] } {
  const warnings: string[] = [];
  const candidates = rows.filter((r) => sameTeamName(String(r.team_name ?? ""), teamName));

  if (candidates.length === 0) {
    return { row: null, warnings: [`tim "${teamName}" tidak ada di data liga`] };
  }
  if (candidates.length > 1) {
    const names = candidates.map((r) => String(r.team_name)).join(" / ");
    warnings.push(`tim "${teamName}" punya ${candidates.length} entri (${names}); dipakai sampel terbesar`);
    const group = findDuplicateTeams(candidates)[0];
    if (group?.conflicting) {
      warnings.push(`entri duplikat untuk "${teamName}" saling bertentangan — hasil model tidak dapat dipercaya`);
    }
  }
  const chosen = preferCanonicalRow(candidates);
  return { row: chosen, warnings };
}

/* ── League averages ─────────────────────────────────────────────── */

export const MIN_TEAMS_FOR_LEAGUE_AVERAGE = 8;

/**
 * League home/away goals per match, derived from the teams in the slice.
 *
 * The host mean is the average of each team's home scoring rate and the guest
 * mean the average of their away scoring rate — NOT the average of both, which
 * would erase home advantage. The live `fixtures` table cannot be used for
 * this: only a handful of rows carry a final score.
 */
export function computeLeagueAverages(
  rows: TeamStatsRow[],
): { averages: LeagueAverages | null; teamsUsed: number; warnings: string[] } {
  const warnings: string[] = [];
  const home: number[] = [];
  const away: number[] = [];

  for (const row of rows) {
    /* Only the scored block carries per-venue rates. */
    const block = row.stats_goals_scored;
    const h = parseStatNumber(block?.["Home"]);
    const a = parseStatNumber(block?.["Away"]);
    if (h != null && h > 0) home.push(h);
    if (a != null && a > 0) away.push(a);
  }

  const teamsUsed = Math.min(home.length, away.length);
  if (teamsUsed < MIN_TEAMS_FOR_LEAGUE_AVERAGE) {
    warnings.push(
      `hanya ${teamsUsed} tim punya rate home/away yang valid (minimum ${MIN_TEAMS_FOR_LEAGUE_AVERAGE})`,
    );
    return { averages: null, teamsUsed, warnings };
  }

  const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
  const homeGoals = mean(home);
  const awayGoals = mean(away);

  /* Sanity: a league where the away mean exceeds the home mean by >25% almost
     always means the columns are swapped or the slice mixes incompatible
     seasons. Refuse rather than model a league that does not exist. */
  if (awayGoals > homeGoals * 1.25) {
    warnings.push(
      `rata-rata gol tandang (${awayGoals.toFixed(2)}) melebihi tuan rumah (${homeGoals.toFixed(2)}) — kemungkinan kolom tertukar`,
    );
    return { averages: null, teamsUsed, warnings };
  }

  return {
    averages: {
      homeGoals: Math.round(homeGoals * 1000) / 1000,
      awayGoals: Math.round(awayGoals * 1000) / 1000,
    },
    teamsUsed,
    warnings,
  };
}

/* ── Odds → engine input ─────────────────────────────────────────── */

export interface MarketOddsRow {
  bookmaker: string;
  capturedAt?: string | null;
  home?: number;
  draw?: number;
  away?: number;
  over?: number;
  under?: number;
  line?: number;
  yes?: number;
  no?: number;
}

export interface StructuredOddsInput {
  matchWinner: MarketOddsRow[];
  overUnder: MarketOddsRow[];
  asianHandicap: MarketOddsRow[];
  btts: MarketOddsRow[];
}

export interface OddsInputResult {
  odds1x2: { home: number; draw: number; away: number } | null;
  totals: OfferedTotals[];
  ah: OfferedAH[];
  btts: { yes: number; no: number } | null;
  bookmaker: string | null;
  /** Bandar sumber per keluarga pasar; berbeda dari bookmaker utama bila fallback per-pasar dipakai. */
  sources: { ML: string | null; Totals: string | null; AH: string | null; BTTS: string | null };
  warnings: string[];
}

const validOdds = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x) && x > 1;

/**
 * Pick ONE bookmaker for the whole fixture instead of mixing best prices from
 * several. Mixing bookmakers produces a synthetic market that does not exist
 * anywhere, and de-vigging it yields a "fair" probability that is too generous
 * (that is how arbitrage-looking EV appears out of nothing).
 */
/** Urutan bookmaker eksekusi: M88 adalah proksi Saba (aplikasi yang
 * benar-benar dipakai pemilik sistem) — pasar Asia-nya main-line dan
 * mirip Saba. 1xbet (tangga line lengkap) hanya cadangan analisis,
 * bukan sumber rekomendasi. Bisa diganti lewat EXECUTION_BOOKMAKER. */
export function executionBookmakerPreference(): string[] {
  const primary = (process.env["EXECUTION_BOOKMAKER"] ?? "M88").trim();
  return [primary, "1xbet"].filter((b, i, a) => b.length > 0 && a.indexOf(b) === i);
}

export function buildOddsInput(
  structured: StructuredOddsInput,
  preferred: string[] = executionBookmakerPreference(),
): OddsInputResult {
  const warnings: string[] = [];
  const counts = new Map<string, number>();
  for (const m of structured.matchWinner) {
    if (validOdds(m.home) && validOdds(m.draw) && validOdds(m.away)) {
      counts.set(m.bookmaker, (counts.get(m.bookmaker) ?? 0) + 1);
    }
  }
  /* Bookmaker eksekusi yang punya 1X2 lengkap selalu menang atas
   * kelengkapan mentah: rekomendasi wajib bisa dipasang di aplikasi
   * pemilik sistem (temuan Norwich-Cardiff, 15 Nov 2026: leg
   * AH +1.75 @1.289 berasal dari tangga 1xbet yang tidak ada di Saba,
   * sementara M88 hanya menawarkan line utama Spread -0.75). */
  const preferredBook = preferred.find((b) => counts.has(b));
  const bookmaker =
    preferredBook ??
    [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ??
    structured.matchWinner[0]?.bookmaker ??
    null;
  if (preferredBook && preferredBook !== preferred[0]) {
    warnings.push(`bookmaker eksekusi ${preferred[0]} tidak menyediakan 1X2 lengkap — memakai ${preferredBook} (periksa ketersediaan di aplikasi Anda)`);
  } else if (!preferredBook && bookmaker) {
    warnings.push(`bookmaker eksekusi ${preferred[0]} tidak tersedia — memakai ${bookmaker} (periksa ketersediaan di aplikasi Anda)`);
  }

  if (!bookmaker) {
    return { odds1x2: null, totals: [], ah: [], btts: null, bookmaker: null, sources: { ML: null, Totals: null, AH: null, BTTS: null }, warnings: ["tidak ada odds 1X2 dari bookmaker mana pun"] };
  }

  const pick = <T extends MarketOddsRow>(rows: T[]) => rows.filter((r) => r.bookmaker === bookmaker);
  /* Fallback PER-PASAR (keputusan pemilik sistem, 17 Nov 2026): pasar
   * yang tidak disediakan bandar eksekusi (mis. BTTS di M88) boleh
   * dipinjam utuh dari bandar cadangan — pasangan odds-nya tetap dari
   * satu bandar sehingga de-vig pasar itu sah. Pemilik memakai pasar
   * sebagai patokan dan mencocokkan odds di aplikasinya (Saba). */
  const fallbackBook = preferred.find((b) => b !== bookmaker)
    ?? [...counts.keys()].find((b) => b !== bookmaker)
    ?? null;
  const pickWithFallback = <T extends MarketOddsRow>(rows: T[]): { rows: T[]; source: string | null } => {
    const own = pick(rows);
    if (own.length > 0 || !fallbackBook) return { rows: own, source: own.length > 0 ? bookmaker : null };
    const borrowed = rows.filter((r) => r.bookmaker === fallbackBook);
    return { rows: borrowed, source: borrowed.length > 0 ? fallbackBook : null };
  };

  const mw = pick(structured.matchWinner).find((r) => validOdds(r.home) && validOdds(r.draw) && validOdds(r.away));
  const odds1x2 = mw && validOdds(mw.home) && validOdds(mw.draw) && validOdds(mw.away)
    ? { home: mw.home, draw: mw.draw, away: mw.away }
    : null;
  if (!odds1x2) warnings.push(`bookmaker ${bookmaker} tidak menyediakan 1X2 lengkap`);

  const totalsPick = pickWithFallback(structured.overUnder);
  const ahPick = pickWithFallback(structured.asianHandicap);
  const bttsPick = pickWithFallback(structured.btts);
  const totals: OfferedTotals[] = [];
  for (const r of totalsPick.rows) {
    if (validOdds(r.over) && validOdds(r.under) && Number.isFinite(r.line)) {
      totals.push({ line: Number(r.line), overOdds: r.over, underOdds: r.under });
    }
  }
  const ah: OfferedAH[] = [];
  for (const r of ahPick.rows) {
    if (validOdds(r.home) && validOdds(r.away) && Number.isFinite(r.line)) {
      ah.push({ line: Number(r.line), homeOdds: r.home, awayOdds: r.away });
    }
  }
  const bttsRow = bttsPick.rows.find((r) => validOdds(r.yes) && validOdds(r.no));
  const btts = bttsRow && validOdds(bttsRow.yes) && validOdds(bttsRow.no)
    ? { yes: bttsRow.yes, no: bttsRow.no }
    : null;

  /* De-duplicate lines: two rows for 2.5 would otherwise be evaluated twice. */
  const dedupe = <T extends { line: number }>(xs: T[]): T[] => {
    const seen = new Set<number>();
    return xs.filter((x) => (seen.has(x.line) ? false : (seen.add(x.line), true)));
  };

  const sources = {
    ML: bookmaker,
    Totals: totalsPick.source,
    AH: ahPick.source,
    BTTS: bttsPick.source,
  };
  for (const [family, source] of Object.entries(sources)) {
    if (source && source !== bookmaker) {
      warnings.push(`pasar ${family} tidak ada di ${bookmaker} — memakai acuan ${source} (odds di aplikasi Anda bisa berbeda)`);
    }
  }
  return {
    odds1x2,
    totals: dedupe(totals),
    ah: dedupe(ah),
    btts,
    bookmaker,
    sources,
    warnings,
  };
}

/* ── One-shot orchestration ──────────────────────────────────────── */

export interface QuantEngineInput {
  homeTeam: string;
  awayTeam: string;
  leagueRows: TeamStatsRow[];
  structuredOdds: StructuredOddsInput;
  adjustment?: LlmAdjustment | null;
  minEv?: number;
}

export interface QuantEngineResult {
  analysis: MatchAnalysis | null;
  leagueAverages: LeagueAverages | null;
  bookmaker: string | null;
  teamsUsed: number;
  warnings: string[];
  /** True when the inputs were good enough to produce numbers at all. */
  usable: boolean;
}

/**
 * Run the deterministic engine for one fixture, or explain why it was skipped.
 * Never throws: a broken fixture must not take down a batch scan.
 */
export function runQuantEngine(input: QuantEngineInput): QuantEngineResult {
  const warnings: string[] = [];

  const league = computeLeagueAverages(input.leagueRows);
  warnings.push(...league.warnings);

  const homeRes = resolveTeamRow(input.leagueRows, input.homeTeam);
  const awayRes = resolveTeamRow(input.leagueRows, input.awayTeam);
  warnings.push(...homeRes.warnings, ...awayRes.warnings);

  const home = toTeamRates(homeRes.row);
  const away = toTeamRates(awayRes.row);
  warnings.push(...home.warnings.map((w) => `${input.homeTeam}: ${w}`));
  warnings.push(...away.warnings.map((w) => `${input.awayTeam}: ${w}`));

  const odds = buildOddsInput(input.structuredOdds);
  warnings.push(...odds.warnings);

  const unusable: string[] = [];
  if (!league.averages) unusable.push("rata-rata liga tidak valid");
  if (!home.rates) unusable.push(`rate ${input.homeTeam} tidak valid`);
  if (!away.rates) unusable.push(`rate ${input.awayTeam} tidak valid`);
  if (!odds.odds1x2) unusable.push("odds 1X2 tidak lengkap");

  if (unusable.length > 0 || !league.averages || !home.rates || !away.rates || !odds.odds1x2) {
    return {
      analysis: null,
      leagueAverages: league.averages,
      bookmaker: odds.bookmaker,
      teamsUsed: league.teamsUsed,
      warnings: [...warnings, ...unusable.map((u) => `ditolak: ${u}`)],
      usable: false,
    };
  }

  const matchInput: MatchInput = {
    odds1x2: odds.odds1x2,
    totals: odds.totals,
    ah: odds.ah,
    btts: odds.btts,
    bookmakerByFamily: odds.sources,
    league: league.averages,
    home: home.rates,
    away: away.rates,
    adjustment: input.adjustment ?? null,
    minEv: input.minEv,
  };

  try {
    const analysis = analyzeMatch(matchInput);
    return {
      analysis,
      leagueAverages: league.averages,
      bookmaker: odds.bookmaker,
      teamsUsed: league.teamsUsed,
      warnings: [...warnings, ...analysis.warnings],
      usable: true,
    };
  } catch (err) {
    return {
      analysis: null,
      leagueAverages: league.averages,
      bookmaker: odds.bookmaker,
      teamsUsed: league.teamsUsed,
      warnings: [...warnings, `engine gagal: ${err instanceof Error ? err.message : String(err)}`],
      usable: false,
    };
  }
}
