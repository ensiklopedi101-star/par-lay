/**
 * Runtime helpers for reading odds_history safely.
 *
 * odds_history contains legacy snapshots as well as the latest sync result.
 * Market movement history must remain append-only, so callers that need the
 * current price should collapse only the runtime result set — never delete
 * historical rows. The identity includes match_id so a broad fallback query
 * can never collapse markets from different provider events together.
 */

export interface OddsSnapshotIdentity {
  match_id?: string | number | null;
  bookmaker?: string | null;
  market_type?: string | null;
  captured_at?: string | null;
}

function snapshotKey(row: OddsSnapshotIdentity): string {
  return [
    String(row.match_id ?? "").trim(),
    String(row.bookmaker ?? "").trim().toLowerCase(),
    String(row.market_type ?? "").trim().toLowerCase(),
  ].join("::");
}

function capturedTime(value: string | null | undefined): number {
  if (!value) return Number.NEGATIVE_INFINITY;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : Number.NEGATIVE_INFINITY;
}

/**
 * Return the newest row for each match + bookmaker + market combination.
 *
 * The input order is not trusted because Supabase pagination and broad
 * fallback queries do not guarantee a complete ordering across all callers.
 */
export function latestOddsByMarket<T extends OddsSnapshotIdentity>(rows: T[]): T[] {
  const latest = new Map<string, T>();

  for (const row of rows) {
    const key = snapshotKey(row);
    const previous = latest.get(key);
    if (!previous || capturedTime(row.captured_at) > capturedTime(previous.captured_at)) {
      latest.set(key, row);
    }
  }

  return [...latest.values()].sort(
    (a, b) => capturedTime(b.captured_at) - capturedTime(a.captured_at),
  );
}

export const SUPABASE_PAGE_SIZE = 1000;

/**
 * Ambil SEMUA baris dari query PostgREST lewat paginasi `.range()`.
 *
 * PostgREST memotong respons di 1000 baris (max-rows), diam-diam. Query
 * batch tanpa `.range()` karena itu hanya pernah melihat 1000 baris
 * pertama — pada scan 13 Nov 2026 (161 fixture, puluhan ribu baris
 * odds_history) 1000 baris pertama hanya mencakup 23 match, sehingga
 * 137 fixture dinyatakan "menunggu odds" padahal snapshot segarnya ada.
 * `fetchPage` menerima rentang [from, to] inklusif dan wajib mengurutkan
 * hasilnya secara stabil supaya halaman tidak tumpang tindih.
 */
export async function collectPagedRows<T>(
  fetchPage: (
    from: number,
    to: number,
  ) => Promise<{ data: T[] | null; error: unknown }>,
  pageSize: number = SUPABASE_PAGE_SIZE,
  maxPages = 100,
): Promise<T[]> {
  const rows: T[] = [];
  for (let page = 0; page < maxPages; page++) {
    const from = page * pageSize;
    const { data, error } = await fetchPage(from, from + pageSize - 1);
    if (error) {
      throw error instanceof Error ? error : new Error(String(error));
    }
    const batch = data ?? [];
    rows.push(...batch);
    if (batch.length < pageSize) break;
  }
  return rows;
}