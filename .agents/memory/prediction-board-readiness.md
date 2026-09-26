---
name: Prediction board readiness
description: Prediction Board readiness uses structured market, provider odds, and explicit probability fields rather than prose.
---

Prediction Board and parlay creation must read explicit probability from the compact context field or versioned recommendation snapshot. Never derive it from confidence or free-form analysis text; a narrative “AMBIL” is not an actionable bet unless the structured market and verified odds also exist.

**Why:** AI output can recommend a market in prose while omitting the required JSON probability or failing provider-market verification. Treating prose as authoritative would create bets with unverifiable price/EV inputs.

**How to apply:** Keep the board fail-closed, expose the specific missing readiness field to users, and re-run or repair legacy predictions only through an explicit analysis/revalidation flow.