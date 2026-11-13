/**
 * Writer ledger P3 untuk jalur LLM (`model_version = 1`).
 *
 * Pasangan `quant-shadow.ts` (v2): menjalankan pembangunan baris murni dari
 * `lib/llm-ledger.ts` lalu upsert ke `prediction_selections`. Baris ditulis
 * SETELAH `ai_predictions` tersimpan dan SEBELUM hasil pertandingan diketahui,
 * jadi ia catatan out-of-sample yang bersih — satu-satunya jenis catatan yang
 * bisa menjawab "apakah jalur LLM mengalahkan pasar?".
 *
 * Kebijakan gagal sama seperti quant shadow: TIDAK PERNAH mematahkan analisis.
 * Semua error ditelan dan dicatat warn; analisis tetap sah tanpa ledger.
 */

import { supabase } from "../lib/supabase-client";
import { logger } from "../lib/logger";
import {
  buildLlmSelectionRows,
  LLM_MODEL_VERSION,
  type LlmLedgerOdds,
} from "../lib/llm-ledger";
import type { MarketProbabilities } from "../lib/match-context";
import type { ScoreMatrix } from "../lib/quant/poisson";

export interface LlmShadowInput {
  fixtureId: number | string;
  analysedAt: string;
  matrix: ScoreMatrix;
  markets: MarketProbabilities;
  odds: LlmLedgerOdds;
  betLabel?: string | null;
  betLine?: number | null;
}

export async function shadowLogLlmAnalysis(input: LlmShadowInput): Promise<{ logged: number; skipped: number }> {
  try {
    const { rows, skipped } = buildLlmSelectionRows({
      fixtureId: input.fixtureId,
      analysedAt: input.analysedAt,
      matrix: input.matrix,
      markets: input.markets,
      odds: input.odds,
      betLabel: input.betLabel,
      betLine: input.betLine,
    });

    if (rows.length === 0) {
      logger.debug(
        { fixtureId: input.fixtureId, skipped },
        "[LLM-SHADOW] tidak ada market yang bisa dicatat",
      );
      return { logged: 0, skipped: skipped.length };
    }

    const { error } = await supabase
      .from("prediction_selections")
      .upsert(rows, { onConflict: "fixture_id,model_version,market_key" });

    if (error) {
      logger.warn(
        { error, fixtureId: input.fixtureId },
        "[LLM-SHADOW] gagal menulis prediction_selections v1",
      );
      return { logged: 0, skipped: skipped.length };
    }

    logger.info(
      { fixtureId: input.fixtureId, selections: rows.length, modelVersion: LLM_MODEL_VERSION },
      "[LLM-SHADOW] selections dicatat",
    );
    return { logged: rows.length, skipped: skipped.length };
  } catch (err) {
    logger.warn({ err, fixtureId: input.fixtureId }, "[LLM-SHADOW] gagal total");
    return { logged: 0, skipped: 0 };
  }
}
