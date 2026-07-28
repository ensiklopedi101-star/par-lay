---
name: Upcoming odds sync policy
description: Odds syncing is limited to configured leagues and the near-term fixture window.
---

Keep historical fixtures; only fetch new odds for pending fixtures within the next 10 days, capped at 80 events per sync cycle.

**Why:** The free Odds-API quota is 100 requests/hour, so syncing the full historical/event catalog wastes quota and prevents timely odds for near-term matches.

**How to apply:** Treat `scheduler_config.leagues` as the configured scope, preserve old rows for history, and let later cycles cover remaining upcoming events.