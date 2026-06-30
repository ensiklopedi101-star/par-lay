import { useState } from "react";
import { useListSupabaseParlays } from "@/api/parlay-hooks";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { TrendingUp, TrendingDown, Minus, AlertCircle, CalendarDays, Target } from "lucide-react";
import { format } from "date-fns";

interface ParlayLeg {
  fixture_id: number;
  home: string;
  away: string;
  league: string;
  date: string;
  market: string;
  selection: string;
  odds: number;
  probability: number;
}

interface Parlay {
  parlay_id: string;
  parlay_name: string;
  legs_count: number;
  combined_odds: number;
  expected_value: number;
  win_probability: number;
  status: string;
  created_at: string;
  legs: ParlayLeg[];
}

function ParlayStatusBadge({ status }: { status: string }) {
  const statusStyles: Record<string, string> = {
    active: "bg-blue-500/10 text-blue-500 border-blue-500/20",
    pending: "bg-amber-500/10 text-amber-500 border-amber-500/20",
    win: "bg-emerald-500/10 text-emerald-500 border-emerald-500/20",
    won: "bg-emerald-500/10 text-emerald-500 border-emerald-500/20",
    loss: "bg-red-500/10 text-red-500 border-red-500/20",
    lost: "bg-red-500/10 text-red-500 border-red-500/20",
    half_win: "bg-emerald-400/10 text-emerald-400 border-emerald-400/20",
    half_loss: "bg-red-400/10 text-red-400 border-red-400/20",
    push: "bg-slate-400/10 text-slate-400 border-slate-400/20",
    no_bet: "bg-slate-500/10 text-slate-500 border-slate-500/20",
    settled: "bg-slate-500/10 text-slate-500 border-slate-500/20",
    settled_manual: "bg-amber-400/10 text-amber-400 border-amber-400/20",
  };
  return (
    <Badge variant="outline" className={statusStyles[status] || statusStyles.pending}>
      {status}
    </Badge>
  );
}

function EVOIndicator({ value }: { value: number }) {
  if (value > 0.1) return <TrendingUp className="w-4 h-4 text-emerald-500" />;
  if (value < -0.05) return <TrendingDown className="w-4 h-4 text-red-500" />;
  return <Minus className="w-4 h-4 text-slate-400" />;
}

function ParlayDetailModal({ parlay, onClose }: { parlay: Parlay; onClose: () => void }) {
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl">{parlay.parlay_name}</DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Created {format(new Date(parlay.created_at), "MMM dd, yyyy HH:mm")}
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-3 gap-4 mb-4">
          <Card className="bg-secondary/30 border-border">
            <CardContent className="p-3 text-center">
              <div className="text-xs text-muted-foreground mb-1">Combined Odds</div>
              <div className="text-xl font-bold text-primary">{parlay.combined_odds.toFixed(2)}</div>
            </CardContent>
          </Card>
          <Card className="bg-secondary/30 border-border">
            <CardContent className="p-3 text-center">
              <div className="text-xs text-muted-foreground mb-1">Win Probability</div>
              <div className="text-xl font-bold">{(parlay.win_probability * 100).toFixed(1)}%</div>
            </CardContent>
          </Card>
          <Card className="bg-secondary/30 border-border">
            <CardContent className="p-3 text-center">
              <div className="text-xs text-muted-foreground mb-1">Expected Value</div>
              <div className={`text-xl font-bold ${parlay.expected_value > 0.05 ? "text-emerald-400" : parlay.expected_value < -0.05 ? "text-red-400" : ""}`}>
                {(parlay.expected_value * 100).toFixed(1)}%
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
            Parlay Legs ({parlay.legs_count})
          </h3>
          <div className="space-y-2">
            {parlay.legs?.map((leg, i) => (
              <Card key={i} className="border-border bg-card/50">
                <CardContent className="p-3">
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-sm">
                        <span className="font-mono text-xs text-muted-foreground">Leg {i + 1}</span>
                        <span className="font-bold">{leg.home}</span>
                        <span className="text-muted-foreground">vs</span>
                        <span className="font-bold">{leg.away}</span>
                      </div>
                      <Badge variant="outline" className="text-xs font-mono">
                        {leg.odds.toFixed(2)}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <CalendarDays className="w-3 h-3" />
                        {format(new Date(leg.date), "MMM dd, HH:mm")}
                      </span>
                      <span className="flex items-center gap-1">
                        <Target className="w-3 h-3" />
                        {leg.market}: <span className="text-primary font-medium">{leg.selection}</span>
                      </span>
                      <span className="flex items-center gap-1">
                        {(leg.probability * 100).toFixed(0)}% implied
                      </span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function Parlays() {
  const { data: parlays, isLoading, error } = useListSupabaseParlays({ status: "active" });
  const [selectedParlay, setSelectedParlay] = useState<Parlay | null>(null);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight text-foreground">AI Parlays</h1>
        <p className="text-muted-foreground">Active parlays generated by Gemini AI analysis. Click a row to view legs.</p>
      </div>

      {error && (
        <Card className="border-red-500/20 bg-red-500/5">
          <CardContent className="flex items-center gap-3 py-4">
            <AlertCircle className="w-5 h-5 text-red-500" />
            <span className="text-sm text-red-500">Failed to load parlays: {error.message}</span>
          </CardContent>
        </Card>
      )}

      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="text-lg font-semibold">Active Parlays</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-border hover:bg-transparent">
                    <TableHead className="text-muted-foreground">Parlay</TableHead>
                    <TableHead className="text-muted-foreground">Legs</TableHead>
                    <TableHead className="text-muted-foreground">Combined Odds</TableHead>
                    <TableHead className="text-muted-foreground">EV</TableHead>
                    <TableHead className="text-muted-foreground">Win Prob</TableHead>
                    <TableHead className="text-muted-foreground">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {parlays?.length ? (
                    parlays.map((parlay: Parlay) => (
                      <TableRow
                        key={parlay.parlay_id}
                        className="border-border cursor-pointer hover:bg-secondary/30 transition-colors"
                        onClick={() => setSelectedParlay(parlay)}
                      >
                        <TableCell className="font-medium">{parlay.parlay_name}</TableCell>
                        <TableCell className="tabular-nums">{parlay.legs_count}</TableCell>
                        <TableCell className="tabular-nums">{parlay.combined_odds.toFixed(2)}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <EVOIndicator value={parlay.expected_value} />
                            <span className={`tabular-nums ${parlay.expected_value > 0.05 ? 'text-emerald-500' : parlay.expected_value < -0.05 ? 'text-red-500' : ''}`}>
                              {(parlay.expected_value * 100).toFixed(1)}%
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="tabular-nums">{(parlay.win_probability * 100).toFixed(1)}%</TableCell>
                        <TableCell>
                          <ParlayStatusBadge status={parlay.status} />
                        </TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                        No active parlays found.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {selectedParlay && (
        <ParlayDetailModal
          parlay={selectedParlay}
          onClose={() => setSelectedParlay(null)}
        />
      )}
    </div>
  );
}
