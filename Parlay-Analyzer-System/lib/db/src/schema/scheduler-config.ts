/**
 * Drizzle mirror of the production Supabase table `scheduler_config`.
 *
 * The live columns are JSONB arrays, not Postgres `text[]`, and `id` is a
 * plain integer defaulting to 1 (single-row config). Types below are
 * introspected from the live database so `drizzle-kit push` proposes nothing.
 *
 * The API server reads this table through supabase-js, not through Drizzle;
 * this definition exists so the two never drift apart.
 */

import { boolean, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const schedulerConfigTable = pgTable("scheduler_config", {
  id: integer("id").primaryKey().default(1),
  leagues: jsonb("leagues").notNull().default([]),
  bookmakers: jsonb("bookmakers").notNull().default([]),
  markets: jsonb("markets").notNull().default([]),
  cronExpression: text("cron_expression").default("0 * * * *"),
  isActive: boolean("is_active").default(true),
  aiPersona: text("ai_persona"),
  agentInstructions: text("agent_instructions"),
  scanDays: integer("scan_days").notNull().default(11),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const insertSchedulerConfigSchema = createInsertSchema(schedulerConfigTable);
export type InsertSchedulerConfig = z.infer<typeof insertSchedulerConfigSchema>;
export type SchedulerConfig = typeof schedulerConfigTable.$inferSelect;
