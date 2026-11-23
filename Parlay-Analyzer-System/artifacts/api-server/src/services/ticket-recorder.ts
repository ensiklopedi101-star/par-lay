/**
 * Pencatat Tiket Hari Ini.
 *
 * Tiket pasar-dulu (Utama/Booster/Jackpot) lahir sebagai pratinjau yang
 * dihitung ulang setiap panel dibuka — tanpa pencatatan, tiket yang
 * kemarin direkomendasikan hilang begitu saja dan tidak pernah bisa
 * dijawab "tiket itu akhirnya menang atau kalah?" (celah yang ditemukan
 * pemilik sistem, 23 Nov 2026).
 *
 * Modul ini mengambil varian yang SUDAH tersusun (tidak menyusun
 * ulang, tidak mengubah satu angka pun) dan menyimpannya sebagai
 * snapshot di `parlays` + `parlay_legs`:
 *  - `generated_by = MARKET_FIRST_<VARIAN>` agar terbedakan dari
 *    parlay manual / AI_BATCH lama;
 *  - leg disimpan dengan `prediction_id = null` dan teks market label
 *    manusia (mis. "Over 2.5 Goals") — persis format yang dievaluasi
 *    `settleManualParlayLegs`, jadi outcome terisi otomatis dari skor
 *    akhir lewat runSettlement, lalu `settleParlaysForFixtures`
 *    menurunkan status tiket won/lost;
 *  - anti-duplikat: tanda tangan tiket = varian + himpunan
 *    `fixtureId:marketKey`. Tiket dengan tanda tangan sama yang sudah
 *    tercatat HARI INI tidak dicatat ulang (panel boleh dibuka dan
 *    tombol boleh ditekan berkali-kali). Bila isi tiket berubah,
 *    tanda tangan berubah → tercatat sebagai tiket baru, dan tiket
 *    lama tetap tersimpan sebagai riwayat. Tidak ada yang ditimpa.
 */

import { supabase as defaultSupabase } from "../lib/supabase-client";
import { logger } from "../lib/logger";
import type { ParlayVariants, VariantTicket } from "../lib/quant/market-first";

type SupabaseLike = typeof defaultSupabase;

export const RECORDER_GENERATED_BY: Record<string, string> = {
  utama: "MARKET_FIRST_UTAMA",
  booster: "MARKET_FIRST_BOOSTER",
  jackpot: "MARKET_FIRST_JACKPOT",
};

const VARIANT_TITLES: Record<string, string> = {
  utama: "Tiket Utama",
  booster: "Tiket Booster",
  jackpot: "Tiket Jackpot",
};

/** Tanda tangan isi tiket: stabil terhadap urutan leg. */
export function ticketSignature(
  variant: string,
  legs: Array<{ fixtureId: number; marketKey: string }>,
): string {
  const parts = legs
    .map((leg) => `${leg.fixtureId}:${leg.marketKey}`)
    .sort()
    .join(",");
  return `${variant}|${parts}`;
}

export interface RecordTicketsResult {
  recorded: Array<{ variant: string; parlayId: string; legs: number; combinedOdds: number }>;
  skipped: Array<{ variant: string; reason: string }>;
}

