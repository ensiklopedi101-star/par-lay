---
name: Sync runs source of truth
description: lastSyncAt is now read from the sync_runs table instead of fixtures.updated_at.
---

`/api/sync/status` reads the most recent `sync_runs` row to report `lastSyncAt`. The previous fallback used `fixtures.updated_at`, which was inaccurate because many fixtures were updated without a full sync.

**Why:** A dedicated `sync_runs` table tracks exactly when the odds sync started, finished, and how many events/odds were fetched, making the dashboard sync status reliable.

**How to apply:**
1. Always create a `sync_runs` row when a sync starts and update it when the sync finishes.
2. Use `sync_runs` as the primary source for the dashboard “Last Sync” indicator.
3. Keep `fixtures.updated_at` only for fixture-level freshness, not sync-level freshness.
