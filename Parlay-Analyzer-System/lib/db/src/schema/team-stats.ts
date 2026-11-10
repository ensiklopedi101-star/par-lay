/**
 * Drizzle mirror of the production Supabase table `team_season_stats`.
 *
 * The live table stores eleven JSONB statistic columns (not flat numeric
 * columns), and every consumer — CSV upload, stats ingest, standings, AI
 * analysis — reads those JSONB keys. Types, defaults and the unique constraint
 * below are introspected from the live database, so `drizzle-kit push` proposes
 * no changes and can no longer replace the real table with an incompatible
 * flat layout.
 */

import { index, jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const teamSeasonStatsTable = pgTable("team_season_stats", {
  id: uuid("id").primaryKey().defaultRandom(),
  leagueSlug: text("league_slug").notNull(),
  season: text("season").notNull(),
  teamName: text("team_name").notNull(),

  /* The eleven JSONB statistic blobs written by CSV upload / stats ingest. */
  statsXg: jsonb("stats_xg"),
  statsFts: jsonb("stats_fts"),
  statsBtts: jsonb("stats_btts"),
  statsGoalsConceded: jsonb("stats_goals_conceded"),
  statsGoalsScored: jsonb("stats_goals_scored"),
  statsShots: jsonb("stats_shots"),
  statsOver25: jsonb("stats_over_25"),
  statsOver35: jsonb("stats_over_35"),
  statsUnder: jsonb("stats_under"),
  statsTeamForm: jsonb("stats_team_form"),
  statsHt: jsonb("stats_ht"),

  /* No created_at column exists in the live table — only updated_at. */
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
}, (t) => [
  /* Matches the live constraint name, so push sees no change. */
  unique("team_season_stats_league_slug_season_team_name_key").on(
    t.leagueSlug,
    t.season,
    t.teamName,
  ),
  index("idx_team_season_stats_team_name").on(t.teamName),
  /* Duplicate of the two above, but present in the live database. */
  index("idx_team_season_stats_key").on(t.leagueSlug, t.season, t.teamName),
  index("idx_team_stats_lookup").on(t.leagueSlug, t.season, t.teamName),
]);

export const insertTeamSeasonStatsSchema = createInsertSchema(teamSeasonStatsTable);
export type InsertTeamSeasonStats = z.infer<typeof insertTeamSeasonStatsSchema>;
export type TeamSeasonStats = typeof teamSeasonStatsTable.$inferSelect;

/**
 * @deprecated Legacy flat table that production code never reads or writes.
 * Kept as a type-only alias so older imports keep compiling.
 */
export type TeamStats = TeamSeasonStats;
