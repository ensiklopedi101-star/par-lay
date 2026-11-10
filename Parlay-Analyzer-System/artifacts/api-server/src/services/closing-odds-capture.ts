/**
 * Job closing-odds: mengisi `odds_close` dan `close_fair_prob` pada
 * `prediction_selections` sebelum kick-off.
 *
 * Kenapa T-10 menit: harga penutup yang diambil terlalu awal bukan harga
 * penutup; terlalu dekat dengan kick-off berisiko fixture sudah dimulai saat
 * job berjalan. Sepuluh menit adalah kompromi yang juga menjaga kuota — hanya
 * fixture yang benar-benar punya prediksi yang disentuh.
 *
 * Biaya kuota: NOL. Semua data diambil dari `odds_movement_history` yang sudah
 * tersimpan oleh sync odds. Tidak ada panggilan ke penyedia odds di sini.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase as defaultSupabase } from "../lib/supabase-client";
import { logger } from "../lib/logger";
import {
  computeClosingPrices,
  type OddsSnapshotRow,
} from "../lib/closing-odds";
import { outcomeMapForFixture } from "../lib/selection-outcome";

/** Seberapa awal job boleh menyentuh sebuah fixture. */
export const CLOSING_WINDOW_MINUTES = 10;

/** Jangan sentuh fixture yang kick-off-nya lebih jauh dari ini. */
const MAX_LOOKAHEAD_HOURS = 6;

/** Batas baris per permintaan agar tidak menabrak batas PostgREST. */
const PAGE_SIZE = 1000;

export interface ClosingCaptureSummary {
  /** fixture yang masuk jendela T-10 dan punya selection belum berharga. */
  candidates: number;
  /** fixture yang berhasil diisi minimal satu market. */
  fixturesUpdated: number;
  /** baris prediction_selections yang mendapat odds_close. */
  rowsUpdated: number;
  /** market yang diminta tetapi tidak bisa dihargai. */
  skipped: number;
  /** baris yang outcome-nya berhasil ditentukan dari skor akhir. */
  outcomesFilled: number;
  errors: string[];
}

interface SelectionRow {
  id: number;
  fixture_id: string;
  market_key: string;
}

/**
 * Ambil selection yang belum punya harga penutup, untuk fixture yang
 * kick-off-nya jatuh dalam jendela [now, now + lookahead).
 */
