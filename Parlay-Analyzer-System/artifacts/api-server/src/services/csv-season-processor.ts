import { parse } from "csv-parse";
import { logger } from "../lib/logger";
import { cleanTeamName, slugifyTeamName } from "../lib/team-name-cleaner";
import { supabase } from "../lib/supabase-client";

/* ────────────────────────────────────────────────
 * Row shape (covers all possible columns)
 * ──────────────────────────────────────────────── */
export interface SeasonStatRow {
  league_slug: string;
  season: string;
  team_name: string;

  // xG
  xg_per_match?: number | null;
  xga_per_match?: number | null;
  xgd_per_match?: number | null;
  gf_per_match?: number | null;
  ga_per_match?: number | null;
  xg_vs_actual?: number | null;

  // xPts
  xwins?: number | null;
  xdraws?: number | null;
  xlosses?: number | null;
  xpts?: number | null;
  actual_pts?: number | null;
  xp_vs_actual?: number | null;

  // FTS
  fts_pct?: number | null;
  fts_home_pct?: number | null;
  fts_away_pct?: number | null;

  // HT
  ht_win_pct?: number | null;
  ht_draw_pct?: number | null;
  ht_loss_pct?: number | null;

  // Over / Under goals
  under_05_pct?: number | null;
  over_05_pct?: number | null;
  under_15_pct?: number | null;
  over_15_pct?: number | null;
  under_25_pct?: number | null;
  over_25_pct?: number | null;
  under_35_pct?: number | null;
  over_35_pct?: number | null;
  under_45_pct?: number | null;
  over_45_pct?: number | null;
  under_55_pct?: number | null;
  over_55_pct?: number | null;

  // Shots
  shots_over_105_pct?: number | null;
  shots_over_115_pct?: number | null;
  shots_over_125_pct?: number | null;
  shots_over_135_pct?: number | null;
  shots_over_145_pct?: number | null;
  shots_over_155_pct?: number | null;

  // Raw JSON
  raw_data: Record<string, unknown>;
}

/* ────────────────────────────────────────────────
 * Parsers
 * ──────────────────────────────────────────────── */
function parsePercent(val: unknown): number | null {
  if (val === null || val === undefined || val === "") return null;
  const s = String(val).trim();
  // "66%" → 0.66
  const m = s.match(/^([\d.]+)\s*%$/);
  if (m) return parseFloat(m[1]) / 100;
  // "+66%" or plain "66"
  const n = parseFloat(s.replace(/^\+/, ""));
  return isNaN(n) ? null : n;
}

function parseFloatOrNull(val: unknown): number | null {
  if (val === null || val === undefined || val === "") return null;
  const n = parseFloat(String(val));
  return isNaN(n) ? null : n;
}

/* ────────────────────────────────────────────────
 * Column detection helpers
 * ──────────────────────────────────────────────── */
