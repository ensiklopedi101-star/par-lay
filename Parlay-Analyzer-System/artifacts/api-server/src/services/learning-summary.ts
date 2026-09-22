import { supabase } from "../lib/supabase-client";
import { logger } from "../lib/logger";

export type LearningOutcome = "WIN" | "LOSS" | "HALF_WIN" | "HALF_LOSS" | "PUSH";

type LessonRow = {
  fixture_id: string | number | null;
  home_team: string | null;
  away_team: string | null;
  league: string | null;
  bet_result: string | null;
  ev_at_bet: number | string | null;
  market_bet: string | null;
  lesson_text: string | null;
  created_at: string | null;
};

type PredictionRow = {
  fixture_id: string | number | null;
  market_bet: string | null;
  best_market: string | null;
  best_odds: number | string | null;
};

type MarketAccumulator = {
  market: string;
  family: string;
  total: number;
  wins: number;
  losses: number;
  halfWins: number;
  halfLosses: number;
  pushes: number;
  hitRate: number | null;
  averageEv: number | null;
  averageOdds: number | null;
  roiPercent: number | null;
  roiSamples: number;
};

const LEARNING_OUTCOMES: LearningOutcome[] = ["WIN", "LOSS", "HALF_WIN", "HALF_LOSS", "PUSH"];

function normalizeOutcome(value: unknown): LearningOutcome | null {
  const result = String(value ?? "").trim().toUpperCase();
  return LEARNING_OUTCOMES.includes(result as LearningOutcome) ? result as LearningOutcome : null;
}

