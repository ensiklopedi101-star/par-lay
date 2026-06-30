---
name: Persona Gemini Database-Driven
description: Where the active Gemini system prompt is stored and how it is seeded.
---

Persona aktif Gemini ("Quant Sniper v4") disimpan di kolom `scheduler_config.ai_persona`.

- **Source of truth:** database (`scheduler_config.ai_persona`).
- **Backend logic:** `src/services/ai-analysis.ts:loadAIConfig` membaca `ai_persona` dari DB. Jika kosong/null atau kurang dari 20 karakter, fallback ke `DEFAULT_SYSTEM_INSTRUCTION` hardcode di file.
- **Seed script:** `artifacts/api-server/scripts/seed-persona.mjs` membaca `DEFAULT_SYSTEM_INSTRUCTION` dari `src/services/ai-analysis.ts`, lalu meng-update baris `scheduler_config` id pertama.
- **Season data priority:** Persona dan prompt builder di `ai-analysis.ts` secara eksplisit menyatakan: jika musim baru < 6 pertandingan, gunakan musim lalu sebagai jangkar; setelah ≥ 6 pertandingan, prioritas penuh ke musim baru.

**Why:** Membuat persona AI dapat diedit runtime tanpa deploy ulang, dan memisahkan konfigurasi bisnis dari kode aplikasi. Sejalan dengan itu, aturan prioritas data musim dinyatakan eksplisit di persona agar Gemini tidak bingung saat awal musim.

