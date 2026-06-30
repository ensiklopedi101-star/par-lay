---
name: RAG Architecture — Parlay Analyzer
description: How the feedback loop and RAG injection work in the AI analysis system
---

Tables:
- `odds_movement_history`: snapshot inserted on every odds fetch (odds-fetcher.ts → insertOddsMovementSnapshot)
- `lessons_learned`: WIN/LOSS records with Gemini-generated lesson text; queried by team name
- `ai_predictions`: now has prediction_text, home_team, away_team, status (active→WIN/LOSS/settled_*)

Flow:
1. Odds fetch → insert snapshot to odds_movement_history per market type
2. AI analysis → fetch last 25 movement rows + 5 lessons from matching teams → inject into Gemini prompt
3. Settlement cron (daily 06:00) → check completed fixtures → update ai_predictions status → LOSS triggers Gemini lesson evaluation → save to lessons_learned
4. Next analysis for same teams → lessons auto-injected (RAG)

**Why:** This creates a compounding knowledge base — the AI learns from historical LOSS bets and avoids repeating mistakes.
