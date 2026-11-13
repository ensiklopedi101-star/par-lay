/**
 * Laporan ledger & kalibrasi (P3 — playbook §8).
 *
 * Membaca `prediction_selections` (jalur LLM v1 + bayangan engine v2) dan
 * mengubahnya menjadi dua pandangan yang berbeda:
 *
 *  1. **`all` — SEMUA baris.** Hanya skor probabilistik (Brier/BSS/log-loss),
 *     bin kalibrasi + ECE, dan CLV. **ROI/vonis sengaja TIDAK diekspos dari
 *     himpunan ini**: `summarizeLedger` menghitung ROI dengan asumsi "taruh
 *     semua baris 1 unit" — hampir semua baris ledger adalah pasar yang tidak
 *     dipilih, dan overround membuat ROI hampir pasti negatif → vonis
 *     `refuted` palsu.
 *
 *  2. **`bets` — baris `was_bet` saja.** ROI, hit rate, dan vonis hanya untuk
 *     seleksi yang lolos gerbang (benar-benar akan di-stake). Ini himpunan
 *     yang jujur untuk menilai keputusan.
 *
 * Empat head-count (total, ada outcome, ada odds_close, was_bet) memakai
 * `head: true` supaya tetap murah saat ledger membesar. Baris ditarik
 * berhalaman (1000/halaman, maksimum 20.000) — diurutkan `id` agar paginasi
 * stabil (timestamp bisa kembar antar baris satu analisis).
 *
 * Semua kegagalan ditelan menjadi `notes` yang jujur: laporan ini konsumen
 * transparansi, bukan tempat melempar error.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase as defaultSupabase } from "../lib/supabase-client";
import { logger } from "../lib/logger";
import {
  summarizeLedger,
  type BetOutcome,
  type CalibrationBin,
  type LedgerBet,
  type LedgerSummary,
} from "../lib/quant/evaluation";

/** Baris per halaman; PostgREST default limit memang 1000. */
const PAGE_SIZE = 1000;
/** Batas total baris yang dianalisis — di atas ini laporan menyebut truncation. */
const MAX_ROWS = 20000;

const VALID_OUTCOMES = new Set<BetOutcome>([
  "win",
  "half_win",
  "push",
  "half_loss",
  "loss",
  "void",
]);

export interface LedgerReportCounts {
  total: number;
  withOutcome: number;
  withClosingOdds: number;
  wasBet: number;
}

/** Pandangan "semua baris": kalibrasi + CLV saja, tanpa ROI/vonis. */
export interface LedgerAllBlock {
  scores: LedgerSummary["scores"];
  calibration: CalibrationBin[];
  clv: LedgerSummary["clv"];
  /** 1 − brierModel/brierMarket; > 0 berarti model mengalahkan pasar pada Brier. */
  brierSkill: number | null;
  /** ECE dari bin yang ditampilkan: Σ (nᵢ/N)·|meanPᵢ − observedᵢ|. */
  ece: number | null;
}

/** Pandangan "baris was_bet": ROI + vonis dari himpunan yang jujur. */
export interface LedgerBetsBlock {
  n: number;
  nSettled: number;
  profit: number;
  staked: number;
  roi: number | null;
  roiCI: LedgerSummary["roiCI"];
  hitRate: number | null;
  avgOdds: number | null;
  avgClaimedEv: number | null;
  betsNeeded: number | null;
  verdict: LedgerSummary["verdict"];
}

export interface LedgerReport {
  counts: LedgerReportCounts;
  /** null bila ledger tidak punya baris sama sekali. */
  all: LedgerAllBlock | null;
  /** null bila tidak ada baris `was_bet`. */
  bets: LedgerBetsBlock | null;
  notes: string[];
  generatedAt: string;
}

interface LedgerRow {
  p_final: number | null;
  p_market_fair: number | null;
  p_model_only: number | null;
  odds: number;
  odds_close: number | null;
  close_fair_prob: number | null;
  outcome: string | null;
  was_bet: boolean;
}

/**
 * Head-count tanpa menarik barisnya — pola `settlement-summary.ts`
 * (`head: true` + `count: "exact"`).
 */
async function countWhere(
  client: SupabaseClient,
  table: string,
  apply?: (query: any) => any,
): Promise<number> {
  let query = client.from(table).select("*", { count: "exact", head: true });
  if (apply) query = apply(query);
  const { count, error } = await query;
  if (error) {
    logger.debug({ error, table }, "Ledger count gagal");
    return 0;
  }
  return count ?? 0;
}

function rowToBet(row: LedgerRow, invalidOutcomes: { count: number }): LedgerBet {
  let outcome: BetOutcome | null = null;
  if (row.outcome != null) {
    if (VALID_OUTCOMES.has(row.outcome as BetOutcome)) {
      outcome = row.outcome as BetOutcome;
    } else {
      invalidOutcomes.count += 1;
    }
  }
  return {
    pModel: row.p_model_only,
    pMarketFair: row.p_market_fair,
    pFinal: row.p_final,
    oddsTaken: row.odds,
    oddsClose: row.odds_close,
    closeFairProb: row.close_fair_prob,
    outcome,
    stakeUnits: 1,
  };
}

/** ECE dari bin yang ditampilkan — Σ (nᵢ/N)·|meanPᵢ − observedᵢ|. */
function eceFromBins(bins: CalibrationBin[]): number | null {
  const n = bins.reduce((sum, b) => sum + b.n, 0);
  if (n === 0) return null;
  return bins.reduce((sum, b) => sum + (b.n / n) * Math.abs(b.meanPredicted - b.observed), 0);
}

