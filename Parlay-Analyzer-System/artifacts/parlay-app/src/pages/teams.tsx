import { useState } from "react";
import { useListTeamStats, useListAvailableLeagues } from "@/api/parlay-hooks";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
/* 11 stat indicator keys as defined in backend */
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

function StatIndicator({ value }: { value: unknown }) {
  const hasData = value != null && (typeof value === "object" ? Object.keys(value).length > 0 : true);
  return (
    <span className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold ${hasData ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400"}`}>
      {hasData ? "✓" : "✗"}
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

interface LeagueOption {
  slug: string;
  name: string;
}

function TeamStatBadges({ team }: { team: Record<string, unknown> }) {
  return (
    <div className="flex flex-wrap gap-1">
      {STAT_KEYS.map((stat) => (
        <div key={stat.key} className="flex items-center gap-1" title={`${stat.desc}: ${team[stat.key] ? "Available" : "Missing"}`}>
          <StatIndicator value={team[stat.key]} />
          <span className="text-[10px] text-muted-foreground uppercase">{stat.label}</span>
        </div>
      ))}
    </div>
  );
}

export default function Teams() {
  const [leagueSlug, setLeagueSlug] = useState<string>("all");
  const [season, setSeason] = useState<string>("");
  const [search, setSearch] = useState<string>("");

  const { data: leaguesRaw } = useListAvailableLeagues();
  const leagues = leaguesRaw as LeagueOption[] | undefined;
  const { data: teamsRaw, isLoading } = useListTeamStats(
    leagueSlug === "all" && !season
      ? undefined
      : {
          leagueSlug: leagueSlug === "all" ? undefined : leagueSlug,
          season: season || undefined,
        }
  );
  const teams = teamsRaw as TeamStat[] | undefined;

  const filtered = teams?.filter((t) =>
    (t.team_name ?? "").toLowerCase().includes(search.toLowerCase())
  );

  /* Group by league */
  const grouped = filtered?.reduce<Record<string, TeamStat[]>>((acc, team) => {
    const lg = (team.league_slug as string) ?? "Unknown";
    if (!acc[lg]) acc[lg] = [];
    acc[lg]!.push(team);
    return acc;
  }, {}) ?? {};

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Team Stats</h1>
          <p className="text-muted-foreground text-sm">11 indicator coverage from FootyStats CSV uploads.</p>
        </div>
        <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
          <Input
            data-testid="input-team-search"
            placeholder="Search team..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full sm:w-48"
          />
          <Select value={leagueSlug} onValueChange={setLeagueSlug}>
            <SelectTrigger className="w-full sm:w-52" data-testid="select-league">
              <SelectValue placeholder="All Leagues" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Leagues</SelectItem>
              {leagues?.map((l) => (
                <SelectItem key={l.slug} value={l.slug}>
                  {l.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            data-testid="input-season"
            placeholder="Season (e.g. 2024-25)"
            value={season}
            onChange={(e) => setSeason(e.target.value)}
            className="w-full sm:w-44"
          />
        </div>
      </div>

      {isLoading ? (
        <Card className="bg-card border-border overflow-hidden">
          <Table>
            <TableHeader className="bg-secondary/50">
              <TableRow className="border-border">
                <TableHead className="w-40">Team</TableHead>
                <TableHead className="w-24">Season</TableHead>
                <TableHead>11 Indicators</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {Array.from({ length: 6 }).map((_, i) => (
                <TableRow key={i} className="border-border">
                  {Array.from({ length: 3 }).map((__, j) => (
                    <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      ) : (
        <div className="space-y-6">
          {Object.keys(grouped).length === 0 ? (
            <Card className="bg-card border-border p-8 text-center text-muted-foreground">
              {teams?.length === 0 ? "No team stats found. Upload a CSV to get started." : "No teams match your search."}
            </Card>
          ) : (
            Object.entries(grouped).map(([league, leagueTeams]) => (
              <div key={league} className="space-y-3">
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="font-mono text-sm">{league}</Badge>
                  <span className="text-xs text-muted-foreground">{leagueTeams?.length} teams</span>
                </div>
                <Card className="bg-card border-border overflow-hidden">
                  <Table>
                    <TableHeader className="bg-secondary/50">
                      <TableRow className="border-border">
                        <TableHead className="w-40">Team</TableHead>
                        <TableHead className="w-24">Season</TableHead>
                        <TableHead className="w-auto">11 Indicators</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {leagueTeams?.map((team) => (
                        <TableRow key={team.id} className="border-border hover:bg-secondary/20 transition-colors" data-testid={`row-team-${team.id}`}>
                          <TableCell className="font-semibold text-sm">{team.team_name}</TableCell>
                          <TableCell className="text-muted-foreground text-xs">{team.season}</TableCell>
                          <TableCell>
                            <TeamStatBadges team={team as Record<string, unknown>} />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Card>
              </div>
            ))
          )}
        </div>
      )}

      {filtered && filtered.length > 0 && (
        <p className="text-xs text-muted-foreground text-right">{filtered.length} teams total</p>
      )}
    </div>
  );
}
