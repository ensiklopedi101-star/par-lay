/**
 * Permintaan HTTP dengan batas waktu.
 *
 * ─── Kenapa ini wajib ─────────────────────────────────────────────────────
 * `fetch()` di Node **tidak punya timeout bawaan**. Satu koneksi ke Odds-API
 * yang menggantung dapat menahan satu event selama berjam-jam. Anggaran waktu
 * sync (45 detik) hanya diperiksa *di antara* panggilan, jadi ia tidak bisa
 * menyelamatkan proses yang sedang menunggu `await fetch()`.
 *
 * Bukti produksi (run 568): satu event memakan **9 menit 12 detik**
 * (mulai 11:28:47, statistik liga pertama tertulis 11:37:59) dan hanya
 * 1 dari 3 event yang berhasil disimpan sebelum fungsi dibekukan. Tanpa
 * timeout, "batas 45 detik" hanyalah niat, bukan jaminan.
 *
 * Dengan timeout, satu panggilan buruk gagal cepat, dihitung sebagai error,
 * dan sisa event tetap diproses pada siklus berikutnya.
 */

/** Batas waktu default satu permintaan HTTP ke penyedia data. */
export const DEFAULT_HTTP_TIMEOUT_MS = 20_000;

/** Batas bawah/atas yang masuk akal; nilai di luar ini diabaikan. */
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 60_000;

/**
 * Membaca timeout dari env (`ODDS_API_TIMEOUT_MS`).
 * Nilai rusak/kosong jatuh ke default, bukan ke "tanpa batas".
 */
export function resolveRequestTimeoutMs(
  raw: unknown,
  fallback: number = DEFAULT_HTTP_TIMEOUT_MS,
): number {
  const parsed =
    typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : Number.NaN;
  if (!Number.isFinite(parsed) || parsed < MIN_TIMEOUT_MS || parsed > MAX_TIMEOUT_MS) {
    return fallback;
  }
  return Math.floor(parsed);
}

export class HttpTimeoutError extends Error {
  constructor(public readonly timeoutMs: number) {
    super(
      `Permintaan HTTP melebihi ${Math.round(timeoutMs / 1000)} detik — dihentikan agar sync tidak menggantung.`,
    );
    this.name = "HttpTimeoutError";
  }
}

export async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs: number = DEFAULT_HTTP_TIMEOUT_MS,
): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    const name = (err as { name?: string } | null)?.name;
    if (name === "TimeoutError" || name === "AbortError") {
      throw new HttpTimeoutError(timeoutMs);
    }
    throw err;
  }
}
