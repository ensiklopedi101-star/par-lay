/**
 * Revalidation Service
 *
 * Problem it solves: the batch scanner permanently skips a fixture the
 * moment `ai_predictions` has a row for it. A leg scanned days before
 * kickoff can go stale — odds drift, the market re-prices, momentum
 * shifts — but the system never looks at it again until settlement.
 *
 * Scope of this pass (intentionally narrow):
 *   - Re-check odds/EV against the market price recorded at analysis
 *     time and tag a `revalidation_status` (`keep` / `review` /
 *     `invalidated`) with a human-readable `revalidation_note`.
 *   - AI re-analysis is intentionally delegated to reanalysis.ts after this
 *     service has produced explicit trigger context.
 *   - NEVER mutates `parlays` / `parlay_legs`. If a prediction backs an
 *     already-created parlay, it is treated as placed history — we only
 *     tag the underlying `ai_predictions` row so the UI can surface a
 *     risk alert; the parlay itself is left untouched.
 *   - Only predictions still `status = "active"` (not yet settled) for
 *     fixtures that have not kicked off yet are considered.
 */

import { supabase } from "../lib/supabase-client";
import { logger } from "../lib/logger";

export type RevalidationStatus = "keep" | "review" | "invalidated";

interface PendingPrediction {
  id: string;
  fixture_id: number;
  market_bet: string | null;
  best_market: string | null;
  best_odds: number | null;
  ev_at_analysis: number | null;
  expected_value: number | null;
  home_team: string | null;
  away_team: string | null;
  created_at: string | null;
}

interface FixtureRow {
  fixture_id: number;
  fixture_date: string;
  league_name?: string | null;
  home_team_name?: string | null;
  away_team_name?: string | null;
}

interface OddsRow {
  match_id: string;
  home_team?: string | null;
  away_team?: string | null;
  commence_time?: string | null;
  bookmaker?: string;
  market_type: string;
  odds_1: number | null;
  odds_2: number | null;
  odds_draw: number | null;
  captured_at: string;
}

export interface RevalidationCandidate {
  predictionId: string;
  fixtureId: number;
  fixtureDate: string;
  leagueName: string;
  homeTeam: string;
  awayTeam: string;
  marketBet: string | null;
  analysisOdds: number | null;
  currentOdds: number | null;
  oddsDelta: number | null;
  evAtAnalysis: number | null;
  currentEV: number | null;
  evDrop: number | null;
  status: RevalidationStatus;
  trigger: "odds_drift" | "ev_deterioration" | "final_window" | "missing_baseline" | null;
  triggerReason: string;
}

/** Thresholds — tuned conservatively; revisit once real data accumulates. */
const REVIEW_ODDS_DELTA = 0.07; // 7% move in the tracked selection's price
const INVALIDATED_ODDS_DELTA = 0.15; // 15% move — market has repriced hard
const FINAL_WINDOW_HOURS = 3; // force a last look this close to kickoff
const EV_DROP_REVIEW = 0.05; // absolute EV drop vs analysis time
const EV_DROP_INVALIDATE = 0.15;

export function marketKey(marketBet: string | null): { type: "home" | "away" | "draw" | "over" | "under" | "btts_yes" | "btts_no" | "unknown" } {
  const m = (marketBet ?? "").toLowerCase();
  if (m.includes("home") || m === "1") return { type: "home" };
  if (m.includes("away") || m === "2") return { type: "away" };
  if (m.includes("draw") || m === "x") return { type: "draw" };
  if (m.includes("over")) return { type: "over" };
  if (m.includes("under")) return { type: "under" };
  if (m.includes("btts_yes") || m.includes("both teams to score yes")) return { type: "btts_yes" };
  if (m.includes("btts_no") || m.includes("both teams to score no")) return { type: "btts_no" };
  return { type: "unknown" };
}

