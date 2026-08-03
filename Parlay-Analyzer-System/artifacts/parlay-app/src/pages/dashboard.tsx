import { useState } from "react";
import { addDays, formatISO } from "date-fns";
import { useGetConfig, useGetSyncStatus, useListSupabaseParlays, useListSupabaseFixtures, useGetHealth, useGetStatsHealth, getListSupabaseParlaysQueryKey } from "@/api/parlay-hooks";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Activity, Clock, Database, Server, BrainCircuit, CalendarDays, Zap, Shield, CircleAlert, RefreshCw } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { formatLeagueName } from "@/utils/format-league";
import { useAdminPassword } from "@/hooks/use-admin-password";
import { AdminPasswordDialog } from "@/components/AdminPasswordDialog";

function HealthDot({ status }: { status: string }) {
  const color = status === "active" ? "bg-emerald-500" : status === "idle" ? "bg-amber-500" : status === "error" || status === "missing_key" ? "bg-red-500" : "bg-slate-500";
  return <div className={`w-2.5 h-2.5 rounded-full ${color} ${status === "calculating" ? "animate-pulse" : ""}`} />;
}

function HealthBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    active: "bg-emerald-500/10 text-emerald-500 border-emerald-500/20",
    idle: "bg-amber-500/10 text-amber-500 border-amber-500/20",
    calculating: "bg-amber-500/10 text-amber-500 border-amber-500/20",
    saving: "bg-blue-500/10 text-blue-500 border-blue-500/20",
    error: "bg-red-500/10 text-red-500 border-red-500/20",
    missing_key: "bg-red-500/10 text-red-500 border-red-500/20",
    no_data: "bg-slate-500/10 text-slate-500 border-slate-500/20",
    checking: "bg-slate-500/10 text-slate-500 border-slate-500/20",
  };
  return <Badge variant="outline" className={colors[status] || colors.checking}>{status}</Badge>;
}

