import { useState } from "react";
import { useListStandings, useListAvailableLeagues } from "@/api/parlay-hooks";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Trophy } from "lucide-react";

function getUpcomingSeason(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth(); // 0-indexed: 0=Jan, 5=Jun, 6=Jul
  // Musim sepakbola Eropa dimulai sekitar Juli/Agustus.
  // Jika sudah Juni atau lebih, musim depan adalah year-(year+1).
  // Jika masih Jan-Mei, musim yang sedang berjalan adalah (year-1)-year.
  if (month >= 5) {
    return `${year}-${String(year + 1).slice(2)}`;
  }
  return `${year - 1}-${String(year).slice(2)}`;
}

interface Standing {
  id: string;
  team: string;
  league_name: string;
  season: string;
  position: number;
  points: number;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goals_for: number;
  goals_against: number;
  goal_difference: number;
}

interface LeagueOption {
  slug: string;
  name: string;
}

export default function Standings() {
  const [leagueSlug, setLeagueSlug] = useState<string>("all");
  const [season, setSeason] = useState<string>(getUpcomingSeason());
  const [search, setSearch] = useState<string>("");

  const { data: leaguesRaw } = useListAvailableLeagues();
  const leagues = leaguesRaw as LeagueOption[] | undefined;
  const { data: standingsRaw, isLoading } = useListStandings(
    leagueSlug === "all" && !season
      ? undefined
      : {
          league_slug: leagueSlug === "all" ? undefined : leagueSlug,
          season: season || undefined,
        }
  );
  const standings = standingsRaw as Standing[] | undefined;

  const safeTeam = (s: Standing) => s.team || "Unknown";

  const filtered = standings?.filter((s) =>
    safeTeam(s).toLowerCase().includes(search.toLowerCase())
  );

  /* Group by league */
  const grouped = filtered?.reduce<Record<string, Standing[]>>((acc, s) => {
    const lg = s.league_name ?? "Unknown";
    if (!acc[lg]) acc[lg] = [];
    acc[lg].push(s);
    return acc;
  }, {}) ?? {};

  const renderTable = (rows: Standing[]) => (
    <Table>
      <TableHeader className="bg-secondary/50">
        <TableRow className="border-border">
          <TableHead className="w-12 text-center">#</TableHead>
          <TableHead>Team</TableHead>
          <TableHead className="text-right">P</TableHead>
          <TableHead className="text-right">W</TableHead>
          <TableHead className="text-right">D</TableHead>
          <TableHead className="text-right">L</TableHead>
          <TableHead className="text-right">GF</TableHead>
          <TableHead className="text-right">GA</TableHead>
          <TableHead className="text-right">GD</TableHead>
          <TableHead className="text-right">Pts</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((s) => (
          <TableRow key={`${safeTeam(s)}-${s.league_name}-${s.season}-${s.id}`} className="border-border hover:bg-secondary/20 transition-colors">
            <TableCell className="text-center">
              <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold ${
                s.position <= 3 ? "bg-emerald-500/20 text-emerald-400" :
                s.position <= 6 ? "bg-blue-500/20 text-blue-400" :
                s.position >= 18 ? "bg-red-500/20 text-red-400" :
                "bg-muted text-muted-foreground"
              }`}>
                {s.position}
              </span>
            </TableCell>
            <TableCell className="font-semibold">{safeTeam(s)}</TableCell>
            <TableCell className="text-right tabular-nums">{s.played}</TableCell>
            <TableCell className="text-right tabular-nums text-emerald-400">{s.won}</TableCell>
            <TableCell className="text-right tabular-nums text-amber-400">{s.drawn}</TableCell>
            <TableCell className="text-right tabular-nums text-red-400">{s.lost}</TableCell>
            <TableCell className="text-right tabular-nums">{s.goals_for}</TableCell>
            <TableCell className="text-right tabular-nums">{s.goals_against}</TableCell>
            <TableCell className={`text-right tabular-nums font-bold ${s.goal_difference > 0 ? "text-emerald-400" : s.goal_difference < 0 ? "text-red-400" : ""}`}>
              {s.goal_difference > 0 ? `+${s.goal_difference}` : s.goal_difference}
            </TableCell>
            <TableCell className="text-right tabular-nums font-bold text-primary">{s.points}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Standings</h1>
          <p className="text-muted-foreground text-sm">League tables from Supabase.</p>
        </div>
        <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
          <Input
            placeholder="Search team..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full sm:w-48"
          />
          <Select value={leagueSlug} onValueChange={setLeagueSlug}>
            <SelectTrigger className="w-full sm:w-52">
              <SelectValue placeholder="All Leagues" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Leagues</SelectItem>
              {leagues?.map((l) => (
                <SelectItem key={l.slug} value={l.slug}>{l.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            placeholder="Season (e.g. 2024-25)"
            value={season}
            onChange={(e) => setSeason(e.target.value)}
            className="w-full sm:w-44"
          />
        </div>
      </div>

      {isLoading ? (
        <Card className="bg-card border-border overflow-hidden">
          {renderTable(Array.from({ length: 10 }).map((_, i) => ({
            id: String(i),
            team: "",
            league_name: "",
            season: "",
            position: 0,
            points: 0,
            played: 0,
            won: 0,
            drawn: 0,
            lost: 0,
            goals_for: 0,
            goals_against: 0,
            goal_difference: 0,
          })))}
        </Card>
      ) : Object.keys(grouped).length === 0 ? (
        <Card className="bg-card border-border p-8 text-center text-muted-foreground">
          {standings?.length === 0
            ? `No standings data found for season ${season}. Try selecting a different season.`
            : "No teams match your search."}
        </Card>
      ) : (
        Object.entries(grouped).map(([league, rows]) => (
          <div key={league} className="space-y-3">
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="font-mono text-sm">{league}</Badge>
              <span className="text-xs text-muted-foreground">{rows.length} teams</span>
            </div>
            <Card className="bg-card border-border overflow-hidden">
              {renderTable(rows)}
            </Card>
          </div>
        ))
      )}
    </div>
  );
}
