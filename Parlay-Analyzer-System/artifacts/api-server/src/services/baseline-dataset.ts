import { parseManualContext } from "../lib/settlement-context";

const FINAL_STATUSES = new Set(["FT", "AET", "PEN", "FINISHED", "COMPLETED"]);
const TEMPORAL_HOLDOUT_FRACTION = 0.2;

export interface BaselineFixtureRecord {
  fixture_id: string | number;
  fixture_date: string | null;
  status_short: string | null;
  home_goals: number | string | null;
  away_goals: number | string | null;
  home_team_name: string | null;
  away_team_name: string | null;
  league_name: string | null;
}

export interface BaselinePredictionRecord {
  id: string;
  fixture_id: string | number;
  created_at: string | null;
  status: string | null;
  manual_context: unknown;
}

export interface BaselineDatasetRow {
  datasetVersion: "m1-baseline-v1";
  fixture: {
    fixtureId: string;
    kickoffAt: string;
    status: string;
    homeTeam: string;
    awayTeam: string;
    league: string;
  };
  features: {
    homeTeamStats: Record<string, unknown>;
    awayTeamStats: Record<string, unknown>;
    oddsSnapshots: Record<string, unknown>[];
  };
  featureAvailability: {
    coreStats: true;
    xg: true;
    preAnalysisOdds: boolean;
  };
  target: {
    homeGoals: number;
    awayGoals: number;
    result: "home" | "draw" | "away";
  };
  provenance: {
    predictionId: string;
    predictionCreatedAt: string | null;
    analysisAt: string;
    statsSnapshotSchemaVersion: 1;
    oddsSnapshotCount: number;
    earliestOddsCapturedAt: string | null;
    latestOddsCapturedAt: string | null;
  };
}

export interface BaselineDatasetExport {
  manifest: {
    datasetVersion: "m1-baseline-v1";
    generatedAt: string;
    labelDefinition: string;
    inclusionRule: string;
    sourceCounts: {
      predictionsRead: number;
      fixturesRead: number;
      completedAnalyzedFixtures: number;
      eligibleRows: number;
      eligibleRowsWithOdds: number;
      pendingFeatureSnapshotsAwaitingLabels: number;
    };
    exclusionCounts: Record<string, number>;
    timeBasedSplit: {
      strategy: "chronological-last-20-percent";
      status: "planned_not_evaluated" | "unavailable_no_eligible_rows" | "unavailable_single_row";
      trainingCandidates: number;
      holdoutCandidates: number;
      holdoutStartsAt: string | null;
    };
    warning: string;
  };
  rows: BaselineDatasetRow[];
}

