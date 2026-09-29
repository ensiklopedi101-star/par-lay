---
name: Settlement provider fail-closed
description: How to handle old fixtures when the score provider still returns pending or no result
---

Fixture time passing is not evidence that a match finished. If the provider returns `pending`, `not found`, or no final score, keep a real `AMBIL` prediction retryable as `pending_result` and exclude it from learning until a verified score is available.

**Why:** Historical settlement can query a date range that does not contain older fixtures, and replacing missing scores with a guessed result would corrupt both the prediction board and the AI feedback loop.

**How to apply:** Transition elapsed predictions out of `active` for UI and health reporting, but only write WIN/LOSS/HALF_WIN/HALF_LOSS/PUSH after final scores and a supported structured market are present.