import assert from "node:assert/strict";
import test from "node:test";
import {
  buildBaselineDataset,
  type BaselineFixtureRecord,
  type BaselinePredictionRecord,
} from "./baseline-dataset";

const fixture: BaselineFixtureRecord = {
  fixture_id: 42,
  fixture_date: "2026-08-01T12:00:00.000Z",
  status_short: "FT",
  home_goals: 2,
  away_goals: 1,
  home_team_name: "Home FC",
  away_team_name: "Away FC",
  league_name: "Test League",
};

function prediction(
  manualContext: unknown,
  createdAt = "2026-08-01T11:00:00.000Z",
): BaselinePredictionRecord {
  return {
    id: "prediction-42",
    fixture_id: 42,
    created_at: createdAt,
    status: "WIN",
    manual_context: manualContext,
  };
}

function validSnapshot(analysisAt = "2026-08-01T11:00:00.000Z") {
  return {
    schemaVersion: 1,
    analysis: { analyzedAt: analysisAt },
    input: {
      teamStats: {
        home: { current_season: { stats_xg: { xG: "1.6", xGA: "1.1" } } },
        away: { current_season: { stats_xg: { xG: "1.2", xGA: "1.4" } } },
      },
      odds: {
        snapshot: [
          { bookmaker: "book-a", market_type: "ML", odds_1: 1.8, captured_at: "2026-08-01T10:30:00.000Z" },
          { bookmaker: "book-b", market_type: "ML", odds_1: 1.7, captured_at: "2026-08-01T11:30:00.000Z" },
        ],
      },
    },
    dataQuality: {
      stats: {
        home: { valid: true },
        away: { valid: true },
      },
    },
  };
}

test("builds an eligible row from the recorded pre-kickoff snapshot and final score", () => {
  const result = buildBaselineDataset(
    [fixture],
    [prediction(JSON.stringify(validSnapshot()))],
    "2026-10-01T00:00:00.000Z",
  );

  assert.equal(result.rows.length, 1);
  assert.deepEqual(result.rows[0]?.target, { homeGoals: 2, awayGoals: 1, result: "home" });
  assert.equal(result.rows[0]?.features.oddsSnapshots.length, 1);
  assert.equal(result.rows[0]?.featureAvailability.preAnalysisOdds, true);
  assert.equal(result.manifest.timeBasedSplit.status, "unavailable_single_row");
});

test("excludes snapshots analyzed after kickoff", () => {
  const result = buildBaselineDataset(
    [fixture],
    [prediction(validSnapshot("2026-08-01T12:05:00.000Z"), "2026-08-01T12:05:00.000Z")],
    "2026-10-01T00:00:00.000Z",
  );

  assert.equal(result.rows.length, 0);
  assert.deepEqual(result.manifest.exclusionCounts, { prediction_after_kickoff: 1 });
});

test("excludes settled rows that have no versioned feature snapshot", () => {
  const result = buildBaselineDataset(
    [fixture],
    [prediction({ settlement: { evaluationSource: "fixture_final_score" } })],
    "2026-10-01T00:00:00.000Z",
  );

  assert.equal(result.rows.length, 0);
  assert.deepEqual(result.manifest.exclusionCounts, { missing_versioned_snapshot: 1 });
  assert.equal(result.manifest.timeBasedSplit.status, "unavailable_no_eligible_rows");
});

test("counts complete pre-match snapshots separately while their fixtures await labels", () => {
  const pendingFixture = { ...fixture, status_short: "NS", home_goals: null, away_goals: null };
  const result = buildBaselineDataset(
    [pendingFixture],
    [prediction(validSnapshot())],
    "2026-10-01T00:00:00.000Z",
  );

  assert.equal(result.rows.length, 0);
  assert.equal(result.manifest.sourceCounts.pendingFeatureSnapshotsAwaitingLabels, 1);
});

test("plans the holdout from the latest chronological fixtures", () => {
  const laterFixture = {
    ...fixture,
    fixture_id: 43,
    fixture_date: "2026-08-02T12:00:00.000Z",
  };
  const laterPrediction = {
    ...prediction(validSnapshot("2026-08-02T11:00:00.000Z"), "2026-08-02T11:00:00.000Z"),
    id: "prediction-43",
    fixture_id: 43,
  };
  const result = buildBaselineDataset(
    [laterFixture, fixture],
    [laterPrediction, prediction(validSnapshot())],
    "2026-10-01T00:00:00.000Z",
  );

  assert.equal(result.manifest.timeBasedSplit.status, "planned_not_evaluated");
  assert.equal(result.manifest.timeBasedSplit.trainingCandidates, 1);
  assert.equal(result.manifest.timeBasedSplit.holdoutCandidates, 1);
  assert.equal(result.manifest.timeBasedSplit.holdoutStartsAt, laterFixture.fixture_date);
});