import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import ReactMarkdown from "react-markdown";
import {
  ArrowRight,
  BrainCircuit,
  CheckCircle2,
  ClipboardCheck,
  ExternalLink,
  Filter,
  RefreshCw,
  Sparkles,
  Target,
} from "lucide-react";
import { format } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { usePredictionBoard, type AIPredictionBoardItem } from "@/api/parlay-hooks";
import { formatLeagueName } from "@/utils/format-league";
import {
  readSelectedPredictionIds,
  writeSelectedPredictionIds,
} from "@/utils/prediction-selection";

function predictionStatusClass(prediction: AIPredictionBoardItem) {
  if (prediction.isSelectable) return "border-emerald-500/30 bg-emerald-500/5 text-emerald-400";
  if (prediction.status.toLowerCase() === "invalidated") return "border-red-500/30 bg-red-500/5 text-red-400";
  return "border-amber-500/30 bg-amber-500/5 text-amber-400";
}

function formatPercent(value: number | null) {
  return value == null ? "—" : `${(value * 100).toFixed(1)}%`;
}

function formatEv(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

function PredictionCard({
  prediction,
  selected,
  onToggle,
}: {
  prediction: AIPredictionBoardItem;
  selected: boolean;
  onToggle: () => void;
}) {
  const statusLabel = prediction.isSelectable
    ? prediction.isInParlay
      ? "IN PARLAY"
      : "READY"
    : prediction.status.toUpperCase();

  return (
    <article
      className={`rounded-xl border p-4 transition-colors ${
        selected
          ? "border-primary/70 bg-primary/10 shadow-[0_0_0_1px_rgba(34,211,238,0.18)]"
          : "border-border bg-card/70 hover:border-primary/30 hover:bg-secondary/20"
      }`}
    >
      <div className="flex items-start gap-3">
        <Checkbox
          aria-label={`Pilih ${prediction.homeTeam} vs ${prediction.awayTeam}`}
          checked={selected}
          onCheckedChange={onToggle}
          disabled={!prediction.isSelectable}
          className="mt-1"
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="text-base font-semibold leading-tight">
                {prediction.homeTeam} <span className="text-muted-foreground">vs</span> {prediction.awayTeam}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span>{formatLeagueName(prediction.league)}</span>
                <span className="text-border">•</span>
                <span>
                  {prediction.fixtureDate
                    ? format(new Date(prediction.fixtureDate), "MMM dd, yyyy · HH:mm")
                    : "Kickoff unavailable"}
                </span>
              </div>
            </div>
            <div className="flex flex-wrap gap-1">
              <Badge variant="outline" className={predictionStatusClass(prediction)}>
                {statusLabel}
              </Badge>
              {selected && (
                <Badge className="gap-1 bg-primary/20 text-primary hover:bg-primary/20">
                  <ClipboardCheck className="h-3 w-3" />
                  QUEUED
                </Badge>
              )}
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
            <div className="rounded-lg border border-border/70 bg-background/50 p-2">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Market</div>
              <div className="mt-1 truncate text-sm font-semibold text-primary" title={prediction.market}>
                {prediction.market}
              </div>
            </div>
            <div className="rounded-lg border border-border/70 bg-background/50 p-2">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Selection</div>
              <div className="mt-1 truncate text-sm font-semibold" title={prediction.selection}>
                {prediction.selection}
              </div>
            </div>
            <div className="rounded-lg border border-border/70 bg-background/50 p-2">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Odds</div>
              <div className="mt-1 text-sm font-semibold tabular-nums">{prediction.odds?.toFixed(2) ?? "—"}</div>
            </div>
            <div className="rounded-lg border border-border/70 bg-background/50 p-2">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Probability</div>
              <div className="mt-1 text-sm font-semibold tabular-nums">{formatPercent(prediction.probability)}</div>
            </div>
            <div className="rounded-lg border border-border/70 bg-background/50 p-2">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Confidence</div>
              <div className="mt-1 text-sm font-semibold tabular-nums">{prediction.confidence.toFixed(1)}</div>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
            <span className={`font-semibold ${prediction.ev >= 0 ? "text-emerald-400" : "text-red-400"}`}>
              EV {formatEv(prediction.ev)}
            </span>
            <span className="text-muted-foreground">
              Analysed {format(new Date(prediction.createdAt), "MMM dd · HH:mm")}
            </span>
            <Link
              href={`/fixtures?fixture=${prediction.fixtureId}`}
              className="inline-flex items-center gap-1 text-primary hover:underline"
            >
              Lihat fixture <ExternalLink className="h-3 w-3" />
            </Link>
          </div>

          {prediction.predictionText && (
            <div className="mt-4 rounded-lg border border-primary/15 bg-primary/[0.04] p-3">
              <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-primary">
                <Sparkles className="h-3.5 w-3.5" />
                AI analysis summary
              </div>
              <div className="prose prose-invert prose-sm max-w-none text-xs leading-relaxed text-muted-foreground [&_strong]:text-foreground [&_p]:my-1 [&_ul]:my-1 [&_li]:my-0">
                <ReactMarkdown>{prediction.predictionText}</ReactMarkdown>
              </div>
            </div>
          )}

          {!prediction.isSelectable && (
            <div className="mt-3 text-xs text-amber-400">
              {prediction.status.toLowerCase() !== "active"
                ? "Prediksi berstatus histori atau settlement."
                : !prediction.isUpcoming
                  ? "Fixture sudah kickoff atau selesai."
                  : "Belum bisa dipilih: market, odds, atau probabilitas belum lengkap."}
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

export default function RiskCenter() {
  const { data: predictions = [], isLoading, isError, refetch, isFetching } = usePredictionBoard();
  const [selectedIds, setSelectedIds] = useState<string[]>(readSelectedPredictionIds);
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    writeSelectedPredictionIds(selectedIds);
  }, [selectedIds]);

  const visiblePredictions = useMemo(
    () => predictions.filter((prediction) => showHistory || prediction.isUpcoming),
    [predictions, showHistory],
  );
  const selectableCount = predictions.filter((prediction) => prediction.isSelectable).length;

  const togglePrediction = (id: string) => {
    setSelectedIds((current) => {
      if (current.includes(id)) return current.filter((value) => value !== id);
      return current.length < 7 ? [...current, id] : current;
    });
  };

  const clearUnavailable = () => {
    const selectableIds = new Set(predictions.filter((prediction) => prediction.isSelectable).map((prediction) => prediction.id));
    setSelectedIds((current) => current.filter((id) => selectableIds.has(id)));
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-primary">
            <BrainCircuit className="h-4 w-4" />
            AI decision workspace
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">AI Prediction Board</h1>
          <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
            Semua hasil scanning dan analisis AI ada di sini. Tinjau market, selection, odds, probabilitas, confidence,
            EV, dan ringkasan analisis sebelum memilih pertandingan untuk AI Parlays.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => void refetch()} disabled={isFetching}>
            <RefreshCw className={isFetching ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
            Refresh board
          </Button>
          <Button variant="outline" size="sm" onClick={() => setShowHistory((current) => !current)}>
            <Filter className="h-4 w-4" />
            {showHistory ? "Hide history" : "Show history"}
          </Button>
          <Button asChild size="sm" disabled={selectedIds.length === 0}>
            <Link href="/parlays">
              Buka AI Parlays ({selectedIds.length})
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="border-primary/20 bg-primary/[0.04]">
          <CardContent className="flex items-center gap-3 p-4">
            <Target className="h-5 w-5 text-primary" />
            <div>
              <div className="text-2xl font-semibold tabular-nums">{visiblePredictions.length}</div>
              <div className="text-xs text-muted-foreground">{showHistory ? "Visible predictions" : "Upcoming predictions"}</div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-emerald-500/20 bg-emerald-500/[0.04]">
          <CardContent className="flex items-center gap-3 p-4">
            <CheckCircle2 className="h-5 w-5 text-emerald-400" />
            <div>
              <div className="text-2xl font-semibold tabular-nums text-emerald-400">{selectableCount}</div>
              <div className="text-xs text-muted-foreground">Ready for selection</div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-amber-500/20 bg-amber-500/[0.04]">
          <CardContent className="flex items-center gap-3 p-4">
            <ClipboardCheck className="h-5 w-5 text-amber-400" />
            <div>
              <div className="text-2xl font-semibold tabular-nums text-amber-400">{selectedIds.length}/7</div>
              <div className="text-xs text-muted-foreground">Queued for AI Parlays</div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="border-primary/20 bg-primary/[0.02]">
        <CardHeader className="flex flex-col gap-3 border-b border-border/60 pb-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-lg">
              <BrainCircuit className="h-5 w-5 text-primary" />
              Scanning & analysis results
            </CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              Checkbox tetap tersimpan saat berpindah halaman atau reload. Maksimal 7 prediksi per parlay.
            </p>
          </div>
          {selectedIds.length > 0 && (
            <Button variant="ghost" size="sm" onClick={clearUnavailable}>
              Bersihkan pilihan tidak valid
            </Button>
          )}
        </CardHeader>
        <CardContent className="pt-5">
          {isLoading ? (
            <div className="grid gap-3 xl:grid-cols-2">
              <Skeleton className="h-64 w-full" />
              <Skeleton className="h-64 w-full" />
            </div>
          ) : isError ? (
            <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-5 text-sm text-red-400">
              Prediction Board belum dapat dimuat. Coba refresh kembali setelah API siap.
            </div>
          ) : visiblePredictions.length ? (
            <div className="grid gap-3 xl:grid-cols-2">
              {visiblePredictions.map((prediction) => (
                <PredictionCard
                  key={prediction.id}
                  prediction={prediction}
                  selected={selectedIds.includes(prediction.id)}
                  onToggle={() => togglePrediction(prediction.id)}
                />
              ))}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-border p-8 text-center">
              <BrainCircuit className="mx-auto h-8 w-8 text-muted-foreground" />
              <p className="mt-3 text-sm text-muted-foreground">
                Belum ada hasil analisis untuk fixture mendatang dengan odds dan probabilitas valid.
              </p>
              <Button asChild variant="outline" size="sm" className="mt-4">
                <Link href="/fixtures">Periksa fixtures & odds</Link>
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}