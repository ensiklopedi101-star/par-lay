import { useState } from "react";
import { useListStandings, useListAvailableLeagues } from "@/api/parlay-hooks";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Trophy } from "lucide-react";

interface Standing {
  id: number;
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

export default function Standings() {
  const [leagueName, setLeagueName] = useState<string>("all");
  const [season, setSeason] = useState<string>("");
  const [search, setSearch] = useState<string>("");

  const { data: leagues } = useListAvailableLeagues();
  const { data: standings, isLoading } = useListStandings(
    leagueName === "all" && !season
      ? undefined
      : {
          league_name: leagueName === "all" ? undefined : leagueName,
          season: season || undefined,
        }
  );

  const safeTeam = (s: Standing) => s.team || s.team_name || "Unknown";

  const filtered = standings?.filter((s: Standing) =>
    safeTeam(s).toLowerCase().includes(search.toLowerCase())
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
          <Select value={leagueName} onValueChange={setLeagueName}>
            <SelectTrigger className="w-full sm:w-52">
              <SelectValue placeholder="All Leagues" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Leagues</SelectItem>
              {leagues?.map((l) => (
                <SelectItem key={l.slug} value={l.name}>{l.name}</SelectItem>
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

      <Card className="bg-card border-border overflow-hidden">
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
            {isLoading ? (
              Array.from({ length: 10 }).map((_, i) => (
                <TableRow key={i} className="border-border">
                  {Array.from({ length: 10 }).map((__, j) => (
                    <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                  ))}
                </TableRow>
              ))
            ) : filtered?.length ? (
              filtered.map((s: Standing, idx: number) => (
                <TableRow key={`${safeTeam(s)}-${s.league_name}-${s.season}-${idx}`} className="border-border hover:bg-secondary/20 transition-colors">
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
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={10} className="h-24 text-center text-muted-foreground">
                  {standings?.length === 0 ? "No standings data found." : "No teams match your search."}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
