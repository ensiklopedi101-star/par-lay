/**
 * Berburu harga di jalur live: untuk tiap leg tiket pasar-dulu, cari
 * harga terbaik pilihan yang sama di semua bandar dalam odds_history,
 * plus arah gerak harganya (snapshot pertama vs terakhir).
 *
 * Memakai ulang resolveMarketOdds per bandar agar pencocokan market,
 * sisi, dan line identik dengan jalur verifikasi yang sudah ada —
 * tidak ada parser harga kedua yang bisa berbeda pendapat.
 */
import { supabase } from "../lib/supabase-client";
import { resolveMarketOdds, type MarketOddsSnapshot } from "../lib/market-odds-readiness";
import { huntBestPrice, ticketPriceImpact, type BookmakerOffer } from "../lib/quant/price-hunt";
import type { MarketFirstTicket } from "../lib/quant/market-first";
import { logger } from "../lib/logger";

const NO_FRESHNESS_LIMIT = Number.MAX_SAFE_INTEGER;

export async function enrichTicketWithPriceHunt(ticket: MarketFirstTicket): Promise<MarketFirstTicket> {
  if (!supabase || ticket.legs.length === 0) return ticket;
  const fixtureIds = [...new Set(ticket.legs.map((l) => l.fixtureId))];

  const rows: MarketOddsSnapshot[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase
      .from("odds_history")
      .select("match_id, bookmaker, market_type, odds_1, odds_2, odds_draw, captured_at")
      .in("match_id", fixtureIds.map(String))
      .order("captured_at", { ascending: false })
      .range(offset, offset + 999);
    if (error) {
      logger.warn({ error }, "[PRICE-HUNT] gagal membaca odds_history");
      return ticket;
    }
    rows.push(...((data ?? []) as MarketOddsSnapshot[]));
    if ((data?.length ?? 0) < 1000) break;
  }

  const rowsByFixture = new Map<string, MarketOddsSnapshot[]>();
  for (const row of rows) {
    const key = String(row.match_id ?? "");
    const list = rowsByFixture.get(key) ?? [];
    list.push(row);
    rowsByFixture.set(key, list);
  }

  for (const leg of ticket.legs) {
    const fixtureRows = rowsByFixture.get(String(leg.fixtureId)) ?? [];
    if (fixtureRows.length === 0) continue;
    const marketLabel = leg.selection.key.replace(/_/g, " ");

    const byBookmaker = new Map<string, MarketOddsSnapshot[]>();
    for (const row of fixtureRows) {
      const bookmaker = String(row.bookmaker ?? "unknown");
      const list = byBookmaker.get(bookmaker) ?? [];
      list.push(row);
      byBookmaker.set(bookmaker, list);
    }

    const offers: BookmakerOffer[] = [];
    for (const [bookmaker, bookmakerRows] of byBookmaker) {
      const resolution = resolveMarketOdds(marketLabel, bookmakerRows, { maxAgeMs: NO_FRESHNESS_LIMIT });
      if (resolution.odds != null) {
        offers.push({ bookmaker, odds: resolution.odds, capturedAt: resolution.capturedAt });
      }
    }

    /* Drift: harga pilihan pada snapshot terawal vs terakhir fixture ini. */
    const timestamps = [...new Set(fixtureRows.map((r) => r.captured_at).filter(Boolean))] as string[];
    timestamps.sort();
    const series: Array<{ odds: number; capturedAt: string }> = [];
    if (timestamps.length >= 2) {
      for (const at of [timestamps[0]!, timestamps[timestamps.length - 1]!]) {
        const atRows = fixtureRows.filter((r) => r.captured_at === at);
        const resolution = resolveMarketOdds(marketLabel, atRows, { maxAgeMs: NO_FRESHNESS_LIMIT });
        if (resolution.odds != null) series.push({ odds: resolution.odds, capturedAt: at });
      }
    }

    leg.priceHunt = huntBestPrice(leg.selection.odds, offers, series);
  }

  ticket.priceImpact = ticketPriceImpact(
    ticket.legs.map((leg) => ({
      usedOdds: leg.selection.odds,
      bestOdds: leg.priceHunt?.bestOdds ?? leg.selection.odds,
    })),
  );
  return ticket;
}
