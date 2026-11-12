import { supabase } from "../lib/supabase-client";
import { logger } from "../lib/logger";

/**
 * Penutup run sync yang menggantung.
 *
 * ─── Kenapa ini perlu ─────────────────────────────────────────────────────
 * `sync_runs` ditutup di blok `finally` milik `fetchAndSaveAllLeagues()`.
 * Itu benar untuk proses panjang (Replit/VPS), tetapi **tidak cukup di
 * serverless**: Vercel membekukan/mematikan instance kapan saja setelah
 * respons dikirim (dan memotong fungsi di `maxDuration`). Bila instance mati
 * di tengah `await`, blok `finally` tidak pernah dijalankan dan baris
 * `sync_runs` tertinggal `running` — panel lalu menampilkan "Berjalan"
 * selamanya, seolah sync masih bekerja.
 *
 * Bukti di produksi: run **568** (2026-11-12 11:28:47 UTC) berstatus `running`
 * dengan `events_fetched = 0` lebih dari 8 menit, padahal fungsi Vercel
 * dibatasi 60 detik. Run itu dibuat oleh jalur "fire-and-forget"
 * (`?action=sync` tanpa `league`) yang menjawab HTTP lebih dulu lalu
 * melanjutkan pekerjaan di latar belakang.
 *
 * Karena `finally` tidak bisa diandalkan, kebenaran status harus ditegakkan
 * dari luar: run yang sudah lebih tua dari ambang **ditutup sebagai `failed`**.
 * Status `failed` adalah kebenaran — pekerjaannya memang tidak selesai.
 */

/**
 * Ambang run dianggap mati. Sync normal selesai < 2 menit (batas fungsi
 * Vercel 60 detik), jadi 10 menit jauh di atas batas itu dan tidak mungkin
 * menutup proses yang benar-benar masih berjalan.
 */
export const STALE_SYNC_RUN_SECONDS = 10 * 60;

export const STALE_RUN_CLOSE_MESSAGE =
  "Ditutup otomatis: proses sync berhenti sebelum selesai (fungsi serverless " +
  "dipotong/dibekukan), jadi tidak ada hasil yang bisa dilaporkan. Bukan " +
  "tanda sync masih berjalan.";

function normalizeMaxAgeSeconds(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : STALE_SYNC_RUN_SECONDS;
}

/** Batas waktu (ISO) sebelum mana sebuah run dianggap mati. */
export function staleSyncRunCutoffIso(
  now: Date = new Date(),
  maxAgeSeconds: number = STALE_SYNC_RUN_SECONDS,
): string {
  return new Date(now.getTime() - normalizeMaxAgeSeconds(maxAgeSeconds) * 1000).toISOString();
}

/** Apakah run yang mulai pada `startedAt` sudah melewati ambang basi. */
export function isSyncRunStale(
  startedAt: string,
  now: Date = new Date(),
  maxAgeSeconds: number = STALE_SYNC_RUN_SECONDS,
): boolean {
  const started = new Date(startedAt).getTime();
  if (!Number.isFinite(started)) return false;
  return now.getTime() - started > normalizeMaxAgeSeconds(maxAgeSeconds) * 1000;
}

export interface CloseStaleSyncRunsResult {
  /** Jumlah baris yang ditutup pada pemanggilan ini. */
  closed: number;
  /** Id baris yang ditutup (untuk log/audit). */
  ids: number[];
  /** Batas waktu yang dipakai; run lebih tua dari ini yang ditutup. */
  cutoff: string;
}

/**
 * Menutup semua `sync_runs` berstatus `running` yang sudah basi.
 *
 * Aman dipanggil sesering apa pun:
 *  - hanya menyentuh baris `running` yang lebih tua dari ambang,
 *  - idempoten (pemanggilan kedua menutup 0 baris),
 *  - tidak pernah melempar error; kegagalan hanya dicatat di log supaya
 *    endpoint cron yang memanggilnya tetap bisa menjawab.
 */
export async function closeStaleSyncRuns(
  options: { now?: Date; maxAgeSeconds?: number } = {},
): Promise<CloseStaleSyncRunsResult> {
  const now = options.now ?? new Date();
  const cutoff = staleSyncRunCutoffIso(now, options.maxAgeSeconds);

  if (!supabase) {
    return { closed: 0, ids: [], cutoff };
  }

  try {
    const { data, error } = await supabase
      .from("sync_runs")
      .update({
        status: "failed",
        finished_at: now.toISOString(),
        error_message: STALE_RUN_CLOSE_MESSAGE,
      })
      .eq("status", "running")
      .lt("started_at", cutoff)
      .select("id");

    if (error) throw error;

    const ids = (data ?? [])
      .map((row: { id?: unknown }) => Number(row.id))
      .filter((id: number) => Number.isFinite(id));

    if (ids.length > 0) {
      logger.warn({ ids, cutoff }, "sync_runs: run basi ditutup otomatis sebagai failed");
    }

    return { closed: ids.length, ids, cutoff };
  } catch (err) {
    logger.warn({ err, cutoff }, "sync_runs: gagal menutup run basi");
    return { closed: 0, ids: [], cutoff };
  }
}
