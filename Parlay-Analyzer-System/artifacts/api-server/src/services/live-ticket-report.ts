/**
 * Loader laporan tiket live (Fase B): membaca tiket varian resmi dari
 * `parlays` + seluruh leg-nya, dan hitungan kemajuan ledger dari
 * `prediction_selections`, lalu menyerahkannya ke pembangun murni di
 * `lib/live-ticket-report.ts`. Pola yang sama dengan ledger-report.
 */

import { supabase } from "../lib/supabase-client";
import {
  buildLiveTicketReport,
  LIVE_VARIANTS,
  type LiveTicketLegRow,
  type LiveTicketReport,
  type LiveTicketRow,
} from "../lib/live-ticket-report";

const PAGE = 1000;
const MAX_ROWS = 50_000;

async function loadTickets(): Promise<LiveTicketRow[]> {
  const rows: LiveTicketRow[] = [];
  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    const { data, error } = await supabase
      .from("parlays")
      .select("id, parlay_name, status, win_probability, created_at")
      .order("created_at", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`Gagal membaca parlays: ${error.message}`);
    const page = (data ?? []) as unknown as LiveTicketRow[];
    rows.push(...page);
    if (page.length < PAGE) break;
  }
  return rows;
}

async function loadLegs(ticketIds: string[]): Promise<LiveTicketLegRow[]> {
  if (ticketIds.length === 0) return [];
  const rows: LiveTicketLegRow[] = [];
  for (let i = 0; i < ticketIds.length; i += 200) {
    const chunk = ticketIds.slice(i, i + 200);
    const { data, error } = await supabase
      .from("parlay_legs")
      .select("parlay_id, odds, result")
      .in("parlay_id", chunk);
    if (error) throw new Error(`Gagal membaca parlay_legs: ${error.message}`);
    rows.push(...((data ?? []) as unknown as LiveTicketLegRow[]));
  }
  return rows;
}

async function countWhere(
  column: string,
): Promise<number> {
  const { count, error } = await supabase
    .from("prediction_selections")
    .select("id", { count: "exact", head: true })
    .not(column, "is", null);
  if (error) throw new Error(`Gagal menghitung ${column}: ${error.message}`);
  return count ?? 0;
}

export async function getLiveTicketReport(): Promise<LiveTicketReport> {
  const tickets = await loadTickets();
  const variantTicketIds = tickets
    .filter((t) => LIVE_VARIANTS.some((v) => (t.parlay_name ?? "").startsWith(`Tiket ${v}`)))
    .map((t) => t.id);
  const [legs, settled, withClose] = await Promise.all([
    loadLegs(variantTicketIds),
    countWhere("outcome"),
    countWhere("odds_close"),
  ]);
  return buildLiveTicketReport(tickets, legs, { settled, withClose });
}
