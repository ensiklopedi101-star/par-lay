/**
 * Drizzle mirror of the production Supabase table `odds_movement_history`.
 *
 * Only rows whose priced columns actually moved are inserted, so this table
 * stays far smaller than `odds_history`. Column types and nullability are
 * introspected from the live database.
 */

import { bigint, index, numeric, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const oddsMovementHistoryTable = pgTable("odds_movement_history", {
  id: bigint("id", { mode: "number" }).primaryKey(),
  /** TEXT on purpose: fixtures.fixture_id is INTEGER and the two do not join. */
  fixtureId: text("fixture_id").notNull(),
  bookmaker: text("bookmaker"),
  marketType: text("market_type").notNull(),
  homeOdds: numeric("home_odds"),
  awayOdds: numeric("away_odds"),
  drawOdds: numeric("draw_odds"),
  overOdds: numeric("over_odds"),
  underOdds: numeric("under_odds"),
  bttsYes: numeric("btts_yes"),
  bttsNo: numeric("btts_no"),
  capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
}, (t) => [
  /* All three exist in the live database. */
  index("idx_odds_movement_fixture_id").on(t.fixtureId),
  index("idx_odds_movement_captured_at").on(t.capturedAt),
  index("idx_omh_fixture").on(t.fixtureId, t.capturedAt),
]);

export const insertOddsMovementHistorySchema = createInsertSchema(oddsMovementHistoryTable);
export type InsertOddsMovementHistory = z.infer<typeof insertOddsMovementHistorySchema>;
export type OddsMovementHistory = typeof oddsMovementHistoryTable.$inferSelect;
