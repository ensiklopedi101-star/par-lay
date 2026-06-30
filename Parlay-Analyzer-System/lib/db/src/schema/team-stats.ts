import { pgTable, serial, text, real, integer, timestamp, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const teamStatsTable = pgTable("team_stats", {
  id: serial("id").primaryKey(),
  team: text("team").notNull(),
  teamNormalized: text("team_normalized").notNull(),
  leagueSlug: text("league_slug").notNull(),
  season: text("season").notNull(),
  mp: integer("mp"),
  xg: real("xg"),
  xga: real("xga"),
  xgd: real("xgd"),
  gf: real("gf"),
  ga: real("ga"),
  xgVsActual: real("xg_vs_actual"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  unique("uq_team_stats_normalized_league_season").on(t.teamNormalized, t.leagueSlug, t.season),
]);

export const insertTeamStatsSchema = createInsertSchema(teamStatsTable);
export type InsertTeamStats = z.infer<typeof insertTeamStatsSchema>;
export type TeamStats = typeof teamStatsTable.$inferSelect;
