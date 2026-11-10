/**
 * Menilai hasil akhir sebuah `market_key` dari skor pertandingan.
 *
 * Ini lubang yang tidak terlihat sampai diperiksa: sebelum modul ini ada,
 * `prediction_selections.outcome` tidak pernah diisi oleh apa pun. Settlement
 * hanya menulis ke `ai_predictions`, sehingga baris ledger tetap kosong
 * selamanya — dan Fase 3 ("≥ 300 selection ber-hasil") mustahil dicapai
 * berapa lama pun ditunggu.
 *
 * Modul ini murni: tidak menyentuh database, tidak butuh Supabase, sehingga
 * bisa diuji penuh tanpa fixture nyata.
 */

import { settleAgainstLine, type SettlementOutcome } from "./bet-settlement";
import { parseMarketKey } from "./closing-odds";
import type { BetOutcome } from "./quant/evaluation";

export interface FinalScore {
  home: number;
  away: number;
  /** Skor babak pertama, hanya dipakai bila `halfTime` diminta. */
  homeHT?: number | null;
  awayHT?: number | null;
}

/**
 * `SettlementOutcome` (WIN/LOSS/PUSH) → `BetOutcome` (huruf kecil, termasuk
 * varian setengah). Nama di `prediction_selections.outcome` mengikuti
 * `evaluation.ts`, bukan `bet-settlement.ts`, karena pembaca kolom itu adalah
 * `summarizeLedger()`.
 */
const OUTCOME_MAP: Record<SettlementOutcome, BetOutcome> = {
  WIN: "win",
  LOSS: "loss",
  HALF_WIN: "half_win",
  HALF_LOSS: "half_loss",
  PUSH: "push",
};

/**
 * Tentukan hasil satu market dari skor akhir.
 *
 * Mengembalikan `null` — bukan menebak — bila:
 *  - `market_key` tidak dikenal
 *  - skor tidak lengkap
 *  - market mensyaratkan data yang tidak ada (mis. 2H tanpa skor HT)
 */
export function outcomeOfMarket(
  marketKey: string,
  score: FinalScore,
): BetOutcome | null {
  const parsed = parseMarketKey(marketKey);
  if (!parsed) return null;

  const { home, away } = score;
  if (!Number.isFinite(home) || !Number.isFinite(away)) return null;

  const total = home + away;

  if (parsed.family === "ML") {
    const result = home > away ? "home" : home < away ? "away" : "draw";
    if (parsed.side === result) return "win";
    /* 1X2 tidak punya push: seri tetap kalah untuk home/away. */
    return "loss";
  }

  if (parsed.family === "BTTS") {
    const bothScored = home > 0 && away > 0;
    const wantYes = parsed.side === "yes";
    return bothScored === wantYes ? "win" : "loss";
  }

  if (parsed.family === "Totals") {
    if (parsed.line == null) return null;
    /* `settleAgainstLine` menerima margin relatif terhadap garis, dan sudah
       menangani garis seperempat (2.25 / 2.75) dengan benar. */
    const margin = parsed.side === "over" ? total - parsed.line : parsed.line - total;
    return OUTCOME_MAP[settleAgainstLine(margin, parsed.line)];
  }

  if (parsed.family === "AH") {
    if (parsed.line == null) return null;
    /*
     * `market_key` AH memakai konvensi garis kandang: `AH:home:-0.25` dan
     * `AH:away:0.25` adalah sisi berlawanan dari garis yang sama.
     * Margin untuk sisi tandang = (away - home) + garis tandang, dan garis
     * tandang adalah kebalikan garis kandang.
     */
    const homeLine = parsed.side === "home" ? parsed.line : -parsed.line;
    const diff = home - away;
    const margin = parsed.side === "home" ? diff + homeLine : -diff - homeLine;
    return OUTCOME_MAP[settleAgainstLine(margin, homeLine)];
  }

  return null;
}

/**
 * Nilai semua baris yang bisa dinilai. Mengembalikan peta
 * `market_key → outcome`; kunci yang tidak bisa dinilai tidak dimasukkan,
 * sehingga pemanggil tidak pernah menulis tebakan ke database.
 */
export function outcomeMapForFixture(
  marketKeys: string[],
  score: FinalScore,
): Map<string, BetOutcome> {
  const out = new Map<string, BetOutcome>();
  for (const key of marketKeys) {
    const value = outcomeOfMarket(key, score);
    if (value) out.set(key, value);
  }
  return out;
}
