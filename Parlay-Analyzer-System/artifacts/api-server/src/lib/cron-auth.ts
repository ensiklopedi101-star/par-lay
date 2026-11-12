/**
 * Otorisasi endpoint cron.
 *
 * Ada tiga pemicu yang memanggil `/api/cron` dan masing-masing membawa rahasia
 * dengan cara berbeda:
 *
 *  1. **Vercel Cron** — mengirim `Authorization: Bearer <CRON_SECRET>`
 *     otomatis. Ini satu-satunya header yang dikirim Vercel; tidak ada
 *     `x-cron-secret` dan tidak ada `?token=`.
 *  2. **GitHub Actions / cron-job.org** — memakai `?token=<CRON_SECRET>`.
 *  3. **Panggilan manual** — memakai header `x-cron-secret`.
 *
 * Versi sebelumnya hanya memeriksa (2) dan (3). Akibatnya cron harian Vercel
 * selalu dijawab **401** dan seluruh rantai otomatis (sync, results, analyze,
 * closing, outcomes) tidak pernah berjalan — tanpa satu pun baris error di
 * database, karena permintaan ditolak sebelum handler sempat bekerja.
 *
 * Fungsi ini murni supaya bisa diuji tanpa HTTP.
 */

export interface CronAuthInput {
  /** Nilai `CRON_SECRET` yang dikonfigurasi; kosong berarti cron dimatikan. */
  secret: string | undefined;
  /** Header `x-cron-secret` (string atau array dari Node). */
  headerSecret?: unknown;
  /** Header `authorization` yang dikirim Vercel Cron. */
  authorization?: unknown;
  /** Query `?token=...`. */
  queryToken?: unknown;
}

function firstString(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    const found = value.find((item) => typeof item === "string");
    return typeof found === "string" ? found : null;
  }
  return null;
}

/**
 * `Bearer <secret>` → `<secret>`. Skema dibandingkan tanpa peduli huruf besar
 * kecil, sesuai RFC 6750, tetapi nilai rahasianya tetap persis.
 */
export function bearerToken(authorization: string | null): string | null {
  if (!authorization) return null;
  const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
  return match?.[1]?.trim() ?? null;
}

export function isCronAuthorized(input: CronAuthInput): boolean {
  if (!input.secret) return false;

  if (firstString(input.headerSecret) === input.secret) return true;
  if (firstString(input.queryToken) === input.secret) return true;
  if (bearerToken(firstString(input.authorization)) === input.secret) return true;

  return false;
}
