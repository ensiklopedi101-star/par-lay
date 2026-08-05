---
name: Data integrity audit findings
description: Live Supabase data has legacy odds duplicates, team-name alias rows, and older parlays without matching legs.
---

The live schema intentionally treats `odds_history.match_id` as a provider event identifier, not a foreign key to `fixtures`. Current data contains repeated provider-key rows from legacy ingestion; current sync logic updates the latest row for that key, while movement history is the append-only change log.

**Why:** A cleanup that deletes repeated odds rows can destroy market history, and a generic fixture join would incorrectly assume `match_id` equals `fixtures.fixture_id`.

**How to apply:** Analyze odds by latest captured row per provider/bookmaker/market, preserve movement history, and only deduplicate legacy rows after defining a retention policy and backup.

Team stats can still contain multiple rows for one normalized club identity within a league and season, such as `Heerenveen` and `SC Heerenveen`; resolver matching helps analysis but does not merge stored JSONB fields.

**Why:** Name cleaning and entity resolution are separate from database reconciliation.

**How to apply:** Merge aliases with an explicit canonical mapping and field-level conflict policy before changing the live stats rows.

The confirmed Eredivisie aliases `SC Heerenveen → Heerenveen` and `FC Utrecht → Utrecht` were merged at field level without conflicts; canonical rows were retained and alias rows removed after readback verification.

**Why:** These identities were confirmed by the user’s example and live rows showed complementary or empty fields rather than conflicting values.

**How to apply:** Keep future alias additions conservative and require an explicit mapping plus conflict guard; do not infer arbitrary clubs from fuzzy similarity alone.