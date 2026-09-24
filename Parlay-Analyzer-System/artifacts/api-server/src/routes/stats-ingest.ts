/**
 * Stats Ingestion API
 * Endpoint untuk menerima data statistik dari Chrome Extension FootyStats.
 * POST /api/stats/ingest — dengan header x-api-key
 */

import { Router, type IRouter } from "express";
import { supabase } from "../lib/supabase-client";
import { logger } from "../lib/logger";
import { canonicalTeamName, teamIdentityKey } from "../lib/team-name-cleaner";
import { VALID_STAT_TYPES, validateStatPayload } from "../utils/stats-dictionary";

const router: IRouter = Router();

/**
 * Middleware: autentikasi API Key dari header x-api-key
 */
function requireApiKey(req: any, res: any, next: any) {
  const configuredKey = process.env["EXTENSION_API_KEY"];
  const authorization = String(req.headers.authorization ?? "");
  const bearerKey = authorization.match(/^Bearer\s+(.+)$/i)?.[1] ?? "";
  const key = req.headers["x-api-key"]
    ?? req.headers["X-API-Key"]
    ?? req.headers["x-extension-api-key"]
    ?? bearerKey
    ?? "";

  if (!configuredKey) {
    logger.error("EXTENSION_API_KEY not configured on server");
    res.status(500).json({
      error: "Server error: EXTENSION_API_KEY not configured. Add it to Replit Secrets.",
    });
    return;
  }

  if (!key || String(key) !== configuredKey) {
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
  let value = raw.trim();
  try {
    if (/^https?:\/\//i.test(value)) {
      value = new URL(value).pathname;
    }
  } catch {
    // Fall back to the raw value; validation below still prevents an empty slug.
  }

  const parts = value
    .split(/[?#]/)[0]!
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => !/^(www\.)?footystats\.org$/i.test(part))
    .filter((part) => !/^\d{4}([-/]\d{2,4})?$/.test(part));

  return parts
    .join("-")
    .toLowerCase()
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
  // Keep the compact format used by the live Supabase rows.
  // "2025-2026" is also accepted and canonicalized to "2025-26".
  const compact = s.match(/^(\d{4})-(\d{2})$/);
  if (compact) return `${compact[1]}-${compact[2]}`;
  const expanded = s.match(/^(\d{4})-(\d{4})$/);
  if (expanded && expanded[2]!.startsWith(expanded[1]!.slice(0, 2))) {
    return `${expanded[1]}-${expanded[2]!.slice(2)}`;
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
  const cleanTeam = canonicalTeamName(teamName, leagueSlug);

  // 1. Cek apakah row sudah ada
  const { data: existingRows, error: lookupError } = await supabase
    .from("team_season_stats")
    .select("id, " + statType)
    .eq("league_slug", leagueSlug)
    .eq("season", season)
    .limit(500);

  if (lookupError) {
    return { success: false, error: `Existing-row lookup failed: ${lookupError.message}` };
  }
  const existing = (existingRows ?? []).find((row) =>
    teamIdentityKey(String((row as Record<string, unknown>).team_name ?? ""), leagueSlug) === teamIdentityKey(cleanTeam, leagueSlug),
  );
  const existingId = existing && typeof existing === "object" && "id" in existing
    ? String((existing as { id: string }).id)
    : null;

  const payload: Record<string, unknown> = {
    league_slug: leagueSlug,
    season,
    team_name: cleanTeam,
    updated_at: new Date().toISOString(),
  };

  // 2. Hanya set kolom yang sesuai stat_type
  payload[statType] = statData;

  if (existing && existingId) {
    // Update existing row (hanya kolom stat_type yang berubah)
    // Match by the same natural key to avoid relying on id typing.
    const { error } = await supabase
      .from("team_season_stats")
      .update(payload)
      .eq("id", existingId);

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
    const body = (req.body ?? {}) as Record<string, unknown>;
    const rawUrlPath = body.raw_url_path ?? body.league_slug ?? body.leagueSlug ?? body.league_url ?? body.url;
    const statType = body.stat_type ?? body.statType ?? body.category;
    const rawSeason = body.season ?? body.season_id ?? body.seasonId;
    const rawTeams = body.teams ?? body.data ?? body.rows;
    const teams = Array.isArray(rawTeams) ? rawTeams as Array<Record<string, unknown>> : null;

    /* Validasi input */
    if (typeof rawUrlPath !== "string" || typeof statType !== "string" || typeof rawSeason !== "string" || !teams) {
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
    if (!VALID_STAT_TYPES.includes(statType)) {
      res.status(400).json({
        error: `Invalid stat_type: "${statType}"`,
        valid_types: VALID_STAT_TYPES,
      });
      return;
    }

    const leagueSlug = normalizeLeagueSlug(rawUrlPath);
    const normalizedSeason = normalizeSeason(rawSeason);
    if (!leagueSlug || !normalizedSeason || teams.length === 0) {
      res.status(400).json({
        error: "League, season, and at least one team are required after normalization",
        normalized: { league_slug: leagueSlug, season: normalizedSeason, team_count: teams.length },
      });
      return;
    }

    logger.info(
      { leagueSlug, stat_type: statType, season: normalizedSeason, teamCount: teams.length },
      "STATS INGEST: Processing payload",
    );

    /* Proses setiap team */
    const results: Array<{
      team: string;
      success: boolean;
      error?: string;
      warnings?: string[];
    }> = [];

    for (const team of teams) {
      const rawNameValue = team.raw_team_name ?? team.team_name ?? team.teamName ?? team.name ?? team.team;
      const rawName = typeof rawNameValue === "string" ? rawNameValue.trim() : "";
      const candidateData = team.stat_data ?? team.stats ?? team.values ?? team.data;
      const statData = candidateData && typeof candidateData === "object" && !Array.isArray(candidateData)
        ? candidateData as Record<string, unknown>
        : Object.fromEntries(
            Object.entries(team).filter(([key]) => !["raw_team_name", "team_name", "teamName", "name", "team"].includes(key)),
          );

      if (!rawName || !statData || typeof statData !== "object") {
        results.push({
          team: rawName ?? "UNKNOWN",
          success: false,
          error: "Missing raw_team_name or stat_data",
        });
        continue;
      }

      const validation = validateStatPayload(statType, statData);
      const warnings = [
        ...(validation.missing.length > 0 ? [`Missing expected metrics: ${validation.missing.join(", ")}`] : []),
        ...(validation.unknown.length > 0 ? [`Unrecognized metrics preserved: ${validation.unknown.join(", ")}`] : []),
      ];
      const result = await upsertTeamStat(leagueSlug, normalizedSeason, rawName, statType, statData);
      results.push({
        team: rawName,
        success: result.success,
        error: result.error,
        warnings: warnings.length > 0 ? warnings : undefined,
      });
    }

    const successCount = results.filter((r) => r.success).length;
    const failCount = results.length - successCount;

    logger.info(
      { success: successCount, failed: failCount, league: leagueSlug, stat_type: statType },
      "STATS INGEST: Done",
    );

    res.json({
      success: failCount === 0,
      // Compatibility fields for the Chrome extension contract.
      ok: failCount === 0,
      partial: successCount > 0 && failCount > 0,
      processed: results.length,
      success_count: successCount,
      fail_count: failCount,
      upserted: successCount,
      skipped: failCount,
      result_rows: results,
      league_slug: leagueSlug,
      season: normalizedSeason,
      stat_type: statType,
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
  const hasKey = !!process.env["EXTENSION_API_KEY"];
  res.json({
    endpoint: "POST /api/stats/ingest",
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": hasKey ? "<configured>" : "NOT CONFIGURED",
      "x-extension-api-key": hasKey ? "<configured>" : "NOT CONFIGURED",
      "Authorization": hasKey ? "Bearer <configured>" : "NOT CONFIGURED",
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
    accepted_aliases: {
      league: ["raw_url_path", "league_slug", "leagueSlug", "league_url", "url"],
      stat_type: ["stat_type", "statType", "category"],
      season: ["season", "season_id", "seasonId"],
      teams: ["teams", "data", "rows"],
      team_name: ["raw_team_name", "team_name", "teamName", "name", "team"],
      stat_data: ["stat_data", "stats", "values", "data"],
    },
    valid_stat_types: VALID_STAT_TYPES,
    api_key_configured: hasKey,
    note: hasKey
      ? "Extension ready to send data."
      : "WARNING: EXTENSION_API_KEY not set in server. Add it to Replit Secrets.",
  });
});

export default router;
