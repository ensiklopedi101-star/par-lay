/**
 * Notifikasi Telegram: susun tiket pasar-dulu dari ledger live lalu
 * kirim ke chat pemilik sistem lewat Bot API.
 *
 * Pengiriman saja (sendMessage) — tidak butuh webhook. Kredensial dari
 * env: TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID. Bila belum diset, fungsi
 * menjawab jujur "tidak terkonfigurasi" dan tidak mengirim apa pun;
 * jalur cron tidak pernah gagal karenanya.
 */
import { supabase } from "../lib/supabase-client";
import { logger } from "../lib/logger";
import { formatVariantsMessage } from "../lib/telegram-format";
import { buildParlayVariants, type ParlayVariants } from "../lib/quant/market-first";
import { candidatesFromSelectionRows, type FixtureMeta, type SelectionRow } from "./parlay-candidates";
import { computeContextForCandidates } from "./context-live";
import { enrichTicketWithPriceHunt } from "./price-hunt-live";

export interface TelegramNotifyResult {
  sent: boolean;
  reason: string;
  legs?: number;
  combinedOdds?: number;
}

/** Susun tiket yang sama persis dengan yang tampil di panel Komposisi. */
export async function buildLiveMarketFirstTicket(): Promise<ParlayVariants | null> {
  if (!supabase) return null;
  const { data: rows, error } = await supabase
    .from("prediction_selections")
    .select("fixture_id, market_key, family, line, odds, p_final, p_market_fair, p_model_only, ev, ev_conservative, bookmaker")
    .order("ev_conservative", { ascending: false })
    .limit(1000);
  if (error) {
    logger.warn({ error }, "[TELEGRAM] gagal membaca ledger");
    return null;
  }
  const selectionRows = (rows ?? []) as SelectionRow[];
  if (selectionRows.length === 0) return null;

  const fixtureIds = [...new Set(selectionRows.map((r) => Number(r.fixture_id)))];
  const { data: fixtures } = await supabase
    .from("fixtures")
    .select("fixture_id, league_name, fixture_date, home_team_name, away_team_name, status_short")
    .in("fixture_id", fixtureIds);
  const meta = new Map<number, FixtureMeta>();
  for (const f of (fixtures ?? []) as Array<{ fixture_id: number; league_name: string | null; fixture_date: string | null; home_team_name: string | null; away_team_name: string | null; status_short: string | null }>) {
    meta.set(Number(f.fixture_id), {
      fixtureId: Number(f.fixture_id),
      league: f.league_name ?? "unknown",
      date: f.fixture_date ? f.fixture_date.slice(0, 10) : null,
      homeTeam: f.home_team_name ?? null,
      awayTeam: f.away_team_name ?? null,
      kickoffAt: f.fixture_date ?? null,
      statusShort: f.status_short ?? null,
    });
  }

  const candidates = candidatesFromSelectionRows(selectionRows, meta, { requirePassing: false });
  const contextByCandidate = await computeContextForCandidates(
    candidates.map((c) => ({ fixtureId: c.fixtureId, marketKey: c.marketKey })),
  );
  const variants = buildParlayVariants(candidates, { contextByCandidate });
  if (!variants.utama && !variants.booster && !variants.jackpot) return null;
  return variants;
}

export async function sendTelegramMessage(text: string): Promise<TelegramNotifyResult> {
  const token = process.env["TELEGRAM_BOT_TOKEN"];
  const chatId = process.env["TELEGRAM_CHAT_ID"];
  if (!token || !chatId) {
    return { sent: false, reason: "TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID belum diset di env server." };
  }
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      return { sent: false, reason: `Telegram menolak: HTTP ${response.status} ${detail.slice(0, 200)}` };
    }
    return { sent: true, reason: "Terkirim." };
  } catch (error) {
    return {
      sent: false,
      reason: `Tidak bisa menghubungi Telegram: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export async function notifyParlayViaTelegram(): Promise<TelegramNotifyResult> {
  const variants = await buildLiveMarketFirstTicket();
  if (!variants) {
    return { sent: false, reason: "Tidak ada tiket pasar-dulu yang bisa disusun dari ledger saat ini." };
  }
  for (const ticket of [variants.utama, variants.booster, variants.jackpot]) {
    if (ticket) await enrichTicketWithPriceHunt(ticket);
  }
  const result = await sendTelegramMessage(formatVariantsMessage(variants));
  /* Tiket yang terkirim ke pemilik sistem adalah tiket resmi hari
   * itu — catat sebagai snapshot agar outcome-nya (menang/kalah)
   * bisa dilihat kemudian di menu Tiket Hari Ini → Riwayat.
   * Pencatatan tidak boleh menggagalkan notifikasi yang sudah
   * terkirim; kegagalannya hanya dicatat di log. */
  if (result.sent) {
    try {
      const { recordVariantTickets } = await import("./ticket-recorder");
      const recorded = await recordVariantTickets(variants);
      logger.info({ recorded: recorded.recorded.map((r) => r.variant) }, "[TELEGRAM] Tiket terkirim tercatat sebagai snapshot");
    } catch (recordError) {
      logger.warn({ recordError }, "[TELEGRAM] Gagal mencatat tiket terkirim (notifikasi tetap terkirim)");
    }
  }
  const main = variants.utama ?? variants.booster ?? variants.jackpot!;
  return { ...result, legs: main.legs.length, combinedOdds: main.combinedOdds };
}
