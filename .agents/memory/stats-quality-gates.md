---
name: Stats quality gates
description: Core team-stat completeness and numeric sanity rules used before AI analysis or parlay readiness.
---

AI analysis and parlay readiness must fail closed when either team lacks all required core stat groups: xG, FTS, BTTS, goals conceded, goals scored, Over 2.5, Under, and team form. Optional Shots, Over 3.5, and HT data improve context but cannot replace core groups. Values must be non-empty, percentages must be 0–100, numeric values must be finite and non-negative unless the metric is a signed difference/advantage, and matches played must be positive.

**Why:** Live ingestion commonly produces rows with only some of the 11 JSONB groups populated. Counting rows or checking for any value allowed AI to analyze one-sided or incomplete data and create misleading parlays.

**How to apply:** Reuse the shared stats-quality assessment for fixture-level analysis and league health. Treat incomplete rows as missing coverage, and keep confidence separate from explicit win probability for Kelly, EV, and parlay calculations.