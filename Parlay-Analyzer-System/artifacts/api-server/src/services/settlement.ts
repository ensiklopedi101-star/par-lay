/**
 * Settlement Service
 *
 * Arsitektur bersih:
 *   - TUGAS SAYA   : ambil data (skor dari tabel `fixtures`), hitung WIN/LOSS secara matematika
 *   - TUGAS GEMINI : evaluasi kenapa LOSS terjadi, buat pelajaran untuk RAG
 *
 * Tidak ada pemanggilan API eksternal di sini.
 * Semua skor sudah disimpan oleh odds-fetcher ke tabel `fixtures`.
 */

import { supabase } from "../lib/supabase-client";
import { logger } from "../lib/logger";
import { generateAIResponse } from "./ai-analysis";
import { settleParlaysForFixtures } from "./parlay-builder";

/* ─────────────────────────────────────────
   Tipe
───────────────────────────────────────── */

interface PendingPrediction {
  id: string;
  fixture_id: number;
  prediction_text: string | null;
  best_market: string | null;
  market_bet: string | null;
  home_team: string | null;
  away_team: string | null;
  expected_value: number | null;
  ev_at_analysis: number | null;
  league: string | null;
}

interface CompletedFixture {
  fixture_id: number;
  home_team_name: string;
  away_team_name: string;
  league_name: string;
  status_short: string;
  home_goals: number | null;
  away_goals: number | null;
}

/* ─────────────────────────────────────────
   Tentukan apakah prediksi adalah "NO BET"
───────────────────────────────────────── */
function isNoBet(prediction: PendingPrediction): boolean {
  const text = (prediction.prediction_text ?? "").toLowerCase();
  return (
    text.includes("no bet") ||
    text.includes("tidak disarankan") ||
    text.includes("tidak ada taruhan") ||
    text.includes("skip")
  );
}

/* ─────────────────────────────────────────
   Tentukan WIN/LOSS dari skor + market
   Return null jika market tidak dikenali
───────────────────────────────────────── */
function calculateResult(
  homeGoals: number,
  awayGoals: number,
  bestMarket: string | null,
  predictionText: string | null,
): "WIN" | "LOSS" | "HALF_WIN" | "HALF_LOSS" | "PUSH" | null {
  const market = (bestMarket ?? "").toLowerCase().trim();
  const text   = (predictionText ?? "").toLowerCase();

  /* 1x2 / Moneyline */
  if (market.includes("home") || market === "1" || market === "1x2_home") {
    return homeGoals > awayGoals ? "WIN" : "LOSS";
  }
  if (market.includes("away") || market === "2" || market === "1x2_away") {
    return awayGoals > homeGoals ? "WIN" : "LOSS";
  }
  if (market.includes("draw") || market === "x" || market === "1x2_draw") {
    return homeGoals === awayGoals ? "WIN" : "LOSS";
  }

  /* Over / Under */
  if (market.includes("over") || market.includes("over_2")) {
    const line = extractLine(market) ?? 2.5;
    return (homeGoals + awayGoals) > line ? "WIN" : "LOSS";
  }
  if (market.includes("under")) {
    const line = extractLine(market) ?? 2.5;
    return (homeGoals + awayGoals) < line ? "WIN" : "LOSS";
  }

  /* BTTS */
  if (market.includes("btts_yes") || market.includes("both teams to score yes")) {
    return homeGoals > 0 && awayGoals > 0 ? "WIN" : "LOSS";
  }
  if (market.includes("btts_no") || market.includes("both teams to score no")) {
    return homeGoals === 0 || awayGoals === 0 ? "WIN" : "LOSS";
  }
  if (market.includes("btts")) {
    /* btts tanpa yes/no — inferensi dari teks */
    if (text.includes("btts yes") || text.includes("kedua tim mencetak")) {
      return homeGoals > 0 && awayGoals > 0 ? "WIN" : "LOSS";
    }
    return homeGoals > 0 && awayGoals > 0 ? "WIN" : "LOSS";
  }

  /* Asian Handicap — dengan quarter line support */
  if (market.includes("handicap") || market.includes("ah")) {
    const line = extractLine(market);
    if (line !== null) {
      const diff = homeGoals - awayGoals; // positif = home menang
      const absLine = Math.abs(line);
      const isHomeFav = line < 0; // line negatif = home adalah favorit
      const effectiveDiff = isHomeFav ? diff : -diff; // adjust dari perspektif yang di-handicap
      const margin = effectiveDiff + absLine;

      // Quarter lines: 0.25, 0.75, 1.25, 1.75, dll
      const fracPart = absLine % 1;
      const isQuarterLine = fracPart === 0.25 || fracPart === 0.75;

      if (isQuarterLine) {
        // 0.25 line: split bet → half win / half loss
        // 0.75 line: half win jika menang, half loss jika kalah
        if (margin > 0.5) {
          return "WIN";
        } else if (margin > 0 && margin <= 0.5) {
          return "HALF_WIN";
        } else if (margin === 0) {
          return "HALF_LOSS";
        } else {
          return "LOSS";
        }
      }

      // Half lines (0.5, 1.0, 1.5) → binary
      return margin > 0 ? "WIN" : "LOSS";
    }
    return homeGoals > awayGoals ? "WIN" : "LOSS";
  }

  /* Fallback: coba inferensi dari teks prediksi */
  if (text.includes("menang") && (text.includes("home") || text.includes("tuan rumah"))) {
    return homeGoals > awayGoals ? "WIN" : "LOSS";
  }
  if (text.includes("menang") && (text.includes("away") || text.includes("tamu"))) {
    return awayGoals > homeGoals ? "WIN" : "LOSS";
  }

  return null; /* market tidak dikenali */
}

