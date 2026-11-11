/**
 * Panel status otomatisasi.
 *
 * Menjawab pertanyaan yang tidak bisa dijawab panel sync: bukan "kapan sync
 * terakhir", melainkan **tugas mana yang tidak akan pernah berjalan sendiri**.
 *
 * Kegagalan yang membuat panel ini ada: penarikan skor akhir sudah ada kodenya
 * dan sudah benar, tetapi hanya dijadwalkan oleh `node-cron` di
 * `scheduler/index.ts` — dan scheduler itu tidak hidup di Vercel karena `PORT`
 * tidak diset. Akibatnya skor tidak pernah diminta ulang, settlement tidak
 * pernah punya bahan, dan selama berminggu-minggu tidak ada satu layar pun yang
 * memperlihatkan sebabnya.
 *
 * Semua angka berasal dari server (`/api/sync/automation-status`).
 */

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle, CalendarClock, CheckCircle2, Clock, Info, XCircle } from "lucide-react";
import type { AutomationStatus } from "@/api/parlay-hooks";

/** Nama aksi dalam bahasa manusia, supaya tidak perlu membaca kode. */
const ACTION_LABEL: Record<string, string> = {
  sync: "Tarik jadwal & odds",
  results: "Tarik skor akhir",
  closing: "Simpan odds penutup",
  outcomes: "Isi hasil ledger",
};

function actionLabel(action: string): string {
  return ACTION_LABEL[action] ?? action;
}

export function AutomationStatusPanel({ status }: { status?: AutomationStatus; isLoading?: boolean }) {
  if (!status) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <CalendarClock className="h-4 w-4" />
            Jadwal Otomatis
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-24 w-full" />
        </CardContent>
      </Card>
    );
  }

  const gaps = status.gaps ?? [];
  const healthy = gaps.length === 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <CalendarClock className="h-4 w-4" />
          Jadwal Otomatis
          {healthy ? (
            <Badge variant="outline" className="ml-auto border-emerald-500/40 text-emerald-600">
              <CheckCircle2 className="mr-1 h-3 w-3" />
              semua terjadwal
            </Badge>
          ) : (
            <Badge variant="outline" className="ml-auto border-amber-500/40 text-amber-600">
              <AlertTriangle className="mr-1 h-3 w-3" />
              {gaps.length} tugas tidak berjalan
            </Badge>
          )}
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Tugas mana yang benar-benar berjalan tanpa disentuh manusia — dan mana yang hanya
          tampak berjalan.
        </p>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* ── Celah: tugas yang tidak akan pernah berjalan sendiri ── */}
        {gaps.length > 0 && (
          <div className="space-y-2">
            {gaps.map((gap) => (
              <div
                key={gap.action}
                className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3"
              >
                <div className="flex items-start gap-2">
                  {gap.onlyOnDeadScheduler ? (
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                  ) : (
                    <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">{actionLabel(gap.action)}</span>
                      <Badge variant="secondary" className="text-[10px]">
                        {gap.unscheduled ? "tanpa jadwal" : "jadwal mati"}
                      </Badge>
                    </div>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                      {gap.consequence}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── Pemicu yang terbaca ── */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs font-medium text-muted-foreground">
            <span>Pemicu terjadwal</span>
            <span>
              {status.coveredByVercel.length} tugas &middot; tiap {status.maxGapHours} jam
            </span>
          </div>
          {(status.triggers ?? []).map((trigger, index) => (
            <div
              key={`${trigger.source}-${trigger.action}-${index}`}
              className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/30 px-2.5 py-1.5 text-xs"
            >
              <Clock className="h-3 w-3 shrink-0 text-muted-foreground" />
              <span className="font-mono text-[11px]">{trigger.schedule}</span>
              <span className="text-muted-foreground">
                {trigger.covers.map(actionLabel).join(" + ")}
              </span>
              <Badge
                variant="outline"
                className={
                  trigger.source === "vercel"
                    ? "ml-auto border-emerald-500/40 text-[10px] text-emerald-600"
                    : "ml-auto border-rose-500/40 text-[10px] text-rose-600"
                }
              >
                {trigger.source === "vercel" ? "Vercel" : "node-cron (mati)"}
              </Badge>
            </div>
          ))}
        </div>

        {/* ── Dampak nyata ── */}
        {status.fixturesAwaitingScore > 0 && (
          <div className="rounded-md border border-rose-500/30 bg-rose-500/5 p-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <AlertTriangle className="h-4 w-4 text-rose-600" />
              {status.fixturesAwaitingScore.toLocaleString("id-ID")} fixture menunggu skor
            </div>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              Pertandingan ini sudah selesai tetapi skornya tidak pernah ditarik. Selama skornya
              kosong, tidak ada yang bisa disettle — berapa pun lama ditunggu.
            </p>
          </div>
        )}

        {/* ── Catatan jujur dari server ── */}
        {(status.notes ?? []).length > 0 && (
          <div className="space-y-1.5 rounded-md border bg-muted/30 p-3">
            <div className="flex items-center gap-1.5 text-xs font-medium">
              <Info className="h-3.5 w-3.5" />
              Penjelasan
            </div>
            <ul className="space-y-1 text-xs leading-relaxed text-muted-foreground">
              {status.notes.map((note, index) => (
                <li key={index} className="flex gap-1.5">
                  <span className="text-muted-foreground/60">•</span>
                  <span>{note}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default AutomationStatusPanel;
