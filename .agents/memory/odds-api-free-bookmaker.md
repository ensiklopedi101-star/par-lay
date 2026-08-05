---
name: Odds-API free bookmaker
description: Current free-plan bookmaker constraint for the imported Odds-API account.
---

The current Odds-API account can fetch `Bet365` on the free plan. `Betano` and `1xBet` are rejected, while `Sbobet` requires a paid plan.

**Why:** Sending unsupported bookmaker selections returns HTTP 403 and wastes sync attempts.

**How to apply:** Keep outbound free-plan odds requests on `Bet365` unless the Odds-API subscription or selected bookmaker permissions change.

The pre-bet readiness flow may still return `missing_odds` when Bet365 responds without bookmaker markets for a fixture; readiness must fail closed rather than reuse stale odds.

**Why:** A successful provider HTTP response does not guarantee a usable market snapshot.

**How to apply:** Treat empty bookmaker payloads as missing current odds and keep the parlay blocked until a safely matched market is available.