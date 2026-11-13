/**
 * P3 (jalur LLM) — menulis SEMUA market yang dihargai ke `prediction_selections`
 * dengan `model_version = 1`.
 *
 * Kenapa ini belum ada sampai sekarang: jalur quant (v2, `quant-shadow.ts`)
 * sudah menulis ledger, tetapi jalur LLM hanya menyimpan SATU seleksi terpilih
 * ke `ai_predictions`. Akibatnya pertanyaan inti Fase 3 — "apakah probabilitas
 * jalur LLM (matriks skor + blend 0.35) lebih baik daripada pasar / daripada
 * quant v2?" — tidak bisa dijawab: tidak ada baris v1 yang bisa diberi
 * `outcome` dan `odds_close` oleh job Fase 2 yang sudah ada.
 *
 * Modul ini MURNI: ia hanya membangun baris. Penulisan DB ada di
 * `services/llm-shadow.ts` (pola yang sama seperti `quant-shadow.ts`).
 *
 * Kontrak yang dijaga:
 *  - `market_key` IDENTIK dengan yang ditulis engine quant
 *    (`ML:home`, `TOT:over:2.5`, `AH:away:0.25`, `BTTS:yes`), supaya
 *    `closing-odds-capture` dan `selection-outcome` yang sudah ada bisa
 *    mengisi `odds_close`/`outcome` baris v1 tanpa perubahan apa pun.
 *  - Satu bookmaker untuk seluruh fixture (baris pertama tiap pasar, sama
 *    seperti `fairProbabilityForLabel` lama). Mencampur harga terbaik antar
 *    bandar menciptakan pasar sintetis yang tidak ada di mana pun.
 *  - Probabilitas model SELALU dari matriks skor yang sama lewat
 *    `modelProbabilityForSelection` — bukan angka LLM. Bila matriks tidak bisa
 *    memberi probabilitas (HT, label tak dikenal), baris TIDAK ditulis,
 *    bukan ditulis dengan p=0.
 *  - `p_market_fair` = de-vig kasus terburuk (`worstCaseFairProbability`),
 *    konsisten dengan yang disimpan ke `ai_predictions.p_market_fair`.
 */

import {
  blendProbability,
  conservativeEv,
  expectedValue,
  worstCaseFairProbability,
} from "./betting-math";
import {
  modelProbabilityForSelection,
  type MarketProbabilities,
} from "./match-context";
import type { ScoreMatrix } from "./quant/poisson";

/** Bentuk odds terstruktur yang sama dengan yang dipakai `ai-analysis.ts`. */
export interface LedgerOddsRow {
  bookmaker: string;
  home?: number;
  draw?: number;
  away?: number;
  over?: number;
  under?: number;
  line?: number;
  yes?: number;
  no?: number;
}

export interface LlmLedgerOdds {
  matchWinner: LedgerOddsRow[];
  overUnder: LedgerOddsRow[];
  asianHandicap: LedgerOddsRow[];
  btts: LedgerOddsRow[];
}

export const LLM_MODEL_VERSION = 1;
/** Sama dengan blend di `ai-analysis.ts` — jangan diubah di satu tempat saja. */
export const LLM_MODEL_WEIGHT = 0.35;
export const LLM_SIGMA = 0.05;

export interface LlmSelectionRow {
  fixture_id: string;
  analysed_at: string;
  model_version: number;
  market_key: string;
  family: "ML" | "Totals" | "AH" | "BTTS";
  line: number | null;
  odds: number;
  p_final: number;
  p_market_fair: number | null;
  p_model_only: number | null;
  ev: number | null;
  ev_conservative: number | null;
  was_bet: boolean;
  bookmaker: string | null;
}

const validOdds = (x: unknown): x is number =>
  typeof x === "number" && Number.isFinite(x) && x > 1;

const fmtLine = (n: number): string => String(n);

/**
 * Petakan label market kanonik (mis. "Over 2.5", "Asian Handicap Home -0.5")
 * ke `market_key` ledger. Mengembalikan null bila label tidak dikenal —
 * pemanggil harus melewatinya, bukan menebak.
 */
