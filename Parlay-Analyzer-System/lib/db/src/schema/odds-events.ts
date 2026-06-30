import { pgTable, integer, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const oddsEventsTable = pgTable("odds_events", {
  id: integer("id").primaryKey(),
  leagueSlug: text("league_slug").notNull(),
  home: text("home").notNull(),
  away: text("away").notNull(),
  date: timestamp("date").notNull(),
  status: text("status").notNull().default("pending"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertOddsEventSchema = createInsertSchema(oddsEventsTable);
export type InsertOddsEvent = z.infer<typeof insertOddsEventSchema>;
export type OddsEvent = typeof oddsEventsTable.$inferSelect;
