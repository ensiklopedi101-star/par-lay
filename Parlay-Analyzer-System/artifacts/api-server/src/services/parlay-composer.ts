/**
 * Menyimpan parlay hasil komposisi ke database.
 *
 * Modul `lib/quant/composition.ts` sengaja tidak menyentuh Supabase agar bisa
 * diuji tanpa database. Di sinilah hasilnya diwujudkan menjadi baris
 * `parlays` + `parlay_legs`.
 *
 * Bedanya dengan `createMergedParlay()`
 * -------------------------------------
 * `createMergedParlay()` **menerima** leg yang sudah dipilih pemanggil, lalu
 * menyimpannya. Modul ini **memilih** lebih dulu lewat pencarian kombinasi
 * yang memperhitungkan korelasi. Nama, `generated_by`, dan `reasoning` dibuat
 * berbeda supaya asal-usulnya bisa dibedakan saat dievaluasi nanti — parlay
 * yang disusun mesin tidak boleh tercampur dengan parlay yang dipilih manusia.
 */

import { supabase } from "../lib/supabase-client";
import { logger } from "../lib/logger";
import {
  buildParlayComposition,
  toParlayLegRows,
  type CompositionCandidate,
  type ParlayComposition,
} from "../lib/quant/composition";
import { ticketStakePlan } from "../lib/quant/parlay";

export const COMPOSER_GENERATED_BY = "QUANT_COMPOSER";

export interface ComposeAndSaveResult {
  /** Ringkasan komposisi apa pun hasilnya — termasuk penolakan. */
  composition: ParlayComposition;
  /** `null` bila tidak ada kombinasi yang layak, atau penyimpanan gagal. */
  parlayId: string | null;
  saved: boolean;
  /** Alasan jujur bila tidak tersimpan. */
  note: string | null;
}

/**
 * Susun parlay dari kandidat, lalu simpan bila ada yang layak.
 *
 * Kegagalan penyimpanan **tidak** melempar: pemanggil (cron) harus tetap bisa
 * melaporkan bahwa komposisi berjalan dan apa hasilnya, sekalipun database
 * menolak. Yang dikembalikan adalah `saved: false` beserta sebabnya.
 */
export async function composeAndSaveParlay(
  candidates: CompositionCandidate[],
  options: {
    minLegs?: number;
    maxLegs?: number;
    maxCandidates?: number;
    seed?: number;
    /** Nama parlay; bawaan memakai tanggal. */
    name?: string;
    /** Untuk pengujian: ganti klien database. */
    client?: typeof supabase;
  } = {},
): Promise<ComposeAndSaveResult> {
  const client = options.client ?? supabase;
  const composition = buildParlayComposition(candidates, {
    minLegs: options.minLegs,
    maxLegs: options.maxLegs,
    maxCandidates: options.maxCandidates,
    seed: options.seed,
  });

  if (!composition.best) {
    return {
      composition,
      parlayId: null,
      saved: false,
      note: composition.notes[0] ?? "Tidak ada kombinasi yang memenuhi syarat.",
    };
  }

  if (!client) {
    return {
      composition,
      parlayId: null,
      saved: false,
      note: "Supabase tidak tersedia — kombinasi disusun tetapi tidak disimpan.",
    };
  }

  const best = composition.best;
  const leagues = new Set(best.legs.map((leg) => leg.league).filter(Boolean));
  const now = new Date().toISOString();

  const { data: parlay, error: parlayError } = await client
    .from("parlays")
    .insert({
      parlay_name:
        options.name ?? `Parlay Kuantitatif — ${new Date().toLocaleDateString("id-ID")}`,
      legs_count: best.legs.length,
      combined_odds: best.combinedOdds,
      win_probability: best.pDecision,
      expected_value: best.evDecision,
      stake_pct: ticketStakePlan(best, best.legs.map(() => 0.03)).stakePct,
      ev_pessimistic: best.evPessimistic,
      p_correlated: best.pCorrelated,
      avg_confidence: null,
      status: "active",
      generated_by: COMPOSER_GENERATED_BY,
      leagues_count: leagues.size,
      countries_count: leagues.size,
      reasoning: buildReasoning(composition),
      created_at: now,
      updated_at: now,
    })
    .select("id")
    .single();

  if (parlayError || !parlay?.id) {
    logger.error({ error: parlayError }, "[COMPOSER] Gagal menyimpan parlay hasil komposisi");
    return {
      composition,
      parlayId: null,
      saved: false,
      note: `Penyimpanan parlay gagal: ${parlayError?.message ?? "id tidak dikembalikan"}`,
    };
  }

  const parlayId = String(parlay.id);
  const rows = toParlayLegRows(best, parlayId, { now });

  const { error: legsError } = await client.from("parlay_legs").insert(rows);
  if (legsError) {
    /* Jangan tinggalkan parlay tanpa leg: ia akan tampil di dashboard sebagai
     * parlay aktif yang tidak bisa disettle. */
    await client.from("parlays").delete().eq("id", parlayId);
    logger.error({ error: legsError, parlayId }, "[COMPOSER] Gagal menyimpan leg, parlay dibatalkan");
    return {
      composition,
      parlayId: null,
      saved: false,
      note: `Penyimpanan leg gagal, parlay dibatalkan: ${legsError.message}`,
    };
  }

  logger.info(
    {
      parlayId,
      legs: best.legs.length,
      combinedOdds: best.combinedOdds,
      evDecision: best.evDecision,
      combinationsEvaluated: composition.combinationsEvaluated,
    },
    "[COMPOSER] Parlay hasil komposisi tersimpan",
  );

  return { composition, parlayId, saved: true, note: null };
}

/**
 * Alasan yang disimpan bersama parlay.
 *
 * Ditulis dari angka yang benar-benar dipakai, bukan dari narasi model bahasa.
 * Saat parlay ini dievaluasi enam bulan lagi, teks inilah yang menjelaskan
 * kenapa leg-nya dipilih — dan ia tidak bisa "berhalusinasi".
 */
function buildReasoning(composition: ParlayComposition): string {
  const best = composition.best!;
  const legs = best.legs
    .map((leg) => `${leg.selection.label} (${leg.league}, EV ${(leg.selection.evConservative * 100).toFixed(1)}%)`)
    .join("; ");
  return [
    `${best.legs.length} leg dipilih dari ${composition.eligible} kandidat layak ` +
      `(${composition.combinationsEvaluated} kombinasi diuji).`,
    `Leg: ${legs}.`,
    `Odds gabungan ${best.combinedOdds.toFixed(2)}, peluang menang ${(best.pDecision * 100).toFixed(1)}%, ` +
      `EV ${(best.evDecision * 100).toFixed(1)}%.`,
    `Toleransi overestimasi ${(best.breakEvenBias * 100).toFixed(1)} poin per leg.`,
    "Prior korelasi masih heuristik; angka ini konservatif, bukan jaminan.",
  ].join(" ");
}
