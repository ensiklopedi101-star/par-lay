import { useState } from "react";
import { addDays, formatISO } from "date-fns";
import {
  useGetConfig,
  useGetSyncStatus,
  useListSupabaseParlays,
  useListSupabaseFixtures,
  useGetHealth,
  useGetStatsHealth,
  useGetLearningSummary,
  getListSupabaseParlaysQueryKey,
} from "@/api/parlay-hooks";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Activity,
  Clock,
  Database,
  Server,
  BrainCircuit,
  CalendarDays,
  Zap,
  Shield,
  CircleAlert,
  RefreshCw,
  BookOpen,
  BarChart3,
  Lightbulb,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { formatLeagueName } from "@/utils/format-league";
import { useAdminPassword } from "@/hooks/use-admin-password";
import { AdminPasswordDialog } from "@/components/AdminPasswordDialog";

function HealthDot({ status }: { status: string }) {
  const color = status === "active" || status === "ready" ? "bg-emerald-500" : status === "idle" ? "bg-amber-500" : status === "error" || status === "missing_key" ? "bg-red-500" : "bg-slate-500";
  return <div className={`w-2.5 h-2.5 rounded-full ${color} ${status === "calculating" ? "animate-pulse" : ""}`} />;
}

function HealthBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    active: "bg-emerald-500/10 text-emerald-500 border-emerald-500/20",
    ready: "bg-emerald-500/10 text-emerald-500 border-emerald-500/20",
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

function learningPercent(value: number | null | undefined) {
  return value == null ? "—" : `${(value * 100).toFixed(1)}%`;
}

