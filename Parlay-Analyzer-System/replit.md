# Parlay Analyzer

A football betting analysis system that pulls odds from Odds-API, stores team stats from FootyStats CSV uploads, and generates AI-powered parlay recommendations using Gemini.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run API server (port 8080, proxy path /api)
- `pnpm --filter @workspace/parlay-app run dev` — run frontend dev server
- `pnpm run typecheck` — full typecheck across packages
- `pnpm --filter @workspace/db run push` — push DB schema changes
- Required secrets: `ODDS_API_KEY`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY`
- `CSV_UPLOAD_PASSWORD` env var — defaults to `parlay2024` if not set

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5 + esbuild (ESM bundle)
- DB: PostgreSQL + Drizzle ORM + drizzle-zod
- Frontend: React 19 + Vite 7 + Tailwind CSS v4 + Radix UI
- Data: Supabase (fixtures, odds, parlays, standings)
- Odds: odds-api.io (v3) via cron sync every 3 hours
- AI: Google Gemini API for analysis
- CSV: FootyStats xG/xGA upload via multer

## Where things live

- **Backend:** `artifacts/api-server/src/routes/` — odds, supabase, csv, config, health
- **Frontend:** `artifacts/parlay-app/src/pages/` — dashboard, fixtures, teams, parlays, upload, settings
- **Database schema:** `lib/db/src/schema/` — odds-events, odds-data, team-stats, scheduler-config
- **API hooks:** `artifacts/parlay-app/src/api/parlay-hooks.ts` — custom React Query hooks
- **Team name mapping:** `artifacts/api-server/src/lib/team-name-map.ts` — FootyStats ↔ Odds-API name resolution
- **Odds fetcher:** `artifacts/api-server/src/services/odds-fetcher.ts` — rate-limited, incremental sync

## Architecture decisions

- **Custom hooks instead of Orval:** The OpenAPI spec is minimal; full API surface is handled via custom React Query hooks in `parlay-hooks.ts` to avoid codegen overhead.
- **Supabase for operational data:** Fixtures, odds history, and parlays live in Supabase tables (not Drizzle), because the original schema was designed there. Drizzle only manages the odds sync + team stats tables.
- **Rate-limited odds sync:** `odds-fetcher.ts` checks active leagues first, skips off-season leagues, sleeps 300ms between event calls, and stops on 429 errors.
- **CSV upload with password:** `csv.ts` enforces `CSV_UPLOAD_PASSWORD` for team stats uploads to prevent accidental overwrites.
- **Dark mode only:** The frontend uses a dark theme (`index.css` overrides default red placeholder values) matching the "terminal" aesthetic.

## Product

- Dashboard shows sync status, league breakdown, active parlays, and upcoming fixtures
- Fixtures page lists events with expandable odds from multiple bookmakers
- Team Stats page displays xG/xGA/xGD data from uploaded CSVs
- AI Parlays page shows Gemini-generated parlays with expected value analysis
- CSV Upload page accepts FootyStats league tables with password protection
- Settings page controls scheduler config (leagues, bookmakers, markets, cron) and manual sync trigger

## User preferences

- User wants dark mode (green-accented terminal aesthetic)
- User wants to save credit — avoid rebuilding from scratch; prefer copy + minimal fixes

## Gotchas

- Odds API rate-limits quickly — sync runs every 3 hours via cron, but may hit rate limits on first start
- `SUPABASE_SERVICE_ROLE_KEY` is required (not anon key) for server-side operations
- `CSV_UPLOAD_PASSWORD` defaults to `parlay2024` — set env var to change it
- The frontend uses `@/api/parlay-hooks` not `@workspace/api-client-react` for data fetching
- If Supabase views (`v_active_parlays`, `v_odds_movement`) don't exist, the Supabase routes will return errors

## Pointers

- See `pnpm-workspace` skill for workspace conventions
- See `environment-secrets` skill for managing secrets
