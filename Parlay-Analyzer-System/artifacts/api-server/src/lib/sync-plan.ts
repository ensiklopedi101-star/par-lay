/**
 * Perencanaan sync: apa yang disimpan lebih dulu, dan berapa per permintaan.
 *
 * Dua masalah nyata yang diselesaikan di sini:
 *
 * 1. **Jadwal jauh ke depan tidak pernah tersimpan.** Fixture hanya ditulis
 *    sebagai efek samping `saveEventAndOdds`, dan loop-nya diurutkan dari
 *    kick-off terdekat lalu berhenti saat anggaran waktu habis. Akibatnya
 *    yang tersimpan hanya pertandingan 2–3 hari ke depan, padahal provider
 *    masih mengembalikan jadwal berminggu-minggu ke depan.
 *
 * 2. **Satu event = satu permintaan HTTP.** Odds-API menyediakan
 *    `/v3/odds/multi` untuk sampai 10 event sekaligus, sehingga 40 event
 *    cukup 4 permintaan, bukan 40.
 */

/** Batas aman `/v3/odds/multi` menurut dokumentasi penyedia. */
export const ODDS_MULTI_BATCH_SIZE = 10;

/**
 * Event yang baru saja mulai masih disimpan (skor/odds in-play), tetapi
 * pertandingan yang sudah lama selesai tidak perlu di-upsert ulang.
 */
export const SCHEDULE_GRACE_HOURS = 6;

/** Memecah daftar menjadi potongan berukuran tetap. */
export function chunkItems<T>(items: T[], size: number = ODDS_MULTI_BATCH_SIZE): T[][] {
  const width = Number.isFinite(size) && size > 0 ? Math.floor(size) : ODDS_MULTI_BATCH_SIZE;
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += width) {
    chunks.push(items.slice(i, i + width));
  }
  return chunks;
}

/** Apakah event ini masih layak disimpan sebagai baris `fixtures`. */
export function isScheduleCandidate(
  dateIso: string,
  now: Date = new Date(),
  graceHours: number = SCHEDULE_GRACE_HOURS,
): boolean {
  const kickoff = new Date(dateIso).getTime();
  if (!Number.isFinite(kickoff)) return false;
  const grace = Number.isFinite(graceHours) && graceHours >= 0 ? graceHours : SCHEDULE_GRACE_HOURS;
  return kickoff >= now.getTime() - grace * 60 * 60 * 1000;
}
