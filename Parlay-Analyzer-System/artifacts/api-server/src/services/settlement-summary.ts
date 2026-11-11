/**
 * Ringkasan transparansi settlement.
 *
 * Dashboard sebelumnya hanya menampilkan hit rate dan ROI. Itu angka akhir,
 * bukan proses — tidak ada cara mengetahui berapa yang sudah tersettle,
 * berapa yang menunggu skor, dan berapa yang gagal karena datanya tidak
 * lengkap. Padahal justru bagian itu yang menentukan apakah sistem bekerja.
 *
 * Modul ini murni membaca; tidak menulis apa pun. Aman dipanggil sesering
 * apa pun dan tidak memakai kuota penyedia odds.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase as defaultSupabase } from "../lib/supabase-client";
import { logger } from "../lib/logger";

/** Status pada `ai_predictions` yang dianggap sudah selesai. */
const SETTLED_STATUSES = ["WIN", "LOSS", "PUSH", "HALF_WIN", "HALF_LOSS", "VOID"];

export interface SettlementCounts {
  total: number;
  settled: number;
  pending: number;
  noBet: number;
}

export interface OutcomeBreakdown {
  outcome: string;
  count: number;
}

export interface SettlementCoverage {
  /** Baris ledger yang sudah punya `odds_close` (harga penutup). */
  withClosingOdds: number;
  /** Baris ledger yang sudah punya `outcome`. */
  withOutcome: number;
  /** Baris ledger yang memenuhi syarat taruhan (`was_bet`). */
  betRows: number;
  total: number;
}

export interface SettlementSummary {
  predictions: SettlementCounts;
  selections: SettlementCounts;
  outcomes: OutcomeBreakdown[];
  coverage: SettlementCoverage;
  /** Fixture yang sudah lewat tapi belum punya skor — penghalang settlement. */
  fixturesMissingScore: number;
  /** Fixture yang sudah lewat dan sudah punya skor. */
  fixturesScored: number;
  generatedAt: string;
  /** Catatan jujur soal apa yang belum bisa dihitung. */
  notes: string[];
}

function countsFrom(
  total: number,
  settled: number,
  noBet: number,
): SettlementCounts {
  return {
    total,
    settled,
    noBet,
    pending: Math.max(0, total - settled - noBet),
  };
}

/**
 * Ambil jumlah baris untuk satu tabel dengan beberapa filter.
 *
 * Memakai `head: true` + `count: "exact"` agar tidak menarik barisnya —
 * penting karena `prediction_selections` bisa membesar cepat (satu fixture
 * menghasilkan banyak market).
 */
async function countWhere(
  client: SupabaseClient,
  table: string,
  apply?: (query: ReturnType<SupabaseClient["from"]>["select"] extends never ? never : any) => any,
): Promise<number> {
  let query = client.from(table).select("*", { count: "exact", head: true });
  if (apply) query = apply(query);
  const { count, error } = await query;
  if (error) {
    logger.debug({ error, table }, "Settlement count gagal");
    return 0;
  }
  return count ?? 0;
}

