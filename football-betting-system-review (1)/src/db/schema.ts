import {
  doublePrecision,
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

/**
 * Ledger bet — sumber kebenaran untuk pembelajaran berbasis bukti.
 * Setiap bet menyimpan: probabilitas model, probabilitas fair pasar saat bet,
 * odds yang diambil, closing odds, dan hasil. Dari sini dihitung CLV,
 * kalibrasi, skill vs pasar, dan signifikansi statistik.
 */
export const bets = pgTable(
  "bets",
  {
    id: serial("id").primaryKey(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    kickoffAt: timestamp("kickoff_at", { withTimezone: true }),
    league: text("league").notNull().default(""),
    homeTeam: text("home_team").notNull(),
    awayTeam: text("away_team").notNull(),
    /** ML | Totals | AH | BTTS | HT */
    marketFamily: text("market_family").notNull().default("ML"),
    selection: text("selection").notNull(),
    line: doublePrecision("line"),
    oddsTaken: doublePrecision("odds_taken").notNull(),
    pModel: doublePrecision("p_model"),
    pMarketFair: doublePrecision("p_market_fair"),
    pFinal: doublePrecision("p_final"),
    stakeUnits: doublePrecision("stake_units").notNull().default(1),
    oddsClose: doublePrecision("odds_close"),
    closeFairProb: doublePrecision("close_fair_prob"),
    /** win | half_win | push | half_loss | loss | void | null (belum selesai) */
    outcome: text("outcome"),
    settledAt: timestamp("settled_at", { withTimezone: true }),
    /** manual | demo */
    source: text("source").notNull().default("manual"),
    notes: text("notes"),
    modelVersion: integer("model_version").notNull().default(1),
  },
  (t) => [index("bets_created_idx").on(t.createdAt), index("bets_source_idx").on(t.source)],
);

export type BetRow = typeof bets.$inferSelect;
export type NewBetRow = typeof bets.$inferInsert;
