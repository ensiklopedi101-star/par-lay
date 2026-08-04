---
name: Odds-API rate limit
description: Free-plan quota constraints and how the sync cap protects it.
---

Odds-API free plan allows **100 requests per hour**. The odds sync is capped at **40 new events per sync cycle** and uses the configured scan window for upcoming odds.

**Why:** Exceeding the quota returns HTTP 429 and pauses the sync until the hourly window resets. A background sync triggered every 30 minutes would likely exceed the free quota, so frequent external cron pings should use a lightweight `keep-alive` endpoint instead of `action=sync`.

**How to apply:**
1. Keep the internal `node-cron` scheduler as the main sync driver (currently every 6 hours).
2. Use cron-job.org only for `keep-alive` pings every 30 minutes to prevent Replit from sleeping.
3. If a faster sync interval is needed, upgrade the Odds-API plan before increasing the scheduler frequency or cron sync rate.

The provider may return the reset duration in the response body when `Retry-After` is absent. Treat both sources as valid, cap waits to a bounded maximum, and retry a league only a limited number of times before continuing with the remaining leagues.

**Why:** A missing header must not collapse the parsed wait to zero, while an uncapped reset window can block the whole scheduler. Bounded per-league recovery preserves progress without increasing request volume beyond the configured limits.
