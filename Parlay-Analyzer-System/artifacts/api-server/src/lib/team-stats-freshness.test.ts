import assert from "node:assert/strict";
import test from "node:test";
import { assessTeamStatsFreshness, TEAM_STATS_STALE_DAYS } from "./team-stats-freshness";

const now = Date.UTC(2026, 9, 17, 12);

test("current-season stats within the configured window are fresh", () => {
  const result = assessTeamStatsFreshness({
    current_season: { updated_at: new Date(now - 5 * 24 * 60 * 60 * 1000).toISOString() },
  }, now);

  assert.equal(result.valid, true);
  assert.equal(result.source, "current_season");
  assert.equal(result.ageDays, 5);
});

test("baseline-only stats use the baseline timestamp", () => {
  const result = assessTeamStatsFreshness({
    current_season: "DATA_UNAVAILABLE",
    baseline_reference: { updated_at: new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString() },
  }, now);

  assert.equal(result.valid, true);
  assert.equal(result.source, "baseline_reference");
});

test("stats older than the shared health window are stale", () => {
  const result = assessTeamStatsFreshness({
    updated_at: new Date(now - (TEAM_STATS_STALE_DAYS + 1) * 24 * 60 * 60 * 1000).toISOString(),
  }, now);

  assert.equal(result.valid, false);
  assert.equal(result.ageDays, TEAM_STATS_STALE_DAYS + 1);
});

test("missing and future timestamps fail closed", () => {
  assert.equal(assessTeamStatsFreshness({ stats_xg: 1.4 }, now).valid, false);
  assert.equal(
    assessTeamStatsFreshness({ updated_at: new Date(now + 60_000).toISOString() }, now).valid,
    false,
  );
});
