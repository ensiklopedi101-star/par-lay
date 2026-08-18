---
name: Complete evaluation snapshot
description: Keep the full AI analysis input and settlement outcome together for later evaluation and audit
---

Store the immutable analysis inputs and recommendation snapshot in `ai_predictions.manual_context`, then append settlement results under the same JSON object instead of replacing the original context.

**Why:** Evaluation is not reproducible from WIN/LOSS, score, and lesson text alone; odds, stats quality, model provenance, RAG context, and the exact recommendation must remain available after settlement.

**How to apply:** When adding evaluation fields, extend the snapshot while preserving the original analysis data. Keep the compact legacy keys alongside the versioned snapshot for existing readers.