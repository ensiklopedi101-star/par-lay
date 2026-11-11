/**
 * Analisis AI yang sadar batas waktu — bisa dipanggil dari cron.
 *
 * Masalah yang diperbaiki
 * -----------------------
 * Batch scanner di `routes/analyze.ts` memakai `void runBatchJob(...)`: ia
 * menyelesaikan maksimal 20 fixture tanpa **satu pun** pemeriksaan waktu.
 * Di serverless Vercel, fungsi diputus keras pada 60 detik — sehingga:
 *
 *  1. Pekerjaan yang belum selesai hilang tanpa jejak (tidak ada error yang
 *     tercatat, tidak ada status yang ditulis).
 *  2. Jawaban HTTP 202 sudah terkirim sebelum pekerjaan berjalan, jadi klien
 *     tidak pernah tahu bahwa prosesnya mati di tengah jalan.
 *
 * Bukti dari basis data: maksimum **6 prediksi per hari**, semuanya dalam
 * rentang **4 menit**. Kalau scanner benar-benar menyelesaikan 20 fixture,
 * angkanya akan jauh lebih besar dan rentangnya lebih panjang. Yang terlihat
 * adalah eksekusi yang terpotong, berulang, selama berminggu-minggu — sampai
 * akhirnya berhenti sama sekali ketika fixture akan datang habis.
 *
 * Bedanya modul ini
 * -----------------
 * Modul ini mengerjakan **satu fixture per panggilan** dan memeriksa sisa
 * waktu sebelum setiap langkah. Ia berhenti dengan rapi, bukan diputus:
 *
 *  - `deadline` absolut, bukan jumlah pekerjaan
 *  - setiap fixture selesai ditulis ke DB sebelum lanjut (tidak ada yang hilang)
 *  - sisa pekerjaan dilaporkan jujur, bukan disembunyikan di balik 202
 *
 * Efek sampingnya: pemanggil (cron harian) bisa menggilir beberapa fixture per
 * hari tanpa risiko kena 504, dan setiap putaran meninggalkan jejak yang bisa
 * diperiksa.
 */

import { supabase } from "../lib/supabase-client";
import { logger } from "../lib/logger";

/**
 * Batas anggaran waktu bawaan.
 *
 * Fungsi Vercel Hobby diputus pada 60 detik. Menyisakan 20 detik untuk
 * penyimpanan, penutupan respons, dan jaringan adalah pilihan sadar: lebih
 * baik berhenti sendiri pada detik ke-38 daripada diputus pada detik ke-60
 * ketika penulisan sedang berjalan.
 */
export const DEFAULT_BUDGET_MS = 38_000;

/**
 * Satu fixture bisa memakan 5–20 detik (satu panggilan model bahasa ditambah
 * pengambilan statistik tim). Angka ini dipakai untuk memutuskan apakah masih
 * cukup waktu SEBELUM memulai, bukan untuk memotong di tengah jalan.
 */
export const ESTIMATED_MS_PER_FIXTURE = 15_000;

export interface AutoAnalysisSummary {
  /** Fixture yang diperiksa sebagai kandidat. */
  candidates: number;
  /** Fixture yang berhasil dianalisis dan tersimpan pada putaran ini. */
  analysed: number;
  /** Fixture yang dilewati karena anggaran waktu habis. */
  skippedForTime: number;
  /** Fixture yang gagal dianalisis (bukan soal waktu). */
  failed: number;
  /** Fixture yang masih belum dianalisis setelah putaran ini. */
  remaining: number;
  /** Milidetik yang terpakai. */
  elapsedMs: number;
  /** `true` bila berhenti karena anggaran waktu, bukan karena selesai. */
  stoppedByBudget: boolean;
  notes: string[];
  generatedAt: string;
}

export interface AutoAnalysisOptions {
  /** Anggaran waktu total untuk putaran ini. */
  budgetMs?: number;
  /** Batas jumlah fixture per putaran. */
  limit?: number;
  /**
   * Perkiraan waktu per fixture. Bisa diatur agar aturan anggaran dapat diuji
   * tanpa benar-benar menunggu 15 detik per kasus — dan agar angka 15 detik
   * itu bisa disesuaikan tanpa menyentuh logika berhentinya.
   */
  estimatedMsPerFixture?: number;
  /** Untuk pengujian: ganti jam. */
  now?: Date;
  /** Untuk pengujian: ganti fungsi analisis. */
  analyse?: (fixtureId: string) => Promise<unknown>;
  /** Untuk pengujian: ganti klien database. */
  client?: typeof supabase;
}

