/**
 * Loader seleksi ledger untuk laga yang BELUM kick-off — satu-satunya
 * sumber bahan komposisi tiket (panel, Telegram, pencatat tiket).
 *
 * Mengapa filter waktu ditegakkan di query, bukan sesudahnya: loader
 * lama mengambil 1000 baris ledger ber-EV tertinggi lalu membuang yang
 * sudah kick-off di memori. Dua kegagalan lahir dari pola itu —
 * (1) tiket tercemar look-ahead (laga selesai ikut tersusun, 23 Nov
 * 2026) dan (2) baris laga mendatang bisa tergusur keluar dari limit
 * 1000 oleh baris lama ber-EV tinggi, sehingga kolam tampak kosong
 * padahal analisisnya ada. Di sini jendela waktu adalah bagian dari
 * query: fixture mendatang dulu, baru seleksinya.
 *
 * Pagar kedua tetap hidup di `candidatesFromSelectionRows`
 * (isFixtureComposable) sebagai pertahanan berlapis.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  FINISHED_FIXTURE_STATUSES,
  type FixtureMeta,
  type SelectionRow,
} from "./parlay-candidates";

export interface UpcomingSelectionLoad {
  rows: SelectionRow[];
  meta: Map<number, FixtureMeta>;
  /** Jumlah fixture mendatang dalam horizon yang punya seleksi. */
  fixtureCount: number;
}

const DEFAULT_HORIZON_DAYS = 7;
const DEFAULT_LIMIT = 1000;
const MAX_FIXTURES = 500;

export async function loadUpcomingSelectionRows(
  supabase: SupabaseClient,
  options: { now?: Date; horizonDays?: number; limit?: number } = {},
): Promise<UpcomingSelectionLoad> {
  const now = options.now ?? new Date();
  const horizonDays = options.horizonDays ?? DEFAULT_HORIZON_DAYS;
  const limit = options.limit ?? DEFAULT_LIMIT;
  const horizon = new Date(now.getTime() + horizonDays * 24 * 60 * 60 * 1000);

  const { data: fixtures, error: fixtureError } = await supabase
    .from("fixtures")
    .select("fixture_id, league_name, fixture_date, home_team_name, away_team_name, status_short")
    .gt("fixture_date", now.toISOString())
    .lte("fixture_date", horizon.toISOString())
    .order("fixture_date", { ascending: true })
    .limit(MAX_FIXTURES);
  if (fixtureError) throw new Error(`Gagal membaca fixtures mendatang: ${fixtureError.message}`);

  const meta = new Map<number, FixtureMeta>();
  for (const f of (fixtures ?? []) as Array<{
    fixture_id: number;
    league_name: string | null;
    fixture_date: string | null;
    home_team_name: string | null;
    away_team_name: string | null;
    status_short: string | null;
  }>) {
    if (FINISHED_FIXTURE_STATUSES.has((f.status_short ?? "").toUpperCase())) continue;
    const fixtureId = Number(f.fixture_id);
    meta.set(fixtureId, {
      fixtureId,
      league: f.league_name ?? "unknown",
      date: f.fixture_date ? f.fixture_date.slice(0, 10) : null,
      homeTeam: f.home_team_name ?? null,
      awayTeam: f.away_team_name ?? null,
      kickoffAt: f.fixture_date ?? null,
      statusShort: f.status_short ?? null,
    });
  }
  if (meta.size === 0) return { rows: [], meta, fixtureCount: 0 };

  const { data: rows, error } = await supabase
    .from("prediction_selections")
    .select("fixture_id, market_key, family, line, odds, p_final, p_market_fair, p_model_only, ev, ev_conservative, bookmaker")
    .in("fixture_id", [...meta.keys()].map(String))
    .order("ev_conservative", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Gagal membaca ledger seleksi: ${error.message}`);

  return {
    rows: (rows ?? []) as SelectionRow[],
    meta,
    fixtureCount: meta.size,
  };
}
