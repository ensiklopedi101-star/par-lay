---
name: Scanner retry and learning integrity
description: Rules for retrying missing-odds fixtures and preserving settlement feedback
---

Batch scanning must exclude only fixtures with a usable structured market and valid odds. A missing-odds attempt or a recoverable `NO BET` row must remain eligible for a later scan.

Settlement must write a durable lesson before marking a prediction settled. If the lesson or parlay-leg update fails, leave the prediction retryable and log the error; otherwise a transient database failure permanently removes the prediction from AI learning.

**Why:** Odds can arrive after the first scan, while settled prediction rows are no longer selected by the scheduler. Silent writes therefore create permanent gaps in both analysis coverage and feedback.

**How to apply:** When changing batch eligibility, settlement, or feedback aggregation, preserve retryability for missing odds and non-`NO BET` outcomes, and treat `WIN`, `LOSS`, `HALF_WIN`, `HALF_LOSS`, and `PUSH` as learning outcomes.