export function marketKeyForLabel(
  label: string | null | undefined,
  lineHint?: number | null,
): string | null {
  const text = String(label ?? "").trim();
  if (!text) return null;
  const lower = text.toLowerCase();

  if (lower === "home win") return "ML:home";
  if (lower === "draw") return "ML:draw";
  if (lower === "away win") return "ML:away";
  if (lower === "btts yes") return "BTTS:yes";
  if (lower === "btts no") return "BTTS:no";

  const totals = lower.match(/^(over|under)\s+(\d+(?:\.\d+)?)/);
  if (totals) return `TOT:${totals[1]}:${fmtLine(Number(totals[2]))}`;

  const handicap = lower.match(/^asian handicap\s+(home|away)\s+([+-]?\d+(?:\.\d+)?)/);
  if (handicap) return `AH:${handicap[1]}:${fmtLine(Number(handicap[2]))}`;

  /* Label tanpa garis eksplisit tetapi pemanggil tahu garis yang cocok. */
  if (lineHint != null && Number.isFinite(lineHint)) {
    if (lower === "over") return `TOT:over:${fmtLine(lineHint)}`;
    if (lower === "under") return `TOT:under:${fmtLine(lineHint)}`;
  }
  return null;
}

export interface BuildLlmRowsInput {
  fixtureId: number | string;
  analysedAt: string;
  matrix: ScoreMatrix;
  markets: MarketProbabilities;
  odds: LlmLedgerOdds;
  /** label seleksi yang benar-benar dipilih LLM (untuk `was_bet`). */
  betLabel?: string | null;
  /** garis seleksi terpilih bila labelnya tidak memuat garis. */
  betLine?: number | null;
}

interface Candidate {
  key: string;
  family: LlmSelectionRow["family"];
  line: number | null;
  odds: number;
  label: string;
  /** odds satu pasar penuh untuk de-vig + indeks sisi ini. */
  marketOdds: Array<number | null | undefined>;
  index: number;
  bookmaker: string | null;
}

