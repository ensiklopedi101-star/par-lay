/**
 * P3 / Fase 3 — laporan bukti dari ledger `prediction_selections`.
 *
 * Tugas laporan ini sempit dan jujur: menjawab, dari baris yang ditulis
 * SEBELUM pertandingan dimainkan dan dinilai SETELAH hasil diketahui,
 *   1. sudah berapa banyak seleksi ber-hasil (target gerbang: ≥ 300),
 *   2. apakah CLV positif dan signifikan (t ≥ 2, n ≥ 30),
 *   3. apakah probabilitas kita terkalibrasi dan mengalahkan pasar
 *      (Brier, BSS vs pasar, ECE, skill log-loss),
 *   4. berapa bobot model optimal `w*` menurut `fitBlendWeight`
 *      (w* ≈ 0 berarti model tidak menambah apa pun di atas pasar),
 *   5. market/liga-versi mana yang punya skill dan mana yang harus dimatikan.
 *
 * Semua matematika statistik memakai ulang `quant/evaluation.ts`
 * (`summarizeLedger`, `fitBlendWeight`) — modul ini hanya memetakan baris DB
 * ke bentuk itu, mengagregasi per versi/per family, dan menilai gerbang.
 * Tidak ada rumus kedua yang bisa berbeda diam-diam dari yang pertama.
 *
 * Di bawah ambang sampel, vonis WAJIB "insufficient" — bukan "buruk".
 * Mengklaim model jelek dari 12 sampel sama salahnya dengan mengklaim bagus.
 */

import { fitBlendWeight, type BlendSample } from "./quant/blend";
import {
  binaryOutcome,
  summarizeLedger,
  type BetOutcome,
  type LedgerBet,
  type LedgerSummary,
} from "./quant/evaluation";

/** Satu baris `prediction_selections` sebagaimana dibaca dari Supabase. */
export interface SelectionLedgerRow {
  fixture_id: string;
  analysed_at?: string | null;
  model_version: number;
  market_key: string;
  family: string;
  line?: number | null;
  odds: number;
  p_final: number | null;
  p_market_fair: number | null;
  p_model_only: number | null;
  ev?: number | null;
  odds_close?: number | null;
  close_fair_prob?: number | null;
  outcome?: string | null;
  was_bet?: boolean | null;
  bookmaker?: string | null;
}

const VALID_OUTCOMES: ReadonlySet<string> = new Set([
  "win", "half_win", "push", "half_loss", "loss", "void",
]);

export function toLedgerBet(row: SelectionLedgerRow): LedgerBet {
  const outcome = row.outcome != null && VALID_OUTCOMES.has(row.outcome)
    ? (row.outcome as BetOutcome)
    : null;
  return {
    pModel: row.p_model_only,
    pMarketFair: row.p_market_fair,
    pFinal: row.p_final,
    oddsTaken: row.odds,
    oddsClose: row.odds_close ?? null,
    closeFairProb: row.close_fair_prob ?? null,
    outcome,
    stakeUnits: 1,
  };
}

/** ECE dari bin kalibrasi ringkasan: rata-rata tertimbang |prediksi − observasi|. */
export function eceFromCalibration(summary: LedgerSummary): number | null {
  const bins = summary.calibration;
  const n = bins.reduce((s, b) => s + b.n, 0);
  if (n === 0) return null;
  return bins.reduce((s, b) => s + (b.n / n) * Math.abs(b.meanPredicted - b.observed), 0);
}

/** Brier Skill Score vs pasar: > 0 berarti p_final lebih akurat dari harga fair pasar. */
export function bssVsMarket(summary: LedgerSummary): number | null {
  const s = summary.scores;
  if (!s || s.brierMarket == null || s.brierMarket <= 0) return null;
  return 1 - s.brierModel / s.brierMarket;
}

export interface LedgerSlice {
  key: string;
  summary: LedgerSummary;
  ece: number | null;
  bssVsMarket: number | null;
  blendFit: ReturnType<typeof fitBlendWeight>;
}

export interface Phase3Gate {
  id: string;
  label: string;
  passed: boolean;
  detail: string;
}

export interface LedgerReport {
  generatedFrom: { totalRows: number; settledRows: number; withCloseRows: number };
  /** Kemajuan menuju syarat Fase 3 (≥ 300 seleksi ber-hasil). */
  progress: { settled: number; target: number; pct: number };
  overall: LedgerSlice;
  byModelVersion: LedgerSlice[];
  byFamily: LedgerSlice[];
  gates: Phase3Gate[];
  verdict: LedgerSummary["verdict"];
}

