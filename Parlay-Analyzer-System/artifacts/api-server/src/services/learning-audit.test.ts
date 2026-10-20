import assert from "node:assert/strict";
import test from "node:test";
import { assessLearningAudit, type LearningAuditInput } from "./learning-audit.js";

const analyzedAt = "2026-10-20T02:00:00.000Z";

function completeAudit(): LearningAuditInput {
  return {
    analysisAt: analyzedAt,
    settledAt: "2026-10-20T03:00:00.000Z",
    settlementSource: "odds_api_historical",
    settlementVerified: true,
    settlementVerifiedAt: "2026-10-20T02:59:30.000Z",
    inputSnapshot: {
      schemaVersion: 2,
      analysis: {
        analyzedAt,
        provider: "Gemini",
        model: "gemini-2.0-flash",
      },
      input: {
        odds: {
          provider: "Odds-API",
          selectedMarketVerified: true,
          selectedMarketCapturedAt: "2026-10-20T01:30:00.000Z",
          snapshot: [{ market: "Match Winner", odds: 1.8 }],
        },
        teamStats: { storageProvider: "Supabase" },
      },
      dataQuality: {
        odds: { verifiedMarket: true },
        stats: { home: { valid: true }, away: { valid: true } },
        statsFreshness: {
          home: { valid: true, source: "current_season", updatedAt: "2026-10-19T12:00:00.000Z" },
          away: { valid: true, source: "current_season", updatedAt: "2026-10-19T12:00:00.000Z" },
        },
      },
    },
  };
}

test("accepts a fully traceable current prediction and provider-verified result", () => {
  assert.deepEqual(assessLearningAudit(completeAudit()), { eligible: true, reasons: [] });
});

test("excludes snapshots without versioned source records", () => {
  const input = completeAudit();
  input.inputSnapshot = {};
  const result = assessLearningAudit(input);
  assert.equal(result.eligible, false);
  assert.ok(result.reasons.includes("analysis_snapshot_not_versioned"));
  assert.ok(result.reasons.includes("odds_provider_missing"));
});

test("excludes stale odds and unverified settlement scores", () => {
  const input = completeAudit();
  const snapshot = input.inputSnapshot as {
    input: { odds: { selectedMarketCapturedAt: string } };
  };
  snapshot.input.odds.selectedMarketCapturedAt = "2026-10-19T20:00:00.000Z";
  input.settlementSource = "fixture_cache";
  input.settlementVerified = false;

  const result = assessLearningAudit(input);
  assert.ok(result.reasons.includes("odds_snapshot_stale_at_analysis"));
  assert.ok(result.reasons.includes("settlement_result_not_provider_verified"));
});

test("excludes missing team-stat quality and freshness records", () => {
  const input = completeAudit();
  const snapshot = input.inputSnapshot as {
    dataQuality: { stats: { home: { valid: boolean } }; statsFreshness: { away: { updatedAt: string } } };
  };
  snapshot.dataQuality.stats.home.valid = false;
  snapshot.dataQuality.statsFreshness.away.updatedAt = "";

  const result = assessLearningAudit(input);
  assert.ok(result.reasons.includes("team_stats_incomplete_or_invalid"));
  assert.ok(result.reasons.includes("team_stats_source_or_time_missing"));
});
