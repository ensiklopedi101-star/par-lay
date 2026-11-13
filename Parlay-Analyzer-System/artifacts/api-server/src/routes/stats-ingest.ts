/**
 * Stats Ingestion API
 * Endpoint untuk menerima data statistik dari Chrome Extension FootyStats.
 * POST /api/stats/ingest — dengan header x-api-key
 */

import { Router, type IRouter } from "express";
import { supabase } from "../lib/supabase-client";
import { logger } from "../lib/logger";
import { loadKnownLeagueSlugs, resolveLeagueSlug } from "../lib/league-slug";
import { canonicalTeamName, teamIdentityKey } from "../lib/team-name-cleaner";
import { STATS_DICTIONARY, VALID_STAT_TYPES, validateStatPayload } from "../utils/stats-dictionary";
import {
  findEquivalentTeamStatsRows,
  mergeTeamStatsRows,
  preferredTeamDisplayName,
  TEAM_STATS_JSON_COLUMNS,
} from "../lib/team-stats-merge";
import { normalizeStatsRow } from "../lib/stats-integrity";

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
 * Catch a payload whose own labels contradict the stat_type it is being filed
 * under. The live database contains 19 rows where stats_goals_scored holds
 * "Conceded / match" text; this is the check that would have stopped them.
 */