/** Extract the current best price for the tracked selection from live odds rows. */
export function currentPriceFor(marketBet: string | null, rows: OddsRow[]): number | null {
  const { type } = marketKey(marketBet);
  if (type === "unknown" || rows.length === 0) return null;

  const usable = rows.filter((row) => [row.odds_1, row.odds_2, row.odds_draw].some((v) => Number(v) > 1));
  if (usable.length === 0) return null;

  // Use the most recently captured row per bookmaker/market, then take the
  // best (highest) current price available for the tracked selection. Odds
  // history can contain several snapshots, so never compare against an old
  // price just because it was better.
  const latestByBookmakerMarket = new Map<string, OddsRow>();
  for (const row of usable) {
    const key = `${row.market_type.toLowerCase()}::${String((row as OddsRow & { bookmaker?: string }).bookmaker ?? "")}`;
    const previous = latestByBookmakerMarket.get(key);
    if (!previous || new Date(row.captured_at).getTime() > new Date(previous.captured_at).getTime()) {
      latestByBookmakerMarket.set(key, row);
    }
  }
  const prices: number[] = [];
  for (const row of latestByBookmakerMarket.values()) {
    const mt = row.market_type.toLowerCase();
    if ((type === "home" || type === "away" || type === "draw") && !["h2h", "1x2", "ml", "match_winner"].some((k) => mt.includes(k))) continue;
    if ((type === "over" || type === "under") && !mt.includes("over") && !mt.includes("total")) continue;
    if ((type === "btts_yes" || type === "btts_no") && !mt.includes("btts") && !mt.includes("both teams")) continue;

    if (type === "home" && row.odds_1) prices.push(row.odds_1);
    if (type === "away" && row.odds_2) prices.push(row.odds_2);
    if (type === "draw" && row.odds_draw) prices.push(row.odds_draw);
    if (type === "over" && row.odds_1) prices.push(row.odds_1);
    if (type === "under" && row.odds_2) prices.push(row.odds_2);
    if (type === "btts_yes" && row.odds_1) prices.push(row.odds_1);
    if (type === "btts_no" && row.odds_2) prices.push(row.odds_2);
  }
  if (prices.length === 0) return null;
  return Math.max(...prices);
}

export interface RevalidationSummary {
  checked: number;
  kept: number;
  review: number;
  invalidated: number;
  skippedNoOdds: number;
  candidates?: RevalidationCandidate[];
}