function candidates(odds: LlmLedgerOdds): Candidate[] {
  const out: Candidate[] = [];

  const mw = odds.matchWinner.find((r) => validOdds(r.home) && validOdds(r.draw) && validOdds(r.away));
  /*
   * Satu bookmaker untuk seluruh fixture: bandar baris 1X2 menjadi acuan,
   * dan pasar lain hanya diambil dari bandar yang sama bila tersedia.
   * Mencampur harga antar bandar menciptakan pasar sintetis yang tidak ada
   * di mana pun (peringatan yang sama seperti di quant adapter).
   */
  const book = mw?.bookmaker ?? odds.btts[0]?.bookmaker ?? odds.overUnder[0]?.bookmaker ?? null;
  const sameBook = <T extends LedgerOddsRow>(rows: T[]): T[] => {
    if (!book) return rows;
    const filtered = rows.filter((r) => r.bookmaker === book);
    return filtered.length > 0 ? filtered : rows;
  };
  if (mw) {
    const marketOdds = [mw.home, mw.draw, mw.away];
    out.push(
      { key: "ML:home", family: "ML", line: null, odds: mw.home!, label: "Home Win", marketOdds, index: 0, bookmaker: mw.bookmaker ?? null },
      { key: "ML:draw", family: "ML", line: null, odds: mw.draw!, label: "Draw", marketOdds, index: 1, bookmaker: mw.bookmaker ?? null },
      { key: "ML:away", family: "ML", line: null, odds: mw.away!, label: "Away Win", marketOdds, index: 2, bookmaker: mw.bookmaker ?? null },
    );
  }

  const btts = sameBook(odds.btts).find((r) => validOdds(r.yes) && validOdds(r.no));
  if (btts) {
    const marketOdds = [btts.yes, btts.no];
    out.push(
      { key: "BTTS:yes", family: "BTTS", line: null, odds: btts.yes!, label: "BTTS Yes", marketOdds, index: 0, bookmaker: btts.bookmaker ?? null },
      { key: "BTTS:no", family: "BTTS", line: null, odds: btts.no!, label: "BTTS No", marketOdds, index: 1, bookmaker: btts.bookmaker ?? null },
    );
  }

  const seenTotals = new Set<number>();
  for (const r of sameBook(odds.overUnder)) {
    if (!validOdds(r.over) || !validOdds(r.under) || r.line == null || !Number.isFinite(r.line)) continue;
    if (seenTotals.has(r.line)) continue;
    seenTotals.add(r.line);
    const marketOdds = [r.over, r.under];
    out.push(
      { key: `TOT:over:${fmtLine(r.line)}`, family: "Totals", line: r.line, odds: r.over, label: `Over ${r.line}`, marketOdds, index: 0, bookmaker: r.bookmaker ?? null },
      { key: `TOT:under:${fmtLine(r.line)}`, family: "Totals", line: r.line, odds: r.under, label: `Under ${r.line}`, marketOdds, index: 1, bookmaker: r.bookmaker ?? null },
    );
  }

  const seenAh = new Set<number>();
  for (const r of sameBook(odds.asianHandicap)) {
    if (!validOdds(r.home) || !validOdds(r.away) || r.line == null || !Number.isFinite(r.line)) continue;
    if (seenAh.has(r.line)) continue;
    seenAh.add(r.line);
    const marketOdds = [r.home, r.away];
    /* Konvensi engine: garis baris adalah garis kandang; sisi tandang `-line`. */
    out.push(
      { key: `AH:home:${fmtLine(r.line)}`, family: "AH", line: r.line, odds: r.home, label: `Asian Handicap Home ${r.line}`, marketOdds, index: 0, bookmaker: r.bookmaker ?? null },
      { key: `AH:away:${fmtLine(-r.line)}`, family: "AH", line: -r.line, odds: r.away, label: `Asian Handicap Away ${-r.line}`, marketOdds, index: 1, bookmaker: r.bookmaker ?? null },
    );
  }

  return out;
}

/**
 * Bangun semua baris ledger v1 untuk satu fixture. Baris tanpa probabilitas
 * model yang sah tidak ditulis (dan dilaporkan lewat `skipped`), karena baris
 * dengan p_final karangan akan meracuni laporan kalibrasi Fase 3.
 */
export function buildLlmSelectionRows(input: BuildLlmRowsInput): {
  rows: LlmSelectionRow[];
  skipped: Array<{ key: string; reason: string }>;
} {
  const rows: LlmSelectionRow[] = [];
  const skipped: Array<{ key: string; reason: string }> = [];
  const betKey = marketKeyForLabel(input.betLabel, input.betLine);

  for (const c of candidates(input.odds)) {
    const model = modelProbabilityForSelection(input.matrix, input.markets, c.label);
    if (model.probability == null || !(model.probability > 0 && model.probability < 1)) {
      skipped.push({ key: c.key, reason: model.note ?? "probabilitas model tidak tersedia" });
      continue;
    }
    const pMarket = worstCaseFairProbability(c.marketOdds, c.index);
    const pFinal = pMarket != null
      ? blendProbability(model.probability, pMarket, LLM_MODEL_WEIGHT)
      : model.probability;

    rows.push({
      fixture_id: String(input.fixtureId),
      analysed_at: input.analysedAt,
      model_version: LLM_MODEL_VERSION,
      market_key: c.key,
      family: c.family,
      line: c.line,
      odds: c.odds,
      p_final: Number(pFinal.toFixed(6)),
      p_market_fair: pMarket == null ? null : Number(pMarket.toFixed(6)),
      p_model_only: Number(model.probability.toFixed(6)),
      ev: Number(expectedValue(pFinal, c.odds).toFixed(6)),
      ev_conservative: Number(conservativeEv(pFinal, c.odds, LLM_SIGMA).toFixed(6)),
      was_bet: betKey != null && betKey === c.key,
      bookmaker: c.bookmaker,
    });
  }

  return { rows, skipped };
}
