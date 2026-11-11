/**
 * Panel transparansi sync odds.
 *
 * Dashboard sebelumnya hanya menampilkan "Last Sync" dan "Sync Status: Idle",
 * sehingga tidak ada cara mengetahui apakah sebuah proses sync benar-benar
 * berjalan, apa yang ditarik, dan apakah ada yang gagal.
 *
 * Data di sini seluruhnya berasal dari tabel `sync_runs` yang sudah lama
 * terisi tetapi tidak pernah diambil: jumlah event ditarik, jumlah tersimpan,
 * jumlah snapshot odds, jumlah error, dan durasi kena rate limit.
 *
 * Semua angka ditampilkan apa adanya — termasuk yang buruk. Panel ini tidak
 * menyembunyikan kegagalan; justru itu gunanya.
 */

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Activity,
  AlertTriangle,
  ArrowDownToLine,
  CheckCircle2,
  Clock,
  Database,
  Gauge,
  History,
  Loader2,
  TimerOff,
  XCircle,
} from "lucide-react";
import type { SyncRunSummary, SyncStatus } from "@/api/parlay-hooks";

/* ─── Pembantu format ───────────────────────────────────────────────────── */

function formatDuration(ms: number | null): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms} ms`;
  const totalSec = ms / 1000;
  if (totalSec < 60) return `${totalSec.toFixed(1)} s`;
  const min = Math.floor(totalSec / 60);
  const sec = Math.round(totalSec % 60);
  return `${min} m ${sec} s`;
}

function formatRelative(iso: string | null | undefined): string {
  if (!iso) return "—";
  const diffMs = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(diffMs)) return "—";
  const sec = Math.round(diffMs / 1000);
  if (sec < 60) return `${Math.max(0, sec)} detik lalu`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} menit lalu`;
  const hour = Math.round(min / 60);
  if (hour < 24) return `${hour} jam lalu`;
  return `${Math.round(hour / 24)} hari lalu`;
}

function formatCount(n: number | undefined | null): string {
  return (n ?? 0).toLocaleString("id-ID");
}

/** Lencana status run — warna mengikuti arti, bukan sekadar nilai. */
function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; className: string; Icon: typeof CheckCircle2 }> = {
    completed: { label: "Selesai", className: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30", Icon: CheckCircle2 },
    partial: { label: "Sebagian", className: "bg-amber-500/15 text-amber-400 border-amber-500/30", Icon: AlertTriangle },
    failed: { label: "Gagal", className: "bg-red-500/15 text-red-400 border-red-500/30", Icon: XCircle },
    running: { label: "Berjalan", className: "bg-sky-500/15 text-sky-400 border-sky-500/30", Icon: Loader2 },
  };
  const entry = map[status] ?? {
    label: status,
    className: "bg-muted text-muted-foreground border-border",
    Icon: Activity,
  };
  const { label, className, Icon } = entry;
  return (
    <Badge variant="outline" className={`gap-1 ${className}`}>
      <Icon className={`w-3 h-3 ${status === "running" ? "animate-spin" : ""}`} />
      {label}
    </Badge>
  );
}

/* ─── Satu baris angka ──────────────────────────────────────────────────── */

function Metric({
  label,
  value,
  hint,
  Icon,
  tone = "default",
}: {
  label: string;
  value: string;
  hint?: string;
  Icon: typeof Database;
  tone?: "default" | "warn" | "bad" | "good";
}) {
  const toneClass =
    tone === "bad"
      ? "text-red-400"
      : tone === "warn"
        ? "text-amber-400"
        : tone === "good"
          ? "text-emerald-400"
          : "text-foreground";
  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
        <Icon className="w-3 h-3" />
        {label}
      </div>
      <div className={`mt-1 text-lg font-semibold tabular-nums ${toneClass}`}>{value}</div>
      {hint ? <div className="text-[11px] text-muted-foreground/80">{hint}</div> : null}
    </div>
  );
}

/* ─── Panel utama ───────────────────────────────────────────────────────── */

