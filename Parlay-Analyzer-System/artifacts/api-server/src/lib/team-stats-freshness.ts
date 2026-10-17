export const TEAM_STATS_STALE_DAYS = 14;

export interface TeamStatsFreshness {
  valid: boolean;
  source: "current_season" | "baseline_reference" | "row" | "missing";
  updatedAt: string | null;
  ageDays: number | null;
}

export function assessTeamStatsFreshness(
  stats: Record<string, unknown>,
  now = Date.now(),
): TeamStatsFreshness {
  const current = stats.current_season && typeof stats.current_season === "object"
    ? stats.current_season as Record<string, unknown>
    : null;
  const baseline = stats.baseline_reference && typeof stats.baseline_reference === "object"
    ? stats.baseline_reference as Record<string, unknown>
    : null;
  const source: TeamStatsFreshness["source"] = current
    ? "current_season"
    : baseline
      ? "baseline_reference"
      : Object.keys(stats).length > 0
        ? "row"
        : "missing";
  const selected = current ?? baseline ?? stats;
  const updatedAt = typeof selected.updated_at === "string" ? selected.updated_at : null;
  const timestamp = updatedAt ? new Date(updatedAt).getTime() : Number.NaN;
  if (!Number.isFinite(timestamp)) {
    return { valid: false, source, updatedAt, ageDays: null };
  }
  const ageDays = (now - timestamp) / (24 * 60 * 60 * 1000);
  return {
    valid: ageDays >= 0 && ageDays <= TEAM_STATS_STALE_DAYS,
    source,
    updatedAt,
    ageDays: Number.isFinite(ageDays) ? Math.max(0, Math.floor(ageDays)) : null,
  };
}
