---
name: Supabase PostgREST Pagination
description: Paginate bulk reads before aggregating fixture odds and movement status.
---

Supabase/PostgREST bulk reads are capped at 1,000 rows by default. Any read that aggregates `odds_history` or `odds_movement_history` across many fixtures must use deterministic range pagination; the same applies to the odds freshness lookup.

**Why:** Truncated bulk results made fixtures with saved odds appear empty in the UI and could make already-synced events look fresh-to-fetch, wasting provider quota.

**How to apply:** Order paged reads by stable identifying fields plus capture time, fetch ranges until the returned page is shorter than the page size, and keep fixture-level detail queries separate from list aggregation.
