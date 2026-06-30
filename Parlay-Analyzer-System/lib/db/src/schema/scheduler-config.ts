import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const schedulerConfigTable = pgTable("scheduler_config", {
  id: serial("id").primaryKey(),
  leagues: text("leagues").array().notNull().default([]),
  bookmakers: text("bookmakers").array().notNull().default([]),
  markets: text("markets").array().notNull().default([]),
  cronExpression: text("cron_expression").notNull().default("0 */3 * * *"),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertSchedulerConfigSchema = createInsertSchema(schedulerConfigTable);
export type InsertSchedulerConfig = z.infer<typeof insertSchedulerConfigSchema>;
export type SchedulerConfig = typeof schedulerConfigTable.$inferSelect;
