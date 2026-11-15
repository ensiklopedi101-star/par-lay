/**
 * Panel backtest gudang riset: model inti Poisson vs pasar di ±16 ribu
 * pertandingan historis + uji fitur Elo (latih/validasi).
 *
 * Ini panggung pembuktian skala besar untuk fondasi model — sampel
 * produksi (±150) terlalu kecil untuk vonis parameter. Angka di sini
 * TIDAK mengubah jalur live; adopsi fitur tetap PR tersendiri.
 */
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Database, FlaskConical } from "lucide-react";
import type { WarehouseBacktestData, WarehouseMetricData } from "@/api/parlay-hooks";

function pctSigned(value: number): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${(value * 100).toFixed(2)}%`;
}

function skillText(metric: WarehouseMetricData | null | undefined): string {
  if (!metric?.vsMarket) return "—";
  const t = metric.vsMarket.tStat != null ? metric.vsMarket.tStat.toFixed(2) : "—";
  return `${pctSigned(metric.vsMarket.skill)} (t=${t}, n=${metric.vsMarket.n})`;
}

export function WarehouseBacktestPanel({
  data,
  isLoading,
}: {
  data?: WarehouseBacktestData;
  isLoading: boolean;
}) {
  return (
    <Card className="shadow-none">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Database className="h-4 w-4 text-primary" />
          Backtest Gudang Riset (Historis)
          {data && (
            <Badge variant="secondary" className="ml-1 font-normal">
              {data.matchesInWarehouse.toLocaleString("id-ID")} pertandingan
            </Badge>
          )}
        </CardTitle>
        <p className="text-xs leading-relaxed text-muted-foreground">
          Model inti Poisson (λ dari laju gol musim sebelumnya, tanpa xG yang memang tidak
          tersedia historis) melawan odds penutup dataset xgabora di 7 liga sejak 2021.
          Latih sebelum Agu 2024, validasi sejak itu. Ini menguji fondasi model pada skala
          yang layak — bukan vonis atas jalur live.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading || !data ? (
          <div className="space-y-2">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : (
          <>
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm leading-relaxed">
              <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                <FlaskConical className="h-3 w-3" /> Vonis skala besar
              </div>
              {data.prior.verdict}
            </div>

            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <div className="rounded-lg border border-border bg-muted/30 p-3">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Skill 1X2 (semua)</div>
                <div className="mt-1 text-lg font-semibold tabular-nums">
                  {data.prior.full.vsMarket ? pctSigned(data.prior.full.vsMarket.skill) : "—"}
                </div>
                <div className="text-[11px] text-muted-foreground">{skillText(data.prior.full)}</div>
              </div>
              <div className="rounded-lg border border-border bg-muted/30 p-3">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Skill 1X2 (validasi)</div>
                <div className="mt-1 text-lg font-semibold tabular-nums">
                  {data.prior.validation.vsMarket ? pctSigned(data.prior.validation.vsMarket.skill) : "—"}
                </div>
                <div className="text-[11px] text-muted-foreground">{skillText(data.prior.validation)}</div>
              </div>
              <div className="rounded-lg border border-border bg-muted/30 p-3">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Over 2.5 vs pasar</div>
                <div className="mt-1 text-lg font-semibold tabular-nums">
                  {data.prior.full.over25VsMarket ? pctSigned(data.prior.full.over25VsMarket.skill) : "—"}
                </div>
                <div className="text-[11px] text-muted-foreground">
                  t={data.prior.full.over25VsMarket?.tStat != null ? data.prior.full.over25VsMarket.tStat.toFixed(2) : "—"} · n={data.prior.full.over25VsMarket?.n ?? 0}
                </div>
              </div>
              <div className="rounded-lg border border-border bg-muted/30 p-3">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Asian Handicap</div>
                <div className="mt-1 text-lg font-semibold tabular-nums">
                  {data.prior.ahFull ? pctSigned(data.prior.ahFull.skill) : "—"}
                </div>
                <div className="text-[11px] text-muted-foreground">
                  cover kandang · n={data.prior.ahFull?.n ?? 0}
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm leading-relaxed">
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Uji fitur Elo (campuran ke λ)
              </div>
              <p>
                Grid kekuatan di data latih:{" "}
                {data.elo.grid
                  .map((g) => `k=${g.k}: ${g.trainSkill != null ? pctSigned(g.trainSkill) : "—"}`)
                  .join(" · ")}
              </p>
              <p className="mt-2">
                Terpilih k={data.elo.bestK ?? "—"} → skill validasi{" "}
                {data.elo.validation ? skillText(data.elo.validation) : "—"} vs model dasar{" "}
                {skillText(data.prior.validation)}. {data.elo.note}
              </p>
              <Badge
                variant="secondary"
                className={data.elo.adoptionJustified ? "mt-2 bg-emerald-500/15 text-emerald-600" : "mt-2"}
              >
                {data.elo.adoptionJustified ? "Elo layak diadopsi (PR tersendiri)" : "Elo belum diadopsi"}
              </Badge>
            </div>

            {data.ticketStrategies && data.ticketStrategies.length > 0 && (
              <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm leading-relaxed">
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Simulasi tiket mingguan 5–8 leg (1X2, peluang ≥ 60%)
                </div>
                <div className="space-y-1.5">
                  {data.ticketStrategies.map((s) => (
                    <div key={s.strategy} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs">
                      <span className="w-44 font-medium">{s.strategy}</span>
                      <span>{s.tickets} tiket</span>
                      <span>leg kena {s.legHitRate != null ? `${(s.legHitRate * 100).toFixed(1)}%` : "—"}</span>
                      <span>tiket kena {s.ticketHitRate != null ? `${(s.ticketHitRate * 100).toFixed(1)}%` : "—"}</span>
                      <span>rata-rata odds {s.avgCombinedOdds != null ? s.avgCombinedOdds.toFixed(2) : "—"}</span>
                      <span className={s.roi != null && s.roi >= 0 ? "text-emerald-600" : "text-red-500"}>
                        ROI {s.roi != null ? `${(s.roi * 100).toFixed(1)}%` : "—"}
                      </span>
                    </div>
                  ))}
                </div>
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Pasar-dulu memilih favorit pasar; model-dulu memilih favorit Poisson;
                  filter menuntut keduanya sepakat. Varian harga-terbaik memakai odds
                  maksimum antar bandar dari dataset untuk leg yang sama persis — itu
                  batas atas nilai berburu harga, karena parlay nyata biasanya terikat
                  satu bandar; yang bisa dikejar adalah bandar terbaik secara keseluruhan
                  dan harga terbaik per leg untuk taruhan tunggal.
                </p>
              </div>
            )}

            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Cakupan: {data.considered.toLocaleString("id-ID")} pertandingan dinilai ·{" "}
              {data.skippedNoPrior.toLocaleString("id-ID")} dilewati tanpa prior musim sebelumnya
              di divisi yang sama (tim promosi & musim pertama) · {data.skippedNoMarket} tanpa
              odds historis. Kalibrasi ECE{" "}
              {data.prior.calibrationEce != null ? `${(data.prior.calibrationEce * 100).toFixed(1)} poin` : "—"}.
              Diperbarui {new Date(data.generatedAt).toLocaleString("id-ID")}.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
