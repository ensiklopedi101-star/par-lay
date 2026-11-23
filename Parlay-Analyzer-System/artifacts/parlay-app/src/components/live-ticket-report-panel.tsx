import { Scale } from "lucide-react";
import { useLiveTicketReport, type LiveVariantSlice } from "@/api/parlay-hooks";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

/**
 * Laporan Tiket Live (Fase B) — bukti dari snapshot yang benar-benar
 * tercatat dan ter-settle, bukan backtest. Hit-rate dibandingkan
 * terhadap probabilitas yang dijanjikan saat tiket dicatat; sampel
 * kecil dilabeli apa adanya supaya tidak dibaca sebagai klaim.
 */

const pctText = (value: number | null): string =>
  value == null ? "—" : `${Math.round(value * 100)}%`;

const roiText = (value: number | null): string =>
  value == null ? "—" : `${value >= 0 ? "+" : ""}${Math.round(value * 100)}%`;

const VARIANT_EMOJI: Record<string, string> = {
  Utama: "🎯",
  Booster: "🚀",
  Jackpot: "💎",
};

function VariantCard({ slice }: { slice: LiveVariantSlice }) {
  return (
    <div className="min-w-[220px] flex-1 rounded-md border p-3">
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold">
          {VARIANT_EMOJI[slice.variant] ?? "🎫"} {slice.variant}
        </span>
        {!slice.sampleSufficient && slice.settled > 0 && (
          <Badge variant="outline" className="text-[10px]">sampel kecil</Badge>
        )}
      </div>
      <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        <span className="text-muted-foreground">Tercatat</span>
        <span className="text-right font-medium">{slice.recorded} tiket</span>
        <span className="text-muted-foreground">Menang / kalah</span>
        <span className="text-right font-medium">
          {slice.settled > 0 ? `${slice.won} / ${slice.lost}` : "belum settled"}
        </span>
        <span className="text-muted-foreground">Hit-rate aktual</span>
        <span className="text-right font-medium">{pctText(slice.hitRate)}</span>
        <span className="text-muted-foreground">Janji probabilitas</span>
        <span className="text-right font-medium">{pctText(slice.avgPromisedProb)}</span>
        <span className="text-muted-foreground">Selisih kalibrasi</span>
        <span className="text-right font-medium">
          {slice.calibrationGap == null
            ? "—"
            : `${slice.calibrationGap >= 0 ? "+" : ""}${Math.round(slice.calibrationGap * 100)} poin`}
        </span>
        <span className="text-muted-foreground">ROI per tiket</span>
        <span className="text-right font-medium">{roiText(slice.roi)}</span>
        <span className="text-muted-foreground">Leg tepat</span>
        <span className="text-right font-medium">
          {slice.legsSettled > 0 ? `${pctText(slice.legHitRate)} (${slice.legsSettled} leg)` : "—"}
        </span>
      </div>
    </div>
  );
}

export function LiveTicketReportPanel() {
  const { data, isLoading } = useLiveTicketReport();

  return (
    <Card>
      <CardContent className="space-y-3 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <Scale className="h-5 w-5 text-primary" />
          <div className="text-base font-semibold">Laporan Tiket Live</div>
          <Badge variant="outline" className="text-[10px]">Fase B — bukti nyata, bukan backtest</Badge>
        </div>

        {isLoading || !data ? (
          <p className="text-xs text-muted-foreground">Menyusun laporan dari tiket tercatat…</p>
        ) : (
          <>
            <p className="text-xs leading-relaxed text-muted-foreground">{data.verdict}</p>
            <div className="flex flex-wrap gap-3">
              {data.variants.map((slice) => (
                <VariantCard key={slice.variant} slice={slice} />
              ))}
            </div>
            <div className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">
                  Ledger per-leg menuju gerbang Fase 3 ({data.ledger.target} settled)
                </span>
                <span className="font-medium">
                  {data.ledger.settled}/{data.ledger.target} · harga penutup terisi {data.ledger.withClose}
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-all"
                  style={{ width: `${data.ledger.pct}%` }}
                />
              </div>
              {data.generatedFrom.lateRecordedTickets > 0 && (
                <p className="text-[11px] font-medium text-destructive">
                  {data.generatedFrom.lateRecordedTickets} tiket dikeluarkan dari laporan: dicatat setelah laga
                  di dalamnya sudah dimulai (tercemar look-ahead) — bukan bukti live yang sah. Catat ulang dari
                  pratinjau di atas; komposer kini menolak pertandingan yang sudah kick-off.
                </p>
              )}
              {data.generatedFrom.legacyTickets > 0 && (
                <p className="text-[11px] text-muted-foreground">
                  {data.generatedFrom.legacyTickets} tiket lama (komposer lama) tidak dicampur ke laporan varian ini.
                </p>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
