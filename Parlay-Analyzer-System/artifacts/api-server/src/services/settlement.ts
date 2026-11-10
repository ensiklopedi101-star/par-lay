/**
 * Settlement Service
 *
 * Arsitektur bersih:
 *   - TUGAS SAYA   : refresh skor final, ambil data, hitung WIN/LOSS secara matematika
 *   - TUGAS GEMINI : evaluasi kenapa LOSS terjadi, buat pelajaran untuk RAG
 *
 * Settlement me-refresh hanya fixture yang terhubung dengan prediction aktif
 * dari endpoint historical events Odds-API, lalu menggunakan `fixtures` sebagai
 * snapshot lokal untuk perhitungan yang fail-closed.
 */

import { supabase } from "../lib/supabase-client";
import { logger } from "../lib/logger";
import { generateAIResponse } from "./ai-analysis";
import { settleParlaysForFixtures } from "./parlay-builder";
import { refreshFixtureResultsForSettlement } from "./odds-fetcher";
import { appendSettlementContext } from "../lib/settlement-context";
import { recordSettledPredictionEvaluation } from "./prompt-learning";
import {
  calculateResult,
  parlayLegMarketText,
  type SettlementOutcome,
} from "../lib/bet-settlement";

/* ─────────────────────────────────────────
   Tipe
───────────────────────────────────────── */

interface PendingPrediction {
  id: string;
  fixture_id: number;
  status: string | null;
  prediction_text: string | null;
  best_market: string | null;
  market_bet: string | null;
  home_team: string | null;
  away_team: string | null;
  expected_value: number | null;
  ev_at_analysis: number | null;
  best_odds: number | null;
  confidence_score: number | null;
  uncertainty_score: number | null;
  league: string | null;
  created_at: string | null;
  manual_context: unknown;
}

interface CompletedFixture {
  fixture_id: number;
  home_team_name: string;
  away_team_name: string;
  league_name: string;
  status_short: string;
  home_goals: number | null;
  away_goals: number | null;
  home_goals_ht: number | null;
  away_goals_ht: number | null;
}

/* ─────────────────────────────────────────
   Tentukan apakah prediksi adalah "NO BET"
───────────────────────────────────────── */
export function isNoBet(
  prediction: Pick<PendingPrediction, "market_bet" | "best_market" | "prediction_text">,
): boolean {
  // A selected market is authoritative. The full Gemini response often
  // contains "NO BET" for alternative markets even when the final
  // recommendation is a real bet.
  const selectedMarket = (prediction.market_bet ?? prediction.best_market ?? "").trim().toLowerCase();
  if (selectedMarket !== "") {
    return /^(no[\s_-]*bet|skip)$/.test(selectedMarket);
  }

  const text = (prediction.prediction_text ?? "").toLowerCase();
  /*
   * Do not scan the whole response for "NO BET": the market comparison table
   * legitimately contains that label for rejected alternatives. The final
   * decision is the only authoritative prose fallback for legacy rows.
   */
  const finalDecision = text.match(
    /keputusan\s*:\s*(?:\*\*)?\s*(ambil|no[\s_-]*bet)\b/i,
  )?.[1]?.replace(/\s+/g, " ");
  if (finalDecision?.toLowerCase() === "ambil") return false;
  if (finalDecision && /no[\s_-]*bet/i.test(finalDecision)) return true;

  return (
    /no[\s_-]*bet/.test(text) ||
    text.includes("tidak disarankan") ||
    text.includes("tidak ada taruhan") ||
    text.includes("skip")
  );
}

/**
 * Recover the final selected market from older AI responses that predate the
 * structured `market_bet` contract. This is used only for post-match
 * evaluation; it must never be used by parlay selection before kickoff.
 */
