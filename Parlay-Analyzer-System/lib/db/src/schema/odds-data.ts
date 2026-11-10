/**
 * @deprecated Production does not read or write `odds_data`.
 *
 * The live odds snapshots are stored per bookmaker/market in `odds_history`
 * (see `odds-history.ts`). This definition is kept only for type imports.
 */

import { integer, json, pgTable, serial, text, timestamp, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { oddsEventsTable } from "./odds-events";

export const oddsDataTable = pgTable(
  "odds_data",
  {
    id: serial("id").primaryKey(),
    eventId: integer("event_id")
      .notNull()
      .references(() => oddsEventsTable.id),
    bookmaker: text("bookmaker").notNull(),
    markets: json("markets").notNull(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [unique().on(t.eventId, t.bookmaker)],
);

export const insertOddsDataSchema = createInsertSchema(oddsDataTable);
export type InsertOddsData = z.infer<typeof insertOddsDataSchema>;
export type OddsData = typeof oddsDataTable.$inferSelect;
