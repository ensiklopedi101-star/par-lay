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