---
name: Odds refresh and AI data contract
description: Readiness refresh states, three-hour freshness, and explicit odds slot mapping sent to AI.
---

Successful odds refresh within three hours may support `ready`; a rate-limited refresh exposes last-known odds only as `rate_limited_unverified` and never unlocks automatic merge. Provider responses without usable markets are `missing_odds`, distinct from refresh failures.

**Why:** A failed provider refresh cannot prove that last-known odds are unchanged, while a successful response with unchanged prices is still a verified refresh.

**How to apply:** Keep refresh results per fixture, prioritize the nearest upcoming kickoff, and preserve `odds_history` snapshots. In AI input, map `odds_1/odds_2/odds_draw` explicitly: 1X2/HT = home/draw/away, Totals = over/under/line, AH = home/away/line, BTTS = yes/no, with bookmaker and capture timestamp. The Settings market selection must filter sync eligibility; when the live schema has no line column, preserve provider lines in the market identity plus the generic line slot rather than dropping alternate markets.

**Why:** The scheduler previously displayed selected markets without passing them into sync, while alternate totals/spread and HT rows were either unclassified or exposed as generic odds. Keeping one shared classifier prevents Settings, persistence, fixture detail, and AI from disagreeing.