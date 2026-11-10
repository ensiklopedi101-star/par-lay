/**
 * Drizzle schema for the production Supabase database.
 *
 * Only tables that actually exist are declared here. The old `odds_events` /
 * `odds_data` / flat `team_stats` definitions were removed: nothing imported
 * them, but `drizzle-kit push` (run by scripts/post-merge.sh) happily created
 * them on every merge, leaving dead tables behind.
 *
 * Tables the API server reads through supabase-js and that are NOT mirrored
 * here yet (fixtures, ai_predictions, parlay_legs, parlays, leagues, odds,
 * odds_flat, team_standings, lessons_learned, performance_log, sync_runs,
 * prediction_learning_evaluations, ai_prediction_revisions, the
 * ai_learning_* family and telegram_sessions) are intentionally omitted.
 * `push` cannot drop what it cannot see, and an incomplete mirror is safer
 * than a wrong one.
 */
export * from "./odds-history";
export * from "./odds-movement-history";
export * from "./scheduler-config";
export * from "./team-stats";
