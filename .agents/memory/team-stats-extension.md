---
name: Team stats extension ingestion
description: FootyStats extension input compatibility and authentication prerequisite
---

The team-stats extension endpoint must accept common aliases for league, season, stat type, team name, and stat payload, normalize full FootyStats URLs and season formats, preserve unknown metrics as warnings, and return per-team failures instead of reporting a false success.

**Why:** The extension source is not part of this workspace, so payload compatibility must be handled at the API boundary. The live environment also requires a separately configured `EXTENSION_API_KEY`; without it ingestion is intentionally blocked rather than unauthenticated.

**How to apply:** Keep the extension contract documented by `/api/stats/ingest-info`, configure the same key on the extension and Replit Secrets, and inspect `result_rows`/`warnings` after each upload.