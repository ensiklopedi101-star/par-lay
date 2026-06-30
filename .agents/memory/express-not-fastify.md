---
name: Backend Framework Correction
description: The API server is Express, not Fastify.
---

API server (`artifacts/api-server`) menggunakan **Express 5**, bukan Fastify. Semua route di-mount via `import { Router } from "express"`.

**Why:** Jangan asumsikan Fastify plugin, hooks, atau middleware pattern. Gunakan middleware Express (e.g., `express.json()`, `multer`, custom route middleware) saat menambah fitur di backend.
