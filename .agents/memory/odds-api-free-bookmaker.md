---
name: Odds-API free bookmaker
description: Current free-plan bookmaker constraint for the imported Odds-API account.
---

The current Odds-API account can fetch `Bet365` on the free plan. `Betano` and `1xBet` are rejected, while `Sbobet` requires a paid plan.

**Why:** Sending unsupported bookmaker selections returns HTTP 403 and wastes sync attempts.

**How to apply:** Keep outbound free-plan odds requests on `Bet365` unless the Odds-API subscription or selected bookmaker permissions change.