async function loadOpenSelections(
  supabase: SupabaseClient,
  now: Date,
): Promise<SelectionRow[]> {
  const lookahead = new Date(now.getTime() + MAX_LOOKAHEAD_HOURS * 60 * 60 * 1000);

  const { data: fixtures, error: fixtureError } = await supabase
    .from("fixtures")
    .select("fixture_id, fixture_date")
    .gte("fixture_date", now.toISOString())
    .lt("fixture_date", lookahead.toISOString());

  if (fixtureError) throw fixtureError;
  if (!fixtures || fixtures.length === 0) return [];

  const fixtureIds = fixtures.map((f) => String(f.fixture_id));

  const rows: SelectionRow[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("prediction_selections")
      .select("id, fixture_id, market_key")
      .in("fixture_id", fixtureIds)
      .is("odds_close", null)
      .range(from, from + PAGE_SIZE - 1);

    if (error) throw error;
    const page = (data ?? []) as SelectionRow[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }

  return rows;
}

/** Baris `odds_movement_history` untuk satu fixture, dinormalkan. */
async function loadSnapshots(
  supabase: SupabaseClient,
  fixtureId: string,
): Promise<OddsSnapshotRow[]> {
  const { data, error } = await supabase
    .from("odds_movement_history")
    .select(
      "bookmaker, market_type, captured_at, home_odds, away_odds, draw_odds, over_odds, under_odds, btts_yes, btts_no",
    )
    .eq("fixture_id", fixtureId)
    .order("captured_at", { ascending: true });

  if (error) throw error;

  return (data ?? []).map((row) => ({
    bookmaker: String(row.bookmaker ?? ""),
    marketType: String(row.market_type ?? ""),
    capturedAt: String(row.captured_at ?? ""),
    homeOdds: row.home_odds == null ? null : Number(row.home_odds),
    awayOdds: row.away_odds == null ? null : Number(row.away_odds),
    drawOdds: row.draw_odds == null ? null : Number(row.draw_odds),
    overOdds: row.over_odds == null ? null : Number(row.over_odds),
    underOdds: row.under_odds == null ? null : Number(row.under_odds),
    bttsYes: row.btts_yes == null ? null : Number(row.btts_yes),
    bttsNo: row.btts_no == null ? null : Number(row.btts_no),
  }));
}

/**
 * Satu putaran job. Aman dijalankan berulang: hanya baris dengan
 * `odds_close IS NULL` yang disentuh, jadi menjalankan dua kali tidak
 * menimpa harga penutup yang sudah benar.
 */
export async function runClosingOddsCapture(
  options: { now?: Date; supabase?: SupabaseClient } = {},
): Promise<ClosingCaptureSummary> {
  const supabase = options.supabase ?? defaultSupabase;
  const now = options.now ?? new Date();

  if (!supabase) {
    /* Kredensial hilang. Jangan lempar error: putaran terjadwal dengan
       lingkungan setengah jadi tidak boleh membanjiri log. */
    logger.warn("[CLOSING-ODDS] Supabase tidak tersedia — putaran dilewati");
    return { candidates: 0, fixturesUpdated: 0, rowsUpdated: 0, skipped: 0, outcomesFilled: 0, errors: [] };
  }
  const summary: ClosingCaptureSummary = {
    candidates: 0,
    fixturesUpdated: 0,
    rowsUpdated: 0,
    skipped: 0,
    outcomesFilled: 0,
    errors: [],
  };

  const selections = await loadOpenSelections(supabase, now);
  if (selections.length === 0) {
    logger.debug({ now: now.toISOString() }, "[CLOSING-ODDS] tidak ada selection terbuka");
    return summary;
  }

  /* Kelompokkan per fixture supaya snapshot diambil sekali per fixture. */
  const byFixture = new Map<string, SelectionRow[]>();
  for (const selection of selections) {
    const list = byFixture.get(selection.fixture_id);
    if (list) list.push(selection);
    else byFixture.set(selection.fixture_id, [selection]);
  }
  summary.candidates = byFixture.size;

  for (const [fixtureId, fixtureSelections] of byFixture) {
    try {
      const { data: fixtureRow, error: fixtureError } = await supabase
        .from("fixtures")
        .select("fixture_date")
        .eq("fixture_id", Number(fixtureId))
        .maybeSingle();
      if (fixtureError) throw fixtureError;
      if (!fixtureRow?.fixture_date) continue;

      const kickoff = new Date(String(fixtureRow.fixture_date));
      if (!Number.isFinite(kickoff.getTime())) continue;

      /* Jangan isi harga penutup bila masih jauh dari kick-off: snapshot
         terakhir saat ini bukan harga penutup, hanya harga sementara. */
      const minutesToKickoff = (kickoff.getTime() - now.getTime()) / 60000;
      if (minutesToKickoff > CLOSING_WINDOW_MINUTES) continue;
      if (minutesToKickoff < 0) continue;

      const snapshots = await loadSnapshots(supabase, fixtureId);
      if (snapshots.length === 0) continue;

      const marketKeys = fixtureSelections.map((s) => s.market_key);
      const { prices, skipped } = computeClosingPrices(marketKeys, snapshots, kickoff);
      summary.skipped += skipped.length;

      if (prices.size === 0) continue;

      let touchedFixture = false;
      for (const selection of fixtureSelections) {
        const price = prices.get(selection.market_key);
        if (!price) continue;

        const { error } = await supabase
          .from("prediction_selections")
          .update({
            odds_close: price.oddsClose,
            close_fair_prob: price.closeFairProb,
          })
          .eq("id", selection.id)
          .is("odds_close", null);

        if (error) {
          summary.errors.push(`${fixtureId}/${selection.market_key}: ${error.message}`);
          continue;
        }
        summary.rowsUpdated++;
        touchedFixture = true;
      }
      if (touchedFixture) summary.fixturesUpdated++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      summary.errors.push(`${fixtureId}: ${message}`);
      logger.warn({ err, fixtureId }, "[CLOSING-ODDS] gagal memproses fixture");
    }
  }

  logger.info(
    {
      candidates: summary.candidates,
      fixturesUpdated: summary.fixturesUpdated,
      rowsUpdated: summary.rowsUpdated,
      skipped: summary.skipped,
      errors: summary.errors.length,
    },
    "[CLOSING-ODDS] putaran selesai",
  );

  return summary;
}

/**
 * Isi `outcome` untuk selection yang pertandingannya sudah selesai.
 *
 * Dipisah dari penulisan `odds_close` karena keduanya terjadi pada waktu yang
 * berbeda: harga penutup diambil sebelum kick-off, hasil baru diketahui
 * sesudahnya. Menjalankannya di job yang sama berarti satu jadwal cron
 * menutup kedua sisi ledger.
 */
export async function runOutcomeSettlement(
  options: { supabase?: SupabaseClient; limit?: number } = {},
): Promise<{ fixturesChecked: number; outcomesFilled: number; errors: string[] }> {
  const supabase = options.supabase ?? defaultSupabase;
  const errors: string[] = [];
  const limit = options.limit ?? 200;

  if (!supabase) return { fixturesChecked: 0, outcomesFilled: 0, errors };

  /* Hanya baris yang belum punya hasil; menjalankan berulang aman. */
  const { data: openRows, error: openError } = await supabase
    .from("prediction_selections")
    .select("id, fixture_id, market_key")
    .is("outcome", null)
    .limit(limit);

  if (openError) {
    errors.push(`baca selection: ${openError.message}`);
    return { fixturesChecked: 0, outcomesFilled: 0, errors };
  }
  if (!openRows || openRows.length === 0) {
    return { fixturesChecked: 0, outcomesFilled: 0, errors };
  }

  const byFixture = new Map<string, Array<{ id: number; market_key: string }>>();
  for (const row of openRows as Array<{ id: number; fixture_id: string; market_key: string }>) {
    const list = byFixture.get(row.fixture_id);
    const entry = { id: row.id, market_key: row.market_key };
    if (list) list.push(entry);
    else byFixture.set(row.fixture_id, [entry]);
  }

  let outcomesFilled = 0;
  let fixturesChecked = 0;

  for (const [fixtureId, selections] of byFixture) {
    /* Skor dikirim sebagai string oleh sebagian penyedia; Number() menormalkan
       keduanya dan menghasilkan NaN untuk nilai kosong — yang ditolak modul
       penilai, bukan ditebak menjadi 0-0. */
    const { data: fixtureRow, error: fixtureError } = await supabase
      .from("fixtures")
      .select("home_goals, away_goals, home_goals_ht, away_goals_ht, status_short")
      .eq("fixture_id", Number(fixtureId))
      .maybeSingle();

    if (fixtureError) {
      errors.push(`${fixtureId}: ${fixtureError.message}`);
      continue;
    }
    if (!fixtureRow) continue;
    if (fixtureRow.home_goals == null || fixtureRow.away_goals == null) continue;

    fixturesChecked++;

    const outcomes = outcomeMapForFixture(
      selections.map((s) => s.market_key),
      {
        home: Number(fixtureRow.home_goals),
        away: Number(fixtureRow.away_goals),
        homeHT: fixtureRow.home_goals_ht == null ? null : Number(fixtureRow.home_goals_ht),
        awayHT: fixtureRow.away_goals_ht == null ? null : Number(fixtureRow.away_goals_ht),
      },
    );

    for (const selection of selections) {
      const outcome = outcomes.get(selection.market_key);
      if (!outcome) continue;

      const { error } = await supabase
        .from("prediction_selections")
        .update({ outcome })
        .eq("id", selection.id)
        .is("outcome", null);

      if (error) {
        errors.push(`${fixtureId}/${selection.market_key}: ${error.message}`);
        continue;
      }
      outcomesFilled++;
    }
  }

  if (outcomesFilled > 0) {
    logger.info({ fixturesChecked, outcomesFilled }, "[CLOSING-ODDS] outcome terisi");
  }

  return { fixturesChecked, outcomesFilled, errors };
}
