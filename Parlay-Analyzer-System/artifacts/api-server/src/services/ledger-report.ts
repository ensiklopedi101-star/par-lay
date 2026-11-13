/**
 * Loader laporan Fase 3: membaca seluruh `prediction_selections` (halaman
 * 1000 baris — Supabase membatasi satu respons) lalu menyerahkannya ke
 * pembangun laporan murni di `lib/ledger-report.ts`.
 */

import { supabase } from "../lib/supabase-client";
import {
  buildLedgerReport,
  type LedgerReport,
  type SelectionLedgerRow,
} from "../lib/ledger-report";

const PAGE = 1000;
/* Pagar keras: ledger per fixture ~10-20 baris; 50k baris jauh di atas kebutuhan
   Fase 3 dan mencegah loop tak berujung bila pagination berubah perilaku. */
const MAX_ROWS = 50_000;

export async function loadLedgerRows(): Promise<SelectionLedgerRow[]> {
  const rows: SelectionLedgerRow[] = [];
  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    const { data, error } = await supabase
      .from("prediction_selections")
      .select(
        "fixture_id, analysed_at, model_version, market_key, family, line, odds, " +
        "p_final, p_market_fair, p_model_only, ev, odds_close, close_fair_prob, outcome, was_bet, bookmaker",
      )
      .order("analysed_at", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`Gagal membaca prediction_selections: ${error.message}`);
    const page = (data ?? []) as unknown as SelectionLedgerRow[];
    rows.push(...page);
    if (page.length < PAGE) break;
  }
  return rows;
}

export async function getLedgerReport(): Promise<LedgerReport> {
  return buildLedgerReport(await loadLedgerRows());
}