export default function Dashboard() {
  const queryClient = useQueryClient();
  const { data: syncStatus, isLoading: isSyncLoading } = useGetSyncStatus();
  const { data: config } = useGetConfig();
  const scanDays = config?.scanDays ?? 11;
  const { data: parlays, isLoading: isParlaysLoading } = useListSupabaseParlays({ status: "active" });
  const now = new Date();
  const { data: fixtures, isLoading: isFixturesLoading } = useListSupabaseFixtures({
    date_from: formatISO(now),
    date_to: formatISO(addDays(now, scanDays)),
    limit: 500,
  });
  const { data: health, isLoading: isHealthLoading } = useGetHealth();
  const { data: statsHealth, isLoading: isStatsHealthLoading } = useGetStatsHealth();
  const [scanState, setScanState] = useState<"idle" | "scanning">("idle");
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanProgress, setScanProgress] = useState<{
    completed: number;
    total: number;
    currentMatch: string | null;
  } | null>(null);
  const [scanResult, setScanResult] = useState<{
    scanned: number;
    validTickets: number;
    parlayLegs: number;
    waitingOdds: number;
    noBet: number;
    message?: string;
    tickets?: Array<{
      home_team: string;
      away_team: string;
      status: string;
      confidence: number;
      selection: string;
      prediction_text: string;
      is_parlay_leg: boolean;
      odds_status?: "valid" | "stale";
    }>;
  } | null>(null);
  const { open, withPassword, onSubmit, onCancel } = useAdminPassword();

  const runScan = async (pwd: string) => {
    setScanState("scanning");
    setScanError(null);
    setScanResult(null);
    setScanProgress(null);
    try {
      const res = await fetch("/api/analyze/batch", {
        method: "POST",
        headers: { "x-admin-password": pwd },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: `API ${res.status}` }));
        throw new Error(body.error ?? `API ${res.status}`);
      }
      const started = await res.json() as { jobId?: string };
      if (!started.jobId) throw new Error("Batch scanner tidak mengembalikan job ID");

      type BatchStatus = {
        status: "running" | "completed" | "failed";
        completed: number;
        total: number;
        currentMatch: string | null;
        scanned: number;
        parlayLegs: number;
        waitingOdds: number;
        noBet: number;
        parlayId?: string | null;
        error?: string | null;
        tickets?: Array<{
          home_team: string;
          away_team: string;
          status: string;
          confidence: number;
          selection: string;
          prediction_text: string;
          is_parlay_leg: boolean;
          odds_status?: "valid" | "stale";
        }>;
      };
      let result: BatchStatus;
      do {
        await new Promise((resolve) => setTimeout(resolve, 1_500));
        const statusResponse = await fetch(`/api/analyze/batch/${started.jobId}`, {
          headers: { "x-admin-password": pwd },
        });
        if (!statusResponse.ok) {
          const body = await statusResponse.json().catch(() => ({ error: `API ${statusResponse.status}` }));
          throw new Error(body.error ?? `API ${statusResponse.status}`);
        }
        result = await statusResponse.json() as BatchStatus;
        setScanProgress({
          completed: result.completed,
          total: result.total,
          currentMatch: result.currentMatch,
        });
        setScanResult({
          scanned: result.scanned,
          validTickets: result.tickets?.filter((ticket) => ticket.confidence >= 6.5 && ticket.status === "scanned").length ?? 0,
          parlayLegs: result.parlayLegs,
          waitingOdds: result.waitingOdds,
          noBet: result.noBet,
          message: result.status === "running"
            ? `Memproses ${result.completed} dari ${result.total} fixture${result.currentMatch ? ` — ${result.currentMatch}` : ""}`
            : result.waitingOdds > 0
              ? `Scanning selesai. ${result.waitingOdds} fixture menunggu data odds; ${result.noBet} fixture memiliki odds tetapi tidak memenuhi value.`
            : result.parlayId
              ? "Scanning selesai dan parlay otomatis berhasil dibuat."
              : "Scanning selesai. Minimal dua leg confidence tinggi diperlukan untuk membuat parlay.",
          tickets: result.tickets,
        });
        if (result.status === "failed") throw new Error(result.error ?? "Batch scanner gagal");
      } while (result.status === "running");
      setScanState("idle");
      await queryClient.invalidateQueries({ queryKey: getListSupabaseParlaysQueryKey({ status: "active" }) });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Scan failed";
      console.error("Scan failed:", err);
      setScanError(message);
      setScanState("idle");
    }
  };

  const handleScan = () => {
    withPassword(runScan);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Dashboard</h1>
          <p className="text-muted-foreground">System overview and data synchronization status.</p>
        </div>
        <Button
          size="lg"
          onClick={handleScan}
          disabled={scanState === "scanning"}
          className="bg-primary hover:bg-primary/90 text-primary-foreground"
        >
          <Zap className="w-4 h-4 mr-2" />
          {scanState === "scanning" ? `Scanning ${scanDays} hari...` : `SCANNING ${scanDays} HARI & BUAT PARLAY`}
        </Button>
      </div>

      {scanState === "scanning" && scanProgress && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="py-4 space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium text-primary">Batch Scanner sedang berjalan</span>
              <span className="tabular-nums text-muted-foreground">
                {scanProgress.completed}/{scanProgress.total}
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-primary/15">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{
                  width: `${scanProgress.total > 0 ? Math.round((scanProgress.completed / scanProgress.total) * 100) : 5}%`,
                }}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              {scanProgress.currentMatch ?? "Menyiapkan fixture..."} — request diproses berurutan untuk menjaga batas API.
            </p>
          </CardContent>
        </Card>
      )}

      {scanError && (
        <Card className="border-red-500/20 bg-red-500/5">
          <CardContent className="py-3 text-sm text-red-500">
            Scan gagal: {scanError}
          </CardContent>
        </Card>
      )}

      {scanResult && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="py-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="font-semibold text-primary">Scanning selesai</div>
                <div className="text-sm text-muted-foreground">
                  {scanResult.message ?? "Hasil analisis berhasil diperbarui."}
                </div>
              </div>
              <div className="flex flex-wrap gap-3 text-sm tabular-nums">
                <span>Scanned: <strong>{scanResult.scanned}</strong></span>
                <span>Valid: <strong>{scanResult.validTickets}</strong></span>
                <span>Parlay legs: <strong>{scanResult.parlayLegs}</strong></span>
                <span className="text-amber-500">Waiting odds: <strong>{scanResult.waitingOdds}</strong></span>
                <span className="text-muted-foreground">No bet: <strong>{scanResult.noBet}</strong></span>
              </div>
            </div>
            {scanResult.tickets && scanResult.tickets.length > 0 && (
              <div className="mt-4 space-y-2 border-t border-border/50 pt-3">
                {scanResult.tickets.map((ticket, index) => (
                  <div
                    key={`${ticket.home_team}-${ticket.away_team}-${index}`}
                    className="flex flex-col gap-1 rounded-md bg-background/40 px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between"
                  >
                    <span className="font-medium">
                      {ticket.home_team} vs {ticket.away_team}
                    </span>
                      <span className={ticket.status === "waiting_odds" ? "text-amber-500" : "text-muted-foreground"}>
                        {ticket.status === "error"
                          ? ticket.prediction_text
                          : ticket.status === "waiting_odds"
                            ? "WAITING FOR ODDS · AI belum dipanggil"
                            : `${ticket.selection || "NO_BET"} · confidence ${ticket.confidence}${ticket.odds_status === "stale" ? " · stale odds" : ""}${ticket.is_parlay_leg ? " · parlay leg" : ""}`}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <AdminPasswordDialog open={open} onOpenChange={onCancel} onSubmit={onSubmit} />

      {/* System Health Monitor — Modul 2 */}
      <Card className="bg-card border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg font-semibold flex items-center gap-2">
            <Shield className="w-5 h-5 text-primary" />
            Status Sistem
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isHealthLoading ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="flex items-center gap-3 p-3 rounded-lg bg-secondary/30">
                <HealthDot status={health?.supabase?.status ?? "checking"} />
                <div>
                  <div className="text-sm font-medium">Supabase</div>
                  <div className="text-xs text-muted-foreground">{health?.supabase?.latencyMs ? `${health.supabase.latencyMs}ms` : health?.supabase?.status}</div>
                </div>
              </div>
              <div className="flex items-center gap-3 p-3 rounded-lg bg-secondary/30">
                <HealthDot status={health?.gemini?.status ?? "checking"} />
                <div>
                  <div className="text-sm font-medium">Gemini API</div>
                  <div className="text-xs text-muted-foreground">{health?.gemini?.model}</div>
                </div>
              </div>
              <div className="flex items-center gap-3 p-3 rounded-lg bg-secondary/30">
                <HealthDot status={health?.aiPipeline?.status ?? "idle"} />
                <div>
                  <div className="text-sm font-medium">AI Pipeline</div>
                  <HealthBadge status={health?.aiPipeline?.status ?? "idle"} />
                </div>
              </div>
              <div className="flex items-center gap-3 p-3 rounded-lg bg-secondary/30">
                <HealthDot status={health?.aiLearning?.status ?? "no_data"} />
                <div>
                  <div className="text-sm font-medium">AI Learning</div>
                  <div className="text-xs text-muted-foreground">
                    {health?.aiLearning?.hitRate != null ? `${(health.aiLearning.hitRate * 100).toFixed(1)}%` : "No data"}
                  </div>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card className="bg-card border-border">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Events</CardTitle>
            <Database className="w-4 h-4 text-primary" />
          </CardHeader>
          <CardContent>
            {isSyncLoading ? (
              <Skeleton className="h-8 w-20" />
            ) : (
              <div className="text-2xl font-bold">{syncStatus?.totalEvents || 0}</div>
            )}
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium text-muted-foreground">Active Leagues</CardTitle>
            <Activity className="w-4 h-4 text-primary" />
          </CardHeader>
          <CardContent>
            {isSyncLoading ? (
              <Skeleton className="h-8 w-20" />
            ) : (
              <div className="text-2xl font-bold">
                {syncStatus?.configuredLeagueCount ?? syncStatus?.leagueBreakdown?.length ?? 0}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium text-muted-foreground">Last Sync</CardTitle>
            <Clock className="w-4 h-4 text-primary" />
          </CardHeader>
          <CardContent>
            {isSyncLoading ? (
              <Skeleton className="h-8 w-32" />
            ) : (
              <div className="text-sm font-medium mt-1">
                {syncStatus?.lastSyncAt ? new Date(syncStatus.lastSyncAt).toLocaleString() : "Never"}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium text-muted-foreground">Sync Status</CardTitle>
            <Server className="w-4 h-4 text-primary" />
          </CardHeader>
          <CardContent>
            {isSyncLoading ? (
              <Skeleton className="h-8 w-24" />
            ) : (
              <div className="flex items-center gap-2 mt-1">
                <div className={`w-2.5 h-2.5 rounded-full ${syncStatus?.isRunning ? 'bg-amber-500 animate-pulse' : 'bg-primary'}`} />
                <span className="text-sm font-medium">{syncStatus?.isRunning ? 'Syncing...' : 'Idle'}</span>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium text-muted-foreground">AI Parlays</CardTitle>
            <BrainCircuit className="w-4 h-4 text-primary" />
          </CardHeader>
          <CardContent>
            {isParlaysLoading ? (
              <Skeleton className="h-8 w-20" />
            ) : (
              <div className="text-2xl font-bold">{parlays?.length || 0}</div>
            )}
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium text-muted-foreground">Upcoming Fixtures</CardTitle>
            <CalendarDays className="w-4 h-4 text-primary" />
          </CardHeader>
          <CardContent>
            {isFixturesLoading ? (
              <Skeleton className="h-8 w-20" />
            ) : (
              <div className="text-2xl font-bold">{fixtures?.length || 0}</div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card className="col-span-1 bg-card border-border">
          <CardHeader>
            <CardTitle className="text-lg font-semibold">League Breakdown</CardTitle>
          </CardHeader>
          <CardContent>
            {isSyncLoading ? (
              <div className="space-y-3">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : (
              <div className="space-y-4">
                {syncStatus?.leagueBreakdown?.length ? (
                  syncStatus.leagueBreakdown.map((lb) => (
                    <div key={lb.leagueSlug} className="flex items-center justify-between border-b border-border/50 pb-2 last:border-0 last:pb-0">
                      <span className="font-medium">{formatLeagueName(lb.leagueSlug)}</span>
                      <span className="text-muted-foreground tabular-nums bg-secondary px-2 py-0.5 rounded text-xs">{lb.eventCount}</span>
                    </div>
                  ))
                ) : (
                  <div className="text-sm text-muted-foreground text-center py-4">No events found.</div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="bg-card border-border">
        <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="text-lg font-semibold flex items-center gap-2">
              <Database className="w-5 h-5 text-primary" />
              Team Stats Health
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Coverage liga dan pengingat update statistik untuk parlay aktif.
            </p>
          </div>
          {statsHealth && (
            <div className="text-sm tabular-nums text-muted-foreground">
              {statsHealth.coveredLeagues}/{statsHealth.totalLeagues} liga memiliki stats
            </div>
          )}
        </CardHeader>
        <CardContent>
          {isStatsHealthLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : statsHealth ? (
            <div className="space-y-4">
              {statsHealth.parlayReminders.length > 0 && (
                <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3">
                  <div className="flex items-center gap-2 font-semibold text-amber-500">
                    <CircleAlert className="w-4 h-4" />
                    Reminder update stats
                  </div>
                  <div className="mt-2 space-y-2 text-sm">
                    {statsHealth.parlayReminders.map((reminder) => (
                      <div key={reminder.parlayId} className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                        <span>{reminder.parlayName} · {reminder.legsCount} legs</span>
                        <span className="text-amber-500">
                          {[
                            ...reminder.missingLeagues.map((league) => `${league} belum ada`),
                            ...reminder.staleLeagues.map((league) => `${league} perlu update`),
                          ].join(" · ")}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-md border border-red-500/20 bg-red-500/5 p-3">
                  <div className="flex items-center gap-2 font-semibold text-red-500">
                    <CircleAlert className="w-4 h-4" />
                    Liga belum ada stats ({statsHealth.missingLeagues.length})
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {statsHealth.missingLeagues.length > 0
                      ? statsHealth.missingLeagues.map((league) => league.name).join(", ")
                      : "Semua liga sudah memiliki data."}
                  </p>
                </div>
                <div className="rounded-md border border-amber-500/20 bg-amber-500/5 p-3">
                  <div className="flex items-center gap-2 font-semibold text-amber-500">
                    <RefreshCw className="w-4 h-4" />
                    Liga perlu update ({statsHealth.staleLeagues.length})
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {statsHealth.staleLeagues.length > 0
                      ? statsHealth.staleLeagues.map((league) => `${league.name} (${league.ageDays ?? "?"} hari)`).join(", ")
                      : `Tidak ada stats lebih lama dari ${statsHealth.staleAfterDays} hari.`}
                  </p>
                </div>
              </div>

              {statsHealth.parlayReminders.length === 0 &&
                statsHealth.missingLeagues.length === 0 &&
                statsHealth.staleLeagues.length === 0 && (
                  <p className="text-sm text-emerald-500">Stats sudah siap untuk liga yang dipantau.</p>
                )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Status stats belum tersedia.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}