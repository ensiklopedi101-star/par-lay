/**
 * Drizzle mirror of the production Supabase table `team_season_stats`.
 *
 * The live table stores eleven JSONB statistic columns (not flat numeric
 * columns), and every consumer — CSV upload, stats ingest, standings, AI
 * analysis — reads those JSONB keys. Keeping this schema aligned means
 * `drizzle-kit push` can no longer propose replacing the real table with an
 * incompatible flat layout.
 */

import { integer, jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
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

  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
}, (t) => [
  unique("uq_team_season_stats_key").on(t.leagueSlug, t.season, t.teamName),
]);

export const insertTeamSeasonStatsSchema = createInsertSchema(teamSeasonStatsTable);
export type InsertTeamSeasonStats = z.infer<typeof insertTeamSeasonStatsSchema>;
export type TeamSeasonStats = typeof teamSeasonStatsTable.$inferSelect;

/**
 * @deprecated Legacy flat table that production code never reads or writes.
 * Kept as a type-only alias so older imports keep compiling.
 */
export type TeamStats = TeamSeasonStats;
