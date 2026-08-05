---
name: Odds Baseline and AI Revisions
description: Rules for safely repairing legacy odds baselines and storing triggered AI re-analysis
---

Legacy odds baselines may only be populated from a historical snapshot at or before the original analysis time, with source and capture timestamp recorded. Unknown markets or unmatched fixtures stay without a baseline and remain `review`; never infer a price from current odds.

**Why:** A fabricated baseline can make EV drift look valid when it was never observed, while using current odds rewrites the historical meaning of the prediction.

**How to apply:** Keep `ai_predictions` immutable for settlement/parlay history. Store triggered AI re-analysis in `ai_prediction_revisions`, enforce a cooldown and per-run AI cap, and fail closed when revision storage or fixture/odds matching is uncertain.