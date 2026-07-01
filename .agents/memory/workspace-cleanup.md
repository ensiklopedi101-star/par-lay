---
name: Workspace Cleanup
description: Workflow and typecheck cleanup after import.
---

## Canonical Workflows

- `Start Backend` → API server di port 8080.
- `Start application` → Vite frontend di port 5000.
- `Project` → menjalankan keduanya parallel.

## Workflow Artifact Duplikat

Replit otomatis membuat managed workflows untuk artifact terdaftar:
- `Parlay-Analyzer-System/artifacts/parlay-app: web`
- `Parlay-Analyzer-System/artifacts/api-server: API Server`
- `Parlay-Analyzer-System/artifacts/mockup-sandbox: Component Preview Server`

`web` dan `API Server` duplikat dengan workflow custom kita dan menabrak port 8080/5000. Solusi sementara: kill proses artifact duplikat. `mockup-sandbox` di port 8081 tidak konflik, biarkan jalan untuk Canvas.

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
