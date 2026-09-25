import assert from "node:assert/strict";
import test from "node:test";
import { teamNamesEquivalent } from "./team-name-cleaner";
import {
  findEquivalentTeamStatsRows,
  groupEquivalentTeamStatsRows,
  preferredTeamDisplayName,
} from "./team-stats-merge";

test("Leipzig and RB Leipzig resolve to one Bundesliga entity and combine categories", () => {
  const rows = [
    {
      team_name: "Leipzig",
      league_slug: "germany-bundesliga",
      season: "2025-26",
      stats_xg: { xG: "1.72", xGA: "1.21" },
      updated_at: "2026-01-01T00:00:00.000Z",
    },
    {
      team_name: "RB Leipzig",
      league_slug: "germany-bundesliga",
      season: "2025-26",
      stats_team_form: { MP: "17", Pts: "31" },
      updated_at: "2026-01-02T00:00:00.000Z",
    },
  ];

  assert.equal(teamNamesEquivalent("Leipzig", "RB Leipzig", "germany-bundesliga"), true);
  assert.equal(findEquivalentTeamStatsRows(rows, "RB Leipzig", "germany-bundesliga").length, 2);
  assert.equal(preferredTeamDisplayName("Leipzig", rows, "germany-bundesliga"), "RB Leipzig");

  const [merged] = groupEquivalentTeamStatsRows(rows);
  assert.equal(merged?.team_name, "RB Leipzig");
  assert.deepEqual(merged?.stats_xg, { xG: "1.72", xGA: "1.21" });
  assert.deepEqual(merged?.stats_team_form, { MP: "17", Pts: "31" });
});

test("common spelling and suffix variations resolve across leagues", () => {
  assert.equal(teamNamesEquivalent("Man City", "Manchester City", "england-premier-league"), true);
  assert.equal(teamNamesEquivalent("Leeds", "Leeds United", "england-premier-league", ["Leeds", "Leeds United"]), true);
  assert.equal(preferredTeamDisplayName("Leeds", [{ team_name: "Leeds United" }], "england-premier-league"), "Leeds United");
});

test("one-word aliases shared by multiple teams stay ambiguous", () => {
  const rows = [
    { team_name: "Manchester United", league_slug: "england-premier-league", season: "2025-26", stats_xg: { xG: "1.5" } },
    { team_name: "Newcastle United", league_slug: "england-premier-league", season: "2025-26", stats_xg: { xG: "1.4" } },
  ];

  assert.deepEqual(findEquivalentTeamStatsRows(rows, "United", "england-premier-league"), []);
});

test("alias stats from different seasons are never combined", () => {
  const rows = [
    { team_name: "RB Leipzig", league_slug: "germany-bundesliga", season: "2024-25", stats_xg: { xG: "1.4" } },
    { team_name: "Leipzig", league_slug: "germany-bundesliga", season: "2025-26", stats_team_form: { MP: "17" } },
  ];

  assert.equal(groupEquivalentTeamStatsRows(rows).length, 2);
});