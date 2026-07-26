---
name: Supabase migration validation
description: Validate migrations against the live schema before applying; old assumptions about column names and FK targets can be stale.
---

Before applying a Supabase DDL migration, inspect the actual database schema with `information_schema.columns` and existing constraints. The codebase and memory may assume columns or FK targets that have changed over time.

**Why:** The 2026-07-01 migration assumed `fixtures.event_date` and `parlays.parlay_id` existed, but the live schema only had `fixtures.fixture_date` and `parlays.id`. It also tried to create FKs from `odds_history.match_id` (text, provider event hash) and `odds_movement_history.fixture_id` (text) to `fixtures.fixture_id` (integer), which cannot work without a type/referential change.

**How to apply:**
1. Query `information_schema.columns` for the target tables before writing or editing the migration.
2. Make indexes `IF NOT EXISTS` and replace FKs only when column types and references match.
3. When replacing existing auto-named FKs, drop the old name and add the new name in a single `ALTER TABLE` so the operation stays atomic.
