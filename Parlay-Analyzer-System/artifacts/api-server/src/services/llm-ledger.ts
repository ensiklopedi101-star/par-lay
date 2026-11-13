/**
 * Penulis jalur LLM ke `prediction_selections` (P3 — playbook §8b).
 *
 * Jalur engine (`quant-shadow.ts`) sudah menulis setiap `SelectionEval` ke
 * ledger dengan `model_version` = `QUANT_MODEL_VERSION` (2). Jalur LLM v1
 * belum — padahal jalur itulah yang menjadi otoritas pengambilan keputusan
 * (`market_bet`, `best_odds`, `p_final` di `ai_predictions`). Tanpa baris v1,
 * laporan kalibrasi (Brier/BSS/ECE + CLV) hanya mengukur bayangan engine dan
 * tidak pernah menyentuh keputusan yang benar-benar diambil.
 *
 * Syarat penulisan (ketat — kolom `odds` dan `p_final` NOT NULL, dan baris
 * dengan harga karangan akan merusak seluruh ledger):
 *
 *  - `oddsMatch.status === "verified"` — harga provider asli yang sudah
 *    dipetakan `resolveMarketOdds`. Klaim odds dari label LLM ditolak
 *    (resolveMarketOdds hanya memakai harga dari baris snapshot, bukan dari
 *    label).
 *  - `pFinal != null` — blend 0.35 model + 0.65 pasar; tanpa salah satunya
 *    tidak ada probabilitas yang jujur untuk dicatat.
 *  - `marketKey` terpetakan oleh `ledgerMarketKey()` — market yang tidak
 *    dikenal settlement (mis. HT) tidak ditulis, bukan ditulis dengan kunci
 *    yang tidak akan pernah terisi outcome-nya.
 *
 * `was_bet` menandai seleksi yang lolos gerbang (`readinessStatus ===
 * "bet_ready"`): odds verified, EV > 0, lolos policy. Baris yang ditolak
 * kebijakan tetap dicatat (dengan `was_bet = false`) supaya tingkat penolakan
 * bisa diaudit — asal harga dan probabilitasnya asli.
 *
 * Semua kegagalan ditelan (return false + log): satu baris ledger yang gagal
 * tidak boleh menggagalkan seluruh analisis.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase as defaultSupabase } from "../lib/supabase-client";
import { logger } from "../lib/logger";
import { ledgerMarketKey, type MarketOddsResolution } from "../lib/market-odds-readiness";

/** Versi model untuk baris jalur LLM — playbook §8b menetapkan v1. */
export const LLM_MODEL_VERSION = 1;

export interface LogLLMSelectionInput {
  fixtureId: number | string;
  /** Waktu analisis (`analyzedAt` di ai-analysis) — dipakai juga sebagai created_at. */
  analysedAt: string;
  /** Label market pilihan LLM (`parsedRecommendation.marketBet`), null bila NO BET. */
  marketLabel: string | null;
  homeTeam?: string;
  awayTeam?: string;
  /** Resolusi odds provider hasil `resolveMarketOdds` — harus verified. */
  oddsMatch: MarketOddsResolution | null;
  pFinal: number | null;
  marketFairProbability: number | null;
  pModelOnly: number | null;
  modelEv: number | null;
  modelEvConservative: number | null;
  /** true bila seleksi lolos gerbang (`readinessStatus === "bet_ready"`). */
  wasBet: boolean;
}

/**
 * Tulis satu baris jalur LLM ke `prediction_selections`.
 *
 * Idempoten: upsert dengan onConflict `(fixture_id, model_version,
 * market_key)` — reanalisis laga yang sama menimpa barisnya, bukan
 * menggandakan. Mengembalikan false bila baris tidak layak ditulis atau
 * tulis gagal; tidak pernah melempar.
 */
export async function logLLMSelection(
  input: LogLLMSelectionInput,
  options: { supabase?: SupabaseClient | null } = {},
): Promise<boolean> {
  /* `!== undefined` (bukan `??`): passing null eksplisit dipakai tes untuk
   * memaksa jalur degrade tanpa bergantung pada env SUPABASE_URL. */
  const client = options.supabase !== undefined ? options.supabase : defaultSupabase;
  try {
    if (!client) return false;
    if (!input.marketLabel || input.pFinal == null) {
      /* NO BET: tanpa label tidak ada market_key; tanpa p_final tidak ada
       * probabilitas yang bisa dipertanggungjawabkan (kolom NOT NULL). */
      return false;
    }
    if (!input.oddsMatch || input.oddsMatch.status !== "verified") {
      logger.debug(
        { fixtureId: input.fixtureId, status: input.oddsMatch?.status ?? "none" },
        "[LLM-LEDGER] odds tidak verified — baris tidak ditulis",
      );
      return false;
    }
    const odds = input.oddsMatch.odds;
    if (odds == null || odds <= 1) return false;

    const keyInfo = ledgerMarketKey(input.marketLabel, {
      homeTeam: input.homeTeam,
      awayTeam: input.awayTeam,
    }, input.oddsMatch);
    if (!keyInfo) {
      logger.debug(
        { fixtureId: input.fixtureId, market: input.marketLabel },
        "[LLM-LEDGER] label tidak bisa dipetakan ke market_key — baris tidak ditulis",
      );
      return false;
    }

    const { error } = await client.from("prediction_selections").upsert(
      {
        fixture_id: String(input.fixtureId),
        analysed_at: input.analysedAt,
        model_version: LLM_MODEL_VERSION,
        market_key: keyInfo.key,
        family: keyInfo.family,
        line: keyInfo.line,
        odds,
        p_final: input.pFinal,
        p_market_fair: input.marketFairProbability,
        p_model_only: input.pModelOnly,
        ev: input.modelEv,
        ev_conservative: input.modelEvConservative,
        was_bet: input.wasBet,
        bookmaker: null,
      },
      { onConflict: "fixture_id,model_version,market_key" },
    );
    if (error) {
      logger.warn(
        { error, fixtureId: input.fixtureId, marketKey: keyInfo.key },
        "[LLM-LEDGER] gagal menulis prediction_selections",
      );
      return false;
    }
    return true;
  } catch (error) {
    logger.warn({ error, fixtureId: input.fixtureId }, "[LLM-LEDGER] kegagalan tak terduga");
    return false;
  }
}
