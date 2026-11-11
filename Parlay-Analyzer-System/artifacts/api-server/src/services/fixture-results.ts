/**
 * Penarik skor akhir untuk fixture yang sudah lewat.
 *
 * Mengapa ini modul terpisah
 * --------------------------
 * `refreshFixtureResultsForSettlement()` di `odds-fetcher.ts` sudah benar dan
 * sudah terbukti menulis `status_short` + `home_goals` + `away_goals` dari
 * Odds-API. Masalahnya bukan kode itu — melainkan **tidak ada yang
 * memanggilnya secara terjadwal**.
 *
 * Ia hanya dipanggil dari `runSettlement()`, dan `runSettlement()` dijadwalkan
 * oleh `node-cron` di `scheduler/index.ts`. Scheduler itu mati di Vercel:
 * `index.ts` melewati `startScheduler()` ketika `PORT` tidak diset, dan fungsi
 * serverless memang tidak menyetelnya. Jadi rantainya putus tanpa suara.
 *
 * Modul ini memberi satu titik masuk yang murah dan aman untuk cron:
 * ambil fixture lewat yang belum punya skor, lalu minta hasilnya ke penyedia.
 * Tanpa AI, tanpa evaluasi prediksi — hanya mengisi skor.
 *
 * Kenapa dipisah dari `runSettlement()`
 * -------------------------------------
 * `runSettlement()` memanggil Gemini untuk menulis "pelajaran" dari
 * kegagalan yang terverifikasi. Itu mahal dan lambat, dan **tidak dibutuhkan
 * hanya untuk mengisi skor**. Vercel Hobby memutus fungsi di 60 detik;
 * mencampur keduanya membuat penarikan skor ikut gagal karena hal yang tidak
 * ada hubungannya.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase as defaultSupabase } from "../lib/supabase-client";
import { logger } from "../lib/logger";
import { refreshFixtureResultsForSettlement } from "./odds-fetcher";

/**
 * Odds-API membatasi kueri historis pada rentang 31 hari. Fixture yang lebih
 * tua dari ini tidak bisa ditarik lagi lewat jalur normal — dicatat sebagai
 * "terlalu tua", bukan diam-diam dilewati.
 */
export const HISTORICAL_WINDOW_DAYS = 31;

/**
 * Batas jumlah fixture per putaran.
 *
 * Setiap liga memicu satu panggilan jaringan; mengelompokkan 400 fixture ke
 * 7 liga tetap hanya 7 panggilan, tetapi penyimpanan per fixture adalah satu
 * `UPDATE`. 120 cukup untuk menyusul beberapa hari sekaligus tanpa mendekati
 * batas 60 detik fungsi.
 */
export const MAX_FIXTURES_PER_RUN = 120;

export interface FixtureResultsSummary {
  /** Fixture lewat tanpa skor, dalam jendela historis, yang akan dicoba. */
  candidates: number;
  /** Fixture yang skornya berhasil ditulis pada putaran ini. */
  refreshed: number;
  /** Fixture yang tidak ditemukan di feed penyedia. */
  notFound: number;
  /** Fixture yang ditemukan tetapi statusnya belum final / skor belum lengkap. */
  skipped: number;
  /** Fixture lewat tanpa skor yang **di luar** jendela 31 hari — tidak bisa ditarik. */
  tooOld: number;
  /** Total fixture lewat yang masih menunggu skor setelah putaran ini. */
  stillAwaitingScore: number;
  errors: number;
  /** Alasan jujur bila tidak ada yang bisa dikerjakan. */
  notes: string[];
  generatedAt: string;
}

/**
 * Ambil fixture lewat yang belum punya skor dan minta hasilnya ke penyedia.
 *
 * Aman dijalankan berulang: fixture yang sudah punya skor tidak pernah
 * diambil lagi, sehingga putaran berikutnya hanya mengerjakan sisa.
 */