/* Helper: ekstrak angka dari string market (misal "over_2_5" → 2.5) */
function extractLine(market: string): number | null {
  const m = market.match(/(\d+)[_. ]?(\d+)?/);
  if (!m) return null;
  const whole = parseInt(m[1]!);
  const frac  = m[2] ? parseInt(m[2]) / 10 : 0;
  return whole + frac;
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

/* ─────────────────────────────────────────
   Main runner — dipanggil oleh scheduler
   dan endpoint POST /api/sync/settle
───────────────────────────────────────── */
export async function runSettlement(): Promise<{ settled: number; lessons: number; skipped: number }> {
  logger.info("[SETTLEMENT] Memulai pengecekan hasil pertandingan...");

  const geminiKey = process.env["GEMINI_API_KEY"];
  const aiAvailable = Boolean(geminiKey || process.env["GROQ_API_KEY"]);

  /* 1. Ambil prediksi yang masih aktif */
  const { data: pendingPredictions, error: predErr } = await supabase
    .from("ai_predictions")
    .select("id, fixture_id, prediction_text, best_market, market_bet, home_team, away_team, expected_value, ev_at_analysis, league")
    .eq("status", "active")
    .not("prediction_text", "is", null)
    .limit(100);

  if (predErr || !pendingPredictions?.length) {
    logger.info("[SETTLEMENT] Tidak ada prediksi aktif untuk di-settle");
    return { settled: 0, lessons: 0, skipped: 0 };
  }

  const fixtureIds = pendingPredictions.map((p) => p.fixture_id);

  /* 2. Ambil fixtures yang sudah selesai BESERTA SKOR dari DB kita sendiri
        Inilah sumber kebenaran — tidak perlu panggil API eksternal */
  const { data: completedFixtures } = await supabase
    .from("fixtures")
    .select("fixture_id, home_team_name, away_team_name, league_name, status_short, home_goals, away_goals")
    .in("fixture_id", fixtureIds)
    .in("status_short", ["FT", "AET", "PEN", "finished", "completed"])
    .not("home_goals", "is", null)
    .not("away_goals", "is", null) as { data: CompletedFixture[] | null };

  if (!completedFixtures?.length) {
    logger.info("[SETTLEMENT] Tidak ada fixture selesai dengan skor tersedia di DB");
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

    const homeGoals = fixture.home_goals!;
    const awayGoals = fixture.away_goals!;

    /* 3. Lewati prediksi "NO BET" — tidak ada taruhan → tidak ada settlement */
    if (isNoBet(prediction)) {
      await supabase.from("ai_predictions").update({
        status: "no_bet",
        home_score: homeGoals,
        away_score: awayGoals,
        settled_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq("id", prediction.id);
      skipped++;
      continue;
    }

    /* 4. Hitung WIN/LOSS secara matematis murni dari skor */
    const marketBet = prediction.market_bet ?? prediction.best_market;
    const betResult = calculateResult(homeGoals, awayGoals, marketBet, prediction.prediction_text);

    if (betResult === null) {
      /* Market tidak dikenali — tandai manual */
      logger.warn({
        fixtureId: fixture.fixture_id,
        bestMarket: marketBet,
      }, "[SETTLEMENT] Market tidak dikenali — perlu review manual");

      await supabase.from("ai_predictions").update({
        status: "settled_manual",
        home_score: homeGoals,
        away_score: awayGoals,
        settled_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq("id", prediction.id);

      skipped++;
      continue;
    }

    logger.info({
      fixtureId: fixture.fixture_id,
      match: `${fixture.home_team_name} ${homeGoals}-${awayGoals} ${fixture.away_team_name}`,
      market: marketBet,
      result: betResult,
    }, "[SETTLEMENT] Hasil dihitung");

    /* 5. Update status prediksi */
    await supabase.from("ai_predictions").update({
      status: betResult,
      home_score: homeGoals,
      away_score: awayGoals,
      settled_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", prediction.id);

    await supabase
      .from("parlay_legs")
      .update({ result: betResult })
      .eq("fixture_id", fixture.fixture_id)
      .is("result", null);

    settled++;

    /* 6. Simpan ke lessons_learned untuk kedua hasil (WIN & LOSS)
          LOSS: Gemini generate evaluasi kenapa salah
          WIN : simpan catatan referensi positif tanpa Gemini */
    const evAtBet = prediction.ev_at_analysis ?? prediction.expected_value ?? 0;

    let lessonText: string | null = null;
    if (betResult === "LOSS" && aiAvailable) {
      lessonText = await generateLossLesson(prediction, homeGoals, awayGoals, geminiKey);
    } else if (betResult === "WIN") {
      lessonText = `Prediksi berhasil. Market: ${marketBet ?? "N/A"}. Skor: ${homeGoals}-${awayGoals}. EV saat analisis: ${evAtBet.toFixed(2)}.`;
    }

    const { error: lessonErr } = await supabase.from("lessons_learned").insert({
      fixture_id: String(fixture.fixture_id),
      home_team:  prediction.home_team ?? fixture.home_team_name,
      away_team:  prediction.away_team ?? fixture.away_team_name,
      league:     prediction.league ?? fixture.league_name,
      bet_result: betResult,
      home_score: homeGoals,
      away_score: awayGoals,
      ev_at_bet:  evAtBet,
      ai_prediction: prediction.prediction_text?.slice(0, 2000) ?? null,
      lesson_text: lessonText,
      market_bet:  marketBet ?? null,
      created_at:  new Date().toISOString(),
    });

    if (!lessonErr && betResult === "LOSS") {
      lessons++;
    }
  }

  await settleParlaysForFixtures(completedFixtures.map((fixture) => fixture.fixture_id));

  /* M6: AI Feedback Loop — aggregate daily performance log */
  const today = new Date().toISOString().split("T")[0];
  const { data: todaysLog } = await supabase
    .from("performance_log")
    .select("*")
    .eq("date", today)
    .limit(1)
    .maybeSingle();

  if (!todaysLog) {
    const winCount = completedFixtures.filter((f) => {
      const p = pendingPredictions.find((pp) => pp.fixture_id === f.fixture_id);
      if (!p || isNoBet(p)) return false;
      const result = calculateResult(f.home_goals!, f.away_goals!, p.market_bet ?? p.best_market, p.prediction_text);
      return result === "WIN";
    }).length;
    const lossCount = settled - winCount;
    const hitRate = settled > 0 ? winCount / settled : 0;

    await supabase.from("performance_log").insert({
      date: today,
      predictions_made: settled + skipped,
      valid_tickets: settled,
      win_count: winCount,
      loss_count: lossCount,
      hit_rate: hitRate,
      total_roi: null,
      created_at: new Date().toISOString(),
    });
  } else {
    const winCount = completedFixtures.filter((f) => {
      const p = pendingPredictions.find((pp) => pp.fixture_id === f.fixture_id);
      if (!p || isNoBet(p)) return false;
      const result = calculateResult(f.home_goals!, f.away_goals!, p.market_bet ?? p.best_market, p.prediction_text);
      return result === "WIN";
    }).length;
    const lossCount = settled - winCount;
    const totalWin = (todaysLog.win_count ?? 0) + winCount;
    const totalLoss = (todaysLog.loss_count ?? 0) + lossCount;
    const totalBets = totalWin + totalLoss;
    const hitRate = totalBets > 0 ? totalWin / totalBets : 0;

    await supabase.from("performance_log").update({
      win_count: totalWin,
      loss_count: totalLoss,
      valid_tickets: totalBets,
      hit_rate: hitRate,
      updated_at: new Date().toISOString(),
    }).eq("id", todaysLog.id);
  }

  logger.info(
    `[SETTLEMENT] Selesai: ${settled} diselesaikan (${lessons} pelajaran LOSS dibuat), ${skipped} dilewati`
  );
  return { settled, lessons, skipped };
}