interface FeatureAssessment {
  row: BaselineDatasetRow | null;
  featureReady: boolean;
  reason: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function timestamp(value: unknown): number | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function numericScore(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function hasMeaningfulValue(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value as object).length > 0;
  return false;
}

function containsXg(value: unknown): boolean {
  if (!isRecord(value) && !Array.isArray(value)) return false;
  const entries = Array.isArray(value) ? value.map((item, index) => [String(index), item] as const) : Object.entries(value);
  return entries.some(([key, child]) =>
    (key === "stats_xg" && hasMeaningfulValue(child)) || containsXg(child),
  );
}

function isFinalFixture(fixture: BaselineFixtureRecord): boolean {
  const status = String(fixture.status_short ?? "").trim().toUpperCase();
  return FINAL_STATUSES.has(status) &&
    numericScore(fixture.home_goals) != null &&
    numericScore(fixture.away_goals) != null;
}

function makeFeatureAssessment(
  fixture: BaselineFixtureRecord,
  prediction: BaselinePredictionRecord,
): FeatureAssessment {
  const fixtureId = String(fixture.fixture_id);
  const kickoffAtMs = timestamp(fixture.fixture_date);
  if (kickoffAtMs == null) return { row: null, featureReady: false, reason: "missing_kickoff_timestamp" };

  const context = parseManualContext(prediction.manual_context);
  if (!context || Number(context.schemaVersion) !== 1) {
    return { row: null, featureReady: false, reason: "missing_versioned_snapshot" };
  }

  const recordedAnalysisAt = timestamp(
    isRecord(context.analysis) ? context.analysis.analyzedAt : null,
  );
  const predictionCreatedAt = timestamp(prediction.created_at);
  const availableTimes = [recordedAnalysisAt, predictionCreatedAt]
    .filter((value): value is number => value != null);
  if (availableTimes.length === 0) {
    return { row: null, featureReady: false, reason: "missing_analysis_timestamp" };
  }
  if (availableTimes.some((value) => value > kickoffAtMs)) {
    return { row: null, featureReady: false, reason: "prediction_after_kickoff" };
  }
  const analysisAtMs = Math.min(...availableTimes);
  const analysisAt = new Date(analysisAtMs).toISOString();

  const input = isRecord(context.input) ? context.input : null;
  const teamStats = input && isRecord(input.teamStats) ? input.teamStats : null;
  const homeTeamStats = teamStats && isRecord(teamStats.home) ? teamStats.home : null;
  const awayTeamStats = teamStats && isRecord(teamStats.away) ? teamStats.away : null;
  if (!homeTeamStats || !awayTeamStats) {
    return { row: null, featureReady: false, reason: "missing_team_stats_snapshot" };
  }

  const quality = isRecord(context.dataQuality) && isRecord(context.dataQuality.stats)
    ? context.dataQuality.stats
    : null;
  const homeQuality = quality && isRecord(quality.home) ? quality.home : null;
  const awayQuality = quality && isRecord(quality.away) ? quality.away : null;
  if (homeQuality?.valid !== true || awayQuality?.valid !== true) {
    return { row: null, featureReady: false, reason: "stats_quality_not_verified" };
  }
  if (!containsXg(homeTeamStats) || !containsXg(awayTeamStats)) {
    return { row: null, featureReady: false, reason: "missing_team_xg" };
  }

  const oddsInput = input && isRecord(input.odds) ? input.odds : null;
  const rawOdds = oddsInput && Array.isArray(oddsInput.snapshot) ? oddsInput.snapshot : [];
  const oddsSnapshots = rawOdds.filter((value): value is Record<string, unknown> => {
    if (!isRecord(value)) return false;
    const capturedAt = timestamp(value.captured_at ?? value.capturedAt);
    return capturedAt != null && capturedAt <= analysisAtMs && capturedAt <= kickoffAtMs;
  });
  const oddsTimes = oddsSnapshots
    .map((row) => timestamp(row.captured_at ?? row.capturedAt))
    .filter((value): value is number => value != null)
    .sort((a, b) => a - b);

  const homeGoals = numericScore(fixture.home_goals);
  const awayGoals = numericScore(fixture.away_goals);
  if (homeGoals == null || awayGoals == null || !isFinalFixture(fixture)) {
    return { row: null, featureReady: true, reason: null };
  }

  return {
    reason: null,
    featureReady: true,
    row: {
      datasetVersion: "m1-baseline-v1",
      fixture: {
        fixtureId,
        kickoffAt: fixture.fixture_date!,
        status: String(fixture.status_short ?? ""),
        homeTeam: fixture.home_team_name ?? "",
        awayTeam: fixture.away_team_name ?? "",
        league: fixture.league_name ?? "",
      },
      features: {
        homeTeamStats,
        awayTeamStats,
        oddsSnapshots,
      },
      featureAvailability: {
        coreStats: true,
        xg: true,
        preAnalysisOdds: oddsSnapshots.length > 0,
      },
      target: {
        homeGoals,
        awayGoals,
        result: homeGoals > awayGoals ? "home" : homeGoals < awayGoals ? "away" : "draw",
      },
      provenance: {
        predictionId: prediction.id,
        predictionCreatedAt: prediction.created_at,
        analysisAt,
        statsSnapshotSchemaVersion: 1,
        oddsSnapshotCount: oddsSnapshots.length,
        earliestOddsCapturedAt: oddsTimes.length > 0 ? new Date(oddsTimes[0]!).toISOString() : null,
        latestOddsCapturedAt: oddsTimes.length > 0 ? new Date(oddsTimes.at(-1)!).toISOString() : null,
      },
    },
  };
}

function timestampForSort(value: string): number {
  return timestamp(value) ?? Number.MAX_SAFE_INTEGER;
}

export function buildBaselineDataset(
  fixtures: BaselineFixtureRecord[],
  predictions: BaselinePredictionRecord[],
  generatedAt = new Date().toISOString(),
): BaselineDatasetExport {
  const fixtureById = new Map(fixtures.map((fixture) => [String(fixture.fixture_id), fixture]));
  const predictionsByFixture = new Map<string, BaselinePredictionRecord[]>();
  for (const prediction of predictions) {
    const key = String(prediction.fixture_id);
    const rows = predictionsByFixture.get(key) ?? [];
    rows.push(prediction);
    predictionsByFixture.set(key, rows);
  }

  const rows: BaselineDatasetRow[] = [];
  const exclusionCounts: Record<string, number> = {};
  let completedAnalyzedFixtures = 0;
  let pendingFeatureSnapshotsAwaitingLabels = 0;

  const recordExclusion = (reason: string) => {
    exclusionCounts[reason] = (exclusionCounts[reason] ?? 0) + 1;
  };

  for (const [fixtureId, fixturePredictions] of predictionsByFixture) {
    const fixture = fixtureById.get(fixtureId);
    if (!fixture) {
      recordExclusion("fixture_record_missing");
      continue;
    }
    const completed = isFinalFixture(fixture);
    if (completed) completedAnalyzedFixtures++;

    const orderedPredictions = [...fixturePredictions].sort((a, b) =>
      timestampForSort(b.created_at ?? "") - timestampForSort(a.created_at ?? ""),
    );
    let accepted: BaselineDatasetRow | null = null;
    let featureReadyWithoutLabel = false;
    let latestFailure = "missing_versioned_snapshot";
    for (const prediction of orderedPredictions) {
      const assessment = makeFeatureAssessment(fixture, prediction);
      if (assessment.row) {
        accepted = assessment.row;
        break;
      }
      if (assessment.featureReady) {
        featureReadyWithoutLabel = true;
        break;
      }
      latestFailure = assessment.reason ?? latestFailure;
    }

    if (accepted && completed) {
      rows.push(accepted);
    } else if (accepted) {
      pendingFeatureSnapshotsAwaitingLabels++;
    } else if (!completed && featureReadyWithoutLabel) {
      pendingFeatureSnapshotsAwaitingLabels++;
    } else if (completed) {
      recordExclusion(latestFailure);
    }
  }

  rows.sort((a, b) =>
    timestampForSort(a.fixture.kickoffAt) - timestampForSort(b.fixture.kickoffAt) ||
    a.fixture.fixtureId.localeCompare(b.fixture.fixtureId),
  );
  const splitAvailable = rows.length > 1;
  const holdoutCandidates = splitAvailable
    ? Math.max(1, Math.ceil(rows.length * TEMPORAL_HOLDOUT_FRACTION))
    : 0;
  const trainingCandidates = splitAvailable ? rows.length - holdoutCandidates : 0;

  return {
    manifest: {
      datasetVersion: "m1-baseline-v1",
      generatedAt,
      labelDefinition: "Final home goals, away goals, and 1X2 result from a completed fixture.",
      inclusionRule: "Use only versioned pre-kickoff prediction snapshots with verified core team stats and xG for both teams. Odds rows are retained only when captured before analysis and kickoff.",
      sourceCounts: {
        predictionsRead: predictions.length,
        fixturesRead: fixtures.length,
        completedAnalyzedFixtures,
        eligibleRows: rows.length,
        eligibleRowsWithOdds: rows.filter((row) => row.featureAvailability.preAnalysisOdds).length,
        pendingFeatureSnapshotsAwaitingLabels,
      },
      exclusionCounts,
      timeBasedSplit: {
        strategy: "chronological-last-20-percent",
        status: rows.length === 0
          ? "unavailable_no_eligible_rows"
          : splitAvailable
            ? "planned_not_evaluated"
            : "unavailable_single_row",
        trainingCandidates,
        holdoutCandidates,
        holdoutStartsAt: holdoutCandidates > 0 ? rows[trainingCandidates]?.fixture.kickoffAt ?? null : null,
      },
      warning: "This export is a candidate dataset, not a trained or validated model. Keep it out of betting decisions until a time-based holdout evaluation is completed.",
    },
    rows,
  };
}
