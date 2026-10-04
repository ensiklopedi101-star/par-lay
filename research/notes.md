# Research Notes: Football Data Source Fit

**Status:** researching
**Depth:** Quick

## Plan

- **Question:** Which of the four shared sources can safely improve automated football statistics, live scores, team news, and AI prediction inputs?
- **Scope:** Audit the Gist and compare NewsAPI, Apify Understat Scraper, and API-Football/API-Sports with the app's existing data requirements.
- **Audience:** Product owner deciding which sources to integrate.
- **Deliverable:** Evidence-linked source assessment, risks, and a phased recommendation; no provider integration in this research step.

## Focus Areas

| # | Area | Status | Sources |
|---|---|---|---|
| 1 | Gist inventory and claims | pending | -- |
| 2 | API-Football coverage, quota, and economics | pending | -- |
| 3 | NewsAPI and Apify Understat fit, restrictions, and cost | pending | -- |

## Coverage Checklist

- [ ] Identify what the Gist contains and separate official APIs from scrapers/unofficial endpoints.
- [ ] Verify API-Football coverage for fixtures, live scores, results, lineups, injuries, player/team statistics, and odds.
- [ ] Verify current API-Football free-plan request limits and historical-season constraints.
- [ ] Verify NewsAPI free-plan limits, latency, and whether it can be used in production.
- [ ] Verify the Apify Understat actor's output, league coverage, cost, maintenance, and operational risks.
- [ ] Compare all sources with the app's required team-stat groups and existing Odds-API contract.
- [ ] Recommend an integration order that keeps source provenance, freshness, and fail-closed behavior explicit.

## Findings Log

_Findings will be added after source review._

## Conflicts & Open Questions

- The Gist describes some API plans and provider coverage; these must be treated as potentially stale until checked against current official documentation.
- NewsAPI free access appears explicitly limited to development/testing; production eligibility needs a clear decision.

## Gaps

- Exact usage cost for frequent live-score polling depends on the chosen API-Sports plan and required refresh interval.
- The Apify actor is community-maintained; actual output quality and upstream Understat access stability cannot be guaranteed from the listing alone.