---
name: Cross-league stats resolver
description: Team statistics matching must tolerate league slug variants, season ranges, and provider team-name suffixes.
---

The analyzer resolves team statistics by fetching rows for equivalent league slugs, normalizing provider names (FC/Utd and common aliases), and supporting seasons such as `2025-26`; matches played comes from `stats_team_form.MP`, not a table column.

**Why:** Fixture data from Odds API and CSV statistics use different canonical naming conventions, and the live `team_season_stats` schema does not include a `matches_played` column.

**How to apply:** Reuse the centralized resolver for any analysis or relational stats lookup instead of adding league-specific exact string queries.