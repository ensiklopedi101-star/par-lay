/**
 * Konteks jadwal di jalur live: hari istirahat dan kepadatan laga
 * kedua tim untuk tiap kandidat tiket, dari tabel fixtures kita
 * sendiri. Hasilnya dinilai assessContext (murni) dan dipakai
 * komposer pasar-dulu untuk menurunkan leg rapuh.
 */
import { supabase } from "../lib/supabase-client";
import { assessContext, backedSideFromKey, type ContextRisk } from "../lib/quant/context-risk";
import { logger } from "../lib/logger";

interface FixtureRow {
  fixture_id: number;
  fixture_date: string | null;
  home_team_name: string | null;
  away_team_name: string | null;
}

export interface CandidateContextRequest {
  fixtureId: number;
  marketKey: string;
}

/** Kunci peta konteks: `${fixtureId}|${marketKey}`. */
export const contextKeyOf = (fixtureId: number, marketKey: string) => `${fixtureId}|${marketKey}`;

export async function computeContextForCandidates(
  requests: CandidateContextRequest[],
): Promise<Map<string, ContextRisk>> {
  const result = new Map<string, ContextRisk>();
  if (!supabase || requests.length === 0) return result;

  const fixtureIds = [...new Set(requests.map((r) => r.fixtureId))];
  const { data: legFixtures, error } = await supabase
    .from("fixtures")
    .select("fixture_id, fixture_date, home_team_name, away_team_name")
    .in("fixture_id", fixtureIds);
  if (error) {
    logger.warn({ error }, "[CONTEXT] gagal membaca fixtures leg");
    return result;
  }
  const legs = ((legFixtures ?? []) as FixtureRow[]).filter((f) => f.fixture_date);
  if (legs.length === 0) return result;

  const dates = legs.map((f) => new Date(f.fixture_date!).getTime());
  const windowStart = new Date(Math.min(...dates) - 28 * 86_400_000).toISOString();
  const windowEnd = new Date(Math.min(...dates)).toISOString();

  const { data: windowFixtures, error: windowError } = await supabase
    .from("fixtures")
    .select("fixture_id, fixture_date, home_team_name, away_team_name")
    .gte("fixture_date", windowStart)
    .lt("fixture_date", windowEnd)
    .limit(5000);
  if (windowError) {
    logger.warn({ error: windowError }, "[CONTEXT] gagal membaca jendela jadwal");
    return result;
  }
  const history = ((windowFixtures ?? []) as FixtureRow[]).filter((f) => f.fixture_date);

  const legById = new Map(legs.map((f) => [Number(f.fixture_id), f]));

  for (const request of requests) {
    const leg = legById.get(request.fixtureId);
    if (!leg) continue;
    const kickoff = new Date(leg.fixture_date!).getTime();
    const teamHistory = (team: string | null) => {
      if (!team) return { restDays: null as number | null, matches14: null as number | null };
      const previous = history
        .filter((f) => f.home_team_name === team || f.away_team_name === team)
        .map((f) => new Date(f.fixture_date!).getTime())
        .filter((t) => t < kickoff)
        .sort((a, b) => b - a);
      if (previous.length === 0) return { restDays: null, matches14: null };
      return {
        restDays: Math.floor((kickoff - previous[0]!) / 86_400_000),
        matches14: previous.filter((t) => kickoff - t <= 14 * 86_400_000).length,
      };
    };
    const home = teamHistory(leg.home_team_name);
    const away = teamHistory(leg.away_team_name);
    result.set(
      contextKeyOf(request.fixtureId, request.marketKey),
      assessContext({
        backed: backedSideFromKey(request.marketKey),
        homeRestDays: home.restDays,
        awayRestDays: away.restDays,
        homeMatches14: home.matches14,
        awayMatches14: away.matches14,
      }),
    );
  }
  return result;
}
