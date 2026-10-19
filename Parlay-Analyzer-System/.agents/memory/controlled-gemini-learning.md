---
name: Controlled Gemini learning
description: Safety and evaluation rules for proposals that adapt Gemini prediction behavior from settled matches
---

Keep self-learning changes bounded to structured selection-policy rules (confidence floor, EV floor, and supported market-family exclusions). Do not allow Gemini to rewrite and activate arbitrary system prompts. The application must continue to enforce its existing explicit-probability, verified-odds, confidence, and positive-EV gates in code.

**Why:** Free-form prompt edits cannot be reliably evaluated from historical outcomes alone and could bypass hard prediction-readiness checks. The original analysis snapshot is the audit source; later outcomes must not leak into proposal generation.

**How to apply:** Generate candidates only from earlier settled snapshots, test them on a strictly later chronological holdout (keep equal timestamps on the same side), require explicit admin promotion, version every change, and retain a rollback path. Treat a policy backtest as a filter test, not a full replay of Gemini inference.
