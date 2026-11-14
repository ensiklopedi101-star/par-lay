/**
 * Panel backtest model Poisson vs pasar.
 *
 * Menjawab pertanyaan yang tidak bisa dijawab hit-rate: apakah
 * probabilitas model lebih akurat daripada probabilitas pasar pada
 * pertandingan yang sama? Model dinilai dari prior musim lalu terhadap
 * hasil musim ini (tanpa look-ahead), pasar dari snapshot terakhir
 * sebelum kick-off. Vonis di panel ini kata per kata dari server.
 */
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Crosshair, FlaskConical } from "lucide-react";
import type { ModelBacktestReportData } from "@/api/parlay-hooks";

function fmt(value: number, digits = 3): string {
  return Number.isFinite(value) ? value.toFixed(digits) : "—";
}

function pctSigned(value: number): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${(value * 100).toFixed(2)}%`;
}

export function ModelBacktestPanel({
  data,
  isLoading,
}: {
  data?: ModelBacktestReportData;
  isLoading: boolean;
}) {
  const report = data?.report;
  const vsMarket = report?.oneX2.vsMarket ?? null;
  const skillGood = vsMarket != null && vsMarket.skill > 0 && (vsMarket.tStat ?? 0) >= 2;
  const skillBad = vsMarket != null && vsMarket.skill <= 0;

  return (
    <Card className="shadow-none">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <FlaskConical className="h-4 w-4 text-primary" />
          Backtest Model vs Pasar
          {report && (
            <Badge variant="secondary" className="ml-1 font-normal">
              n={report.samples} pertandingan
            </Badge>
          )}
        </CardTitle>
        <p className="text-xs leading-relaxed text-muted-foreground">
          Model Poisson dinilai dari statistik musim 2025-26 (prior, tanpa melihat hasil) terhadap
          pertandingan 2026-27 yang sudah selesai. Pembandingnya adalah probabilitas pasar dari
          snapshot odds terakhir sebelum kick-off. Skill positif berarti model lebih akurat dari pasar.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading || !report ? (
          <div className="space-y-2">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : (
          <>
            <div
              className={`rounded-lg border p-3 text-sm leading-relaxed ${
                skillGood
                  ? "border-emerald-500/30 bg-emerald-500/5"
                  : skillBad
                    ? "border-red-500/30 bg-red-500/5"
                    : "border-amber-500/30 bg-amber-500/5"
              }`}
            >
              <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                <Crosshair className="h-3 w-3" /> Vonis
              </div>
              {report.verdict}
            </div>

            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <div className="rounded-lg border border-border bg-muted/30 p-3">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Skill vs pasar (log-loss)</div>
                <div className="mt-1 text-lg font-semibold tabular-nums">
                  {vsMarket ? pctSigned(vsMarket.skill) : "—"}
                </div>
                <div className="text-[11px] text-muted-foreground">
                  {vsMarket
                    ? `t=${vsMarket.tStat != null ? vsMarket.tStat.toFixed(2) : "—"} · n=${vsMarket.n} vs pasar`
                    : "pasar tidak tersedia"}
                </div>
              </div>
              <div className="rounded-lg border border-border bg-muted/30 p-3">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Log-loss model (1X2)</div>
                <div className="mt-1 text-lg font-semibold tabular-nums">{fmt(report.oneX2.modelLogLoss)}</div>
                <div className="text-[11px] text-muted-foreground">
                  pasar {vsMarket ? fmt(vsMarket.marketLogLoss) : "—"} · makin kecil makin akurat
                </div>
              </div>
              <div className="rounded-lg border border-border bg-muted/30 p-3">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Kalibrasi (ECE)</div>
                <div className="mt-1 text-lg font-semibold tabular-nums">
                  {report.calibrationEce != null ? `${(report.calibrationEce * 100).toFixed(1)} poin` : "—"}
                </div>
                <div className="text-[11px] text-muted-foreground">target ≤ 5 poin</div>
              </div>
              <div className="rounded-lg border border-border bg-muted/30 p-3">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Ketepatan argmax 1X2</div>
                <div className="mt-1 text-lg font-semibold tabular-nums">
                  {(report.oneX2.argmaxHitRate * 100).toFixed(1)}%
                </div>
                <div className="text-[11px] text-muted-foreground">konteks saja — bukan bukti nilai betting</div>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                    <th className="py-2 pr-3 font-medium">Liga</th>
                    <th className="py-2 pr-3 font-medium">n</th>
                    <th className="py-2 pr-3 font-medium">Log-loss model</th>
                    <th className="py-2 font-medium">Skill vs pasar</th>
                  </tr>
                </thead>
                <tbody>
                  {report.byLeague.map((row) => (
                    <tr key={row.league} className="border-b border-border/50">
                      <td className="py-2 pr-3">{row.league}</td>
                      <td className="py-2 pr-3 tabular-nums">{row.n}</td>
                      <td className="py-2 pr-3 tabular-nums">{fmt(row.modelLogLoss)}</td>
                      <td className="py-2 tabular-nums">
                        {row.vsMarket
                          ? `${pctSigned(row.vsMarket.skill)} (t=${row.vsMarket.tStat != null ? row.vsMarket.tStat.toFixed(2) : "—"})`
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Cakupan: {data.fixturesTotal} pertandingan selesai · {data.skippedNoStats} dilewati karena
              statistik prior salah satu tim tidak ada (mis. tim promosi) · {data.skippedNoMarket} tanpa
              snapshot pasar pra-pertandingan. Over 2.5 log-loss {fmt(report.over25.logLoss)} · BTTS{" "}
              {fmt(report.btts.logLoss)}. Diperbarui {new Date(data.generatedAt).toLocaleString("id-ID")}.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
