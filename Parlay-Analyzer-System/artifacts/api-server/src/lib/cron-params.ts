/**
 * Parameter kuantitatif untuk endpoint cron.
 *
 * Kuota Odds-API free plan adalah **100 permintaan per jam** dan satu event
 * membutuhkan satu permintaan odds. Tanpa batas per liga, tujuh liga yang
 * dijalankan paralel (matriks GitHub Actions) bisa meminta ratusan odds
 * sekaligus, lalu sebagian besar ditolak 429 dan tercatat sebagai error.
 *
 * Karena itu pemanggil boleh meminta batas yang lebih kecil lewat `?max=`,
 * tetapi tidak boleh melebihi plafon internal.
 */

/** Plafon keras: nilai `?max=` di atas ini dipotong ke sini. */
export const MAX_EVENTS_PER_LEAGUE_CALL = 40;

/**
 * Mengubah `?max=` menjadi jumlah event yang aman.
 *
 * `undefined` dikembalikan bila parameter tidak ada/rusak, supaya pemanggil
 * memakai default internalnya (bukan 0 yang berarti "tidak ada yang disinkron").
 */
export function parseMaxEvents(raw: unknown): number | undefined {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string" || value.trim() === "") return undefined;

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 1) {
    return undefined;
  }

  return Math.min(parsed, MAX_EVENTS_PER_LEAGUE_CALL);
}
