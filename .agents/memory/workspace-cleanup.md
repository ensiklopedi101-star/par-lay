---
name: Workspace Cleanup
description: Workflow and typecheck cleanup after import.
---

## Canonical Workflows

- `Parlay-Analyzer-System/artifacts/api-server: API Server` → API server di port 8080. Jangan jalankan workflow backend duplikat di port ini.
- `Start application` → Vite frontend di port 5000.
- `Project` → menjalankan keduanya parallel.

## Workflow Artifact Duplikat

Replit otomatis membuat managed workflows untuk artifact terdaftar:
- `Parlay-Analyzer-System/artifacts/parlay-app: web`
- `Parlay-Analyzer-System/artifacts/api-server: API Server`
- `Parlay-Analyzer-System/artifacts/mockup-sandbox: Component Preview Server`

`API Server` adalah workflow backend canonical; workflow backend custom lama dapat menabrak port 8080 dan harus dihapus. Workflow `parlay-app: web` juga duplikat frontend custom, sedangkan `mockup-sandbox` di port 8081 tidak konflik dan dapat dibiarkan untuk Canvas.

## Root Typecheck

Sebelum cleanup, `pnpm run typecheck` di root gagal:

```
error TS2688: Cannot find type definition file for 'node'.
lib/supabase-client/src/index.ts(3,13): error TS2591: Cannot find name 'process'.
```

Fix: install `@types/node` sebagai devDependency di `lib/supabase-client`.

```bash
cd Parlay-Analyzer-System/lib/supabase-client && pnpm add -D @types/node
```

Setelah fix, `pnpm run typecheck` di root clean.

**Why:** Root workspace build perlu dijaga clean agar CI/CD dan deployment autoscale tidak gagal karena type error di shared library.
