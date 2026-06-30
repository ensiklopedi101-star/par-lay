---
name: Supabase Management API
description: How to run DDL SQL in Supabase (CREATE TABLE, ALTER TABLE) from the agent
---

Endpoint: `POST https://api.supabase.com/v1/projects/{project_ref}/database/query`
Header: `Authorization: Bearer {SUPABASE_ACCESS_TOKEN}`
Project ref: `hqbuwfyiqfxpnpdlgcru` (extracted from SUPABASE_URL)

**Why:** `SUPABASE_SERVICE_ROLE_KEY` is a PostgREST JWT — it can read/write rows but CANNOT run DDL. The management API requires a Personal Access Token from supabase.com/dashboard/account/tokens.

**How to apply:** When creating/altering tables, use management API. For row operations (insert/update/select), use the supabase-js client with service role key as before.