export function marketFromPredictionText(
  text: string | null,
  homeTeam?: string | null,
  awayTeam?: string | null,
): string | null {
  const recommendation = (text ?? "").match(
    /pasaran\s+terpilih\s*:\s*(?:\*\*)?([^\n]+?)(?:\*\*)?\s*-\s*keputusan\s*:/i,
  )?.[1];
  if (!recommendation) return null;

  const raw = recommendation
    .replace(/\*\*/g, "")
    .replace(/\*/g, "")
    .replace(/[`_]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.,;:]+$/, "");
  if (!raw || /^(n\/?a|none|tidak ada|no[\s_-]*bet|skip)$/i.test(raw)) return null;

  const normalized = raw
    .replace(/\s*\([^)]*\)\s*$/, "")
    .replace(/\s+goals?\b/i, "")
    .trim();
  if (/both teams to score|btts/i.test(normalized)) {
    return /\bno\b/i.test(normalized) ? "BTTS No" : "BTTS Yes";
  }
  if (/half\s*time|first\s*half/i.test(normalized)) {
    if (/\baway\b|\btamu\b/i.test(normalized)) return "HT Away";
    if (/\bdraw\b|\bseri\b/i.test(normalized)) return "HT Draw";
    if (awayTeam && normalized.toLowerCase().includes(awayTeam.toLowerCase())) return "HT Away";
    if (homeTeam && normalized.toLowerCase().includes(homeTeam.toLowerCase())) return "HT Home";
    return "HT Home";
  }
  if (/^1x2\b/i.test(normalized)) {
    if (/\baway\b|\btamu\b/i.test(normalized)) return "1X2 Away";
    if (/\bdraw\b|\bseri\b/i.test(normalized)) return "1X2 Draw";
    if (/\bhome\b|\btuan rumah\b/i.test(normalized)) return "1X2 Home";
    if (awayTeam && normalized.toLowerCase().includes(awayTeam.toLowerCase())) return "1X2 Away";
    if (homeTeam && normalized.toLowerCase().includes(homeTeam.toLowerCase())) return "1X2 Home";
  }
  const totals = normalized.match(/\b(over|under)\s*([+-]?\d+(?:[.,]\d+)?)/i);
  if (totals) return `${totals[1]!.toLowerCase() === "over" ? "Over" : "Under"} ${totals[2]!.replace(",", ".")}`;
  if (/asian\s+handicap|handicap|spread|\bah\b/i.test(normalized)) {
    return normalized
      .replace(/asian\s+handicap/i, "AH")
      .replace(/handicap/i, "AH")
      .replace(/spread/i, "AH")
      .replace(/\s+/g, " ")
      .trim();
  }
  if (/draw\s+no\s+bet|dnb/i.test(normalized)) {
    if (awayTeam && normalized.toLowerCase().includes(awayTeam.toLowerCase())) return "DNB Away";
    if (homeTeam && normalized.toLowerCase().includes(homeTeam.toLowerCase())) return "DNB Home";
  }
  return normalized;
}

/* ─────────────────────────────────────────
   Tentukan WIN/LOSS dari skor + market
   Matematika murni ada di lib/bet-settlement.ts supaya bisa diuji
   tanpa Supabase. Return null jika market tidak dikenali.
───────────────────────────────────────── */
export { calculateResult };
export type { SettlementOutcome };

function requiresHalfTimeScore(market: string | null): boolean {
  return /\b(ht|half[\s-]?time|first[\s-]?half)\b/i.test(market ?? "");
}

function withSettlementContext(
  prediction: PendingPrediction,
  settlement: Record<string, unknown>,
  evaluationSource = "fixture_final_score",
): Record<string, unknown> {
  return appendSettlementContext(prediction.manual_context, settlement, evaluationSource);
}

function snapshotProbability(value: unknown): number | null {
  let context: Record<string, unknown> = {};
  if (value && typeof value === "object" && !Array.isArray(value)) {
    context = value as Record<string, unknown>;
  } else if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        context = parsed as Record<string, unknown>;
      }
    } catch {
      return null;
    }
  }
  const recommendation = context.recommendation && typeof context.recommendation === "object"
    ? context.recommendation as Record<string, unknown>
    : {};
  const probability = Number(context.probability ?? recommendation.probability);
  return Number.isFinite(probability) && probability > 0 && probability < 1 ? probability : null;
}

/* ─────────────────────────────────────────
   Gemini: evaluasi LOSS → buat pelajaran
   (satu-satunya tugas Gemini di settlement)
───────────────────────────────────────── */
async function generateLossLesson(
  prediction: PendingPrediction,
  homeGoals: number,
  awayGoals: number,
  geminiKey: string | undefined,
): Promise<string | null> {
  try {
    const prompt = `Anda adalah analis evaluasi pasca-pertandingan.

Pertandingan : ${prediction.home_team} vs ${prediction.away_team}
Skor Akhir   : ${homeGoals} - ${awayGoals}
Pasaran Bet  : ${prediction.market_bet ?? prediction.best_market ?? "tidak diketahui"}

Prediksi AI sebelumnya:
${prediction.prediction_text?.slice(0, 1500) ?? "Tidak tersedia"}

Hasil pertandingan ini BERBEDA dari yang direkomendasikan (LOSS).

Tugas Anda — tulis dalam 2-3 kalimat maksimal:
1. Faktor kunci yang tidak terprediksi dengan baik
2. Satu pelajaran konkret untuk analisis pertandingan serupa di masa depan

Format: langsung tulis pelajarannya, tanpa intro, tanpa header, dalam bahasa Indonesia.`;

    const result = await generateAIResponse(
      geminiKey,
      "Anda adalah evaluator hasil prediksi betting yang objektif.",
      prompt,
    );
    return result.text.trim();
  } catch (err) {
    logger.warn({ err }, "[SETTLEMENT] Gagal generate pelajaran dari Gemini");
    return null;
  }
}

function buildFallbackLesson(
  prediction: PendingPrediction,
  homeGoals: number,
  awayGoals: number,
  betResult: SettlementOutcome,
  marketBet: string | null,
  evAtBet: number,
): string {
  const market = marketBet ?? "N/A";
  const score = `${homeGoals}-${awayGoals}`;
  switch (betResult) {
    case "WIN":
      return `Prediksi WIN terkonfirmasi. Market: ${market}. Skor: ${score}. EV saat analisis: ${evAtBet.toFixed(2)}.`;
    case "HALF_WIN":
      return `Prediksi HALF_WIN. Market: ${market} menghasilkan kemenangan setengah berdasarkan skor ${score}; evaluasi line quarter perlu dipertahankan.`;
    case "HALF_LOSS":
      return `Prediksi HALF_LOSS. Market: ${market} menghasilkan kerugian setengah berdasarkan skor ${score}; line quarter perlu diperiksa pada analisis berikutnya.`;
    case "PUSH":
      return `Prediksi PUSH. Market: ${market} tepat pada line berdasarkan skor ${score}; tidak ada edge hasil yang terealisasi.`;
    case "LOSS":
      return `Prediksi LOSS. Market: ${market}. Skor aktual ${score} berbeda dari rekomendasi; evaluasi ulang kualitas statistik, line, dan pergerakan odds.`;
  }
}

async function ensureLearningLesson(
  prediction: PendingPrediction,
  fixture: CompletedFixture,
  betResult: SettlementOutcome,
  lessonText: string,
  evAtBet: number,
  marketBet: string | null,
): Promise<boolean> {
  const fixtureId = String(fixture.fixture_id);
  const existing = await supabase
    .from("lessons_learned")
    .select("id")
    .eq("fixture_id", fixtureId)
    .eq("bet_result", betResult)
    .limit(1);

  if (existing.error) {
    logger.error({ err: existing.error, fixtureId, predictionId: prediction.id }, "[SETTLEMENT] Gagal memeriksa lesson existing");
    return false;
  }
  if ((existing.data ?? []).length > 0) return true;

  const { error } = await supabase.from("lessons_learned").insert({
    fixture_id: fixtureId,
    home_team: prediction.home_team ?? fixture.home_team_name,
    away_team: prediction.away_team ?? fixture.away_team_name,
    league: prediction.league ?? fixture.league_name,
    bet_result: betResult,
    home_score: fixture.home_goals,
    away_score: fixture.away_goals,
    ev_at_bet: evAtBet,
    ai_prediction: prediction.prediction_text?.slice(0, 2000) ?? null,
    lesson_text: lessonText,
    market_bet: marketBet ?? null,
    created_at: new Date().toISOString(),
  });
  if (error) {
    logger.error({ err: error, fixtureId, predictionId: prediction.id, betResult }, "[SETTLEMENT] Gagal menyimpan lesson AI");
    return false;
  }
  return true;
}

interface LessonPerformanceRow {
  bet_result: string | null;
  created_at: string | null;
}

/**
 * Rebuild the feedback metrics from settled lessons.
 *
 * `performance_log` is an aggregate table, while `lessons_learned` is the
 * durable source for each settled prediction. Rebuilding from lessons makes
 * the metric recoverable after a failed insert or a server restart.
 */
async function rebuildPerformanceLog(): Promise<void> {
  const { data, error } = await supabase
    .from("lessons_learned")
    .select("bet_result, created_at")
    .not("created_at", "is", null);

  if (error) {
    logger.error({ err: error }, "[SETTLEMENT] Gagal membaca lessons untuk performance log");
    return;
  }

  const byDate = new Map<string, LessonPerformanceRow[]>();
  for (const row of (data ?? []) as LessonPerformanceRow[]) {
    const date = row.created_at?.slice(0, 10);
    if (!date) continue;
    const rows = byDate.get(date) ?? [];
    rows.push(row);
    byDate.set(date, rows);
  }

  for (const [date, rows] of byDate) {
    const wins = rows.filter((row) => row.bet_result === "WIN" || row.bet_result === "HALF_WIN").length;
    const losses = rows.filter((row) => row.bet_result === "LOSS" || row.bet_result === "HALF_LOSS").length;
    const total = rows.length;
    const decisive = wins + losses;
    if (total === 0) continue;

    const payload = {
      date,
      total_parlays: total,
      wins,
      losses,
      hit_rate: decisive > 0 ? wins / decisive : null,
      total_roi: null,
    };

    const { data: existing, error: lookupError } = await supabase
      .from("performance_log")
      .select("id")
      .eq("date", date)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lookupError) {
      logger.error({ err: lookupError, date }, "[SETTLEMENT] Gagal membaca performance log");
      continue;
    }

    const write = existing?.id
      ? await supabase.from("performance_log").update({
          total_parlays: payload.total_parlays,
          wins: payload.wins,
          losses: payload.losses,
          hit_rate: payload.hit_rate,
          total_roi: payload.total_roi,
        }).eq("id", existing.id)
      : await supabase.from("performance_log").insert(payload);

    if (write.error) {
      logger.error({ err: write.error, date }, "[SETTLEMENT] Gagal menyimpan performance log");
    }
  }
}

/* ─────────────────────────────────────────
   Manual parlay legs (prediction_id IS NULL)
───────────────────────────────────────── */

interface ManualParlayLegRow {
  id: string;
  fixture_id: number | string;
  market: string | null;
  selection: string | null;
}

/**
 * Settle legs that were picked manually and therefore have no AI prediction.
 *
 * The leg's own market + selection decides the outcome. The caller supplies the
 * fixtures it already knows are finished; any manual leg on a finished fixture
 * that the caller did not load (typically a fixture with no AI prediction at
 * all) is resolved with one extra query so it can never hang a mixed parlay.
 */
async function settleManualParlayLegs(
  completedFixtures: CompletedFixture[],
  scopedFixtureIds?: number[],
): Promise<{ settledLegs: number; fixtureIds: number[] }> {
  const knownFixtures = new Map(completedFixtures.map((fixture) => [fixture.fixture_id, fixture]));

  let legQuery = supabase
    .from("parlay_legs")
    .select("id, fixture_id, market, selection")
    .is("prediction_id", null)
    .is("result", null);
  /* A scoped run (single fixture / single prediction) must not touch legs
     outside the fixtures the caller asked about. */
  if (scopedFixtureIds?.length) {
    legQuery = legQuery.in("fixture_id", scopedFixtureIds);
  }
  const { data: legs, error } = await legQuery.limit(500);
  if (error) {
    logger.error({ err: error }, "[SETTLEMENT] Gagal memuat manual parlay legs");
    return { settledLegs: 0, fixtureIds: [] };
  }
  if (!legs?.length) return { settledLegs: 0, fixtureIds: [] };

  /* Resolve any finished fixture the caller did not already load. */
  const missingFixtureIds = Array.from(new Set(
    legs
      .map((leg) => Number(leg.fixture_id))
      .filter((fixtureId) => Number.isFinite(fixtureId) && !knownFixtures.has(fixtureId)),
  ));
  if (missingFixtureIds.length > 0) {
    const { data: extraFixtures, error: extraError } = await supabase
      .from("fixtures")
      .select("fixture_id, home_team_name, away_team_name, league_name, status_short, home_goals, away_goals, home_goals_ht, away_goals_ht")
      .in("fixture_id", missingFixtureIds)
      .in("status_short", ["FT", "AET", "PEN", "finished", "completed", "settled"])
      .not("home_goals", "is", null)
      .not("away_goals", "is", null) as { data: CompletedFixture[] | null; error: { message: string } | null };
    if (extraError) {
      logger.error({ err: extraError }, "[SETTLEMENT] Gagal memuat fixture untuk manual legs");
    }
    for (const fixture of extraFixtures ?? []) {
      knownFixtures.set(fixture.fixture_id, fixture);
    }
  }

  const fixtureById = knownFixtures;
  const settledFixtureIds = new Set<number>();
  let settledLegs = 0;

  for (const leg of (legs ?? []) as ManualParlayLegRow[]) {
    const fixture = fixtureById.get(Number(leg.fixture_id));
    if (!fixture || fixture.home_goals == null || fixture.away_goals == null) continue;

    const marketText = parlayLegMarketText(leg, {
      homeTeam: fixture.home_team_name,
      awayTeam: fixture.away_team_name,
    });
    const legResult = calculateResult(
      fixture.home_goals,
      fixture.away_goals,
      marketText,
      null,
      fixture.home_goals_ht,
      fixture.away_goals_ht,
    );
    if (legResult === null) {
      logger.warn(
        { legId: leg.id, fixtureId: fixture.fixture_id, market: marketText },
        "[SETTLEMENT] Manual leg tidak dapat dievaluasi — perlu review manual",
      );
      continue;
    }

    const { error: updateError } = await supabase
      .from("parlay_legs")
      .update({ result: legResult })
      .eq("id", leg.id)
      .is("result", null);
    if (updateError) {
      logger.error({ err: updateError, legId: leg.id }, "[SETTLEMENT] Gagal update manual parlay leg");
      continue;
    }
    settledFixtureIds.add(fixture.fixture_id);
    settledLegs++;
  }

  if (settledLegs > 0) {
    logger.info(
      { settledLegs, fixtures: [...settledFixtureIds] },
      "[SETTLEMENT] Manual parlay legs diselesaikan",
    );
  }
  return { settledLegs, fixtureIds: [...settledFixtureIds] };
}

/* ─────────────────────────────────────────
   Main runner — dipanggil oleh scheduler
   dan endpoint POST /api/sync/settle
───────────────────────────────────────── */
export async function runSettlement(options: {
  fixtureIds?: number[];
  predictionId?: string;
  refreshResults?: boolean;
  evaluationSource?: "fixture_final_score" | "manual_score_entry";
} = {}): Promise<{ settled: number; lessons: number; skipped: number }> {
  logger.info("[SETTLEMENT] Memulai pengecekan hasil pertandingan...");

  const geminiKey = process.env["GEMINI_API_KEY"];
  const aiAvailable = Boolean(geminiKey || process.env["GROQ_API_KEY"]);

  /* 1. Ambil prediksi aktif dan prediksi yang sebelumnya salah ditandai no_bet.
     The latter must be recoverable after the recommendation parser is fixed. */
  const pendingPredictions: PendingPrediction[] = [];
  let predErr: { message: string } | null = null;
  for (let offset = 0; ; offset += 1000) {
    let pendingQuery = supabase
      .from("ai_predictions")
      .select("id, fixture_id, status, prediction_text, best_market, market_bet, home_team, away_team, expected_value, ev_at_analysis, best_odds, confidence_score, uncertainty_score, league, created_at, manual_context")
      .in("status", ["active", "pending_result", "no_bet", "settled_manual"])
      .not("prediction_text", "is", null);
    if (options.fixtureIds?.length) {
      pendingQuery = pendingQuery.in("fixture_id", options.fixtureIds);
    }
    if (options.predictionId) {
      pendingQuery = pendingQuery.eq("id", options.predictionId);
    }
    const { data, error } = await pendingQuery.range(offset, offset + 999);
    if (error) {
      predErr = error;
      break;
    }
    pendingPredictions.push(...((data ?? []) as PendingPrediction[]));
    if ((data?.length ?? 0) < 1000) break;
  }

  if (predErr || !pendingPredictions?.length) {
    if (predErr) logger.error({ error: predErr }, "[SETTLEMENT] Gagal memuat seluruh prediksi pending");
    else logger.info("[SETTLEMENT] Tidak ada prediksi aktif untuk di-settle");
    await rebuildPerformanceLog();
    return { settled: 0, lessons: 0, skipped: 0 };
  }

  const fixtureIds = pendingPredictions.map((p) => p.fixture_id);

  /*
   * A row must not remain "active" after kickoff merely because the provider
   * has not returned its final result yet. Keep it retryable, but expose the
   * honest intermediate state as pending_result.
   */
  const { data: elapsedFixtures } = await supabase
    .from("fixtures")
    .select("fixture_id, fixture_date")
    .in("fixture_id", fixtureIds)
    .lte("fixture_date", new Date().toISOString());
  const elapsedIds = new Set((elapsedFixtures ?? []).map((fixture) => Number(fixture.fixture_id)));
  for (const prediction of pendingPredictions as PendingPrediction[]) {
    if (prediction.status === "active" && elapsedIds.has(Number(prediction.fixture_id))) {
      const nextStatus = isNoBet(prediction) ? "no_bet" : "pending_result";
      const { error: pendingUpdateError } = await supabase
        .from("ai_predictions")
        .update({ status: nextStatus, updated_at: new Date().toISOString() })
        .eq("id", prediction.id);
      if (pendingUpdateError) {
        logger.warn({ err: pendingUpdateError, predictionId: prediction.id }, "[SETTLEMENT] Gagal menandai pending result");
      } else {
        prediction.status = nextStatus;
      }
    }
  }

  /*
   * 2. Refresh hasil final dari Odds-API terlebih dahulu. Normal odds sync
   * memakai status=pending, sehingga pertandingan selesai tidak selalu muncul
   * di sana. Refresh dibatasi pada fixture yang punya prediction unsettled.
   * Jika provider gagal/rate-limited, settlement tetap memakai skor lokal yang
   * sudah tersedia dan tidak pernah mengarang hasil.
   */
  const refreshedResults = options.refreshResults === false
    ? { skipped: fixtureIds.length, reason: "manual_score_entry", refreshedFixtureIds: [] as number[] }
    : await refreshFixtureResultsForSettlement(fixtureIds);
  logger.info(refreshedResults, "[SETTLEMENT] Refresh hasil dari Odds-API selesai");
  const providerVerifiedFixtureIds = new Set(
    "refreshedFixtureIds" in refreshedResults ? refreshedResults.refreshedFixtureIds : [],
  );

  /* 3. Ambil fixtures yang sudah selesai BESERTA SKOR dari DB kita sendiri */
  const { data: completedFixtures } = await supabase
    .from("fixtures")
    .select("fixture_id, home_team_name, away_team_name, league_name, status_short, home_goals, away_goals, home_goals_ht, away_goals_ht")
    .in("fixture_id", fixtureIds)
    .in("status_short", ["FT", "AET", "PEN", "finished", "completed", "settled"])
    .not("home_goals", "is", null)
    .not("away_goals", "is", null) as { data: CompletedFixture[] | null };

  if (!completedFixtures?.length) {
    logger.info("[SETTLEMENT] Tidak ada fixture selesai dengan skor tersedia di DB");
    /* Manual legs have no prediction, so they must still be settled here. */
    const manualOnly = await settleManualParlayLegs([], options.fixtureIds);
    if (manualOnly.fixtureIds.length > 0) {
      await settleParlaysForFixtures(manualOnly.fixtureIds);
    }
    await rebuildPerformanceLog();
    return { settled: 0, lessons: 0, skipped: 0 };
  }

  logger.info(
    `[SETTLEMENT] ${completedFixtures.length} fixture selesai ditemukan dari ${pendingPredictions.length} prediksi aktif`
  );

  let settled  = 0;
  let lessons  = 0;
  let skipped  = 0;

  for (const fixture of completedFixtures) {
    const prediction = pendingPredictions.find(
      (p) => p.fixture_id === fixture.fixture_id
    ) as PendingPrediction | undefined;
    if (!prediction) continue;

    const resultProviderVerified = providerVerifiedFixtureIds.has(fixture.fixture_id);
    const settlementSource = resultProviderVerified
      ? "odds_api_historical"
      : options.refreshResults === false
        ? "manual_score_entry"
        : "fixture_cache";
    const resultVerifiedAt = resultProviderVerified ? new Date().toISOString() : null;
    const settlementAuditFields = {
      resultProvider: resultProviderVerified ? "Odds-API" : null,
      resultVerified: resultProviderVerified,
      resultVerifiedAt,
    };
    const homeGoals = fixture.home_goals!;
    const awayGoals = fixture.away_goals!;

    /* 4. Lewati prediksi "NO BET" — tidak ada taruhan → tidak ada settlement */
    if (isNoBet(prediction)) {
      const { error: noBetUpdateError } = await supabase.from("ai_predictions").update({
        status: "no_bet",
        home_score: homeGoals,
        away_score: awayGoals,
        settled_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        manual_context: withSettlementContext(prediction, {
          status: "no_bet",
          marketBet: null,
          homeScore: homeGoals,
          awayScore: awayGoals,
          marketResolution: "no_selected_market",
          ...settlementAuditFields,
        }, settlementSource),
      }).eq("id", prediction.id);
      if (noBetUpdateError) {
        logger.error({ err: noBetUpdateError, predictionId: prediction.id }, "[SETTLEMENT] Gagal menyimpan status NO BET");
      }
      skipped++;
      continue;
    }

    /* 5. Hitung WIN/LOSS secara matematis murni dari skor */
    const marketBet = prediction.market_bet
      ?? prediction.best_market
      ?? marketFromPredictionText(prediction.prediction_text, prediction.home_team, prediction.away_team);
    if (requiresHalfTimeScore(marketBet) &&
      (fixture.home_goals_ht == null || fixture.away_goals_ht == null)) {
      logger.warn(
        { fixtureId: fixture.fixture_id, predictionId: prediction.id },
        "[SETTLEMENT] Skipping HT market until half-time score is available",
      );
      skipped++;
      continue;
    }
    const betResult = calculateResult(
      homeGoals,
      awayGoals,
      marketBet,
      prediction.prediction_text,
      fixture.home_goals_ht,
      fixture.away_goals_ht,
    );

    if (betResult === null) {
      /* Market tidak dikenali — tandai manual */
      logger.warn({
        fixtureId: fixture.fixture_id,
        bestMarket: marketBet,
      }, "[SETTLEMENT] Market tidak dikenali — perlu review manual");

      const { error: manualUpdateError } = await supabase.from("ai_predictions").update({
        status: "settled_manual",
        home_score: homeGoals,
        away_score: awayGoals,
        settled_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        manual_context: withSettlementContext(prediction, {
          status: "settled_manual",
          marketBet,
          homeScore: homeGoals,
          awayScore: awayGoals,
          marketResolution: "unsupported_market",
          ...settlementAuditFields,
        }, settlementSource),
      }).eq("id", prediction.id);
      if (manualUpdateError) {
        logger.error({ err: manualUpdateError, predictionId: prediction.id }, "[SETTLEMENT] Gagal menyimpan status manual");
      }

      skipped++;
      continue;
    }

    logger.info({
      fixtureId: fixture.fixture_id,
      match: `${fixture.home_team_name} ${homeGoals}-${awayGoals} ${fixture.away_team_name}`,
      market: marketBet,
      result: betResult,
    }, "[SETTLEMENT] Hasil dihitung");

    /* 6. Simpan setiap hasil taruhan ke knowledge base.
          NO BET sudah dilewati di atas; WIN/LOSS/partial/push semuanya
          menjadi feedback yang dapat dipakai oleh RAG. */
    const evAtBet = prediction.ev_at_analysis ?? prediction.expected_value ?? 0;

    let lessonText: string;
    if (betResult === "LOSS" && aiAvailable) {
      lessonText = await generateLossLesson(prediction, homeGoals, awayGoals, geminiKey)
        ?? buildFallbackLesson(prediction, homeGoals, awayGoals, betResult, marketBet, evAtBet);
    } else {
      lessonText = buildFallbackLesson(prediction, homeGoals, awayGoals, betResult, marketBet, evAtBet);
    }

    /*
     * Learning is written before the prediction is marked settled. If this
     * write fails, the row remains retryable on the next scheduler run
     * instead of silently becoming permanently invisible to the learner.
     */
    const learningSaved = await ensureLearningLesson(
      prediction,
      fixture,
      betResult,
      lessonText,
      evAtBet,
      marketBet,
    );
    if (!learningSaved) {
      skipped++;
      continue;
    }

    const settledAt = new Date().toISOString();
    const evaluationSaved = await recordSettledPredictionEvaluation({
      predictionId: prediction.id,
      fixtureId: fixture.fixture_id,
      analysisAt: prediction.created_at,
      settledAt,
      league: fixture.league_name ?? prediction.league,
      marketBet,
      outcome: betResult,
      homeScore: homeGoals,
      awayScore: awayGoals,
      odds: prediction.best_odds,
      probability: snapshotProbability(prediction.manual_context),
      confidence: prediction.confidence_score,
      evPercent: evAtBet * 100,
      predictionText: prediction.prediction_text,
      inputSnapshot: prediction.manual_context,
      settlementSource,
      settlementVerified: resultProviderVerified,
      settlementVerifiedAt: resultVerifiedAt,
    });
    if (!evaluationSaved) {
      logger.warn(
        { predictionId: prediction.id },
        "[SETTLEMENT] Prediction remains settleable; the learning evaluation can be imported later",
      );
    }

    /*
     * Update the parlay legs that belong to THIS prediction. Scoping by
     * fixture_id alone would overwrite manual legs on the same fixture that
     * were placed on a different market (for example the AI picked Over 2.5
     * while the user picked 1X2 Home). If this fails, the prediction remains
     * retryable and the parent parlay cannot be left with a null result.
     */
    const { error: legUpdateError } = await supabase
      .from("parlay_legs")
      .update({ result: betResult })
      .eq("prediction_id", prediction.id)
      .is("result", null);
    if (legUpdateError) {
      logger.error({ err: legUpdateError, fixtureId: fixture.fixture_id, predictionId: prediction.id }, "[SETTLEMENT] Gagal update hasil parlay leg");
      skipped++;
      continue;
    }

    /* 7. Update prediction dengan hasil dan snapshot evaluasi lengkap.
          Snapshot analisis asli tetap dipertahankan; settlement hanya menambah
          bagian hasil aktual sehingga evaluasi tidak kehilangan input awal. */
    const { error: predictionUpdateError } = await supabase.from("ai_predictions").update({
      status: betResult,
      // Preserve the recovered historical selection so the board and learning
      // summary can explain the result even for legacy rows.
      market_bet: marketBet,
      best_market: marketBet,
      home_score: homeGoals,
      away_score: awayGoals,
      settled_at: settledAt,
      updated_at: new Date().toISOString(),
      manual_context: withSettlementContext(prediction, {
        status: betResult,
        marketBet,
        oddsAtAnalysis: prediction.best_odds,
        confidenceAtAnalysis: prediction.confidence_score,
        uncertaintyAtAnalysis: prediction.uncertainty_score,
        evAtAnalysis: evAtBet,
        homeScore: homeGoals,
        awayScore: awayGoals,
        lessonText,
        ...settlementAuditFields,
      }, settlementSource),
    }).eq("id", prediction.id);
    if (predictionUpdateError) {
      logger.error({ err: predictionUpdateError, predictionId: prediction.id }, "[SETTLEMENT] Gagal update hasil prediksi");
      skipped++;
      continue;
    }

    settled++;
    lessons++;
  }

  /*
   * Manual parlay legs (prediction_id IS NULL) have no AI prediction to drive
   * settlement, so they are settled here from the finished fixture using the
   * leg's own market/selection. Without this pass a mixed AI + manual parlay
   * stays "active" forever once any manual leg is on a fixture that has no
   * active prediction.
   */
  const manualLegs = await settleManualParlayLegs(completedFixtures, options.fixtureIds);
  const parlayFixtureIds = Array.from(new Set([
    ...completedFixtures.map((fixture) => fixture.fixture_id),
    ...manualLegs.fixtureIds,
  ]));

  await settleParlaysForFixtures(parlayFixtureIds);

  /* M6: AI Feedback Loop — rebuild aggregates from durable lessons. */
  await rebuildPerformanceLog();

  logger.info(
    `[SETTLEMENT] Selesai: ${settled} diselesaikan (${lessons} hasil masuk learning), ${skipped} dilewati`
  );
  return { settled, lessons, skipped };
}
