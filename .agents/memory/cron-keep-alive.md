---
name: Cron keep-alive for Replit
description: How to keep a free Replit workspace alive and trigger sync without exposing the admin password.
---

Free Replit workspaces go to sleep after ~30 minutes of inactivity. The internal `node-cron` scheduler stops when the workspace sleeps, so an external cron service (e.g., cron-job.org) is needed to keep the app alive.

**Why:** A separate `CRON_SECRET` is better than exposing the admin endpoint to a third-party cron service. The cron endpoint only starts the sync it is asked to start, so a lightweight `keep-alive` ping can run every 30 minutes without burning the Odds-API free-plan quota (100 req/hour).

**How to apply:**
1. Add a cron route (e.g., `GET /api/cron?token=<CRON_SECRET>&action=keep-alive`) that validates `CRON_SECRET` from Replit Secrets.
2. In dev, the cron service should hit the frontend preview URL (port 5000) so Vite proxies `/api` to the backend on port 8080. The backend is not directly reachable from the public internet.
3. For production, use a Replit deployment (reserved VM / Always On) instead of relying on pings to a dev domain.
4. Use `action=sync` only when you want to trigger a full odds fetch; use `action=keep-alive` to keep the workspace alive and let the internal scheduler handle the sync interval.
