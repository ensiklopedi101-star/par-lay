---
name: Cross-league stats resolver
description: Team statistics matching must tolerate league slug variants, season ranges, and provider team-name suffixes.
---

The analyzer resolves team statistics by fetching rows for equivalent league slugs, normalizing provider names (FC/Utd and common aliases), and supporting seasons such as `2025-26`; matches played comes from `stats_team_form.MP`, not a table column. Merge aliases only when canonical identity is exact or the shorter label is unambiguous among teams in that league.

**Why:** Fixture data from Odds API and CSV statistics use different canonical naming conventions, and the live `team_season_stats` schema does not include a `matches_played` column. Broad fuzzy matching can incorrectly combine different clubs that share generic tokens such as "United".

**How to apply:** Reuse the centralized resolver for analysis, ingestion, health, standings, and team-stat display. If a short alias is ambiguous in the league, add an explicit league-scoped alias instead of loosening the fuzzy threshold.