export async function refreshElapsedFixtureResults(
  options: {
    supabase?: SupabaseClient;
    limit?: number;
    now?: Date;
    /** Untuk pengujian: ganti pemanggil Odds-API. */
    refresh?: (fixtureIds: number[]) => Promise<{
      refreshed: number;
      notFound: number;
      skipped: number;
      errors: number;
      refreshedFixtureIds?: number[];
    }>;
  } = {},
): Promise<FixtureResultsSummary> {
  const client = options.supabase ?? defaultSupabase;
  const now = options.now ?? new Date();
  const limit = Math.min(options.limit ?? MAX_FIXTURES_PER_RUN, MAX_FIXTURES_PER_RUN);
  const notes: string[] = [];

  const empty: FixtureResultsSummary = {
    candidates: 0,
    refreshed: 0,
    notFound: 0,
    skipped: 0,
    tooOld: 0,
    stillAwaitingScore: 0,
    errors: 0,
    notes: [],
    generatedAt: now.toISOString(),
  };

  if (!client) {
    empty.notes.push("Supabase tidak tersedia — penarikan hasil dilewati.");
    return empty;
  }

  const nowIso = now.toISOString();
  const windowStart = new Date(
    now.getTime() - HISTORICAL_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  /* ─── Berapa banyak yang menunggu skor, dan berapa yang sudah di luar jendela ─── */
  try {
    const past = await client
      .from("fixtures")
      .select("*", { count: "exact", head: true })
      .lt("fixture_date", nowIso)
      .is("home_goals", null);
    const tooOld = await client
      .from("fixtures")
      .select("*", { count: "exact", head: true })
      .lt("fixture_date", windowStart)
      .is("home_goals", null);
    if (!past.error) empty.stillAwaitingScore = past.count ?? 0;
    if (!tooOld.error) empty.tooOld = tooOld.count ?? 0;
  } catch (err) {
    logger.debug({ err }, "[RESULTS] Gagal menghitung fixture tanpa skor");
  }

  /* ─── Kandidat: lewat, belum berskor, masih di dalam jendela historis ───
   * Diurutkan dari yang paling baru agar pertandingan terdekat — yang paling
   * relevan untuk settlement prediksi aktif — dikerjakan lebih dulu. */
  let fixtureIds: number[] = [];
  try {
    const { data, error } = await client
      .from("fixtures")
      .select("fixture_id, fixture_date")
      .lt("fixture_date", nowIso)
      .gte("fixture_date", windowStart)
      .is("home_goals", null)
      .order("fixture_date", { ascending: false })
      .limit(limit);
    if (error) {
      empty.notes.push(`Gagal membaca kandidat fixture: ${error.message}`);
      return empty;
    }
    fixtureIds = (data ?? [])
      .map((row: { fixture_id: number | string }) => Number(row.fixture_id))
      .filter((id: number) => Number.isInteger(id));
  } catch (err) {
    empty.notes.push(`Gagal membaca kandidat fixture: ${String(err)}`);
    return empty;
  }

  empty.candidates = fixtureIds.length;

  if (fixtureIds.length === 0) {
    if (empty.stillAwaitingScore > 0) {
      empty.notes.push(
        `${empty.stillAwaitingScore} fixture menunggu skor, tetapi semuanya lebih tua dari ` +
          `${HISTORICAL_WINDOW_DAYS} hari sehingga Odds-API tidak bisa lagi menyediakannya. ` +
          "Skor harus diisi manual.",
      );
    } else {
      empty.notes.push("Tidak ada fixture lewat yang menunggu skor — tidak ada yang perlu dikerjakan.");
    }
    return empty;
  }

  /* ─── Minta hasil ke penyedia ─── */
  const refreshFn =
    options.refresh ??
    ((ids: number[]) => refreshFixtureResultsForSettlement(ids) as Promise<any>);

  try {
    const result = await refreshFn(fixtureIds);
    empty.refreshed = result.refreshed ?? 0;
    empty.notFound = result.notFound ?? 0;
    empty.skipped = result.skipped ?? 0;
    empty.errors = result.errors ?? 0;
  } catch (err) {
    empty.errors = fixtureIds.length;
    empty.notes.push(`Penarikan hasil gagal: ${err instanceof Error ? err.message : String(err)}`);
    logger.error({ err }, "[RESULTS] Penarikan hasil fixture gagal");
    return empty;
  }

  /* ─── Hitung ulang sisa setelah putaran ini, supaya angkanya bisa dipercaya ─── */
  try {
    const past = await client
      .from("fixtures")
      .select("*", { count: "exact", head: true })
      .lt("fixture_date", nowIso)
      .is("home_goals", null);
    if (!past.error) empty.stillAwaitingScore = past.count ?? 0;
  } catch {
    /* Angka lama tetap dipakai; lebih baik sedikit basi daripada gagal total. */
  }

  if (empty.refreshed === 0 && empty.candidates > 0) {
    empty.notes.push(
      `${empty.candidates} fixture dicoba, tidak ada yang menghasilkan skor. ` +
        "Penyedia belum menerbitkan hasilnya, atau statusnya belum final. " +
        "Ini normal untuk pertandingan yang baru selesai — putaran berikutnya akan mencoba lagi.",
    );
  }
  empty.notes = [...notes, ...empty.notes];
  empty.notes.push(
    "Skor yang berhasil ditarik hanya disimpan bila status pertandingan sudah final " +
      "dan kedua skor tersedia — sistem tidak pernah mengarang hasil.",
  );

  return empty;
}
