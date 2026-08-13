---
name: Settlement market parsing
description: Final recommendation fields must take precedence over prose mentions of NO BET during result settlement
---

Settlement must determine whether a prediction is a real bet from the structured selected market (`market_bet` or `best_market`) before scanning the generated explanation for “NO BET”.

**Why:** Gemini analyses can mention “NO BET” for alternative markets while still selecting a valid final recommendation. Treating any prose mention as a no-bet suppresses WIN/LOSS settlement and leaves parlays active after kickoff.

**How to apply:** When repairing or extending settlement, reprocess recoverable `no_bet`/manual rows that have a structured selected market, update their leg results, and settle the parent parlay after all legs have results.