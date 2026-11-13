import { useMemo, useState } from "react";
import { useListTeamStats, useListAvailableLeagues } from "@/api/parlay-hooks";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatLeagueName } from "@/utils/format-league";

const STAT_KEYS = [
  { key: "stats_xg", label: "xG", desc: "Expected Goals" },
  { key: "stats_fts", label: "FTS", desc: "First to Score" },
  { key: "stats_btts", label: "BTTS", desc: "Both Teams Score" },
  { key: "stats_goals_conceded", label: "GC", desc: "Goals Conceded" },
  { key: "stats_goals_scored", label: "GS", desc: "Goals Scored" },
  { key: "stats_shots", label: "SH", desc: "Shots" },
  { key: "stats_over_25", label: "O2.5", desc: "Over 2.5" },
  { key: "stats_over_35", label: "O3.5", desc: "Over 3.5" },
  { key: "stats_under", label: "UN", desc: "Under" },
  { key: "stats_team_form", label: "FORM", desc: "Form" },
  { key: "stats_ht", label: "HT", desc: "Half Time" },
];

function currentSeason(): string {
  const now = new Date();
  const year = now.getFullYear();
  return now.getMonth() >= 5 ? `${year}-${String(year + 1).slice(2)}` : `${year - 1}-${String(year).slice(2)}`;
}

function previousSeason(season: string): string {
  const start = Number(season.slice(0, 4));
  return `${start - 1}-${String(start).slice(2)}`;
}

function StatIndicator({ value }: { value: unknown }) {
  const hasData = value != null && (typeof value === "object" ? Object.keys(value).length > 0 : true);
  return (
    <span className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold ${hasData ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-600"}`}>
      {hasData ? "✓" : "×"}
    </span>
  );
}

interface TeamStat {
  id: string;
  team_name: string;
  season: string;
  league_slug: string;
  [key: string]: unknown;
}

function coverage(team: Record<string, unknown>) {
  return STAT_KEYS.filter((stat) => {
    const value = team[stat.key];
    return value != null && (typeof value === "object" ? Object.keys(value).length > 0 : true);
  }).length;
}

function TeamStatBadges({ team }: { team: Record<string, unknown> }) {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1.5">
      {STAT_KEYS.map((stat) => (
        <div key={stat.key} className="flex items-center gap-1" title={`${stat.desc}: ${team[stat.key] ? "Available" : "Missing"}`}>
          <StatIndicator value={team[stat.key]} />
          <span className="text-[10px] font-medium uppercase text-muted-foreground">{stat.label}</span>
        </div>
      ))}
    </div>
  );
}