function brierSkillOf(scores: LedgerSummary["scores"]): number | null {
  if (!scores || scores.brierMarket == null || !(scores.brierMarket > 0)) return null;
  const skill = 1 - scores.brierModel / scores.brierMarket;
  return Number.isFinite(skill) ? skill : null;
}

export async function buildLedgerReport(
  options: { supabase?: SupabaseClient | null } = {},
): Promise<LedgerReport> {
  /* `!== undefined` (bukan `??`): passing null eksplisit memaksa jalur
   * degrade di tes tanpa bergantung pada env SUPABASE_URL. */
  const client = options.supabase !== undefined ? options.supabase : defaultSupabase;
  const notes: string[] = [];

  const empty: LedgerReport = {
    counts: { total: 0, withOutcome: 0, withClosingOdds: 0, wasBet: 0 },
    all: null,
    bets: null,
    notes: ["Supabase tidak tersedia — laporan ledger tidak bisa dihitung."],
    generatedAt: new Date().toISOString(),
  };
  if (!client) return empty;

  /* ─── Head-count: murah, tetap akurat walau baris dianalisis terpotong ─── */
  const counts: LedgerReportCounts = {
    total: await countWhere(client, "prediction_selections"),
    withOutcome: await countWhere(client, "prediction_selections", (q) =>
      q.not("outcome", "is", null),
    ),
    withClosingOdds: await countWhere(client, "prediction_selections", (q) =>
      q.not("odds_close", "is", null),
    ),
    wasBet: await countWhere(client, "prediction_selections", (q) =>
      q.eq("was_bet", true),
    ),
  };

  if (counts.total === 0) {
    notes.push(
      "Ledger masih kosong (0 baris prediction_selections): tidak ada analisis yang " +
        "menulis ke ledger — prediksi kemungkinan tidak berjalan. Ini bukan penilaian " +
        "kualitas model; bahannya belum ada.",
    );
    return { counts, all: null, bets: null, notes, generatedAt: new Date().toISOString() };
  }

  /* ─── Tarik baris berhalaman (urut id → paginasi stabil) ─── */
  const rows: LedgerRow[] = [];
  let fetchError: string | null = null;
  for (let from = 0; from < MAX_ROWS; from += PAGE_SIZE) {
    const { data, error } = await client
      .from("prediction_selections")
      .select("p_final, p_market_fair, p_model_only, odds, odds_close, close_fair_prob, outcome, was_bet")
      .order("id", { ascending: true })
      .range(from, Math.min(from + PAGE_SIZE - 1, MAX_ROWS - 1));
    if (error) {
      fetchError = error.message;
      break;
    }
    const page = (data ?? []) as LedgerRow[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }

  if (fetchError) {
    notes.push(`Gagal membaca baris ledger: ${fetchError}`);
    if (rows.length === 0) {
      return { counts, all: null, bets: null, notes, generatedAt: new Date().toISOString() };
    }
  }
  if (rows.length < counts.total) {
    notes.push(
      `Menganalisis ${rows.length.toLocaleString("id-ID")} dari ` +
        `${counts.total.toLocaleString("id-ID")} baris (batas ${MAX_ROWS.toLocaleString("id-ID")}).`,
    );
  }

  const invalidOutcomes = { count: 0 };
  const mapped = rows.map((row) => ({
    bet: rowToBet(row, invalidOutcomes),
    wasBet: row.was_bet === true,
  }));
  const allBets = mapped.map((m) => m.bet);
  if (invalidOutcomes.count > 0) {
    notes.push(
      `${invalidOutcomes.count} baris dengan outcome tidak dikenal diperlakukan sebagai belum selesai.`,
    );
  }

  if (counts.withOutcome === 0) {
    notes.push(
      "Belum ada outcome terisi — settlement skor belum berjalan; Brier/ECE dari ledger " +
        "belum bisa dihitung.",
    );
  }
  if (counts.withClosingOdds === 0) {
    notes.push(
      "Belum ada odds_close — CLV (metrik tercepat & paling andal) belum bisa dihitung.",
    );
  }

  /* ─── (a) SEMUA baris: kalibrasi + CLV saja ─── */
  const allSummary = summarizeLedger(allBets);
  const all: LedgerAllBlock = {
    scores: allSummary.scores,
    calibration: allSummary.calibration,
    clv: allSummary.clv,
    brierSkill: brierSkillOf(allSummary.scores),
    ece: eceFromBins(allSummary.calibration),
  };

  /* ─── (b) baris was_bet saja: ROI + vonis yang jujur ─── */
  const betBets = mapped.filter((m) => m.wasBet).map((m) => m.bet);
  let bets: LedgerBetsBlock | null = null;
  if (betBets.length > 0) {
    const s = summarizeLedger(betBets);
    bets = {
      n: s.nTotal,
      nSettled: s.nSettled,
      profit: s.profit,
      staked: s.staked,
      roi: s.roi,
      roiCI: s.roiCI,
      hitRate: s.hitRate,
      avgOdds: s.avgOdds,
      avgClaimedEv: s.avgClaimedEv,
      betsNeeded: s.betsNeeded,
      verdict: s.verdict,
    };
  } else {
    notes.push(
      "Tidak ada baris was_bet — belum ada seleksi yang lolos gerbang; ROI dan vonis " +
        "taruhan tidak bisa dihitung.",
    );
  }

  return {
    counts,
    all,
    bets,
    notes,
    generatedAt: new Date().toISOString(),
  };
}