function learningOutcomeClass(outcome: string) {
  if (outcome === "WIN" || outcome === "HALF_WIN") return "text-emerald-400";
  if (outcome === "LOSS" || outcome === "HALF_LOSS") return "text-red-400";
  return "text-amber-400";
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
  const { data: learning, isLoading: isLearningLoading, isError: isLearningError } = useGetLearningSummary();
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
                  <div className="mt-1 text-[11px] text-muted-foreground">
                    {health?.aiPipeline?.activePredictions ?? 0} aktif ·{" "}
                    {(health?.aiPipeline?.reviewPredictions ?? 0) + (health?.aiPipeline?.invalidatedPredictions ?? 0)} risiko
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3 p-3 rounded-lg bg-secondary/30">
                <HealthDot status={health?.aiLearning?.status ?? "no_data"} />
                <div>
                  <div className="text-sm font-medium">AI Learning</div>
                  <div className="text-xs text-muted-foreground">
                    {health?.aiLearning?.hitRate != null
                      ? `${(health.aiLearning.hitRate * 100).toFixed(1)}% · ${health.aiLearning.sampleSize ?? health.aiLearning.settled ?? 0} sampel`
                      : "No data"}
                  </div>
                  {health?.aiLearning?.recommendedMarket && (
                    <div className="mt-1 max-w-[150px] truncate text-[10px] text-primary" title={health.aiLearning.recommendedMarket}>
                      Fokus: {health.aiLearning.recommendedMarket}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-primary/20 bg-primary/[0.02]">
        <CardHeader className="flex flex-col gap-2 border-b border-border/60 pb-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-lg font-semibold">
              <BookOpen className="h-5 w-5 text-primary" />
              AI Learning Transparency
            </CardTitle>
            <p className="mt-1 max-w-3xl text-xs text-muted-foreground">
              Ini yang benar-benar dipelajari sistem dari hasil settlement. NO BET dipisahkan, partial result dan PUSH tidak disembunyikan.
            </p>
          </div>
          {learning && (
            <Badge
              variant="outline"
              className={
                learning.dataQuality.status === "usable"
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                  : "border-amber-500/30 bg-amber-500/10 text-amber-400"
              }
            >
              {learning.dataQuality.status === "usable"
                ? "Sampel cukup untuk sinyal"
                : learning.dataQuality.status === "early_signal"
                  ? "Sinyal awal"
                  : "Belum cukup sampel"}
            </Badge>
          )}
        </CardHeader>
        <CardContent className="space-y-5 pt-5">
          {isLearningLoading ? (
            <div className="grid gap-3 sm:grid-cols-4">
              {Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-20 w-full" />)}
            </div>
          ) : isLearningError || !learning ? (
            <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-4 text-sm text-red-400">
              Ringkasan AI learning belum dapat dimuat. Data prediksi tetap aman; coba refresh setelah API siap.
            </div>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-lg border border-border/70 bg-background/50 p-3">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Sample settled</div>
                  <div className="mt-1 text-2xl font-semibold tabular-nums">{learning.totals.settled}</div>
                  <div className="text-xs text-muted-foreground">
                    minimum rekomendasi {learning.dataQuality.minimumRecommendedSample}
                  </div>
                </div>
                <div className="rounded-lg border border-border/70 bg-background/50 p-3">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Hit rate decisive</div>
                  <div className="mt-1 text-2xl font-semibold tabular-nums">{learningPercent(learning.totals.hitRate)}</div>
                  <div className="text-xs text-muted-foreground">
                    {learning.totals.wins} W · {learning.totals.losses} L · {learning.totals.halfWins} HW · {learning.totals.halfLosses} HL
                  </div>
                </div>
                <div className="rounded-lg border border-border/70 bg-background/50 p-3">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Push / no bet</div>
                  <div className="mt-1 text-2xl font-semibold tabular-nums">{learning.totals.pushes} / {learning.totals.noBetExcluded}</div>
                  <div className="text-xs text-muted-foreground">PUSH tetap netral · NO BET dikeluarkan</div>
                </div>
                <div className="rounded-lg border border-border/70 bg-background/50 p-3">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">ROI estimasi</div>
                  <div className={`mt-1 text-2xl font-semibold tabular-nums ${(learning.totals.roiPercent ?? 0) >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                    {learningPercent(learning.totals.roiPercent)}
                  </div>
                  <div className="text-xs text-muted-foreground">{learning.totals.roiSamples} hasil dengan odds valid</div>
                </div>
              </div>

              <div className="rounded-lg border border-primary/20 bg-primary/[0.04] p-4">
                <div className="flex items-start gap-3">
                  <Lightbulb className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                  <div className="min-w-0">
                    <div className="text-sm font-semibold">Keputusan belajar berikutnya</div>
                    {learning.recommendedMarket ? (
                      <>
                        <div className="mt-1 flex flex-wrap items-center gap-2">
                          <span className="text-lg font-semibold text-primary">{learning.recommendedMarket.market}</span>
                          <Badge variant="outline" className="border-primary/30 text-primary">
                            {learning.recommendedMarket.family}
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            {learning.recommendedMarket.sampleSize} sampel · hit {learningPercent(learning.recommendedMarket.hitRate)}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">{learning.recommendedMarket.reason}</p>
                      </>
                    ) : (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Belum ada market dengan minimal 3 sampel. Sistem belum akan memaksakan rekomendasi dari data yang terlalu kecil.
                      </p>
                    )}
                    <p className="mt-2 text-xs text-muted-foreground">{learning.dataQuality.explanation}</p>
                  </div>
                </div>
              </div>

              <div className="grid gap-5 lg:grid-cols-[1.45fr_1fr]">
                <div>
                  <div className="mb-3 flex items-center gap-2">
                    <BarChart3 className="h-4 w-4 text-primary" />
                    <h3 className="text-sm font-semibold">Peta keberhasilan market</h3>
                  </div>
                  {learning.marketBreakdown.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-border p-5 text-sm text-muted-foreground">
                      Belum ada market settled yang bisa dibandingkan.
                    </div>
                  ) : (
                    <div className="overflow-x-auto rounded-lg border border-border/70">
                      <table className="w-full min-w-[650px] text-left text-xs">
                        <thead className="bg-secondary/30 text-muted-foreground">
                          <tr>
                            <th className="px-3 py-2 font-medium">Market</th>
                            <th className="px-3 py-2 font-medium">Sampel</th>
                            <th className="px-3 py-2 font-medium">W / L</th>
                            <th className="px-3 py-2 font-medium">HW / HL</th>
                            <th className="px-3 py-2 font-medium">Push</th>
                            <th className="px-3 py-2 font-medium">Hit</th>
                            <th className="px-3 py-2 font-medium">ROI</th>
                          </tr>
                        </thead>
                        <tbody>
                          {learning.marketBreakdown.slice(0, 8).map((market) => (
                            <tr key={market.market} className="border-t border-border/60">
                              <td className="px-3 py-2">
                                <div className="font-medium">{market.market}</div>
                                <div className="text-[10px] text-muted-foreground">{market.family}</div>
                              </td>
                              <td className="px-3 py-2 tabular-nums">{market.sampleSize}</td>
                              <td className="px-3 py-2 tabular-nums">
                                <span className="text-emerald-400">{market.wins}</span> / <span className="text-red-400">{market.losses}</span>
                              </td>
                              <td className="px-3 py-2 tabular-nums">{market.halfWins} / {market.halfLosses}</td>
                              <td className="px-3 py-2 tabular-nums text-amber-400">{market.pushes}</td>
                              <td className="px-3 py-2 tabular-nums">{learningPercent(market.hitRate)}</td>
                              <td className={`px-3 py-2 tabular-nums ${(market.roiPercent ?? 0) >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                                {learningPercent(market.roiPercent)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                <div>
                  <div className="mb-3 flex items-center gap-2">
                    <BookOpen className="h-4 w-4 text-primary" />
                    <h3 className="text-sm font-semibold">Lesson terbaru</h3>
                  </div>
                  <div className="space-y-2">
                    {learning.recentLessons.slice(0, 5).map((lesson, index) => (
                      <div key={`${lesson.fixtureId}-${lesson.createdAt ?? index}`} className="rounded-lg border border-border/70 bg-background/40 p-3">
                        <div className="flex items-start justify-between gap-2 text-xs">
                          <span className="font-medium">{lesson.homeTeam} vs {lesson.awayTeam}</span>
                          <span className={`font-semibold ${learningOutcomeClass(lesson.outcome)}`}>{lesson.outcome}</span>
                        </div>
                        <div className="mt-1 text-[10px] text-muted-foreground">
                          {lesson.market} {lesson.odds != null ? `· odds ${lesson.odds.toFixed(2)}` : ""}
                        </div>
                        <p className="mt-2 line-clamp-3 text-xs leading-relaxed text-muted-foreground">{lesson.lessonText}</p>
                      </div>
                    ))}
                    {learning.recentLessons.length === 0 && (
                      <div className="rounded-lg border border-dashed border-border p-5 text-sm text-muted-foreground">
                        Belum ada lesson settled.
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </>
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
              {statsHealth.coveredLeagues}/{statsHealth.totalLeagues} liga memiliki stats inti
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
                    Liga belum ada stats inti ({statsHealth.missingLeagues.length})
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