/** Fixture yang akan datang dalam jendela pemindaian. */
interface UpcomingFixture {
  fixture_id: number;
  home_team_name: string | null;
  away_team_name: string | null;
  league_name: string | null;
  fixture_date: string;
}

/**
 * Pilih fixture yang layak dianalisis sekarang.
 *
 * Kriteria "layak" sengaja ketat, dan setiap penolakan punya sebab:
 *  - belum ada prediksi dengan market terpilih (yang sudah dianalisis tidak
 *    diulang; itu pemborosan kuota model bahasa)
 *  - kick-off masih di depan
 *  - punya harga pasar (tanpa harga, engine tidak bisa menilai apa pun)
 */
export async function findFixturesAwaitingAnalysis(options: {
  client?: typeof supabase;
  now?: Date;
  scanDays?: number;
  limit?: number;
} = {}): Promise<{ fixtures: UpcomingFixture[]; withOdds: number; withoutOdds: number }> {
  const client = options.client ?? supabase;
  const now = options.now ?? new Date();
  const scanDays = options.scanDays ?? 10;
  const limit = options.limit ?? 20;

  if (!client) return { fixtures: [], withOdds: 0, withoutOdds: 0 };

  const horizon = new Date(now.getTime() + scanDays * 24 * 60 * 60 * 1000).toISOString();
  const { data: upcoming, error } = await client
    .from("fixtures")
    .select("fixture_id, home_team_name, away_team_name, league_name, fixture_date")
    .gt("fixture_date", now.toISOString())
    .lte("fixture_date", horizon)
    .order("fixture_date", { ascending: true })
    .limit(500);

  if (error) {
    logger.warn({ error }, "[AUTO-ANALYSIS] Gagal membaca fixture akan datang");
    return { fixtures: [], withOdds: 0, withoutOdds: 0 };
  }

  const rows = (upcoming ?? []) as UpcomingFixture[];
  if (rows.length === 0) return { fixtures: [], withOdds: 0, withoutOdds: 0 };

  const ids = rows.map((f) => f.fixture_id);

  /* Prediksi yang sudah punya market terpilih tidak diulang. Baris NO BET
   * tanpa market tetap layak — bisa jadi harga baru sudah tersedia. */
  const { data: existing } = await client
    .from("ai_predictions")
    .select("fixture_id, status, market_bet, best_market, best_odds")
    .in("fixture_id", ids);

  const done = new Set(
    (existing ?? [])
      .filter((row: {
        status?: unknown;
        market_bet?: unknown;
        best_market?: unknown;
        best_odds?: unknown;
      }) => {
        const market = String(row.market_bet ?? row.best_market ?? "").trim().toLowerCase();
        const odds = Number(row.best_odds);
        return Boolean(
          market &&
            market !== "no_bet" &&
            market !== "no bet" &&
            Number.isFinite(odds) &&
            odds > 1 &&
            String(row.status ?? "active").toLowerCase() !== "no_bet",
        );
      })
      .map((row: { fixture_id: number }) => Number(row.fixture_id)),
  );

  /* Fixture tanpa harga di `odds_history` tidak bisa dinilai engine. Melewati
   * mereka menghemat kuota model bahasa — dan mencegah NO BET palsu yang
   * lahir dari data kosong, bukan dari analisis. */
  const { data: oddsRows } = await client
    .from("odds_history")
    .select("match_id")
    .in("match_id", ids.map((id) => String(id)))
    .limit(2000);

  const withOddsSet = new Set(
    (oddsRows ?? []).map((row: { match_id: string | number }) => Number(row.match_id)),
  );

  const pending = rows.filter((f) => !done.has(Number(f.fixture_id)));
  const priced = pending.filter((f) => withOddsSet.has(Number(f.fixture_id)));

  return {
    fixtures: priced.slice(0, limit),
    withOdds: priced.length,
    withoutOdds: pending.length - priced.length,
  };
}

/**
 * Jalankan analisis untuk beberapa fixture dengan anggaran waktu.
 *
 * Berhenti sendiri sebelum batas, dan melaporkan sisa pekerjaan.
 */
