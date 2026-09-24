/**
 * JSONB statistic columns stored in team_season_stats.
 */
export const TEAM_STATS_JSON_COLUMNS = [
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
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function timestampOf(row: Record<string, unknown>): number {
  const timestamp = new Date(String(row.updated_at ?? row.created_at ?? "")).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

/**
 * Merge rows representing one team/league/season entity.
 *
 * The newest row wins when the same JSON key conflicts, while keys that only
 * exist in an older alias row are retained. This is important for imports
 * split by stat category or for legacy aliases that were ingested separately.
 */
export function mergeTeamStatsRows(rows: Array<Record<string, unknown>>): Record<string, unknown> {
  if (rows.length === 0) return {};

  const ordered = [...rows].sort((a, b) => timestampOf(a) - timestampOf(b));
  const merged: Record<string, unknown> = { ...ordered[0] };

  for (const row of ordered) {
    for (const column of TEAM_STATS_JSON_COLUMNS) {
      const incoming = row[column];
      if (isRecord(incoming)) {
        const current = isRecord(merged[column]) ? merged[column] : {};
        merged[column] = { ...current, ...incoming };
      } else if (incoming !== null && incoming !== undefined) {
        merged[column] = incoming;
      }
    }

    for (const column of ["league_slug", "season", "team_name", "updated_at", "created_at"]) {
      if (row[column] !== null && row[column] !== undefined) {
        merged[column] = row[column];
      }
    }
  }

  return merged;
}