export async function buildSettlementSummary(
  options: { supabase?: SupabaseClient } = {},
): Promise<SettlementSummary> {
  const client = options.supabase ?? defaultSupabase;
  const notes: string[] = [];

  const empty: SettlementSummary = {
    predictions: { total: 0, settled: 0, pending: 0, noBet: 0 },
    selections: { total: 0, settled: 0, pending: 0, noBet: 0 },
    outcomes: [],
    coverage: { withClosingOdds: 0, withOutcome: 0, betRows: 0, total: 0 },
    fixturesMissingScore: 0,
    fixturesScored: 0,
    generatedAt: new Date().toISOString(),
    notes: ["Supabase tidak tersedia — ringkasan settlement tidak bisa dihitung."],
  };

  if (!client) return empty;

  /* ─── ai_predictions: prediksi tingkat fixture ─── */
  const predTotal = await countWhere(client, "ai_predictions");
  const predSettled = await countWhere(client, "ai_predictions", (q) =>
    q.in("status", SETTLED_STATUSES),
  );
  const predNoBet = await countWhere(client, "ai_predictions", (q) =>
    q.eq("status", "no_bet"),
  );

  /* ─── prediction_selections: ledger quant (banyak market per fixture) ─── */
  const selTotal = await countWhere(client, "prediction_selections");
  const selWithOutcome = await countWhere(client, "prediction_selections", (q) =>
    q.not("outcome", "is", null),
  );
  const selWithClose = await countWhere(client, "prediction_selections", (q) =>
    q.not("odds_close", "is", null),
  );
  const selBetRows = await countWhere(client, "prediction_selections", (q) =>
    q.eq("was_bet", true),
  );

  /* ─── Sebaran outcome ledger ─── */
  const outcomes: OutcomeBreakdown[] = [];
  try {
    const { data } = await client
      .from("prediction_selections")
      .select("outcome")
      .not("outcome", "is", null)
      .limit(5000);
    if (Array.isArray(data)) {
      const tally = new Map<string, number>();
      for (const row of data as { outcome: string | null }[]) {
        const key = row.outcome ?? "unknown";
        tally.set(key, (tally.get(key) ?? 0) + 1);
      }
      for (const [outcome, count] of Array.from(tally.entries()).sort((a, b) => b[1] - a[1])) {
        outcomes.push({ outcome, count });
      }
    }
  } catch (err) {
    logger.debug({ err }, "Gagal membaca sebaran outcome");
  }

  /* ─── Fixture lewat yang belum punya skor: penghalang nyata settlement ───
   * `runOutcomeSettlement` butuh skor akhir. Fixture tanpa skor akan terus
   * menumpuk dan tidak akan pernah tersettle berapa pun lama ditunggu. */
  let fixturesMissingScore = 0;
  let fixturesScored = 0;
  try {
    const nowIso = new Date().toISOString();
    fixturesScored = await countWhere(client, "fixtures", (q) =>
      q.lt("fixture_date", nowIso).not("home_goals", "is", null),
    );
    const pastTotal = await countWhere(client, "fixtures", (q) =>
      q.lt("fixture_date", nowIso),
    );
    fixturesMissingScore = Math.max(0, pastTotal - fixturesScored);
  } catch (err) {
    logger.debug({ err }, "Gagal menghitung fixture tanpa skor");
  }

  /* ─── Catatan jujur ─── */
  if (selTotal === 0) {
    notes.push(
      "Ledger quant (prediction_selections) masih kosong. Settlement ledger belum bisa dinilai " +
        "sampai ada analisis nyata yang berjalan.",
    );
  }
  if (selTotal > 0 && selWithOutcome === 0) {
    notes.push(
      "Belum ada satu pun selection punya outcome. Job `?action=outcomes` perlu berjalan " +
        "setelah fixture selesai dan skornya terisi.",
    );
  }
  if (selTotal > 0 && selWithClose === 0) {
    notes.push(
      "Belum ada odds_close terisi. Job `?action=closing` mengisinya 10 menit sebelum kick-off; " +
        "tanpa ini CLV tidak bisa dihitung.",
    );
  }
  if (fixturesMissingScore > 0) {
    notes.push(
      `${fixturesMissingScore} fixture sudah lewat tetapi belum punya skor akhir. ` +
        "Fixture ini tidak akan pernah tersettle sampai skornya diisi.",
    );
  }

  return {
    predictions: countsFrom(predTotal, predSettled, predNoBet),
    selections: countsFrom(selTotal, selWithOutcome, 0),
    outcomes,
    coverage: {
      withClosingOdds: selWithClose,
      withOutcome: selWithOutcome,
      betRows: selBetRows,
      total: selTotal,
    },
    fixturesMissingScore,
    fixturesScored,
    generatedAt: new Date().toISOString(),
    notes,
  };
}
