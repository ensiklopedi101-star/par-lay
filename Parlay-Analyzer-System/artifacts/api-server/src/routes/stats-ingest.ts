/**
 * Stats Ingestion API
 * Endpoint untuk menerima data statistik dari Chrome Extension FootyStats.
 * POST /api/stats/ingest — dengan header x-api-key
 */

import { Router, type IRouter } from "express";
import { supabase } from "../lib/supabase-client";
import { logger } from "../lib/logger";
import { cleanTeamName } from "../lib/team-name-cleaner";
import { VALID_STAT_TYPES } from "../utils/stats-dictionary";

const router: IRouter = Router();

/* API Key untuk ekstensi Chrome (bisa di-set via env var) */
const EXTENSION_API_KEY = process.env["EXTENSION_API_KEY"];

/**
 * Middleware: autentikasi API Key dari header x-api-key
 */
function requireApiKey(req: any, res: any, next: any) {
  const key = req.headers["x-api-key"] ?? req.headers["X-API-Key"] ?? "";

  if (!EXTENSION_API_KEY) {
    logger.error("EXTENSION_API_KEY not configured on server");
    res.status(500).json({
      error: "Server error: EXTENSION_API_KEY not configured. Add it to Replit Secrets.",
    });
    return;
  }

  if (!key || String(key) !== EXTENSION_API_KEY) {
    logger.warn({ ip: req.ip }, "Unauthorized stats ingestion attempt");
    res.status(401).json({ error: "Unauthorized — invalid or missing x-api-key" });
    return;
  }

  next();
}

/**
 * Normalisasi raw_url_path ke league_slug.
 * Contoh: "england/premier-league" → "england-premier-league"
 */
function normalizeLeagueSlug(raw: string): string {
  return raw
    .toLowerCase()
    .trim()
    .replace(/\//g, "-")     // slash → dash
    .replace(/\s+/g, "-")    // space → dash
    .replace(/-+/g, "-")      // collapse multiple dashes
    .replace(/^-|-$/g, "");  // trim dashes
}

/**
 * Normalisasi season string.
 * "2025-26" → "2025-2026", "2026" → "2026"
 */
function normalizeSeason(raw: string): string {
  const s = raw.trim();
  // Handle "2025-26" format
  const m = s.match(/^(\d{4})-(\d{2})$/);
  if (m) {
    const century = m[1]!.slice(0, 2);
    return `${m[1]}-${century}${m[2]}`;
  }
  return s;
}

/**
 * Upsert statistik tim ke team_season_stats.
 * Hanya update kolom yang sesuai dengan stat_type, tidak menimpa kolom lain.
 */
async function upsertTeamStat(
  leagueSlug: string,
  season: string,
  teamName: string,
  statType: string,
  statData: Record<string, unknown>,
): Promise<{ success: boolean; error?: string }> {
  const cleanTeam = cleanTeamName(teamName);

  // 1. Cek apakah row sudah ada
  const { data: existing } = await supabase
    .from("team_season_stats")
    .select("id, " + statType)
    .eq("league_slug", leagueSlug)
    .eq("season", season)
    .ilike("team_name", cleanTeam)
    .maybeSingle();

  const payload: Record<string, unknown> = {
    league_slug: leagueSlug,
    season,
    team_name: cleanTeam,
    updated_at: new Date().toISOString(),
  };

  // 2. Hanya set kolom yang sesuai stat_type
  payload[statType] = statData;

  if (existing) {
    // Update existing row (hanya kolom stat_type yang berubah)
    // Match by the same natural key to avoid relying on id typing.
    const { error } = await supabase
      .from("team_season_stats")
      .update(payload)
      .eq("league_slug", leagueSlug)
      .eq("season", season)
      .ilike("team_name", cleanTeam);

    if (error) {
      return { success: false, error: error.message };
    }
  } else {
    // Insert new row
    payload.created_at = new Date().toISOString();
    const { error } = await supabase
      .from("team_season_stats")
      .insert(payload);

    if (error) {
      return { success: false, error: error.message };
    }
  }

  return { success: true };
}

/* ═══════════════════════════════════════════════════════════════
   POST /api/stats/ingest
   ═══════════════════════════════════════════════════════════════ */

router.post("/stats/ingest", requireApiKey, async (req, res) => {
  try {
    const { raw_url_path, stat_type, season, teams } = req.body as {
      raw_url_path?: string;
      stat_type?: string;
      season?: string;
      teams?: Array<{ raw_team_name?: string; stat_data?: Record<string, unknown> }>;
    };

    /* Validasi input */
    if (!raw_url_path || !stat_type || !season || !teams || !Array.isArray(teams)) {
      res.status(400).json({
        error: "Missing required fields: raw_url_path, stat_type, season, teams",
        example: {
          raw_url_path: "england/premier-league",
          stat_type: "stats_xg",
          season: "2025-26",
          teams: [{ raw_team_name: "Manchester United", stat_data: { MP: "38", xG: "1.74" } }],
        },
      });
      return;
    }

    /* Validasi stat_type */
    if (!VALID_STAT_TYPES.includes(stat_type)) {
      res.status(400).json({
        error: `Invalid stat_type: "${stat_type}"`,
        valid_types: VALID_STAT_TYPES,
      });
      return;
    }

    const leagueSlug = normalizeLeagueSlug(raw_url_path);
    const normalizedSeason = normalizeSeason(season);

    logger.info(
      { leagueSlug, stat_type, season: normalizedSeason, teamCount: teams.length },
      "STATS INGEST: Processing payload",
    );

    /* Proses setiap team */
    const results: Array<{
      team: string;
      success: boolean;
      error?: string;
    }> = [];

    for (const team of teams) {
      const rawName = team.raw_team_name;
      const statData = team.stat_data;

      if (!rawName || !statData || typeof statData !== "object") {
        results.push({
          team: rawName ?? "UNKNOWN",
          success: false,
          error: "Missing raw_team_name or stat_data",
        });
        continue;
      }

      const result = await upsertTeamStat(leagueSlug, normalizedSeason, rawName, stat_type, statData);
      results.push({
        team: rawName,
        success: result.success,
        error: result.error,
      });
    }

    const successCount = results.filter((r) => r.success).length;
    const failCount = results.length - successCount;

    logger.info(
      { success: successCount, failed: failCount, league: leagueSlug, stat_type },
      "STATS INGEST: Done",
    );

    res.json({
      success: true,
      processed: results.length,
      success_count: successCount,
      fail_count: failCount,
      league_slug: leagueSlug,
      season: normalizedSeason,
      stat_type,
      details: results,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    logger.error({ err }, "STATS INGEST: Failed");
    res.status(500).json({ error: message });
  }
});

/* GET /api/stats/ingest-info — Info untuk ekstensi Chrome */
router.get("/stats/ingest-info", (req, res) => {
  const hasKey = !!EXTENSION_API_KEY;
  res.json({
    endpoint: "POST /api/stats/ingest",
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": hasKey ? "<configured>" : "NOT CONFIGURED",
    },
    body_format: {
      raw_url_path: "string (e.g., england/premier-league)",
      stat_type: `string (one of: ${VALID_STAT_TYPES.join(", ")})`,
      season: "string (e.g., 2025-26)",
      teams: [
        {
          raw_team_name: "string (e.g., Manchester United)",
          stat_data: "object (key-value pairs)",
        },
      ],
    },
    valid_stat_types: VALID_STAT_TYPES,
    api_key_configured: hasKey,
    note: hasKey
      ? "Extension ready to send data."
      : "WARNING: EXTENSION_API_KEY not set in server. Add it to Replit Secrets.",
  });
});

export default router;
