import { supabase } from "../lib/supabase-client";
import {
  buildBaselineDataset,
  type BaselineDatasetExport,
  type BaselineFixtureRecord,
  type BaselinePredictionRecord,
} from "./baseline-dataset";

const PAGE_SIZE = 250;
const FIXTURE_ID_BATCH_SIZE = 100;

async function fetchAllPredictions(): Promise<BaselinePredictionRecord[]> {
  const rows: BaselinePredictionRecord[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("ai_predictions")
      .select("id, fixture_id, created_at, status, manual_context")
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw new Error(`Failed to read AI prediction snapshots: ${error.message}`);
    rows.push(...((data ?? []) as BaselinePredictionRecord[]));
    if (!data || data.length < PAGE_SIZE) break;
  }
  return rows;
}

async function fetchFixturesForPredictions(
  fixtureIds: Array<string | number>,
): Promise<BaselineFixtureRecord[]> {
  const uniqueIds = [...new Set(fixtureIds.map(String))];
  const fixtures: BaselineFixtureRecord[] = [];
  for (let batchStart = 0; batchStart < uniqueIds.length; batchStart += FIXTURE_ID_BATCH_SIZE) {
    const idBatch = uniqueIds.slice(batchStart, batchStart + FIXTURE_ID_BATCH_SIZE);
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const { data, error } = await supabase
        .from("fixtures")
        .select("fixture_id, fixture_date, status_short, home_goals, away_goals, home_team_name, away_team_name, league_name")
        .in("fixture_id", idBatch)
        .range(offset, offset + PAGE_SIZE - 1);
      if (error) throw new Error(`Failed to read fixture labels: ${error.message}`);
      fixtures.push(...((data ?? []) as BaselineFixtureRecord[]));
      if (!data || data.length < PAGE_SIZE) break;
    }
  }
  return fixtures;
}

export async function loadBaselineDataset(): Promise<BaselineDatasetExport> {
  const predictions = await fetchAllPredictions();
  const fixtures = await fetchFixturesForPredictions(predictions.map((prediction) => prediction.fixture_id));
  return buildBaselineDataset(fixtures, predictions);
}