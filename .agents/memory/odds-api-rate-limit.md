---
name: Odds-API rate limit
description: Free-plan quota constraints and how the sync cap protects it.
---

Odds-API free plan allows **100 requests per hour**. The odds sync is therefore capped at **80 new events per sync cycle** to leave headroom for league/odds metadata requests.

**Why:** Exceeding the quota returns HTTP 429 and pauses the sync until the hourly window resets. A background sync triggered every 30 minutes would likely exceed the free quota, so frequent external cron pings should use a lightweight `keep-alive` endpoint instead of `action=sync`.

**How to apply:**
1. Keep the internal `node-cron` scheduler as the main sync driver (default every 3 hours).
2. Use cron-job.org only for `keep-alive` pings every 30 minutes to prevent Replit from sleeping.
3. If a faster sync interval is needed, upgrade the Odds-API plan before increasing the scheduler frequency or cron sync rate.
