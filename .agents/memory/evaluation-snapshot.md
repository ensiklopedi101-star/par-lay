---
name: Complete evaluation snapshot
description: Keep the full AI analysis input and settlement outcome together for later evaluation and audit
---

Store the immutable analysis inputs and recommendation snapshot in `ai_predictions.manual_context`, then append settlement results under the same JSON object instead of replacing the original context.

**Why:** Evaluation is not reproducible from WIN/LOSS, score, and lesson text alone; odds, stats quality, model provenance, RAG context, and the exact recommendation must remain available after settlement.

Supabase can return `manual_context` as a string containing JSON. Normalize parseable JSON strings before merging settlement fields; retain non-JSON legacy values rather than silently replacing them.

**Why:** A live data audit found that object-only merging treated string contexts as empty and discarded the original analysis inputs on settlement.

**How to apply:** When adding evaluation fields, extend the snapshot while preserving the original analysis data. Keep the compact legacy keys alongside the versioned snapshot for existing readers, and test both object and JSON-string context values.