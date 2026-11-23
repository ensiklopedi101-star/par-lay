/**
 * Isi tim yang hilang dari `team_season_stats` dengan statistik turunan
 * dari hasil pertandingan yang sudah dimiliki sistem (Fase A blueprint):
 *
 *   musim berjalan  ← skor akhir `fixtures` untuk liga tsb
 *   musim baseline  ← `research_matches` (satu musim penuh sebelumnya)
 *
 * Hanya tim yang BELUM punya baris pada musim target yang ditulis; baris
 * FootyStats dari ekstensi selalu menang dan tidak pernah ditimpa skrip
 * ini (jalur merge ingest yang menanganinya). `stats_xg` adalah proxy
 * deterministik — lihat `src/lib/derived-team-stats.ts`.
 *
 * Penulisan memakai HTTP langsung ke PostgREST (pola yang sama dengan
 * ingest-research-matches.ts). Butuh SUPABASE_URL +
 * SUPABASE_SERVICE_ROLE_KEY.
 *
 * Pakai: npx tsx scripts/derive-missing-team-stats.ts \
 *   --league-slug germany-bundesliga --league-name Bundesliga \
 *   --season 2026-27 --baseline-from 2025-08-01 --baseline-to 2026-07-01 \
 *   --baseline-season 2025-26 [--dry-run]
 */
import {
  buildDerivedTeamStats,
  leagueGoalsAgainstAverage,
  type TeamMatchPerspective,
} from "../src/lib/derived-team-stats";
import { canonicalTeamName } from "../src/lib/team-name-cleaner";

function argValue(flag: string): string | null {
  const idx = process.argv.indexOf(flag);
  return idx >= 0 ? (process.argv[idx + 1] ?? null) : null;
}

interface RestConfig {
  baseUrl: string;
  serviceKey: string;
}

async function restGet<T>(cfg: RestConfig, path: string): Promise<T[]> {
  const response = await fetch(`${cfg.baseUrl}/rest/v1/${path}`, {
    headers: {
      apikey: cfg.serviceKey,
      Authorization: `Bearer ${cfg.serviceKey}`,
    },
  });
  if (!response.ok) throw new Error(`GET ${path} gagal: HTTP ${response.status}`);
  return (await response.json()) as T[];
}

