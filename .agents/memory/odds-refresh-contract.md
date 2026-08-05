---
name: Odds refresh and AI data contract
description: Readiness refresh states, three-hour freshness, and explicit odds slot mapping sent to AI.
---

Successful odds refresh within three hours may support `ready`; a rate-limited refresh exposes last-known odds only as `rate_limited_unverified` and never unlocks automatic merge. Provider responses without usable markets are `missing_odds`, distinct from refresh failures.

**Why:** A failed provider refresh cannot prove that last-known odds are unchanged, while a successful response with unchanged prices is still a verified refresh.

**How to apply:** Keep refresh results per fixture, prioritize the nearest upcoming kickoff, and preserve `odds_history` snapshots. In AI input, map `odds_1/odds_2/odds_draw` explicitly: 1X2 = home/draw/away, Totals = over/under, BTTS = yes/no, with bookmaker and capture timestamp.