import type { LeagueConfig } from "./odds-fetcher";

/**
 * Perencanaan sync di dalam cron harian Vercel.
 *
 * `vercel.json` membatasi fungsi ini pada **60 detik**. Rangkaian harian lama
 * menyapu tujuh liga satu per satu lebih dulu, lalu baru menjalankan
 * results/analyze/closing/outcomes. Tujuh liga tidak mungkin muat dalam 60
 * detik (satu liga 140 event sudah butuh puluhan detik), sehingga fungsi
 * dipotong **sebelum** langkah analisis AI — dan justru analisis itulah yang
 * mengisi `prediction_selections` (target Fase 1).
 *
 * Perbaikannya dua arah:
 *   1. langkah yang mahal nilainya (analisis) dijalankan lebih dulu;
 *   2. sync yang tersisa dibatasi ke sebagian liga saja per hari, bergiliran,
 *      dengan sisa anggaran waktu — bukan seluruh liga.
 *
 * Fungsi di file ini murni supaya rotasinya bisa diuji tanpa jaringan.
 */

/**
 * Memilih liga yang disinkronkan pada pemanggilan harian ini.
 *
 * Rotasi ditentukan oleh hari UTC, sehingga setiap liga mendapat giliran
 * tanpa perlu menyimpan state. `count` tidak pernah melebihi jumlah liga dan
 * hasilnya selalu unik.
 */
export function leaguesForDailySync(
  leagues: LeagueConfig[],
  now: Date = new Date(),
  count: number = 2,
): LeagueConfig[] {
  if (leagues.length === 0) return [];

  const wanted = Math.max(0, Math.min(Math.trunc(count) || 0, leagues.length));
  if (wanted === 0) return [];

  const dayIndex = Math.floor(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) / 86_400_000,
  );
  const start = ((dayIndex % leagues.length) + leagues.length) % leagues.length;

  return Array.from({ length: wanted }, (_, offset) => leagues[(start + offset) % leagues.length]!);
}

/** Sisa anggaran waktu, tidak pernah negatif. */
export function remainingMs(deadlineAt: number, now: number = Date.now()): number {
  return Math.max(0, deadlineAt - now);
}

/**
 * Anggaran untuk satu langkah: tidak pernah melebihi `maxMs` dan selalu
 * menyisakan `reserveMs` untuk langkah berikutnya.
 */
export function stepBudgetMs(
  deadlineAt: number,
  maxMs: number,
  reserveMs: number,
  now: number = Date.now(),
): number {
  return Math.max(0, Math.min(maxMs, remainingMs(deadlineAt, now) - reserveMs));
}