export async function runRevalidation(): Promise<RevalidationSummary> {
  const now = Date.now();
  const summary: RevalidationSummary = { checked: 0, kept: 0, review: 0, invalidated: 0, skippedNoOdds: 0, candidates: [] };

  const { data: predictions, error: predErr } = await supabase
    .from("ai_predictions")
    .select("id, fixture_id, market_bet, best_market, best_odds, ev_at_analysis, expected_value, home_team, away_team, created_at")
    .eq("status", "active")
    .limit(500);

  if (predErr) {
    logger.error({ err: predErr }, "[REVALIDATION] Failed to load active predictions");
    return summary;
  }
  const active = (predictions ?? []) as PendingPrediction[];
  if (active.length === 0) {
    logger.info("[REVALIDATION] No active predictions to check");
    return summary;
  }

  const fixtureIds = active.map((p) => p.fixture_id);
  const { data: fixtures } = await supabase
    .from("fixtures")
    .select("fixture_id, fixture_date, league_name, home_team_name, away_team_name")
    .in("fixture_id", fixtureIds);
  const fixtureById = new Map((fixtures ?? []).map((f) => [Number((f as FixtureRow).fixture_id), f as FixtureRow]));

  // Only fixtures that haven't kicked off yet are eligible for revalidation —
  // once a match starts, settlement (not revalidation) takes over.
  const upcoming = active.filter((p) => {
    const fx = fixtureById.get(Number(p.fixture_id));
    return fx && new Date(fx.fixture_date).getTime() > now;
  });
  if (upcoming.length === 0) {
    logger.info("[REVALIDATION] No upcoming (pre-kickoff) active predictions");
    return summary;
  }

  const fixtureByTeamAndDate = new Map(
    (fixtures ?? []).map((f) => [
      fixtureMatchKey(
        String((f as FixtureRow & { home_team_name?: string }).home_team_name),
        String((f as FixtureRow & { away_team_name?: string }).away_team_name),
        String((f as FixtureRow & { fixture_date?: string }).fixture_date),
      ),
      f,
    ]),
  );
  const { data: oddsRowsRaw } = await supabase
    .from("odds_history")
    .select("match_id, home_team, away_team, commence_time, bookmaker, market_type, odds_1, odds_2, odds_draw, captured_at")
    .limit(5000);
  const oddsByFixture = new Map<string, OddsRow[]>();
  for (const row of (oddsRowsRaw ?? []) as OddsRow[]) {
    const directFixture = fixtureById.get(Number(row.match_id));
    const matchingFixture = directFixture ?? fixtureByTeamAndDate.get(
      fixtureMatchKey(
        String((row as OddsRow & { home_team?: string }).home_team),
        String((row as OddsRow & { away_team?: string }).away_team),
        String((row as OddsRow & { commence_time?: string }).commence_time),
      ),
    ) as FixtureRow | undefined;
    const key = matchingFixture ? String(matchingFixture.fixture_id) : String(row.match_id);
    const list = oddsByFixture.get(key) ?? [];
    list.push(row);
    oddsByFixture.set(key, list);
  }

  const updates: Array<{ id: string; revalidation_status: RevalidationStatus; revalidation_note: string }> = [];
  const candidates: RevalidationCandidate[] = [];

  for (const prediction of upcoming) {
    summary.checked++;
    const fx = fixtureById.get(Number(prediction.fixture_id))!;
    const hoursToKickoff = (new Date(fx.fixture_date).getTime() - now) / (1000 * 60 * 60);
    const marketBet = prediction.market_bet ?? prediction.best_market;
    const rows = oddsByFixture.get(String(prediction.fixture_id)) ?? [];
    const currentOdds = currentPriceFor(marketBet, rows);
    const analysisOdds = prediction.best_odds;
    const evAtAnalysis = prediction.ev_at_analysis ?? prediction.expected_value ?? null;

    if (!currentOdds || !analysisOdds || analysisOdds <= 1) {
      summary.skippedNoOdds++;
      summary.review++;
      updates.push({
        id: prediction.id,
        revalidation_status: "review",
        revalidation_note: "Odds terkini untuk pasaran ini tidak ditemukan — perlu pengecekan manual sebelum kickoff.",
      });
      candidates.push({
        predictionId: prediction.id,
        fixtureId: prediction.fixture_id,
        fixtureDate: fx.fixture_date,
        leagueName: String((fx as FixtureRow & { league_name?: string }).league_name ?? ""),
        homeTeam: prediction.home_team ?? "",
        awayTeam: prediction.away_team ?? "",
        marketBet,
        analysisOdds,
        currentOdds,
        oddsDelta: null,
        evAtAnalysis,
        currentEV: null,
        evDrop: null,
        status: "review",
        trigger: null,
        triggerReason: "Tidak ada baseline atau odds terkini yang dapat dicocokkan secara aman.",
      });
      continue;
    }

    const oddsDelta = (currentOdds - analysisOdds) / analysisOdds;
    // Implied probability at analysis time, derived from the stored EV,
    // reused against the current price to see how EV would look today if
    // the true win probability hasn't changed — only the market price has.
    const impliedProbAtAnalysis = evAtAnalysis !== null ? (evAtAnalysis + 1) / analysisOdds : 1 / analysisOdds;
    const currentEV = impliedProbAtAnalysis * currentOdds - 1;
    const evDrop = evAtAnalysis !== null ? evAtAnalysis - currentEV : 0;

    let status: RevalidationStatus = "keep";
    let trigger: RevalidationCandidate["trigger"] = null;
    const reasons: string[] = [];

    const adverseOddsDrop = oddsDelta < 0 ? Math.abs(oddsDelta) : 0;
    if (adverseOddsDrop >= INVALIDATED_ODDS_DELTA || currentEV < 0 && evDrop >= EV_DROP_INVALIDATE) {
      status = "invalidated";
      trigger = adverseOddsDrop >= INVALIDATED_ODDS_DELTA ? "odds_drift" : "ev_deterioration";
      reasons.push(`Odds bergerak ${(oddsDelta * 100).toFixed(1)}% dari saat analisis (${analysisOdds} → ${currentOdds}).`);
      if (currentEV < 0) reasons.push(`EV kini negatif (${(currentEV * 100).toFixed(1)}%) vs saat analisis (${((evAtAnalysis ?? 0) * 100).toFixed(1)}%).`);
    } else if (adverseOddsDrop >= REVIEW_ODDS_DELTA || evDrop >= EV_DROP_REVIEW) {
      status = "review";
      trigger = adverseOddsDrop >= REVIEW_ODDS_DELTA ? "odds_drift" : "ev_deterioration";
      reasons.push(`Odds bergerak ${(oddsDelta * 100).toFixed(1)}% (${analysisOdds} → ${currentOdds}), EV bergeser ${(evDrop * 100).toFixed(1)}pp.`);
    } else if (oddsDelta > REVIEW_ODDS_DELTA) {
      reasons.push(`Odds membaik ${(oddsDelta * 100).toFixed(1)}% (${analysisOdds} → ${currentOdds}); EV meningkat berdasarkan harga pasar.`);
    }

    if (hoursToKickoff <= FINAL_WINDOW_HOURS && status === "keep") {
      status = "review";
      trigger = "final_window";
      reasons.push(`Kickoff dalam ${hoursToKickoff.toFixed(1)} jam — pengecekan akhir sebelum pertandingan dimulai.`);
    }

    if (status === "keep") {
      reasons.push("Tidak ada pergerakan signifikan; prediksi masih valid.");
    }

    updates.push({ id: prediction.id, revalidation_status: status, revalidation_note: reasons.join(" ") });
    candidates.push({
      predictionId: prediction.id,
      fixtureId: prediction.fixture_id,
      fixtureDate: fx.fixture_date,
      leagueName: String((fx as FixtureRow & { league_name?: string }).league_name ?? ""),
      homeTeam: prediction.home_team ?? "",
      awayTeam: prediction.away_team ?? "",
      marketBet,
      analysisOdds,
      currentOdds,
      oddsDelta,
      evAtAnalysis,
      currentEV,
      evDrop,
      status,
      trigger,
      triggerReason: reasons.join(" "),
    });
    if (status === "keep") summary.kept++;
    else if (status === "review") summary.review++;
    else summary.invalidated++;
  }

  // One update per row (Supabase JS has no native batch-update-by-id), but
  // this only runs over the pending-fixture subset, which is small and
  // bounded by the scan window — not the full historical table.
  await Promise.all(
    updates.map((u) =>
      supabase
        .from("ai_predictions")
        .update({
          revalidation_status: u.revalidation_status,
          revalidation_note: u.revalidation_note,
          last_revalidated_at: new Date().toISOString(),
        })
        .eq("id", u.id),
    ),
  );

  summary.candidates = candidates;
  logger.info(summary, "[REVALIDATION] Selesai");
  return summary;
}

function normalizeTeamName(value: string): string {
  return value
    .toLowerCase()
    .replace(/\b(fc|cf|sc|afc)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function fixtureMatchKey(home: string, away: string, date: string): string {
  const parsed = date ? new Date(date) : null;
  const day = parsed && Number.isFinite(parsed.getTime()) ? parsed.toISOString().slice(0, 10) : "";
  return `${normalizeTeamName(home)}::${normalizeTeamName(away)}::${day}`;
}