function detectStatTypeContradiction(
  statType: string,
  statData: Record<string, unknown>,
): string | null {
  const label = Object.entries(statData)
    .filter(([key]) => /per\s*match|total|^goals/i.test(key))
    .map(([, value]) => String(value ?? ""))
    .join(" ")
    .toLowerCase();

  if (!label) return null;

  const saysConceded = /conceded/.test(label);
  const saysScored = /scored/.test(label);

  if (statType === "stats_goals_scored" && saysConceded && !saysScored) {
    return 'blok berlabel "Conceded" di kolom gol-dicetak';
  }
  if (statType === "stats_goals_conceded" && saysScored && !saysConceded) {
    return 'blok berlabel "Scored" di kolom gol-kebobolan';
  }
  return null;
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
  existingRows: Array<Record<string, unknown>>,
): Promise<{ success: boolean; error?: string }> {
  const cleanTeam = canonicalTeamName(teamName, leagueSlug);

  const candidates = findEquivalentTeamStatsRows(
    existingRows,
    cleanTeam,
    leagueSlug,
  );
  const displayTeam = preferredTeamDisplayName(cleanTeam, candidates, leagueSlug);
  const target = candidates.find((row) =>
    String(row.team_name ?? "").trim().toLowerCase() === displayTeam.trim().toLowerCase(),
  ) ?? candidates[0];
  const existingId = target?.id == null ? null : String(target.id);
  const mergedExisting = mergeTeamStatsRows(candidates);

  const payload: Record<string, unknown> = {
    league_slug: leagueSlug,
    season,
    team_name: displayTeam,
    updated_at: new Date().toISOString(),
  };

  // Kontaminasi lama (La Liga 2026-27): 18 baris menyimpan tabel "Goals
  // Conceded" di kolom stats_goals_scored. Teks yang sama sudah ada di
  // stats_goals_conceded, jadi tidak ada informasi yang hilang. Buang blok
  // yang bertentangan SEBELUM digabung ke payload — payload update menimpa
  // SELURUH kolom, jadi membawa blok korup itu memicu constraint
  // team_stats_scored_not_conceded di update mana pun (17 dari 20 tim
  // tertolak pada ingest stats_team_form 2026-11-13, bukan karena datanya
  // salah, melainkan karena blok korup ikut terseret).
  const { stats: sanitizedExisting, removed } = normalizeStatsRow({
    ...(mergedExisting as Record<string, unknown>),
  });
  for (const hit of removed) {
    logger.warn(
      { leagueSlug, season, teamName: displayTeam, kol: hit.column },
      "Ingest: membuang blok korup dari baris tersimpan (bertentangan dengan nama kolom)",
    );
  }

  // Fold complementary categories from any legacy aliases into the row being updated.
  for (const column of TEAM_STATS_JSON_COLUMNS) {
    const existingValue = sanitizedExisting[column];
    if (existingValue !== null && existingValue !== undefined) payload[column] = existingValue;
  }
  const existingStat = sanitizedExisting[statType];
  payload[statType] = {
    ...(existingStat && typeof existingStat === "object" && !Array.isArray(existingStat)
      ? existingStat as Record<string, unknown>
      : {}),
    ...statData,
  };

  if (target && existingId) {
    // Update existing row (hanya kolom stat_type yang berubah)
    // Match by the same natural key to avoid relying on id typing.
    const { error } = await supabase
      .from("team_season_stats")
      .update(payload)
      .eq("id", existingId);

    if (error) {
      return { success: false, error: error.message };
    }
    const snapshotIndex = existingRows.findIndex((row) => String(row.id) === existingId);
    if (snapshotIndex >= 0) existingRows[snapshotIndex] = { ...existingRows[snapshotIndex], ...payload };
    else existingRows.push({ id: existingId, ...payload });
  } else {
    /* Insert baris baru. JANGAN tambahkan `created_at`: tabel
       team_season_stats tidak punya kolom itu (skema: id, league_slug,
       season, team_name, 11 kolom stats_*, updated_at, team_key).
       Menulisnya membuat SETIAP insert tim baru gagal dengan
       "Could not find the 'created_at' column" — bug yang menelan
       FC Twente & Go Ahead Eagles (Eredivisie 2026-27) dan diam-diam
       menolak semua tim promosi/baru di liga mana pun. `updated_at`
       di payload sudah cukup dan memang kolom tabelnya. */
    const { data: inserted, error } = await supabase
      .from("team_season_stats")
      .insert(payload)
      .select("id")
      .maybeSingle();

    if (error) {
      return { success: false, error: error.message };
    }
    existingRows.push({ id: inserted?.id, ...payload });
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

    /*
     * Resolve the league against the live `leagues` table.
     *
     * Before this check the route wrote whatever slug it was given, so a
     * mismatched URL (footystats /spain/la-liga → "la-liga") silently created
     * a second home for 20 La Liga clubs under a slug nobody joins on. Failing
     * here is the difference between a broken import and a corrupt database.
     */
    /*
     * Pre-flight: reject payloads whose labels contradict the target column
     * BEFORE any database access. Doing this first keeps the error message
     * useful even when Supabase is unreachable, and avoids a round trip for a
     * request that can never succeed.
     */
    const contradicted: Array<{ team: string; reason: string }> = [];
    for (const team of teams) {
      const nameForError = String(
        team.raw_team_name ?? team.team_name ?? team.teamName ?? team.name ?? team.team ?? "UNKNOWN",
      );
      const data = team.stat_data ?? team.stats ?? team.values ?? team.data;
      if (!data || typeof data !== "object" || Array.isArray(data)) continue;
      const reason = detectStatTypeContradiction(statType, data as Record<string, unknown>);
      if (reason) contradicted.push({ team: nameForError, reason });
    }

    if (contradicted.length === teams.length) {
      /* Every team in the payload contradicts its target column: refuse the
         request outright instead of reporting a "successful" import of zero. */
      res.status(422).json({
        error: `Payload tidak cocok untuk stat_type "${statType}"`,
        rejected: contradicted,
        hint: "Periksa deteksi stat_type di ekstensi — blok yang dikirim berlabel sebaliknya.",
      });
      return;
    }

    const league = await resolveLeagueSlug(String(rawUrlPath));
    if (!league.ok) {
      logger.warn(
        { rawUrlPath, resolved: league.slug, suggestions: league.suggestions },
        "STATS INGEST: league_slug ditolak",
      );
      res.status(422).json({
        error: league.reason,
        raw_url_path: league.raw,
        resolved_slug: league.slug,
        suggestions: league.suggestions ?? [],
        known_leagues: [...(await loadKnownLeagueSlugs())],
        hint: "Kirim raw_url_path sebagai '<negara>/<kompetisi>', mis. 'spain/la-liga'.",
      });
      return;
    }
    const leagueSlug = league.slug;

    const normalizedSeason = normalizeSeason(String(rawSeason));
    if (!normalizedSeason || teams.length === 0) {
      res.status(400).json({
        error: "Season dan minimal satu tim diwajibkan",
        normalized: { league_slug: leagueSlug, season: normalizedSeason, team_count: teams.length },
      });
      return;
    }
    if (league.reason) {
      logger.warn({ leagueSlug, reason: league.reason }, "STATS INGEST: validasi liga dilewati");
    }

    logger.info(
      { leagueSlug, stat_type: statType, season: normalizedSeason, teamCount: teams.length },
      "STATS INGEST: Processing payload",
    );

    /*
     * Load the league/season stats once for the whole payload. The lookup used
     * to sit inside the per-team loop, so a 20-team payload read the same 11
     * JSONB columns 20 times.
     */
    const existingStatsRows: Array<Record<string, unknown>> = [];
    {
      const { data: loadedRows, error: loadError } = await supabase
        .from("team_season_stats")
        .select("*")
        .eq("league_slug", leagueSlug)
        .eq("season", normalizedSeason)
        .limit(500);
      if (loadError) {
        res.status(500).json({ error: `Existing-row lookup failed: ${loadError.message}` });
        return;
      }
      existingStatsRows.push(...((loadedRows ?? []) as Array<Record<string, unknown>>));
    }

    /*
     * Penjaga lintas-liga: tim yang sudah terdaftar di liga domestik LAIN
     * pada musim yang sama tidak boleh ditulis ke liga ini. Pada 13 Nov 2026
     * pemilih liga di ekstensi tertinggal di Championship saat halaman
     * La Liga di-scrape, sehingga 20 klub Spanyol tersimpan di bawah
     * england-championship tanpa ada yang protes — kedua slug sama-sama
     * valid, jadi validasi slug saja tidak cukup. Kompetisi piala/Eropa
     * dikecualikan: klub yang sama sah tampil di liga domestik dan
     * Champions League pada musim yang sama.
     */
    const isCupLeague = (slug: string) => slug.startsWith("uefa-") || slug.startsWith("international-");
    const foreignTeamLeagues = new Map<string, string>();
    if (!isCupLeague(leagueSlug)) {
      const { data: foreignRows, error: foreignError } = await supabase
        .from("team_season_stats")
        .select("team_name, league_slug")
        .eq("season", normalizedSeason)
        .neq("league_slug", leagueSlug)
        .limit(1000);
      if (foreignError) {
        logger.warn({ foreignError }, "STATS INGEST: penjaga lintas-liga dilewati (lookup gagal)");
      } else {
        for (const row of (foreignRows ?? []) as Array<Record<string, unknown>>) {
          const foreignSlug = String(row.league_slug ?? "");
          if (!foreignSlug || isCupLeague(foreignSlug)) continue;
          const foreignName = String(row.team_name ?? "");
          for (const key of [teamIdentityKey(foreignName), teamIdentityKey(foreignName, foreignSlug)]) {
            if (key && !foreignTeamLeagues.has(key)) foreignTeamLeagues.set(key, foreignSlug);
          }
        }
      }
    }

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

      /*
       * Blocking validation.
       *
       * `validateStatPayload` already knew which metrics a stat_type must
       * contain, but the result was only logged as a warning, so a payload of
       * "goals conceded" could be written into stats_goals_scored and nobody
       * would notice until the model produced nonsense. A block whose label
       * contradicts its destination column is now refused outright.
       *
       * Missing metrics are fatal only when EVERY expected metric is absent —
       * FootyStats pages legitimately omit a column or two, and rejecting
       * those would lose real data.
       */
      const validation = validateStatPayload(statType, statData);
      const contradiction = detectStatTypeContradiction(statType, statData);
      const nothingUsable = validation.valid === false || validation.missing.length === 0
        ? false
        : validation.missing.length >= (STATS_DICTIONARY[statType]?.metrics.length ?? 1);

      if (contradiction) {
        results.push({
          team: rawName,
          success: false,
          error: `stat_type ${statType} bertentangan dengan isi data: ${contradiction}`,
          warnings: [`tidak ditulis — periksa deteksi stat_type di ekstensi`],
        });
        continue;
      }
      if (nothingUsable) {
        results.push({
          team: rawName,
          success: false,
          error: `data tidak cocok untuk ${statType}: metrik ${validation.missing.join(", ")} tidak ada`,
          warnings: [`tidak ditulis — periksa deteksi stat_type di ekstensi`],
        });
        continue;
      }

      /* Penjaga lintas-liga (lihat pemuatan foreignTeamLeagues di atas). */
      const foreignLeague = [teamIdentityKey(rawName), teamIdentityKey(rawName, leagueSlug)]
        .map((key) => foreignTeamLeagues.get(key))
        .find(Boolean);
      if (foreignLeague) {
        results.push({
          team: rawName,
          success: false,
          error: `tim sudah terdaftar di liga "${foreignLeague}" musim ${normalizedSeason} — kemungkinan pemilih liga di ekstensi salah (payload mengklaim "${leagueSlug}")`,
          warnings: ["tidak ditulis — periksa liga terpilih di ekstensi"],
        });
        continue;
      }

      const warnings = [
        ...(validation.missing.length > 0 ? [`Missing expected metrics: ${validation.missing.join(", ")}`] : []),
        ...(validation.unknown.length > 0 ? [`Unrecognized metrics preserved: ${validation.unknown.join(", ")}`] : []),
      ];
      const result = await upsertTeamStat(
        leagueSlug,
        normalizedSeason,
        rawName,
        statType,
        statData,
        existingStatsRows,
      );
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
