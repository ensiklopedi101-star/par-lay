import {
  canonicalTeamName,
  leagueIdentityKey,
  teamIdentityKey,
  teamNamesEquivalent,
} from "./team-name-cleaner";

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
    for (const [column, incoming] of Object.entries(row)) {
      if (column === "id" || incoming === null || incoming === undefined) continue;
      if (isRecord(incoming)) {
        const current = isRecord(merged[column]) ? merged[column] : {};
        const nonNullEntries = Object.fromEntries(
          Object.entries(incoming).filter(([, value]) => value !== null && value !== undefined),
        );
        merged[column] = { ...current, ...nonNullEntries };
      } else {
        merged[column] = incoming;
      }
    }
  }

  return merged;
}

/**
 * Return all rows that safely represent the requested team. Callers should
 * pass the full set of names in the league so one-word aliases are resolved
 * only when they identify a single entity.
 */
export function findEquivalentTeamStatsRows(
  rows: Array<Record<string, unknown>>,
  requestedTeam: string,
  leagueSlug: string,
): Array<Record<string, unknown>> {
  const candidateNames = Array.from(new Set(
    rows.map((row) => String(row.team_name ?? "").trim()).filter(Boolean),
  ));
  const matchedKeys = new Set(
    candidateNames
      .filter((name) => teamNamesEquivalent(requestedTeam, name, leagueSlug, candidateNames))
      .map((name) => teamIdentityKey(name, leagueSlug)),
  );
  return rows.filter((row) =>
    matchedKeys.has(teamIdentityKey(String(row.team_name ?? ""), leagueSlug)),
  );
}

export function preferredTeamDisplayName(
  requestedTeam: string,
  matchedRows: Array<Record<string, unknown>>,
  leagueSlug: string,
): string {
  const names = Array.from(new Set([
    ...matchedRows.map((row) => String(row.team_name ?? "").trim()),
    requestedTeam.trim(),
  ].filter(Boolean).map((name) => canonicalTeamName(name, leagueSlug))));
  return names.sort((a, b) =>
    teamNameTokensForSort(b) - teamNameTokensForSort(a) || b.length - a.length,
  )[0] ?? canonicalTeamName(requestedTeam, leagueSlug);
}

/**
 * Consolidate duplicate/alias team rows for display and health calculations.
 * Grouping is scoped to the same normalized league and season, so a new-season
 * row can never inherit a previous season's stats.
 */
export function groupEquivalentTeamStatsRows(
  rows: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  const buckets = new Map<string, Array<Record<string, unknown>>>();
  for (const row of rows) {
    const league = leagueIdentityKey(row.league_slug);
    const season = String(row.season ?? "");
    const key = `${league}::${season}`;
    const bucket = buckets.get(key) ?? [];
    bucket.push(row);
    buckets.set(key, bucket);
  }

  const result: Array<Record<string, unknown>> = [];
  for (const bucket of buckets.values()) {
    const leagueSlug = String(bucket[0]?.league_slug ?? "");
    const teamUniverse = Array.from(new Set(
      bucket.map((row) => String(row.team_name ?? "").trim()).filter(Boolean),
    ));
    const entities = new Map<string, { names: string[]; rows: Array<Record<string, unknown>> }>();
    for (const row of bucket) {
      const name = String(row.team_name ?? "").trim();
      const key = teamIdentityKey(name, leagueSlug);
      const entity = entities.get(key) ?? { names: [], rows: [] };
      if (name && !entity.names.includes(name)) entity.names.push(name);
      entity.rows.push(row);
      entities.set(key, entity);
    }

    const groups = Array.from(entities.entries()).map(([key, entity]) => ({
      keys: new Set([key]),
      names: entity.names,
      rows: entity.rows,
    }));
    const parent = groups.map((_group, index) => index);
    const findRoot = (index: number): number => {
      if (parent[index] !== index) parent[index] = findRoot(parent[index]!);
      return parent[index]!;
    };

    for (let left = 0; left < groups.length; left++) {
      for (let right = left + 1; right < groups.length; right++) {
        const leftName = groups[left]!.names[0] ?? "";
        const rightName = groups[right]!.names[0] ?? "";
        if (!teamNamesEquivalent(leftName, rightName, leagueSlug, teamUniverse)) continue;
        const leftRoot = findRoot(left);
        const rightRoot = findRoot(right);
        if (leftRoot !== rightRoot) parent[rightRoot] = leftRoot;
      }
    }

    const mergedGroups = new Map<number, { names: string[]; rows: Array<Record<string, unknown>> }>();
    groups.forEach((group, index) => {
      const root = findRoot(index);
      const merged = mergedGroups.get(root) ?? { names: [], rows: [] };
      merged.names.push(...group.names);
      merged.rows.push(...group.rows);
      mergedGroups.set(root, merged);
    });

    for (const group of mergedGroups.values()) {
      const merged = mergeTeamStatsRows(group.rows);
      const displayNames = group.names
        .map((name) => canonicalTeamName(name, leagueSlug))
        .sort((a, b) => teamNameTokensForSort(b) - teamNameTokensForSort(a) || b.length - a.length);
      if (displayNames[0]) merged.team_name = displayNames[0];
      result.push(merged);
    }
  }

  return result;
}

function teamNameTokensForSort(name: string): number {
  return name.trim().split(/\s+/).filter(Boolean).length;
}