export default function Teams() {
  const thisSeason = currentSeason();
  const lastSeason = previousSeason(thisSeason);
  const [leagueSlug, setLeagueSlug] = useState("all");
  const [seasonMode, setSeasonMode] = useState<"current" | "previous" | "all">("current");
  const [search, setSearch] = useState("");
  const season = seasonMode === "current" ? thisSeason : seasonMode === "previous" ? lastSeason : "";

  const { data: leagues } = useListAvailableLeagues();
  const { data: teamsRaw, isLoading } = useListTeamStats({
    leagueSlug: leagueSlug === "all" ? undefined : leagueSlug,
    season: season || undefined,
  });
  const teams = teamsRaw as TeamStat[] | undefined;

  const filtered = useMemo(
    () => teams?.filter((team) => (team.team_name ?? "").toLowerCase().includes(search.toLowerCase())) ?? [],
    [teams, search],
  );

  const groupedBySeason = useMemo(() => {
    const seasons = new Map<string, Map<string, TeamStat[]>>();
    for (const team of filtered) {
      if (!seasons.has(team.season)) seasons.set(team.season, new Map());
      const leaguesMap = seasons.get(team.season)!;
      if (!leaguesMap.has(team.league_slug)) leaguesMap.set(team.league_slug, []);
      leaguesMap.get(team.league_slug)!.push(team);
    }
    return [...seasons.entries()].sort(([a], [b]) => b.localeCompare(a));
  }, [filtered]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Team Stats</h1>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">
          Kelengkapan 11 indikator statistik tim. Musim berjalan dan musim lalu kini dipisahkan secara eksplisit
          agar data lama tidak tercampur dengan data yang dipakai analisis saat ini.
        </p>
      </div>

      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Pilih rentang musim">
        {[
          { value: "current" as const, label: `${thisSeason} · Musim berjalan` },
          { value: "previous" as const, label: `${lastSeason} · Musim lalu` },
          { value: "all" as const, label: "Bandingkan semua musim" },
        ].map((option) => (
          <Button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={seasonMode === option.value}
            variant={seasonMode === option.value ? "default" : "outline"}
            className={seasonMode === option.value ? "" : "bg-white"}
            onClick={() => setSeasonMode(option.value)}
          >
            {option.label}
          </Button>
        ))}
      </div>

      <div className="grid gap-3 rounded-2xl border border-border bg-white p-4 shadow-sm md:grid-cols-[1fr_280px]">
        <div>
          <label htmlFor="team-search" className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">Cari tim</label>
          <Input id="team-search" data-testid="input-team-search" placeholder="Contoh: Arsenal, Barcelona, Enschede…" value={search} onChange={(e) => setSearch(e.target.value)} className="bg-white" />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">Liga</label>
          <Select value={leagueSlug} onValueChange={setLeagueSlug}>
            <SelectTrigger className="w-full bg-white" data-testid="select-league">
              <SelectValue placeholder="Semua liga" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua liga</SelectItem>
              {leagues?.map((league) => (
                <SelectItem key={league.slug} value={league.slug}>{league.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="mt-1.5 text-xs text-muted-foreground">Dropdown membuat daftar liga panjang tetap compact.</p>
        </div>
      </div>

      {isLoading ? (
        <Card className="overflow-hidden">
          <Table>
            <TableHeader className="bg-secondary/60"><TableRow><TableHead>Team</TableHead><TableHead>Musim</TableHead><TableHead>Cakupan</TableHead><TableHead>11 indikator</TableHead></TableRow></TableHeader>
            <TableBody>{Array.from({ length: 6 }).map((_, i) => <TableRow key={i}>{Array.from({ length: 4 }).map((__, j) => <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>)}</TableRow>)}</TableBody>
          </Table>
        </Card>
      ) : groupedBySeason.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          {teams?.length === 0
            ? `Belum ada team stats untuk ${seasonMode === "all" ? "filter ini" : `musim ${season}`}. Data masuk melalui ingest/ekstensi, bukan Upload CSV.`
            : "Tidak ada tim yang cocok dengan pencarian."}
        </Card>
      ) : (
        groupedBySeason.map(([seasonGroup, leaguesMap]) => (
          <section key={seasonGroup} className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge className="px-3 py-1 text-sm">{seasonGroup}</Badge>
              <span className="text-sm font-medium">{seasonGroup === thisSeason ? "Musim berjalan" : seasonGroup === lastSeason ? "Musim lalu" : "Musim arsip"}</span>
              <span className="text-xs text-muted-foreground">{[...leaguesMap.values()].reduce((sum, rows) => sum + rows.length, 0)} tim · {leaguesMap.size} liga</span>
            </div>
            {[...leaguesMap.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([league, leagueTeams]) => (
              <div key={`${seasonGroup}-${league}`} className="space-y-2">
                <div className="flex items-center gap-2">
                  <Badge variant="secondary">{formatLeagueName(league)}</Badge>
                  <span className="text-xs text-muted-foreground">{leagueTeams.length} tim</span>
                </div>
                <Card className="overflow-hidden">
                  <Table>
                    <TableHeader className="bg-secondary/60">
                      <TableRow>
                        <TableHead className="w-52">Team</TableHead>
                        <TableHead className="w-28">Musim</TableHead>
                        <TableHead className="w-28">Cakupan</TableHead>
                        <TableHead>11 indikator</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {leagueTeams.map((team) => (
                        <TableRow key={team.id} data-testid={`row-team-${team.id}`}>
                          <TableCell className="font-semibold text-sm">{team.team_name}</TableCell>
                          <TableCell><Badge variant="outline">{team.season}</Badge></TableCell>
                          <TableCell><Badge variant={coverage(team) === 11 ? "default" : "secondary"}>{coverage(team)}/11</Badge></TableCell>
                          <TableCell><TeamStatBadges team={team} /></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Card>
              </div>
            ))}
          </section>
        ))
      )}

      {filtered.length > 0 && <p className="text-right text-xs text-muted-foreground">{filtered.length} tim ditampilkan · ✓ tersedia · × belum tersedia</p>}
    </div>
  );
}
