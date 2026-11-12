/**
 * Penjelasan rasio "tersimpan vs ditarik" pada `sync_runs`.
 *
 * Angka `140 ditarik / 1 tersimpan` terlihat seperti kegagalan total, padahal
 * biasanya bukan. Dua angka itu mengukur hal yang berbeda:
 *
 *   - `eventsFetched` = **seluruh** daftar event satu liga dari provider,
 *     termasuk pertandingan yang sudah lewat dan yang jauh di luar jendela;
 *   - `eventsInserted` = event yang benar-benar disimpan, yaitu yang akan
 *     datang, masuk `scan_days`, dan odds-nya belum segar (<6 jam).
 *
 * Rasio rendah karena itu normal saat liga jeda atau jadwal baru sedikit.
 * Yang membuatnya tidak normal adalah `errors > 0`, durasi melewati batas
 * fungsi, atau status `failed` — dan itu ditampilkan terpisah di panel.
 */

/** Di bawah proporsi ini, penyebabnya perlu dijelaskan. */
export const LOW_INSERT_RATIO = 0.5;

export function explainInsertRatio(
  fetched: number,
  inserted: number,
): string | null {
  if (!Number.isFinite(fetched) || fetched <= 0) return null;
  if (inserted >= fetched * LOW_INSERT_RATIO) return null;

  const opening =
    inserted === 0
      ? "Tidak ada event baru yang masuk jendela pemindaian."
      : `Hanya ${inserted} dari ${fetched} event yang disimpan.`;

  return (
    `${opening} Angka "Event ditarik" menghitung SELURUH daftar liga dari ` +
    "provider — termasuk pertandingan yang sudah lewat dan yang di luar " +
    "jendela scan_days. Yang disimpan hanya event akan datang yang belum " +
    "punya odds segar (<6 jam). Rasio rendah belum tentu kegagalan: periksa " +
    "kolom Error, Durasi, dan pesan terakhir."
  );
}
