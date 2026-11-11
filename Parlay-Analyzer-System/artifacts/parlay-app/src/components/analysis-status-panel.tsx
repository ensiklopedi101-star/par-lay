/**
 * Panel status analisis AI.
 *
 * Menjawab pertanyaan yang tidak dijawab panel mana pun: **kapan prediksi
 * terakhir lahir, dan berapa yang menunggu dianalisis?**
 *
 * Kegagalan yang membuat panel ini ada: batch scanner menyelesaikan hingga 20
 * fixture tanpa pemeriksaan waktu, lalu diputus platform pada detik ke-60.
 * Hasil yang hilang tidak meninggalkan error apa pun — satu-satunya jejak
 * adalah tidak adanya prediksi baru.
 */

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle, BrainCircuit, CheckCircle2, Clock, Info } from "lucide-react";
import type { AnalysisStatus } from "@/api/parlay-hooks";

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-md border bg-muted/20 p-2">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-sm font-semibold">{value}</div>
      {hint && <div className="text-[10px] text-muted-foreground">{hint}</div>}
    </div>
  );
}

export function AnalysisStatusPanel({
  status,
  isLoading,
}: {
  status?: AnalysisStatus;
  isLoading?: boolean;
}) {
  if (!status) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <BrainCircuit className="h-4 w-4" />
            Analisis AI
          </CardTitle>
        </CardHeader>
        <CardContent>{isLoading ? <Skeleton className="h-20 w-full" /> : null}</CardContent>
      </Card>
    );
  }

  const stale = status.hoursSinceLastPrediction === null || status.hoursSinceLastPrediction > 72;
  const waiting = status.awaitingAnalysis > 0;
  const healthy = !stale && !waiting;
  const estimateMinutes = Math.round((status.awaitingAnalysis * 15) / 60);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <BrainCircuit className="h-4 w-4" />
          Analisis AI
          {healthy ? (
            <Badge variant="outline" className="ml-auto border-emerald-500/40 text-emerald-600">
              <CheckCircle2 className="mr-1 h-3 w-3" />
              berjalan
            </Badge>
          ) : (
            <Badge variant="outline" className="ml-auto border-amber-500/40 text-amber-600">
              <AlertTriangle className="mr-1 h-3 w-3" />
              {stale && waiting ? "tertahan" : stale ? "tidak berjalan" : "ada antrean"}
            </Badge>
          )}
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Kapan prediksi terakhir lahir, dan berapa fixture yang menunggu dianalisis.
        </p>
      </CardHeader>

      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Tile
            label="Prediksi tersimpan"
            value={status.totalPredictions.toLocaleString("id-ID")}
            hint="seluruh riwayat"
          />
          <Tile
            label="Fixture akan datang"
            value={String(status.upcomingFixtures)}
            hint="10 hari ke depan"
          />
          <Tile
            label="Menunggu analisis"
            value={String(status.awaitingAnalysis)}
            hint={waiting ? `± ${estimateMinutes} menit kerja` : "tidak ada antrean"}
          />
          <Tile
            label="Prediksi terakhir"
            value={
              status.hoursSinceLastPrediction === null
                ? "belum pernah"
                : `${status.hoursSinceLastPrediction} jam lalu`
            }
            hint={status.lastPredictionAt ? "waktu simpan" : "—"}
          />
        </div>

        {stale && status.lastPredictionAt && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs">
            <div className="flex items-center gap-1.5 font-medium">
              <Clock className="h-3.5 w-3.5" />
              Prediksi tidak bertambah lebih dari 3 hari
            </div>
            <p className="mt-1 text-muted-foreground">
              Cron harian seharusnya menambah prediksi setiap hari. Jeda sepanjang ini berarti
              analisis tidak berjalan, atau selalu gagal sebelum menyimpan hasil.
            </p>
          </div>
        )}

        {waiting && (
          <div className="rounded-md border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-xs">
            <div className="flex items-center gap-1.5 font-medium">
              <AlertTriangle className="h-3.5 w-3.5 text-rose-600" />
              {status.awaitingAnalysis} fixture sudah punya harga, belum dianalisis
            </div>
            <p className="mt-1 text-muted-foreground">
              Fixture ini punya harga pasar sehingga seharusnya sudah dinilai. Selama belum,
              tidak ada prediksi, tidak ada leg untuk parlay, dan tidak ada yang bisa dievaluasi.
            </p>
          </div>
        )}

        {status.notes.length > 0 && (
          <div className="space-y-1 rounded-md border bg-muted/30 p-3">
            <div className="flex items-center gap-1.5 text-xs font-medium">
              <Info className="h-3.5 w-3.5" />
              Penjelasan
            </div>
            <ul className="space-y-1 text-xs leading-relaxed text-muted-foreground">
              {status.notes.map((note, i) => (
                <li key={i}>• {note}</li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default AnalysisStatusPanel;
