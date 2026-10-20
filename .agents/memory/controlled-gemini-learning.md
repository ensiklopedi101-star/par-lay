---
name: Controlled Gemini learning
description: Safety and evaluation rules for proposals that adapt Gemini prediction behavior from settled matches
---

Keep self-learning changes bounded to structured selection-policy rules (confidence floor, EV floor, and supported market-family exclusions). Do not allow Gemini to rewrite and activate arbitrary system prompts. The application must continue to enforce explicit-probability, verified-odds, confidence, and positive-EV gates in code.

**Why:** Free-form prompt edits cannot be reliably evaluated from historical outcomes alone and could bypass hard prediction-readiness checks. Original analysis snapshots are the audit source; later outcomes must not leak into proposal generation. The user wants policy changes to activate automatically without per-change admin approval, with confidence and accountable data as prerequisites. A Gemini batch can finish server-side after a shell request times out, so retrying without checking current state can cause duplicate API usage.

**How to apply:** Generate candidates only from earlier settled snapshots with traceable source and freshness metadata; test them on a strictly later chronological holdout (keep equal timestamps on the same side). Automatic activation must require high confidence plus objective quality and backtest gates, and every change must be versioned with a rollback path. Treat a policy backtest as a filter test, not a full replay of Gemini inference. After a timeout, read queue/state counts before retrying.
