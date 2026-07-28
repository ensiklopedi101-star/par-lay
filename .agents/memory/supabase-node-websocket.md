---
name: Supabase Node WebSocket compatibility
description: Supabase Realtime needs an explicit ws transport in this Node runtime.
---

When the API server runs on Node.js 20, initialize the Supabase client with the `ws` package as its Realtime transport.

**Why:** The installed Supabase Realtime client does not detect native WebSocket support on Node.js 20 and crashes during client creation unless a transport is supplied.

**How to apply:** Keep `ws` and `@types/ws` as API-server dependencies and cast the transport to the browser-oriented WebSocket type expected by Supabase.