function normalizeHeader(h: string): string {
  return h
    .trim()
    .replace(/^\uFEFF/, "") // strip BOM
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function findColumn(headers: string[], candidates: string[]): string | undefined {
  const n = headers.map(normalizeHeader);
  for (const c of candidates) {
    const idx = n.indexOf(c.toLowerCase());
    if (idx !== -1) return headers[idx];
  }
  // Fuzzy fallback: includes
  for (const c of candidates) {
    const h = headers.find(
      (h) => normalizeHeader(h).includes(c.toLowerCase())
    );
    if (h) return h;
  }
  return undefined;
}

/* ────────────────────────────────────────────────
 * Dynamic column detection
 * ──────────────────────────────────────────────── */
function detectColumns(headers: string[]) {
  const h = headers.map(normalizeHeader);

  return {
    teamCol:
      findColumn(headers, ["team", "club", "squad", "team name"]) ??
      headers.find((h) => /team|club|squad|name/i.test(h)),

    // xG
    xgCol: findColumn(headers, [
      "xg", "xG", "expected goals", "xg per match", "xg/match",
    ]),
    xgaCol: findColumn(headers, [
      "xga", "xGA", "expected goals against", "xga per match", "xga/match",
    ]),
    xgdCol: findColumn(headers, [
      "xgd", "xGD", "expected goal difference", "xgd per match", "xgd/match",
    ]),
    gfCol: findColumn(headers, [
      "gf", "goals for", "gf per match", "gf/match",
    ]),
    gaCol: findColumn(headers, [
      "ga", "goals against", "ga per match", "ga/match",
    ]),
    xgVsActualCol: findColumn(headers, [
      "xg vs actual", "xG vs Actual", "xG vs actual", "xg_vs_actual",
    ]),

    // xPts
    xwinsCol: findColumn(headers, [
      "xwins", "xWins", "expected wins", "xWins",
    ]),
    xdrawsCol: findColumn(headers, [
      "xdraws", "xDraws", "expected draws", "xDraws",
    ]),
    xlossesCol: findColumn(headers, [
      "xlosses", "xLosses", "expected losses", "xLosses",
    ]),
    xptsCol: findColumn(headers, [
      "xpts", "xPts", "expected points", "xPts per match", "xpts/match",
    ]),
    actualPtsCol: findColumn(headers, [
      "actual pts", "actual_pts", "Actual Pts", "points", "pts",
    ]),
    xpVsActualCol: findColumn(headers, [
      "xp v actual", "xP v Actual", "xP v actual", "xp_vs_actual", "xp v actual",
    ]),

    // FTS
    ftsPctCol: findColumn(headers, [
      "fts %", "fts%", "fts", "failed to score", "failed to score %",
    ]),
    ftsHomePctCol: findColumn(headers, [
      "home %", "fts home %", "fts home%", "home%",
    ]),
    ftsAwayPctCol: findColumn(headers, [
      "away %", "fts away %", "fts away%", "away%",
    ]),

    // HT
    htWinPctCol: findColumn(headers, [
      "win %", "ht win %", "ht win%", "win%", "half-time win",
      "half time win",
    ]),
    htDrawPctCol: findColumn(headers, [
      "draw %", "ht draw %", "ht draw%", "draw%", "half-time draw",
      "half time draw",
    ]),
    htLossPctCol: findColumn(headers, [
      "loss %", "ht loss %", "ht loss%", "loss%", "half-time loss",
      "half time loss",
    ]),
  };
}

/* ────────────────────────────────────────────────
 * Over / Under goals column detection
 * ──────────────────────────────────────────────── */
/* ────────────────────────────────────────────────
 * Over / Under goals column detection (excludes shots thresholds)
 * ──────────────────────────────────────────────── */
function detectOverUnder(
  headers: string[],
): Record<string, string> {
  const map: Record<string, string> = {};
  for (const h of headers) {
    const norm = normalizeHeader(h);
    const underMatch = norm.match(/under\s*(\d\.\d)/);
    const overMatch = norm.match(/over\s*(\d\.\d)/);
    if (underMatch) {
      const num = parseFloat(underMatch[1]);
      if (num > 5.5) continue; // skip shots thresholds
      const key = `under_${underMatch[1].replace(".", "")}_pct`;
      map[key] = h;
    } else if (overMatch) {
      const num = parseFloat(overMatch[1]);
      if (num > 5.5) continue; // skip shots thresholds
      const key = `over_${overMatch[1].replace(".", "")}_pct`;
      map[key] = h;
    }
  }
  return map;
}

/* ────────────────────────────────────────────────
 * Shots column detection (high thresholds like Over 10.5–15.5)
 * ──────────────────────────────────────────────── */
function detectShots(
  headers: string[],
): Record<string, string> {
  const map: Record<string, string> = {};
  for (const h of headers) {
    const norm = normalizeHeader(h);
    const m = norm.match(/over\s*(\d\.\d)/);
    if (m) {
      const num = parseFloat(m[1]);
      if (num >= 10.5) {
        const key = `shots_over_${m[1].replace(".", "")}_pct`;
        map[key] = h;
      }
    }
  }
  return map;
}

/* ────────────────────────────────────────────────
 * Parse CSV buffer
 * ──────────────────────────────────────────────── */
export interface SkipReason {
  row: number;
  reason: string;
  teamRaw?: string;
  cleaned?: string;
}

export async function parseSeasonCsv(
  buffer: Buffer,
  leagueSlug: string,
  season: string,
): Promise<{ rows: SeasonStatRow[]; stats: { total: number; skipped: number }; skipReasons: SkipReason[] }> {
  const text = buffer.toString("utf-8");

  // Auto-detect delimiter
  const firstLine = text.split(/\r?\n/)[0] ?? "";
  const delimiter = firstLine.includes(";") ? ";" : ",";

  const records: Record<string, string>[] = await new Promise(
    (resolve, reject) => {
      const out: Record<string, string>[] = [];
      const parser = parse({
        columns: true,
        skip_empty_lines: true,
        trim: true,
        relax_column_count: true,
        delimiter,
        quote: '"',
        relax_quotes: true,
      });
      parser.on("readable", () => {
        let rec: Record<string, string>;
        while ((rec = parser.read()) !== null) {
          out.push(rec);
        }
      });
      parser.on("error", reject);
      parser.on("end", () => resolve(out));
      parser.write(text);
      parser.end();
    },
  );

  if (records.length === 0) {
    return { rows: [], stats: { total: 0, skipped: 0 }, skipReasons: [] };
  }

  const headers = Object.keys(records[0]);
  const cols = detectColumns(headers);
  const overUnder = detectOverUnder(headers);
  const shots = detectShots(headers);

  logger.info(
    { headers, detected: cols, overUnder, shots, leagueSlug, season, delimiter },
    "CSV columns detected",
  );

  const rows: SeasonStatRow[] = [];
  let skipped = 0;
  const skipReasons: SkipReason[] = [];

  for (let i = 0; i < records.length; i++) {
    const raw = records[i];
    const teamRaw = cols.teamCol ? raw[cols.teamCol] : "";
    if (!teamRaw || /^\s*$/.test(teamRaw)) {
      const reason: SkipReason = {
        row: i + 1,
        reason: "empty team name",
        teamRaw,
      };
      skipReasons.push(reason);
      logger.debug(reason, "Row skipped");
      skipped++;
      continue;
    }

    const cleaned = cleanTeamName(teamRaw);
    const slug = slugifyTeamName(cleaned);

    if (!slug) {
      const reason: SkipReason = {
        row: i + 1,
        reason: "empty slug after cleaning",
        teamRaw,
        cleaned,
      };
      skipReasons.push(reason);
      logger.debug(reason, "Row skipped");
      skipped++;
      continue;
    }

    // Collect all non-empty raw data
    const rawData: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(raw)) {
      if (v !== "" && v !== null && v !== undefined) {
        rawData[k] = v;
      }
    }

    const row: SeasonStatRow = {
      league_slug: leagueSlug,
      season,
      team_name: cleaned,
      raw_data: rawData,
    };

    // Map detected columns
    if (cols.xgCol) row.xg_per_match = parseFloatOrNull(raw[cols.xgCol]);
    if (cols.xgaCol) row.xga_per_match = parseFloatOrNull(raw[cols.xgaCol]);
    if (cols.xgdCol) row.xgd_per_match = parseFloatOrNull(raw[cols.xgdCol]);
    if (cols.gfCol) row.gf_per_match = parseFloatOrNull(raw[cols.gfCol]);
    if (cols.gaCol) row.ga_per_match = parseFloatOrNull(raw[cols.gaCol]);
    if (cols.xgVsActualCol) row.xg_vs_actual = parseFloatOrNull(raw[cols.xgVsActualCol]);

    if (cols.xwinsCol) row.xwins = parseFloatOrNull(raw[cols.xwinsCol]);
    if (cols.xdrawsCol) row.xdraws = parseFloatOrNull(raw[cols.xdrawsCol]);
    if (cols.xlossesCol) row.xlosses = parseFloatOrNull(raw[cols.xlossesCol]);
    if (cols.xptsCol) row.xpts = parseFloatOrNull(raw[cols.xptsCol]);
    if (cols.actualPtsCol) row.actual_pts = parseFloatOrNull(raw[cols.actualPtsCol]);
    if (cols.xpVsActualCol) row.xp_vs_actual = parseFloatOrNull(raw[cols.xpVsActualCol]);

    if (cols.ftsPctCol) row.fts_pct = parsePercent(raw[cols.ftsPctCol]);
    if (cols.ftsHomePctCol) row.fts_home_pct = parsePercent(raw[cols.ftsHomePctCol]);
    if (cols.ftsAwayPctCol) row.fts_away_pct = parsePercent(raw[cols.ftsAwayPctCol]);

    if (cols.htWinPctCol) row.ht_win_pct = parsePercent(raw[cols.htWinPctCol]);
    if (cols.htDrawPctCol) row.ht_draw_pct = parsePercent(raw[cols.htDrawPctCol]);
    if (cols.htLossPctCol) row.ht_loss_pct = parsePercent(raw[cols.htLossPctCol]);

    // Over / Under goals
    for (const [key, header] of Object.entries(overUnder)) {
      (row as Record<string, number | null>)[key] = parsePercent(raw[header]);
    }

    // Shots
    for (const [key, header] of Object.entries(shots)) {
      (row as Record<string, number | null>)[key] = parsePercent(raw[header]);
    }

    rows.push(row);
  }

  return { rows, stats: { total: records.length, skipped }, skipReasons };
}

