import * as zod from "zod";

/**
 * Returns server health status
 * @summary Health check
 */
export const HealthCheckResponse = zod.object({
  status: zod.string(),
});

/* ─── Odds ─── */
export const ListEventsQueryParams = zod.object({
  league: zod.string().optional(),
  limit: zod.coerce.number().min(1).max(500).optional(),
});

export const GetEventParams = zod.object({
  eventId: zod.number().min(1),
});

/* ─── Config ─── */
export const SaveConfigBody = zod.object({
  leagues: zod.array(zod.string()).min(1),
  bookmakers: zod.array(zod.string()).min(1),
  markets: zod.array(zod.string()).min(1),
  cronExpression: zod.string().min(1),
});