function normalizeMarket(value: unknown): string {
  const market = String(value ?? "")
    .trim()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
  if (!market) return "Unknown market";
  return market
    .split(" ")
    .map((part) => part.length <= 3 ? part.toUpperCase() : part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function marketFamily(value: string): string {
  const market = value.toLowerCase();
  if (market.includes("btts") || market.includes("both teams")) return "BTTS";
  if (market.includes("over") || market.includes("under") || market.includes("total")) return "Totals";
  if (market.includes("handicap") || market.includes("spread") || market.includes("asian") || /\bah\b/.test(market)) return "Asian Handicap";
  if (market.includes("half time") || market.includes("halftime") || /\bht\b/.test(market)) return "Half Time";
  if (market.includes("home") || market.includes("away") || market.includes("draw") || market === "1" || market === "2" || market === "x") return "Match Result";
  return "Other";
}

function numberOrNull(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function roiFor(outcome: LearningOutcome, odds: number | null): number | null {
  if (odds == null || odds <= 1) return null;
  switch (outcome) {
    case "WIN": return odds - 1;
    case "LOSS": return -1;
    case "HALF_WIN": return (odds - 2) / 2;
    case "HALF_LOSS": return -0.5;
    case "PUSH": return 0;
  }
}

function finalizeMarket(accumulator: MarketAccumulator & { evTotal: number; evSamples: number; roiTotal: number }) {
  const decisive = accumulator.wins + accumulator.losses + accumulator.halfWins + accumulator.halfLosses;
  return {
    market: accumulator.market,
    family: accumulator.family,
    sampleSize: accumulator.total,
    wins: accumulator.wins,
    losses: accumulator.losses,
    halfWins: accumulator.halfWins,
    halfLosses: accumulator.halfLosses,
    pushes: accumulator.pushes,
    hitRate: decisive > 0 ? (accumulator.wins + accumulator.halfWins) / decisive : null,
    averageEv: accumulator.evSamples > 0 ? accumulator.evTotal / accumulator.evSamples : null,
    averageOdds: accumulator.roiSamples > 0
      ? (accumulator.roiTotal + accumulator.roiSamples) / accumulator.roiSamples
      : null,
    roiPercent: accumulator.roiSamples > 0 ? accumulator.roiTotal / accumulator.roiSamples : null,
    roiSamples: accumulator.roiSamples,
  };
}

export async function getLearningSummary() {
  const [{ data: lessons, error: lessonsError }, { data: predictions, error: predictionsError }] = await Promise.all([
    supabase
      .from("lessons_learned")
      .select("fixture_id, home_team, away_team, league, bet_result, ev_at_bet, market_bet, lesson_text, created_at")
      .order("created_at", { ascending: false })
      .limit(5000),
    supabase
      .from("ai_predictions")
      .select("fixture_id, market_bet, best_market, best_odds")
      .in("status", ["WIN", "LOSS", "HALF_WIN", "HALF_LOSS", "PUSH", "win", "loss", "half_win", "half_loss", "push"])
      .limit(5000),
  ]);
  if (lessonsError) throw lessonsError;
  if (predictionsError) throw predictionsError;

  const predictionByFixture = new Map<string, PredictionRow>();
  for (const prediction of (predictions ?? []) as PredictionRow[]) {
    const fixtureId = String(prediction.fixture_id ?? "");
    if (fixtureId && !predictionByFixture.has(fixtureId)) predictionByFixture.set(fixtureId, prediction);
  }

  const outcomes = { wins: 0, losses: 0, halfWins: 0, halfLosses: 0, pushes: 0 };
  let noBetExcluded = 0;
  let unknownOutcomes = 0;
  let totalEv = 0;
  let evSamples = 0;
  let totalRoi = 0;
  let roiSamples = 0;
  const marketMap = new Map<string, MarketAccumulator & { evTotal: number; evSamples: number; roiTotal: number }>();

  const recentLessons = ((lessons ?? []) as LessonRow[])
    .map((lesson) => {
      const outcome = normalizeOutcome(lesson.bet_result);
      const market = normalizeMarket(lesson.market_bet);
      const prediction = predictionByFixture.get(String(lesson.fixture_id ?? ""));
      const odds = numberOrNull(prediction?.best_odds);
      const ev = numberOrNull(lesson.ev_at_bet);
      if (!outcome) {
        if (String(lesson.bet_result ?? "").toUpperCase() === "NO_BET") noBetExcluded++;
        else unknownOutcomes++;
        return null;
      }

      outcomes.wins += outcome === "WIN" ? 1 : 0;
      outcomes.losses += outcome === "LOSS" ? 1 : 0;
      outcomes.halfWins += outcome === "HALF_WIN" ? 1 : 0;
      outcomes.halfLosses += outcome === "HALF_LOSS" ? 1 : 0;
      outcomes.pushes += outcome === "PUSH" ? 1 : 0;
      if (ev != null) {
        totalEv += ev;
        evSamples++;
      }
      const roi = roiFor(outcome, odds);
      if (roi != null) {
        totalRoi += roi;
        roiSamples++;
      }

      const current = marketMap.get(market) ?? {
        market,
        family: marketFamily(market),
        total: 0,
        wins: 0,
        losses: 0,
        halfWins: 0,
        halfLosses: 0,
        pushes: 0,
        hitRate: null,
        averageEv: null,
        averageOdds: null,
        roiPercent: null,
        roiSamples: 0,
        evTotal: 0,
        evSamples: 0,
        roiTotal: 0,
      };
      current.total++;
      current.wins += outcome === "WIN" ? 1 : 0;
      current.losses += outcome === "LOSS" ? 1 : 0;
      current.halfWins += outcome === "HALF_WIN" ? 1 : 0;
      current.halfLosses += outcome === "HALF_LOSS" ? 1 : 0;
      current.pushes += outcome === "PUSH" ? 1 : 0;
      if (ev != null) {
        current.evTotal += ev;
        current.evSamples++;
      }
      if (roi != null) {
        current.roiTotal += roi;
        current.roiSamples++;
      }
      marketMap.set(market, current);

      return {
        fixtureId: Number(lesson.fixture_id),
        homeTeam: lesson.home_team ?? "Unknown",
        awayTeam: lesson.away_team ?? "Unknown",
        league: lesson.league ?? "",
        market,
        outcome,
        odds,
        ev,
        lessonText: lesson.lesson_text ?? "Tidak ada catatan evaluasi.",
        createdAt: lesson.created_at,
      };
    })
    .filter((lesson): lesson is NonNullable<typeof lesson> => lesson !== null);

  const marketBreakdown = Array.from(marketMap.values())
    .map(finalizeMarket)
    .sort((a, b) => {
      const aScore = a.roiPercent ?? a.hitRate ?? -1;
      const bScore = b.roiPercent ?? b.hitRate ?? -1;
      return bScore - aScore || b.sampleSize - a.sampleSize;
    });
  const decisive = outcomes.wins + outcomes.losses + outcomes.halfWins + outcomes.halfLosses;
  const settled = decisive + outcomes.pushes;
  const rankedMarkets = marketBreakdown.filter((market) => market.sampleSize >= 3 && market.hitRate != null);
  const recommendedMarket = rankedMarkets[0] ?? null;

  return {
    generatedAt: new Date().toISOString(),
    dataQuality: {
      status: settled >= 10 ? "usable" : settled >= 3 ? "early_signal" : "insufficient",
      sampleSize: settled,
      minimumRecommendedSample: 10,
      explanation: settled >= 10
        ? "Sampel mulai cukup untuk membandingkan market, tetapi tetap bukan jaminan hasil masa depan."
        : "Sampel masih kecil. Ranking market bersifat sinyal awal dan belum boleh dianggap keunggulan yang stabil.",
    },
    totals: {
      settled,
      decisive,
      wins: outcomes.wins,
      losses: outcomes.losses,
      halfWins: outcomes.halfWins,
      halfLosses: outcomes.halfLosses,
      pushes: outcomes.pushes,
      noBetExcluded,
      unknownOutcomes,
      hitRate: decisive > 0 ? (outcomes.wins + outcomes.halfWins) / decisive : null,
      averageEv: evSamples > 0 ? totalEv / evSamples : null,
      roiPercent: roiSamples > 0 ? totalRoi / roiSamples : null,
      roiSamples,
    },
    recommendedMarket: recommendedMarket
      ? {
          ...recommendedMarket,
          reason: `Dipilih dari ${recommendedMarket.sampleSize} sampel; market ini memiliki hit rate ${((recommendedMarket.hitRate ?? 0) * 100).toFixed(1)}%${recommendedMarket.roiPercent != null ? ` dan ROI estimasi ${(recommendedMarket.roiPercent * 100).toFixed(1)}%` : ""}.`,
        }
      : null,
    marketBreakdown,
    recentLessons: recentLessons.slice(0, 20),
    learningRules: [
      "NO BET tidak dihitung sebagai taruhan dan tidak memengaruhi hit rate.",
      "WIN dan HALF_WIN dihitung sebagai hasil berhasil; LOSS dan HALF_LOSS sebagai hasil gagal.",
      "PUSH ditampilkan terpisah dan tidak menaikkan atau menurunkan hit rate.",
      "Market dengan kurang dari 3 sampel tidak dipromosikan sebagai rekomendasi.",
      "ROI estimasi hanya dihitung untuk hasil yang memiliki odds settled yang valid.",
    ],
  };
}

export function learningHealthFromSummary(summary: Awaited<ReturnType<typeof getLearningSummary>>) {
  return {
    status: summary.totals.settled > 0 ? "active" : "no_data",
    hitRate: summary.totals.hitRate,
    wins: summary.totals.wins,
    losses: summary.totals.losses,
    halfWins: summary.totals.halfWins,
    halfLosses: summary.totals.halfLosses,
    pushes: summary.totals.pushes,
    settled: summary.totals.settled,
    sampleSize: summary.dataQuality.sampleSize,
    recommendedMarket: summary.recommendedMarket?.market ?? null,
  };
}