import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link } from "wouter";
import ReactMarkdown from "react-markdown";
import {
  ArrowRight,
  BrainCircuit,
  CheckCircle2,
  ClipboardCheck,
  ExternalLink,
  Filter,
  Loader2,
  RefreshCw,
  Save,
  Sparkles,
  Target,
} from "lucide-react";
import { format } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  usePredictionBoard,
  useRecordManualPredictionResult,
  type AIPredictionBoardItem,
} from "@/api/parlay-hooks";
import { formatLeagueName } from "@/utils/format-league";
import { useAdminPassword } from "@/hooks/use-admin-password";
import { AdminPasswordDialog } from "@/components/AdminPasswordDialog";
import { useToast } from "@/hooks/use-toast";
import {
  readSelectedPredictionIds,
  writeSelectedPredictionIds,
} from "@/utils/prediction-selection";

function predictionStatusClass(prediction: AIPredictionBoardItem) {
  if (prediction.isSelectable) return "border-emerald-500/30 bg-emerald-500/5 text-emerald-400";
  if (prediction.result === "WIN" || prediction.result === "HALF_WIN") {
    return "border-emerald-500/30 bg-emerald-500/5 text-emerald-400";
  }
  if (prediction.result === "LOSS" || prediction.result === "HALF_LOSS") {
    return "border-red-500/30 bg-red-500/5 text-red-400";
  }
  if (prediction.result === "PUSH") return "border-sky-500/30 bg-sky-500/5 text-sky-400";
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
  onEnterScore,
}: {
  prediction: AIPredictionBoardItem;
  selected: boolean;
  onToggle: () => void;
  onEnterScore: () => void;
}) {
  const statusLabel = prediction.result
    ?? (prediction.status.toLowerCase() === "pending_result" ? "PENDING RESULT" : null)
    ?? (prediction.isSelectable
      ? prediction.isInParlay
        ? "IN PARLAY"
        : "READY"
      : prediction.status.toUpperCase());

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
              {prediction.decision && (
                <Badge
                  variant="outline"
                  className={
                    prediction.decision === "AMBIL"
                      ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-400"
                      : "border-red-500/30 bg-red-500/5 text-red-400"
                  }
                >
                  {prediction.decision}
                </Badge>
              )}
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
            {prediction.homeScore != null && prediction.awayScore != null && (
              <span className="font-semibold text-foreground">
                Score {prediction.homeScore}–{prediction.awayScore}
              </span>
            )}
            {prediction.result && (
              <span className={`font-semibold ${
                prediction.result === "WIN" || prediction.result === "HALF_WIN"
                  ? "text-emerald-400"
                  : prediction.result === "LOSS" || prediction.result === "HALF_LOSS"
                    ? "text-red-400"
                    : "text-sky-400"
              }`}>
                Hasil masuk learning
              </span>
            )}
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
                {prediction.selectabilityReason ?? "Prediksi belum memenuhi syarat pemilihan."}
            </div>
          )}
          {prediction.status.toLowerCase() === "pending_result"
            && prediction.decision !== "NO BET"
            && !/^no[\s_-]*bet\b/i.test(prediction.market)
            && (
            <div className="mt-4 flex flex-col gap-2 rounded-lg border border-amber-500/25 bg-amber-500/5 p-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-xs text-muted-foreground">
                Skor provider belum tersedia. Masukkan skor final untuk menghitung hasil prediksi dan mengirimkannya ke AI Learning.
              </div>
              <Button type="button" size="sm" variant="outline" className="shrink-0 border-primary/40 text-primary" onClick={onEnterScore}>
                <Save className="h-4 w-4" />
                Input final score
              </Button>
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

export default function RiskCenter() {
  const { data: predictions = [], isLoading, isError, refetch, isFetching } = usePredictionBoard();
  const recordManualResult = useRecordManualPredictionResult();
  const { open: adminDialogOpen, withPassword, onSubmit, onCancel } = useAdminPassword();
  const { toast } = useToast();
  const [selectedIds, setSelectedIds] = useState<string[]>(readSelectedPredictionIds);
  const [showHistory, setShowHistory] = useState(false);
  const [pendingOnly, setPendingOnly] = useState(false);
  const [manualScorePrediction, setManualScorePrediction] = useState<AIPredictionBoardItem | null>(null);
  const [homeScore, setHomeScore] = useState("");
  const [awayScore, setAwayScore] = useState("");
  const [homeScoreHT, setHomeScoreHT] = useState("");
  const [awayScoreHT, setAwayScoreHT] = useState("");

  useEffect(() => {
    writeSelectedPredictionIds(selectedIds);
  }, [selectedIds]);

  const visiblePredictions = useMemo(
    () => predictions.filter((prediction) => pendingOnly
      ? prediction.status.toLowerCase() === "pending_result"
      : showHistory || prediction.isUpcoming),
    [predictions, showHistory, pendingOnly],
  );
  const selectableCount = predictions.filter((prediction) => prediction.isSelectable).length;
  const pendingResultCount = predictions.filter(
    (prediction) => prediction.status.toLowerCase() === "pending_result"
      && prediction.decision !== "NO BET"
      && !/^no[\s_-]*bet\b/i.test(prediction.market),
  ).length;

  const openManualScore = (prediction: AIPredictionBoardItem) => {
    setManualScorePrediction(prediction);
    setHomeScore("");
    setAwayScore("");
    setHomeScoreHT("");
    setAwayScoreHT("");
  };

  const submitManualScore = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!manualScorePrediction || homeScore === "" || awayScore === "") return;
    const input = {
      predictionId: manualScorePrediction.id,
      homeScore: Number(homeScore),
      awayScore: Number(awayScore),
      ...(homeScoreHT !== "" && awayScoreHT !== ""
        ? { homeScoreHT: Number(homeScoreHT), awayScoreHT: Number(awayScoreHT) }
        : {}),
    };
    withPassword(() => {
      recordManualResult.mutate(input, {
        onSuccess: (result) => {
          setManualScorePrediction(null);
          toast({
            title: result.learningIncluded
              ? `Hasil ${result.result} disimpan`
              : "Skor tersimpan; settlement menunggu retry",
            description: result.learningIncluded
              ? "Skor fixture dan hasil prediksi tersimpan. Feedback sudah masuk ke AI Learning."
              : result.message ?? "Prediksi tetap bisa dicoba ulang oleh settlement.",
          });
        },
        onError: (error) => toast({
          title: "Hasil manual gagal disimpan",
          description: error.message,
          variant: "destructive",
        }),
      });
    });
  };

  const requiresHalfTimeScore = /\b(ht|half[\s-]?time|first[\s-]?half)\b/i.test(manualScorePrediction?.market ?? "");
  const validFullTimeScore = homeScore !== "" && awayScore !== ""
    && Number.isInteger(Number(homeScore)) && Number.isInteger(Number(awayScore))
    && Number(homeScore) >= 0 && Number(awayScore) >= 0
    && Number(homeScore) <= 30 && Number(awayScore) <= 30;
  const validHalfTimeScore = !requiresHalfTimeScore || (
    homeScoreHT !== "" && awayScoreHT !== ""
    && Number.isInteger(Number(homeScoreHT)) && Number.isInteger(Number(awayScoreHT))
    && Number(homeScoreHT) >= 0 && Number(awayScoreHT) >= 0
    && Number(homeScoreHT) <= 30 && Number(awayScoreHT) <= 30
  );

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
            Semua hasil scanning dan analisis AI ada di sini. Prediksi upcoming dapat dipilih untuk AI Parlays;
            prediksi yang sudah kickoff tetap tersedia sebagai histori dengan skor dan hasil settlement. Jika provider tidak mengirim skor,
            masukkan skor final secara manual dari kartu pending result.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => void refetch()} disabled={isFetching}>
            <RefreshCw className={isFetching ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
            Refresh board
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setPendingOnly(false);
              setShowHistory((current) => !current);
            }}
          >
            <Filter className="h-4 w-4" />
            {showHistory ? "Hide history" : "Show history"}
          </Button>
          {pendingResultCount > 0 && (
            <Button
              variant={pendingOnly ? "secondary" : "outline"}
              size="sm"
              onClick={() => {
                setPendingOnly((current) => !current);
                setShowHistory(true);
              }}
            >
              {pendingOnly ? "Show all history" : `Pending results (${pendingResultCount})`}
            </Button>
          )}
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
              <div className="text-xs text-muted-foreground">{pendingOnly ? "Pending results" : showHistory ? "Visible predictions" : "Upcoming predictions"}</div>
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
              Hasil WIN/LOSS/partial/PUSH yang tampil sebagai histori juga dipakai untuk AI learning.
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
                  onEnterScore={() => openManualScore(prediction)}
                />
              ))}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-border p-8 text-center">
              <BrainCircuit className="mx-auto h-8 w-8 text-muted-foreground" />
              <p className="mt-3 text-sm text-muted-foreground">
                Belum ada hasil analisis untuk fixture mendatang. Gunakan “Show history” untuk melihat hasil settlement.
              </p>
              <Button asChild variant="outline" size="sm" className="mt-4">
                <Link href="/fixtures">Periksa fixtures & odds</Link>
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
      <Dialog
        open={Boolean(manualScorePrediction)}
        onOpenChange={(isOpen) => {
          if (!isOpen && !recordManualResult.isPending) setManualScorePrediction(null);
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Input hasil pertandingan</DialogTitle>
            <DialogDescription>
              {manualScorePrediction
                ? `${manualScorePrediction.homeTeam} vs ${manualScorePrediction.awayTeam} · ${formatLeagueName(manualScorePrediction.league)}`
                : "Masukkan skor final pertandingan."}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submitManualScore} className="space-y-5">
            <div>
              <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Skor penuh waktu</div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="manual-home-score">{manualScorePrediction?.homeTeam ?? "Home"}</Label>
                  <Input
                    id="manual-home-score"
                    type="number"
                    min="0"
                    max="30"
                    step="1"
                    inputMode="numeric"
                    required
                    value={homeScore}
                    onChange={(event) => setHomeScore(event.target.value)}
                    disabled={recordManualResult.isPending}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="manual-away-score">{manualScorePrediction?.awayTeam ?? "Away"}</Label>
                  <Input
                    id="manual-away-score"
                    type="number"
                    min="0"
                    max="30"
                    step="1"
                    inputMode="numeric"
                    required
                    value={awayScore}
                    onChange={(event) => setAwayScore(event.target.value)}
                    disabled={recordManualResult.isPending}
                  />
                </div>
              </div>
            </div>
            <div>
              <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Skor babak pertama {requiresHalfTimeScore ? "(wajib untuk market ini)" : "(opsional)"}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="manual-home-score-ht">{manualScorePrediction?.homeTeam ?? "Home"} HT</Label>
                  <Input
                    id="manual-home-score-ht"
                    type="number"
                    min="0"
                    max="30"
                    step="1"
                    placeholder="—"
                    value={homeScoreHT}
                    onChange={(event) => setHomeScoreHT(event.target.value)}
                    disabled={recordManualResult.isPending}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="manual-away-score-ht">{manualScorePrediction?.awayTeam ?? "Away"} HT</Label>
                  <Input
                    id="manual-away-score-ht"
                    type="number"
                    min="0"
                    max="30"
                    step="1"
                    placeholder="—"
                    value={awayScoreHT}
                    onChange={(event) => setAwayScoreHT(event.target.value)}
                    disabled={recordManualResult.isPending}
                  />
                </div>
              </div>
            </div>
            <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-xs text-muted-foreground">
              Sistem akan menghitung WIN/LOSS dari market prediksi. Skor fixture dan pelajaran hasil akan disimpan; NO BET tidak dihitung sebagai sampel taruhan.
            </div>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setManualScorePrediction(null)}
                disabled={recordManualResult.isPending}
              >
                Batal
              </Button>
              <Button type="submit" disabled={!validFullTimeScore || !validHalfTimeScore || recordManualResult.isPending}>
                {recordManualResult.isPending
                  ? <Loader2 className="h-4 w-4 animate-spin" />
                  : <Save className="h-4 w-4" />}
                {recordManualResult.isPending ? "Menyimpan..." : "Simpan skor & settle"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      <AdminPasswordDialog
        open={adminDialogOpen}
        onOpenChange={(isOpen) => {
          if (!isOpen) onCancel();
        }}
        onSubmit={onSubmit}
      />
    </div>
  );
}