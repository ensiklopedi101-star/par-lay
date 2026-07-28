---
name: Batch scanner fixture schema
description: The batch analyzer must query fixtures using the live fixture_date and home_team_name/away_team_name columns.
---

The live `fixtures` table uses `fixture_date`, `home_team_name`, and `away_team_name`; batch scanning must use those columns rather than the older `event_date`, `home_team`, or `away_team` names.

**Why:** A stale date-column assumption made the scanner report zero upcoming fixtures even though the dashboard query returned events.

**How to apply:** When changing the batch window or scan query, validate against `/api/supabase/fixtures` and check Supabase query errors before interpreting an empty result.