export function SyncTransparencyPanel({
  status,
  isLoading,
}: {
  status?: SyncStatus;
  isLoading?: boolean;
}) {
  if (isLoading) {
    return (
      <Card className="bg-card border-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">Transparansi Sync</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-32 w-full" />
        </CardContent>
      </Card>
    );
  }

  const run = status?.lastSyncRun ?? null;
  const history = status?.recentSyncRuns ?? [];
  const isRunning = Boolean(status?.isRunning);
  const stale = Boolean(status?.staleRunning);
  const runningAge = status?.runningAgeSeconds ?? null;

  const insertRatioPct =
    run?.insertRatio != null ? Math.round(run.insertRatio * 100) : null;

  return (
    <Card className="bg-card border-border">
      <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
        <div>
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Transparansi Sync
          </CardTitle>
          <p className="text-[11px] text-muted-foreground/70 mt-0.5">
            Apa yang ditarik, berapa yang tersimpan, dan apa yang gagal — langsung dari
            riwayat <span className="font-mono">sync_runs</span>.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isRunning ? (
            <Badge variant="outline" className="gap-1 bg-sky-500/15 text-sky-400 border-sky-500/30">
              <Loader2 className="w-3 h-3 animate-spin" />
              Berjalan{runningAge != null ? ` · ${runningAge}s` : ""}
            </Badge>
          ) : stale ? (
            <Badge variant="outline" className="gap-1 bg-red-500/15 text-red-400 border-red-500/30">
              <TimerOff className="w-3 h-3" />
              Run macet
            </Badge>
          ) : (
            <Badge variant="outline" className="gap-1">
              <Clock className="w-3 h-3" />
              Idle
            </Badge>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {!run ? (
          <div className="rounded-lg border border-dashed border-border p-4 text-center">
            <History className="w-5 h-5 mx-auto text-muted-foreground/60" />
            <p className="mt-2 text-sm text-muted-foreground">
              Belum ada riwayat sync tercatat.
            </p>
            <p className="text-[11px] text-muted-foreground/70">
              Tabel <span className="font-mono">sync_runs</span> kosong — artinya belum
              pernah ada proses sync yang berjalan sejak pencatatan dibuat.
            </p>
          </div>
        ) : (
          <>
            {/* Peringatan run macet — penting: proses mati di tengah jalan
                (mis. fungsi Vercel kehabisan waktu) meninggalkan status
                `running` selamanya bila tidak ditandai. */}
            {stale ? (
              <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3">
                <div className="flex items-start gap-2">
                  <TimerOff className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-xs font-medium text-red-300">
                      Proses sync kemungkinan berhenti di tengah jalan
                    </p>
                    <p className="text-[11px] text-red-300/80">
                      Status masih <span className="font-mono">running</span> selama{" "}
                      {runningAge ?? 0} detik, melewati ambang{" "}
                      {status?.staleThresholdSeconds ?? 600} detik. Pada Vercel, fungsi
                      diputus setelah 60 detik — bila sync lebih lama, ia terhenti tanpa
                      menulis status akhir.
                    </p>
                  </div>
                </div>
              </div>
            ) : null}

            {run.errorMessage ? (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5">
                <p className="text-[11px] font-medium text-amber-300">Pesan terakhir</p>
                <p className="text-[11px] text-amber-300/80 break-words">{run.errorMessage}</p>
              </div>
            ) : null}

            {/* Angka "811 ditarik / 0 tersimpan" terlihat seperti kegagalan.
                Hampir selalu bukan: semua event di luar jendela pemindaian,
                atau sudah tersinkron. Penjelasan ini yang membedakan
                "tidak ada yang baru" dari "ada yang rusak". */}
            {run.zeroInsertReason ? (
              <div className="rounded-lg border border-border bg-muted/40 p-2.5">
                <p className="text-[11px] font-medium text-foreground/80">
                  Kenapa 0 tersimpan?
                </p>
                <p className="text-[11px] text-muted-foreground">{run.zeroInsertReason}</p>
                {status?.scanDays != null ? (
                  <p className="mt-1 text-[10px] text-muted-foreground/70">
                    Jendela pemindaian saat ini: <span className="font-mono">{status.scanDays}</span> hari
                  </p>
                ) : null}
              </div>
            ) : null}

            {/* Metrik run terakhir */}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
              <Metric
                label="Status"
                value={run.status}
                hint={formatRelative(run.finishedAt ?? run.startedAt)}
                Icon={Activity}
                tone={
                  run.status === "completed"
                    ? "good"
                    : run.status === "failed"
                      ? "bad"
                      : run.status === "partial"
                        ? "warn"
                        : "default"
                }
              />
              <Metric
                label="Durasi"
                value={formatDuration(run.durationMs)}
                hint={run.durationMs == null ? "belum selesai" : "dari mulai ke selesai"}
                Icon={Gauge}
              />
              <Metric
                label="Event ditarik"
                value={formatCount(run.eventsFetched)}
                hint={`${run.leagueCount} liga`}
                Icon={ArrowDownToLine}
              />
              <Metric
                label="Tersimpan"
                value={formatCount(run.eventsInserted)}
                hint={insertRatioPct != null ? `${insertRatioPct}% dari ditarik` : "tidak ada data"}
                Icon={Database}
                tone={insertRatioPct != null && insertRatioPct < 50 ? "warn" : "good"}
              />
              <Metric
                label="Snapshot odds"
                value={formatCount(run.oddsFetched)}
                hint="baris harga tersimpan"
                Icon={Activity}
              />
              <Metric
                label="Error"
                value={formatCount(run.errors)}
                hint={run.rateLimitedSeconds > 0 ? `RL ${run.rateLimitedSeconds}s` : "tanpa rate limit"}
                Icon={run.errors > 0 ? AlertTriangle : CheckCircle2}
                tone={run.errors > 0 ? "bad" : "good"}
              />
            </div>

            {/* Riwayat beberapa run terakhir */}
            {history.length > 1 ? (
              <div className="rounded-lg border border-border overflow-hidden">
                <div className="px-3 py-2 bg-muted/40 text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <History className="w-3 h-3" />
                  Riwayat {history.length} sync terakhir
                </div>
                <div className="divide-y divide-border">
                  {history.map((row: SyncRunSummary) => (
                    <div
                      key={`${row.id ?? "x"}-${row.startedAt}`}
                      className="px-3 py-2 text-[11px] grid grid-cols-[auto_1fr_auto] gap-x-3 gap-y-0.5 items-center"
                    >
                      <StatusBadge status={row.status} />
                      <span className="text-muted-foreground truncate">
                        {formatRelative(row.finishedAt ?? row.startedAt)} ·{" "}
                        <span className="tabular-nums">{formatCount(row.eventsFetched)}</span> ditarik ·{" "}
                        <span className="tabular-nums">{formatCount(row.eventsInserted)}</span> tersimpan ·{" "}
                        <span className="tabular-nums">{formatCount(row.oddsFetched)}</span> odds
                      </span>
                      <span className="tabular-nums text-muted-foreground/80 text-right">
                        {formatDuration(row.durationMs)}
                        {row.errors > 0 ? (
                          <span className="text-red-400"> · {row.errors} err</span>
                        ) : null}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}
