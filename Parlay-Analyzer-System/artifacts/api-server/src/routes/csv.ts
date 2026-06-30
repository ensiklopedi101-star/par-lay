import { Router, type IRouter } from "express";
import multer from "multer";
import { parse } from "csv-parse";
import { supabase } from "../lib/supabase-client";
import { logger } from "../lib/logger";
import { cleanTeamName } from "../lib/team-name-cleaner";

const router: IRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

const CSV_UPLOAD_PASSWORD = process.env["CSV_UPLOAD_PASSWORD"] ?? "parlay2024";

/* 11 valid JSONB columns in team_season_stats */
const VALID_CSV_TYPES = [
  "stats_xg",
  "stats_fts",
  "stats_btts",
  "stats_goals_conceded",
  "stats_goals_scored",
  "stats_shots",
  "stats_over_25",
  "stats_over_35",
  "stats_under",
  "stats_team_form",
  "stats_ht",
];

/** Remove BOM from a string */
function stripBom(str: string): string {
  return str.replace(/^\uFEFF/, "");
}

/** Clean CSV header keys: strip BOM, trim, lowercase, remove empty */
function cleanKey(k: string): string {
  return stripBom(k)
    .trim()
    .replace(/\s+/g, " ");   // collapse spaces
}

/** Clean a row object: remove keys that are empty / garbage-only */
function cleanRow(raw: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    const key = cleanKey(k);
    if (!key) continue;
    if (key === "" || /^[^a-zA-Z0-9]+$/.test(key)) continue; // garbage-only key
    const val = stripBom(v).trim();
    if (val === "") continue;
    out[key] = val;
  }
  return out;
}

router.post("/csv/upload", upload.single("file"), async (req, res) => {
  const { password, leagueSlug, season, csvType } = req.body as Record<string, string>;

  if (!password || password !== CSV_UPLOAD_PASSWORD) {
    res.status(401).json({ error: "Unauthorized — wrong password" });
    return;
  }
  if (!leagueSlug || !season) {
    res.status(400).json({ error: "leagueSlug and season are required" });
    return;
  }
  if (!csvType || !VALID_CSV_TYPES.includes(csvType)) {
    res.status(400).json({ error: `Invalid csvType. Must be one of: ${VALID_CSV_TYPES.join(", ")}` });
    return;
  }
  if (!req.file) {
    res.status(400).json({ error: "No file uploaded" });
    return;
  }

  let inserted = 0;
  let skipped = 0;
  let errors = 0;
  const teams: string[] = [];

  try {
    const text = stripBom(req.file!.buffer.toString("utf-8"));

    // Auto-detect delimiter
    const firstLine = text.split(/\r?\n/)[0] ?? "";
    const delimiter = firstLine.includes(";") ? ";" : ",";

    const rows = await new Promise<Record<string, string>[]>((resolve, reject) => {
      const records: Record<string, string>[] = [];
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
        let record: Record<string, string>;
        while ((record = parser.read()) !== null) {
          records.push(record);
        }
      });
      parser.on("error", reject);
      parser.on("end", () => resolve(records));
      parser.write(text);
      parser.end();
    });

    logger.info({ rows: rows.length, leagueSlug, season, csvType, delimiter }, "CSV parsed");

    for (const rawRow of rows) {
      const row = cleanRow(rawRow);

      // Find team name (case-insensitive key search)
      const teamKey = Object.keys(row).find((k) => /^team\b/i.test(k));
      const rawTeam = teamKey ? row[teamKey] : "";
      if (!rawTeam) {
        logger.debug({ row }, "Row skipped: empty team name");
        skipped++;
        continue;
      }
      if (/badge/i.test(rawTeam) || /^team$/i.test(rawTeam.trim())) {
        logger.debug({ rawTeam }, "Row skipped: badge/header row");
        skipped++;
        continue;
      }

      const teamName = cleanTeamName(rawTeam);
      if (!teamName) {
        logger.debug({ rawTeam }, "Row skipped: empty after cleaning");
        skipped++;
        continue;
      }

      try {
        // Fetch existing row from Supabase
        const { data: existing } = await supabase
          .from("team_season_stats")
          .select("*")
          .eq("league_slug", leagueSlug)
          .eq("season", season)
          .eq("team_name", teamName)
          .single();

        // Build the JSON payload for this csvType
        const jsonPayload = { ...row };   // keep as-is (strings)
        delete jsonPayload[teamKey!];     // remove team name from JSON

        // Build upsert object: keep all 11 JSONB columns from existing, overwrite only the target one
        const dataToInsert: Record<string, unknown> = {
          league_slug: leagueSlug,
          season,
          team_name: teamName,
        };

        // Preserve existing JSONB columns
        for (const col of VALID_CSV_TYPES) {
          if (existing && existing[col] !== null && existing[col] !== undefined) {
            dataToInsert[col] = existing[col];
          } else {
            dataToInsert[col] = null; // or omit; Supabase will keep NULL
          }
        }

        // Overwrite the target column with new JSON
        const existingJson = (existing && existing[csvType]) || {};
        dataToInsert[csvType] = {
          ...existingJson,
          ...jsonPayload,
        };

        logger.debug({ teamName, csvType, keys: Object.keys(jsonPayload) }, "Upserting row");

        const { error } = await supabase
          .from("team_season_stats")
          .upsert(dataToInsert, {
            onConflict: "league_slug, season, team_name",
          });

        if (error) {
          logger.error({ error, teamName, csvType }, "Supabase upsert error");
          errors++;
          continue;
        }

        teams.push(teamName);
        inserted++;
      } catch (err) {
        logger.error({ err, teamName }, "Row processing exception");
        errors++;
      }
    }

    logger.info({ inserted, skipped, errors, leagueSlug, season, csvType }, "CSV import done");
    res.json({ inserted, skipped, errors, teams, csvType });
  } catch (err) {
    logger.error({ err }, "CSV parse failed");
    res.status(500).json({ error: "CSV parse failed" });
  }
});

router.get("/csv/teams", async (req, res) => {
  try {
    const { leagueSlug, season } = req.query as Record<string, string>;
    let q = supabase.from("team_season_stats").select("*");
    if (leagueSlug) q = q.eq("league_slug", leagueSlug);
    if (season) q = q.eq("season", season);

    const { data, error } = await q.order("team_name", { ascending: true });
    if (error) {
      logger.error({ error }, "Failed to fetch team stats");
      res.status(500).json({ error: error.message });
      return;
    }

    res.json(data ?? []);
  } catch (err) {
    logger.error({ err }, "Failed to fetch team stats");
    res.status(500).json({ error: "Failed to fetch team stats" });
  }
});

export default router;
