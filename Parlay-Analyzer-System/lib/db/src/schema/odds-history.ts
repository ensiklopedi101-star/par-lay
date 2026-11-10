/**
 * Drizzle mirror of the production Supabase table `odds_history`.
 *
 * Runtime code reads the generic odds slots, not the legacy `odds_events` /
 * `odds_data` pair: for ML/HT `odds_1`/`odds_2`/`odds_draw` are
 * home/away/draw, for Totals they are over/under/line, for BTTS yes/no and for
 * AH home/away/line. Keeping the columns aligned prevents `drizzle-kit push`
 * from creating a parallel table that nothing reads.
 */

import { doublePrecision, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const oddsHistoryTable = pgTable("odds_history", {
  id: uuid("id").primaryKey().defaultRandom(),
  matchId: text("match_id").notNull(),
  homeTeam: text("home_team"),
  awayTeam: text("away_team"),
  commenceTime: timestamp("commence_time", { withTimezone: true }),
  bookmaker: text("bookmaker").notNull(),
  /** Market type including the line suffix, e.g. "Totals 2.5". */
  marketType: text("market_type").notNull(),
  odds1: doublePrecision("odds_1"),
  odds2: doublePrecision("odds_2"),
  oddsDraw: doublePrecision("odds_draw"),
  capturedAt: timestamp("captured_at", { withTimezone: true }).defaultNow(),
}, (t) => [
  index("idx_odds_history_match_id").on(t.matchId),
  index("idx_odds_history_captured_at").on(t.capturedAt),
]);

export const insertOddsHistorySchema = createInsertSchema(oddsHistoryTable);
export type InsertOddsHistory = z.infer<typeof insertOddsHistorySchema>;
export type OddsHistory = typeof oddsHistoryTable.$inferSelect;