export const PHASE3_TARGET_SETTLED = 300;

function slice(key: string, rows: SelectionLedgerRow[]): LedgerSlice {
  const bets = rows.map(toLedgerBet);
  const summary = summarizeLedger(bets);
  const blendSamples: BlendSample[] = [];
  for (const b of bets) {
    const y = binaryOutcome(b.outcome);
    if (y != null && b.pModel != null && b.pMarketFair != null) {
      blendSamples.push({ pModel: b.pModel, pMarket: b.pMarketFair, outcome: y });
    }
  }
  return {
    key,
    summary,
    ece: eceFromCalibration(summary),
    bssVsMarket: bssVsMarket(summary),
    blendFit: fitBlendWeight(blendSamples),
  };
}

function group(rows: SelectionLedgerRow[], keyOf: (r: SelectionLedgerRow) => string): LedgerSlice[] {
  const map = new Map<string, SelectionLedgerRow[]>();
  for (const r of rows) {
    const k = keyOf(r);
    const arr = map.get(k) ?? [];
    arr.push(r);
    map.set(k, arr);
  }
  return [...map.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .map(([k, rs]) => slice(k, rs));
}

export function buildLedgerReport(rows: SelectionLedgerRow[]): LedgerReport {
  const overall = slice("all", rows);
  const settled = rows.filter((r) => r.outcome != null && VALID_OUTCOMES.has(r.outcome)).length;
  const withClose = rows.filter((r) => r.odds_close != null || r.close_fair_prob != null).length;

  const clv = overall.summary.clv;
  const skill = overall.summary.scores?.skillVsMarket ?? null;
  const wStar = overall.blendFit?.weight ?? null;

  const gates: Phase3Gate[] = [
    {
      id: "settled_300",
      label: `≥ ${PHASE3_TARGET_SETTLED} selection ber-hasil pada ledger`,
      passed: settled >= PHASE3_TARGET_SETTLED,
      detail: `${settled}/${PHASE3_TARGET_SETTLED} seleksi ber-hasil.`,
    },
    {
      id: "clv_significant",
      label: "CLV rata-rata > 0 dengan t-stat ≥ 2 (n ≥ 30)",
      passed: clv != null && clv.n >= 30 && clv.mean > 0 && clv.tStat >= 2,
      detail: clv == null
        ? "CLV belum bisa dihitung (belum ada odds_close/close_fair_prob)."
        : `CLV ${(clv.mean * 100).toFixed(2)}%, t=${clv.tStat.toFixed(2)}, n=${clv.n}.`,
    },
    {
      id: "skill_vs_market",
      label: "Skill log-loss vs pasar > 0 pada himpunan yang sama",
      passed: skill != null && skill > 0,
      detail: skill == null
        ? "Belum cukup seleksi decisive dengan p_market_fair (butuh ≥ 5)."
        : `Skill ${(skill * 100).toFixed(2)}%.`,
    },
    {
      id: "blend_weight",
      label: "fitBlendWeight: w* > 0 (model menambah informasi di atas pasar)",
      passed: wStar != null && wStar > 0,
      detail: overall.blendFit == null
        ? "fitBlendWeight butuh ≥ 30 sampel decisive dengan p_model & p_market."
        : `w* = ${overall.blendFit.weight.toFixed(2)} dari n=${overall.blendFit.n} (w*=0 → pasar murni).`,
    },
    {
      id: "calibration",
      label: "ECE kalibrasi ≤ 0.05",
      passed: overall.ece != null && overall.ece <= 0.05,
      detail: overall.ece == null
        ? "Belum ada bin kalibrasi (butuh ≥ 5 seleksi decisive)."
        : `ECE ${(overall.ece * 100).toFixed(2)} poin.`,
    },
  ];

  return {
    generatedFrom: { totalRows: rows.length, settledRows: settled, withCloseRows: withClose },
    progress: {
      settled,
      target: PHASE3_TARGET_SETTLED,
      pct: Math.min(100, Math.round((settled / PHASE3_TARGET_SETTLED) * 1000) / 10),
    },
    overall,
    byModelVersion: group(rows, (r) => `v${r.model_version}`),
    byFamily: group(rows, (r) => r.family),
    gates,
    verdict: overall.summary.verdict,
  };
}
