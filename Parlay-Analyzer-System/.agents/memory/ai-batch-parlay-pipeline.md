---
name: AI Batch Parlay Pipeline
description: Durable behavior of asynchronous AI batch scanning, parlay creation, settlement, and learning feedback.
---

Batch scanning is intentionally asynchronous and sequential. The UI polls a server-side job so long AI requests and throttling do not look like a frozen page.

**Why:** AI providers may require retries and deliberate delays; keeping the HTTP request open made users unable to tell whether scanning was still running.

**How to apply:** Preserve the job status/progress contract when changing scan limits or provider behavior. Automatic parlays should only be created from multiple qualifying legs, and each leg should retain its originating prediction ID.

Settlement writes mathematical WIN/LOSS results to both the prediction and its linked parlay leg. Once all legs are settled, the parlay status is aggregated; lessons and performance logs provide the feedback context for later AI analysis.

**Why:** The AI learning loop needs reliable, structured outcomes rather than only unstructured prediction text.

**How to apply:** Keep structured market/EV fields populated for new predictions, while retaining fallback reads from legacy `best_market`/`expected_value` for older records.