function startOfTodayIso(now: Date): string {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

/**
 * Catat semua varian non-null. Kegagalan satu varian tidak membatalkan
 * yang lain; hasil per varian dilaporkan apa adanya.
 */
export async function recordVariantTickets(
  variants: ParlayVariants,
  options: { supabase?: SupabaseLike; now?: Date } = {},
): Promise<RecordTicketsResult> {
  const supabase = options.supabase ?? defaultSupabase;
  const now = options.now ?? new Date();
  const result: RecordTicketsResult = { recorded: [], skipped: [] };
  if (!supabase) {
    return {
      recorded: [],
      skipped: Object.keys(RECORDER_GENERATED_BY).map((variant) => ({
        variant,
        reason: "Supabase tidak terkonfigurasi",
      })),
    };
  }

  /* Tanda tangan tiket yang sudah tercatat hari ini (per varian). */
  const generatedByValues = Object.values(RECORDER_GENERATED_BY);
  const { data: todaysParlays } = await supabase
    .from("parlays")
    .select("id, generated_by")
    .in("generated_by", generatedByValues)
    .gte("created_at", startOfTodayIso(now));
  const existingSignatures = new Set<string>();
  if (todaysParlays && todaysParlays.length > 0) {
    const ids = (todaysParlays as Array<{ id: string }>).map((p) => p.id);
    const { data: todaysLegs } = await supabase
      .from("parlay_legs")
      .select("parlay_id, fixture_id, market, selection")
      .in("parlay_id", ids);
    const variantByParlay = new Map<string, string>();
    for (const p of todaysParlays as Array<{ id: string; generated_by: string }>) {
      const variant = Object.keys(RECORDER_GENERATED_BY).find(
        (key) => RECORDER_GENERATED_BY[key] === p.generated_by,
      );
      if (variant) variantByParlay.set(String(p.id), variant);
    }
    const legsByParlay = new Map<string, Array<{ fixtureId: number; marketKey: string }>>();
    const { marketKeyForLabel } = await import("../lib/llm-ledger");
    for (const leg of (todaysLegs ?? []) as Array<{ parlay_id: string; fixture_id: number | string; market: string | null; selection: string | null }>) {
      const marketKey = marketKeyForLabel(leg.selection ?? leg.market);
      if (!marketKey) continue;
      const list = legsByParlay.get(String(leg.parlay_id)) ?? [];
      list.push({ fixtureId: Number(leg.fixture_id), marketKey });
      legsByParlay.set(String(leg.parlay_id), list);
    }
    for (const [parlayId, variant] of variantByParlay) {
      const legs = legsByParlay.get(parlayId);
      if (legs && legs.length > 0) existingSignatures.add(ticketSignature(variant, legs));
    }
  }

  const dateLabel = now.toLocaleDateString("id-ID", { day: "numeric", month: "numeric", year: "numeric" });

  for (const variant of ["utama", "booster", "jackpot"] as const) {
    const ticket: VariantTicket | null = variants[variant];
    if (!ticket) {
      result.skipped.push({ variant, reason: variants.variantNotes[variant] ?? "Varian tidak terbentuk" });
      continue;
    }
    const signature = ticketSignature(variant, ticket.legs);
    if (existingSignatures.has(signature)) {
      result.skipped.push({ variant, reason: "Isi tiket sama persis dengan yang sudah tercatat hari ini" });
      continue;
    }

    const { data: parlay, error: parlayError } = await supabase
      .from("parlays")
      .insert({
        parlay_name: `${VARIANT_TITLES[variant]} — ${dateLabel}`,
        legs_count: ticket.legs.length,
        combined_odds: ticket.combinedOdds,
        win_probability: ticket.pCombined,
        expected_value: ticket.evVsBook,
        avg_confidence: null,
        status: "active",
        generated_by: RECORDER_GENERATED_BY[variant],
        leagues_count: new Set(ticket.legs.map((leg) => leg.league).filter(Boolean)).size,
        countries_count: new Set(ticket.legs.map((leg) => leg.league).filter(Boolean)).size,
        reasoning: ticket.notes.join(" ").slice(0, 900),
        created_at: now.toISOString(),
        updated_at: now.toISOString(),
      })
      .select("id")
      .single();

    if (parlayError || !parlay?.id) {
      logger.error({ error: parlayError, variant }, "[TICKET-RECORDER] Gagal mencatat tiket");
      result.skipped.push({ variant, reason: `Gagal menyimpan: ${parlayError?.message ?? "tidak ada id"}` });
      continue;
    }

    const { error: legsError } = await supabase.from("parlay_legs").insert(
      ticket.legs.map((leg, index) => ({
        parlay_id: parlay.id,
        prediction_id: null,
        fixture_id: leg.fixtureId,
        leg_order: index + 1,
        market: leg.displayLabel,
        selection: leg.displayLabel,
        odds: leg.selection.odds,
        probability: leg.pUsed,
        confidence: null,
        result: null,
      })),
    );
    if (legsError) {
      logger.error({ error: legsError, variant, parlayId: parlay.id }, "[TICKET-RECORDER] Gagal mencatat leg tiket");
      result.skipped.push({ variant, reason: `Tiket tersimpan tanpa leg: ${legsError.message}` });
      continue;
    }

    existingSignatures.add(signature);
    result.recorded.push({
      variant,
      parlayId: String(parlay.id),
      legs: ticket.legs.length,
      combinedOdds: ticket.combinedOdds,
    });
    logger.info({ variant, parlayId: parlay.id, legs: ticket.legs.length }, "[TICKET-RECORDER] Tiket tercatat");
  }

  return result;
}
