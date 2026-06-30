---
name: Parlay System Migration
description: Lessons learned migrating an external parlay analysis system into this pnpm workspace
---

## Context

The user migrated a parlay analysis system from another Replit account. The system uses:
- Express backend with odds-api.io, Supabase, and Gemini
- React frontend with Radix UI + Tailwind
- PostgreSQL (Drizzle) for odds events + team stats
- Supabase for fixtures, odds history, parlays, standings

## Key Lessons

### 1. `@workspace/supabase-client` lib + esbuild bundling

**Problem:** Adding a new lib (`@workspace/supabase-client`) that uses `@supabase/supabase-js` fails during esbuild because:
- `esbuild` resolves workspace symlinks differently than Node.js at runtime
- Even if the package is in `node_modules/@workspace/supabase-client`, esbuild may not resolve it

**Solution:** Import `@supabase/supabase-js` directly in the backend route and add it to the package's `external` list in `build.mjs`:

```js
external: [
  // ... existing externals
  "@supabase/supabase-js",
]
```

**Why:** This avoids the bundle trying to resolve the transitive dependency graph. The package is available at runtime via `node_modules`.

**How to apply:** For any new lib that wraps a third-party package with complex deps, either:
- Use the third-party package directly in backend code (not via workspace lib), or
- Add the third-party package name to `build.mjs` `external` list

### 2. Orval codegen mismatch

**Problem:** The original system had an extensive OpenAPI spec with many endpoints. The uploaded files only included a minimal `healthz` spec. The frontend used many Orval-generated hooks (`useGetSyncStatus`, `useListAvailableLeagues`, etc.) that don't exist in the current `lib/api-client-react`.

**Solution:** Created custom React Query hooks in `artifacts/parlay-app/src/api/parlay-hooks.ts` instead of regenerating the entire OpenAPI spec. This is faster and avoids unnecessary codegen.

**Why:** The user wants to save credit and avoid rebuilding from scratch. Custom hooks are simpler for a system with ~10 API endpoints.

**How to apply:** For small-to-medium API surfaces (<20 endpoints), custom hooks are more maintainable than Orval codegen. For larger APIs, regenerate the OpenAPI spec and run `pnpm --filter @workspace/api-spec run codegen`.

### 3. `references` in tsconfig.json for new libs

**Problem:** Adding `lib/supabase-client` without adding it to `tsconfig.json` references causes `tsc --build` to skip it.

**Solution:** Add the new lib to both:
- Root `tsconfig.json` `references` array
- Any artifact that imports it (e.g., `artifacts/api-server/tsconfig.json`)

**Why:** `tsc --build` uses project references to determine compilation order. Missing references cause stale declarations or "module not found" errors.

**How to apply:** Always add new `lib/*` packages to root `tsconfig.json` references. Add artifact-specific references only when the artifact imports the lib directly.

### 4. CSS variables from scaffold

**Problem:** The scaffold `index.css` has `red` placeholder values for all CSS variables. The uploaded system had a fully styled dark theme.

**Solution:** The uploaded CSS overwrote the placeholders. When the scaffold was overwritten by the user's files, the theme was preserved.

**How to apply:** If merging a styled system into a scaffold, prefer copying the user's CSS files rather than merging variable-by-variable.

### 5. Frontend dependencies via `pnpm --filter`

**Problem:** Installing dependencies in the frontend artifact needs to be done via `pnpm --filter @workspace/<name> add <pkg>` rather than editing `package.json` directly.

**Why:** pnpm manages workspace symlinks and catalog versions. Direct `package.json` edits may miss catalog resolution or workspace dependencies.

**How to apply:** Always use `pnpm --filter <pkg> add <dep>` or `pnpm --filter <pkg> add -D <dev-dep>`.
