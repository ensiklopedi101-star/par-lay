---
name: ai_predictions table schema
description: Full column list for ai_predictions table after migrations
---

Original columns: id (uuid), fixture_id (integer), prob_home_win, prob_draw, prob_away_win, prob_over25, prob_under25, prob_btts_yes, prob_btts_no, confidence_score, uncertainty_score, best_market, best_value, best_odds, expected_value, reasoning, model_version, status, verified_by_agent, created_at, updated_at

Added columns: prediction_text (TEXT), home_team (TEXT), away_team (TEXT), league (TEXT), home_score (INTEGER), away_score (INTEGER), ev_at_analysis (NUMERIC), market_bet (TEXT), settled_at (TIMESTAMPTZ)

**Why:** Original table had structured probability columns but no prediction_text — the Gemini output text couldn't be saved. New columns enable settlement tracking and RAG feedback loop.
