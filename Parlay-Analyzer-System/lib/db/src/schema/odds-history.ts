/**
 * Drizzle mirror of the production Supabase table `odds_history`.
 *
 * Runtime code reads the generic odds slots, not the legacy `odds_events` /
 * `odds_data` pair: for ML/HT `odds_1`/`odds_2`/`odds_draw` are
 * home/away/draw, for Totals they are over/under/line, for BTTS yes/no and for
 * AH home/away/line.
 *
 * Column types and nullability below are introspected from the live database
 * (`information_schema`), so `drizzle-kit push` can no longer propose altering
 * `id` to a uuid or making nullable columns NOT NULL.
 */

import { index, integer, numeric, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const oddsHistoryTable = pgTable("odds_history", {
  /* bigserial-style integer PK; the sequence lives in the database. */
  id: integer("id").primaryKey(),
  matchId: text("match_id").notNull(),
  homeTeam: text("home_team"),
  awayTeam: text("away_team"),
  commenceTime: timestamp("commence_time", { withTimezone: true }),
  bookmaker: text("bookmaker"),
  /** Market type including the line suffix, e.g. "Totals 2.5". */
  marketType: text("market_type"),
  odds1: numeric("odds_1"),
  odds2: numeric("odds_2"),
  oddsDraw: numeric("odds_draw"),
  capturedAt: timestamp("captured_at", { withTimezone: true }),
}, (t) => [
  /* Every index below already exists in the live database. Declaring them
     keeps `drizzle-kit push` from proposing to drop the older duplicates
     created by earlier SQL migrations. */
  index("idx_odds_history_match_id").on(t.matchId),
  index("idx_odds_history_captured_at").on(t.capturedAt),
  index("idx_odds_history_bookmaker").on(t.bookmaker),
  index("idx_odds_history_latest_snapshot").on(
    t.matchId,
    t.bookmaker,
    t.marketType,
    t.capturedAt.desc(),
  ),
  index("idx_oh_match_id").on(t.matchId),
  index("idx_oh_captured").on(t.capturedAt),
  index("idx_oh_composite").on(t.matchId, t.bookmaker, t.marketType, t.capturedAt.desc()),
  index("idx_oh_time").on(t.commenceTime),
]);

export const insertOddsHistorySchema = createInsertSchema(oddsHistoryTable);
export type InsertOddsHistory = z.infer<typeof insertOddsHistorySchema>;
export type OddsHistory = typeof oddsHistoryTable.$inferSelect;
