---
name: Performance log schema
description: Feedback aggregates must use the live performance_log column names
---

The live `performance_log` table stores aggregate counts as `total_parlays`, `wins`, and `losses`; it does not use the legacy names `predictions_made`, `valid_tickets`, `win_count`, or `loss_count`.

**Why:** Inserts using the legacy names failed while errors were ignored, leaving AI Learning permanently in `no_data` even though settlement created lessons.

**How to apply:** Validate feedback writes against the live PostgREST schema, log insert/update errors explicitly, and rebuild aggregate rows from `lessons_learned` so metrics recover after a failed write or server restart.