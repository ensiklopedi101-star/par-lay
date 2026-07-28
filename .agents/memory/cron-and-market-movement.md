---
name: Cron and market movement
description: External keep-alive routing and when odds movement snapshots are created.
---

Use `/api/cron?action=keep-alive` with `x-cron-secret` for external uptime pings; it must not trigger odds sync.

**Why:** The API router is mounted under `/api`, and triggering a sync every 15 minutes exhausts the free Odds-API quota. Market movement snapshots are created only during odds fetches when values differ.

**How to apply:** Configure cron-job.org against the public app/deployment URL with the `/api/cron` path and secret header. Use the internal scheduler or occasional authenticated `action=sync` for odds collection.