async function restInsert(cfg: RestConfig, rows: Record<string, unknown>[]): Promise<void> {
  const response = await fetch(`${cfg.baseUrl}/rest/v1/team_season_stats`, {
    method: "POST",
    headers: {
      apikey: cfg.serviceKey,
      Authorization: `Bearer ${cfg.serviceKey}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify(rows),
  });
  if (!response.ok) {
    throw new Error(`Insert team_season_stats gagal: HTTP ${response.status} ${await response.text()}`);
  }
}

interface FixtureRow {
  home_team_name: string;
  away_team_name: string;
  home_goals: number;
  away_goals: number;
  fixture_date: string;
}

interface ResearchRow {
  home_team: string;
  away_team: string;
  ft_home: number;
  ft_away: number;
  match_date: string;
}

function toPerspectives(
  matches: Array<{ home: string; away: string; hg: number; ag: number; date: string }>,
  team: string,
): TeamMatchPerspective[] {
  return matches
    .filter((m) => m.home === team || m.away === team)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((m) => {
      const isHome = m.home === team;
      const gf = isHome ? m.hg : m.ag;
      const ga = isHome ? m.ag : m.hg;
      return {
        gf,
        ga,
        venue: isHome ? ("H" as const) : ("A" as const),
        result: gf > ga ? ("W" as const) : gf === ga ? ("D" as const) : ("L" as const),
      };
    });
}

function allPerspectives(
  matches: Array<{ home: string; away: string; hg: number; ag: number; date: string }>,
): TeamMatchPerspective[] {
  return matches.flatMap((m) => [
    { gf: m.hg, ga: m.ag, venue: "H" as const, result: (m.hg > m.ag ? "W" : m.hg === m.ag ? "D" : "L") as "W" | "D" | "L" },
    { gf: m.ag, ga: m.hg, venue: "A" as const, result: (m.ag > m.hg ? "W" : m.ag === m.hg ? "D" : "L") as "W" | "D" | "L" },
  ]);
}

async function main(): Promise<void> {
  const leagueSlug = argValue("--league-slug");
  const leagueName = argValue("--league-name");
  const season = argValue("--season");
  const baselineFrom = argValue("--baseline-from");
  const baselineTo = argValue("--baseline-to");
  const baselineSeason = argValue("--baseline-season");
  const dryRun = process.argv.includes("--dry-run");
  if (!leagueSlug || !leagueName || !season || !baselineFrom || !baselineTo || !baselineSeason) {
    throw new Error("Argumen wajib: --league-slug --league-name --season --baseline-from --baseline-to --baseline-season");
  }
  const baseUrl = process.env["SUPABASE_URL"];
  const serviceKey = process.env["SUPABASE_SERVICE_ROLE_KEY"];
  if (!baseUrl || !serviceKey) throw new Error("SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY wajib di-set");
  const cfg: RestConfig = { baseUrl: baseUrl.replace(/\/$/, ""), serviceKey };

  const existing = await restGet<{ team_name: string }>(
    cfg,
    `team_season_stats?league_slug=eq.${encodeURIComponent(leagueSlug)}&season=eq.${encodeURIComponent(season)}&select=team_name`,
  );
  const existingNames = new Set(existing.map((r) => r.team_name));

  const fixtures = await restGet<FixtureRow>(
    cfg,
    `fixtures?league_name=ilike.*${encodeURIComponent(leagueName)}*&home_goals=not.is.null&select=home_team_name,away_team_name,home_goals,away_goals,fixture_date&limit=2000`,
  );
  const currentMatches = fixtures.map((f) => ({
    home: f.home_team_name, away: f.away_team_name,
    hg: f.home_goals, ag: f.away_goals, date: f.fixture_date,
  }));
  const teams = new Set<string>();
  for (const m of currentMatches) { teams.add(m.home); teams.add(m.away); }
  const missing = [...teams].filter((t) => !existingNames.has(t));
  console.log(`Tim di fixtures: ${teams.size}, sudah punya statistik: ${existingNames.size}, hilang: ${missing.join(", ") || "-"}`);
  if (missing.length === 0) return;

  const research = await restGet<ResearchRow>(
    cfg,
    `research_matches?league_slug=eq.${encodeURIComponent(leagueSlug)}&match_date=gte.${baselineFrom}&match_date=lt.${baselineTo}&select=home_team,away_team,ft_home,ft_away,match_date&limit=5000`,
  );
  const baselineMatches = research.map((r) => ({
    home: r.home_team, away: r.away_team, hg: r.ft_home, ag: r.ft_away, date: r.match_date,
  }));

  const currentLeagueAvg = leagueGoalsAgainstAverage(allPerspectives(currentMatches));
  const baselineLeagueAvg = leagueGoalsAgainstAverage(allPerspectives(baselineMatches));

  const rows: Record<string, unknown>[] = [];
  for (const team of missing) {
    const canonical = canonicalTeamName(team, leagueSlug);
    const current = toPerspectives(currentMatches, team);
    const baseline = canonical === team
      ? toPerspectives(baselineMatches, team)
      : toPerspectives(baselineMatches, team).concat(toPerspectives(baselineMatches, canonical));
    const push = (seasonLabel: string, ms: TeamMatchPerspective[], avg: number) => {
      const blocks = buildDerivedTeamStats(ms, avg);
      if (Object.keys(blocks).length === 0) return;
      rows.push({
        league_slug: leagueSlug,
        season: seasonLabel,
        team_name: canonical,
        team_key: canonical.toLowerCase(),
        ...blocks,
      });
    };
    push(season, current, currentLeagueAvg);
    push(baselineSeason, baseline, baselineLeagueAvg);
  }

  console.log(`Baris turunan yang akan ditulis: ${rows.length}`);
  if (dryRun) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }
  await restInsert(cfg, rows);
  console.log("Selesai — baris turunan tersimpan. Baris FootyStats asli tetap menang lewat jalur merge ingest.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