export async function runAutoAnalysis(
  options: AutoAnalysisOptions = {},
): Promise<AutoAnalysisSummary> {
  const startedAt = Date.now();
  const now = options.now ?? new Date();
  const budgetMs = options.budgetMs ?? DEFAULT_BUDGET_MS;
  const estimatedMsPerFixture = options.estimatedMsPerFixture ?? ESTIMATED_MS_PER_FIXTURE;
  const limit = options.limit ?? 20;
  const notes: string[] = [];

  const summary: AutoAnalysisSummary = {
    candidates: 0,
    analysed: 0,
    skippedForTime: 0,
    failed: 0,
    remaining: 0,
    elapsedMs: 0,
    stoppedByBudget: false,
    notes,
    generatedAt: now.toISOString(),
  };

  const { fixtures, withOdds, withoutOdds } = await findFixturesAwaitingAnalysis({
    client: options.client,
    now,
    limit,
  });

  summary.candidates = fixtures.length;
  summary.remaining = withOdds;

  if (withoutOdds > 0) {
    notes.push(
      `${withoutOdds} fixture akan datang belum punya harga di odds_history. ` +
        "Mereka tidak dianalisis — engine tidak bisa menilai tanpa harga, dan memaksanya " +
        "hanya menghasilkan NO BET palsu.",
    );
  }

  if (fixtures.length === 0) {
    notes.push(
      withOdds === 0
        ? "Tidak ada fixture akan datang yang menunggu analisis. Ini keadaan normal saat " +
          "liga jeda atau saat sync belum menambah jadwal baru."
        : "Semua fixture yang punya harga sudah dianalisis. Tidak ada yang perlu diulang.",
    );
    summary.elapsedMs = Date.now() - startedAt;
    return summary;
  }

  /* Analisis dimuat malas: modul ini berat (memuat prompt, kontrak model),
   * dan putaran yang tidak menemukan kandidat tidak perlu membayarnya. */
  const analyse =
    options.analyse ??
    (async (fixtureId: string) => {
      const { analyzeFixture } = await import("./ai-analysis");
      return analyzeFixture(fixtureId);
    });

  for (let index = 0; index < fixtures.length; index++) {
    /* Berhenti SEBELUM memulai fixture yang tidak akan selesai. Memotong di
     * tengah jalan berarti kehilangan hasil yang sebenarnya sudah dikerjakan
     * model — dan tetap tidak tersimpan. */
    const elapsed = Date.now() - startedAt;
    if (elapsed + estimatedMsPerFixture > budgetMs) {
      summary.stoppedByBudget = true;
      summary.skippedForTime = fixtures.length - index;
      notes.push(
        `Berhenti setelah ${index} fixture karena anggaran waktu ${Math.round(budgetMs / 1000)} detik ` +
          `habis. ${summary.skippedForTime} fixture ditunda ke putaran berikutnya — ` +
          "tidak hilang, hanya belum dikerjakan.",
      );
      break;
    }

    const fixture = fixtures[index]!;
    try {
      await analyse(String(fixture.fixture_id));
      summary.analysed++;
      logger.info(
        { fixtureId: fixture.fixture_id, index: index + 1, elapsedMs: Date.now() - startedAt },
        "[AUTO-ANALYSIS] Fixture selesai dianalisis",
      );
    } catch (err) {
      summary.failed++;
      logger.warn(
        { err, fixtureId: fixture.fixture_id },
        "[AUTO-ANALYSIS] Gagal menganalisis fixture, lanjut ke berikutnya",
      );
    }
  }

  summary.remaining = Math.max(0, withOdds - summary.analysed);
  summary.elapsedMs = Date.now() - startedAt;

  if (summary.failed > 0) {
    notes.push(
      `${summary.failed} fixture gagal dianalisis. Kegagalan satu fixture tidak menghentikan ` +
        "yang lain, dan fixture itu akan dicoba lagi pada putaran berikutnya.",
    );
  }
  if (!summary.stoppedByBudget && summary.analysed > 0) {
    notes.push(
      `Semua ${summary.analysed} fixture dalam anggaran waktu selesai dikerjakan. ` +
        "Hasilnya sudah tersimpan sebelum fungsi ditutup.",
    );
  }

  return summary;
}