/* ────────────────────────────────────────────────
 * SELECT existing row, merge, then UPSERT
 * ──────────────────────────────────────────────── */
export async function upsertSeasonStats(
  rows: SeasonStatRow[],
): Promise<{ inserted: number; errors: number; merged: number }> {
  let inserted = 0;
  let errors = 0;
  let merged = 0;

  for (const row of rows) {
    try {
      // 1. Fetch existing row
      const { data: existing, error: fetchError } = await supabase
        .from("team_season_stats")
        .select("*")
        .eq("league_slug", row.league_slug)
        .eq("season", row.season)
        .eq("team_name", row.team_name)
        .single();

      if (fetchError && fetchError.code !== "PGRST116") {
        // PGRST116 = "JSON object requested, multiple (or no) rows returned"
        logger.error(
          { error: fetchError, team: row.team_name, league: row.league_slug, season: row.season },
          "Supabase fetch error",
        );
        errors++;
        continue;
      }

      // 2. Build data object: merge existing data with new data
      const dataToInsert: Record<string, unknown> = {
        league_slug: row.league_slug,
        season: row.season,
        team_name: row.team_name,
      };

      // If row exists, start with its values
      if (existing) {
        merged++;
        // Copy all existing columns (except PK & raw_data)
        const colsToKeep = [
          "xg_per_match", "xga_per_match", "xgd_per_match", "gf_per_match", "ga_per_match",
          "xg_vs_actual", "xwins", "xdraws", "xlosses", "xpts", "actual_pts", "xp_vs_actual",
          "fts_pct", "fts_home_pct", "fts_away_pct",
          "ht_win_pct", "ht_draw_pct", "ht_loss_pct",
          "under_05_pct", "over_05_pct", "under_15_pct", "over_15_pct",
          "under_25_pct", "over_25_pct", "under_35_pct", "over_35_pct",
          "under_45_pct", "over_45_pct", "under_55_pct", "over_55_pct",
          "shots_over_105_pct", "shots_over_115_pct", "shots_over_125_pct",
          "shots_over_135_pct", "shots_over_145_pct", "shots_over_155_pct",
        ];
        for (const col of colsToKeep) {
          if (existing[col] !== null && existing[col] !== undefined) {
            dataToInsert[col] = existing[col];
          }
        }
        // Merge raw_data
        if (existing.raw_data && typeof existing.raw_data === "object") {
          dataToInsert.raw_data = {
            ...existing.raw_data,
            ...row.raw_data,
          };
        } else {
          dataToInsert.raw_data = row.raw_data;
        }
      } else {
        dataToInsert.raw_data = row.raw_data;
      }

      // 3. Overlay new data (only non-null values)
      const newCols = [
        "xg_per_match", "xga_per_match", "xgd_per_match", "gf_per_match", "ga_per_match",
        "xg_vs_actual", "xwins", "xdraws", "xlosses", "xpts", "actual_pts", "xp_vs_actual",
        "fts_pct", "fts_home_pct", "fts_away_pct",
        "ht_win_pct", "ht_draw_pct", "ht_loss_pct",
        "under_05_pct", "over_05_pct", "under_15_pct", "over_15_pct",
        "under_25_pct", "over_25_pct", "under_35_pct", "over_35_pct",
        "under_45_pct", "over_45_pct", "under_55_pct", "over_55_pct",
        "shots_over_105_pct", "shots_over_115_pct", "shots_over_125_pct",
        "shots_over_135_pct", "shots_over_145_pct", "shots_over_155_pct",
      ];
      for (const col of newCols) {
        const val = (row as Record<string, unknown>)[col];
        if (val !== null && val !== undefined) {
          dataToInsert[col] = val;
        }
      }

      // 4. Upsert
      const { error } = await supabase
        .from("team_season_stats")
        .upsert(dataToInsert, {
          onConflict: "league_slug, season, team_name",
        });

      if (error) {
        logger.error(
          { error, team: row.team_name, league: row.league_slug, season: row.season },
          "Supabase upsert error",
        );
        errors++;
        continue;
      }
      inserted++;
    } catch (err) {
      logger.error(
        { err, team: row.team_name, league: row.league_slug, season: row.season },
        "Upsert exception",
      );
      errors++;
    }
  }

  return { inserted, errors, merged };
}
