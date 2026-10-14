---
name: Settlement provider fail-closed
description: Odds-API historical result lookup, score parsing, quota handling, and fail-closed behavior
---

Odds-API `/v3/historical/events` returns settled events only, with full-time scores in `scores.home` / `scores.away` and football first-half scores in `scores.periods.p1`. Its date range is limited to 31 days and result coverage is incomplete (about 90% from March 2026 onward). Treat `settled` as a final status, but never infer a result from kickoff time or a missing event.

**Why:** The provider may omit matches outside its coverage window or before its settlement pipeline finishes. Replacing missing scores with guesses corrupts the prediction record and AI feedback loop; continuing requests after HTTP 429 wastes the shared hourly quota.

**How to apply:** Request historical results only for fixture IDs attached to unsettled predictions, grouped by league and bounded to the provider's 31-day range. On HTTP 429, stop the remaining league requests for that run. Keep local verified scores usable; otherwise leave predictions retryable and exclude them from learning until both final scores and a supported structured market are present.