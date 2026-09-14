import { useEffect, useState } from "react";
import { Link } from "wouter";
import {
  useListSupabaseParlays,
  usePredictionBoard,
  useCreateParlayFromPredictions,
  useVerifyParlays,
  useMergeParlays,
  type Parlay,
  type ParlayReadiness,
  type ParlayReadinessLeg,
  type AIPredictionBoardItem,
} from "@/api/parlay-hooks";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { TrendingUp, TrendingDown, Minus, AlertCircle, CalendarDays, Target, ShieldCheck, ShieldAlert, RefreshCw, GitMerge, CheckCircle2, XCircle, ClipboardCheck, ArrowRight, X } from "lucide-react";
import { format } from "date-fns";
import { useAdminPassword } from "@/hooks/use-admin-password";
import { AdminPasswordDialog } from "@/components/AdminPasswordDialog";
import { useToast } from "@/hooks/use-toast";
import {
  readSelectedPredictionIds,
  writeSelectedPredictionIds,
} from "@/utils/prediction-selection";

function ParlayStatusBadge({ status }: { status: string }) {
  const statusStyles: Record<string, string> = {
    active: "bg-blue-500/10 text-blue-500 border-blue-500/20",
    pending: "bg-amber-500/10 text-amber-500 border-amber-500/20",
    win: "bg-emerald-500/10 text-emerald-500 border-emerald-500/20",
    won: "bg-emerald-500/10 text-emerald-500 border-emerald-500/20",
    loss: "bg-red-500/10 text-red-500 border-red-500/20",
    lost: "bg-red-500/10 text-red-500 border-red-500/20",
    half_win: "bg-emerald-400/10 text-emerald-400 border-emerald-400/20",
    half_loss: "bg-red-400/10 text-red-400 border-red-400/20",
    push: "bg-slate-400/10 text-slate-400 border-slate-400/20",
    no_bet: "bg-slate-500/10 text-slate-500 border-slate-500/20",
    settled: "bg-slate-500/10 text-slate-500 border-slate-500/20",
    settled_manual: "bg-amber-400/10 text-amber-400 border-amber-400/20",
  };
  return (
    <Badge variant="outline" className={statusStyles[status] || statusStyles.pending}>
      {status}
    </Badge>
  );
}

function EVOIndicator({ value }: { value: number }) {
  if (value > 0.1) return <TrendingUp className="w-4 h-4 text-emerald-500" />;
  if (value < -0.05) return <TrendingDown className="w-4 h-4 text-red-500" />;
  return <Minus className="w-4 h-4 text-slate-400" />;
}

function readinessLabel(status: ParlayReadinessLeg["status"]) {
  if (status === "ready") return "READY";
  if (status === "invalidated") return "INVALIDATED";
  if (status === "started_or_finished") return "KICKED OFF";
  if (status === "missing_prediction") return "MISSING";
  if (status === "rate_limited_unverified") return "RATE LIMITED";
  if (status === "missing_odds") return "NO ODDS";
  if (status === "stale") return "STALE";
  return "REVIEW";
}

function readinessClass(status: ParlayReadinessLeg["status"]) {
  return status === "ready"
    ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20"
      : status === "invalidated" || status === "started_or_finished"
      ? "bg-red-500/10 text-red-500 border-red-500/20"
        : status === "rate_limited_unverified"
          ? "bg-orange-500/10 text-orange-500 border-orange-500/20"
      : "bg-amber-500/10 text-amber-500 border-amber-500/20";
}

function Metric({ label, value, tone = "" }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-lg border border-border bg-secondary/30 p-3">
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`mt-1 text-lg font-semibold tabular-nums ${tone}`}>{value}</div>
    </div>
  );
}

function VerificationPanel({
  readiness,
  selectedCount,
  onVerify,
  onMerge,
  isVerifying,
  isMerging,
  stake,
  onStakeChange,
}: {
  readiness: ParlayReadiness | null;
  selectedCount: number;
  onVerify: () => void;
  onMerge: () => void;
  isVerifying: boolean;
  isMerging: boolean;
  stake: string;
  onStakeChange: (value: string) => void;
}) {
  const ready = Boolean(readiness?.ready);
  const preview = readiness?.mergePreview;
  return (
    <Card className="border-primary/20 bg-primary/[0.03]">
      <CardHeader className="pb-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-lg">
              <ShieldCheck className="h-5 w-5 text-primary" />
              Verify Before Bet
            </CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Refresh odds dan AI untuk parlay terpilih sebelum dipasang. Histori parlay lama tidak diubah.
            </p>
          </div>
          <div className="flex gap-2">
            <Input
              type="number"
              min="0"
              step="1"
              value={stake}
              onChange={(event) => onStakeChange(event.target.value)}
              placeholder="Stake (optional)"
              aria-label="Optional stake"
              className="w-32"
            />
            <Button variant="outline" onClick={onVerify} disabled={selectedCount === 0 || isVerifying}>
              <RefreshCw className={isVerifying ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
              {isVerifying ? "Verifying..." : "Verify Before Bet"}
            </Button>
            <Button onClick={onMerge} disabled={!ready || isMerging}>
              <GitMerge className="h-4 w-4" />
              {isMerging ? "Creating..." : "Create Merged Parlay"}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {!readiness ? (
          <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
            Pilih satu atau lebih active parlay, lalu klik Verify Before Bet. Merge hanya tersedia jika seluruh leg ready.
          </div>
        ) : (
          <>
            <Alert variant={ready ? "default" : "destructive"} className={ready ? "border-emerald-500/30 bg-emerald-500/5" : ""}>
              {ready ? <CheckCircle2 className="h-4 w-4" /> : <ShieldAlert className="h-4 w-4" />}
              <AlertTitle>{ready ? "Ready to bet" : "Do not place this bet yet"}</AlertTitle>
              <AlertDescription>
                {ready
                  ? `Semua ${readiness.legs.length} leg lolos odds freshness, status revalidasi, dan AI refresh.`
                  : `${readiness.legs.filter((leg) => leg.status !== "ready").length} leg perlu ditinjau sebelum bet.`}
                {" "}Verified {format(new Date(readiness.generatedAt), "MMM dd, HH:mm:ss")}.
              </AlertDescription>
            </Alert>
            {preview && (
              <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
                <Metric label="Legs" value={`${preview.legs}/${preview.maxLegs}`} />
                <Metric label="Combined odds" value={preview.combinedOdds.toFixed(2)} tone="text-primary" />
                <Metric label="Win probability" value={`${(preview.winProbability * 100).toFixed(1)}%`} />
                <Metric label="EV" value={`${(preview.expectedValue * 100).toFixed(1)}%`} tone={preview.expectedValue >= 0 ? "text-emerald-500" : "text-red-500"} />
                <Metric label="Risk" value={`${preview.riskLevel.replace("_", " ")} · ${preview.riskScore}/100`} tone={preview.riskScore >= 55 ? "text-amber-500" : "text-emerald-500"} />
              </div>
            )}
            {preview?.potentialReturn != null && (
              <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
                <Metric label="Stake" value={preview.stake?.toFixed(2) ?? "—"} />
                <Metric label="Potential return" value={preview.potentialReturn.toFixed(2)} tone="text-primary" />
                <Metric label="Potential profit" value={preview.potentialProfit?.toFixed(2) ?? "—"} tone={preview.potentialProfit && preview.potentialProfit >= 0 ? "text-emerald-500" : "text-red-500"} />
              </div>
            )}
            <div className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Leg freshness checklist</h3>
              {readiness.legs.map((leg) => (
                <div key={`${leg.parlayId}-${leg.fixtureId}`} className="rounded-lg border border-border bg-card/60 p-3">
                  <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                    <div className="flex items-start gap-2">
                      {leg.status === "ready" ? <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-500" /> : <XCircle className="mt-0.5 h-4 w-4 text-amber-500" />}
                      <div>
                        <div className="text-sm font-medium">{leg.homeTeam} <span className="text-muted-foreground">vs</span> {leg.awayTeam}</div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {leg.market} · {leg.selection} · confidence {leg.confidence.toFixed(1)}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 text-xs">
                      <span>Odds {leg.analysisOdds.toFixed(2)} → <strong>{leg.currentOdds?.toFixed(2) ?? "—"}</strong></span>
                      <span>EV {leg.currentEV == null ? "—" : `${(leg.currentEV * 100).toFixed(1)}%`}</span>
                      <Badge variant="outline" className={readinessClass(leg.status)}>{readinessLabel(leg.status)}</Badge>
                    </div>
                  </div>
                   {leg.status !== "ready" && (
                     <div className={`mt-2 pl-6 text-xs ${leg.status === "rate_limited_unverified" ? "text-orange-500" : "text-amber-500"}`}>
                       {leg.reason}
                       {leg.status === "rate_limited_unverified" && (
                         <span className="ml-1 font-semibold">Merge otomatis tetap diblokir.</span>
                       )}
                     </div>
                   )}
                </div>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function ParlayDetailModal({ parlay, onClose }: { parlay: Parlay; onClose: () => void }) {
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl">{parlay.parlay_name}</DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Created {format(new Date(parlay.created_at), "MMM dd, yyyy HH:mm")}
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-3 gap-4 mb-4">
          <Card className="bg-secondary/30 border-border">
            <CardContent className="p-3 text-center">
              <div className="text-xs text-muted-foreground mb-1">Combined Odds</div>
              <div className="text-xl font-bold text-primary">{parlay.combined_odds.toFixed(2)}</div>
            </CardContent>
          </Card>
          <Card className="bg-secondary/30 border-border">
            <CardContent className="p-3 text-center">
              <div className="text-xs text-muted-foreground mb-1">Win Probability</div>
              <div className="text-xl font-bold">{(parlay.win_probability * 100).toFixed(1)}%</div>
            </CardContent>
          </Card>
          <Card className="bg-secondary/30 border-border">
            <CardContent className="p-3 text-center">
              <div className="text-xs text-muted-foreground mb-1">Expected Value</div>
              <div className={`text-xl font-bold ${parlay.expected_value > 0.05 ? "text-emerald-400" : parlay.expected_value < -0.05 ? "text-red-400" : ""}`}>
                {(parlay.expected_value * 100).toFixed(1)}%
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
            Parlay Legs ({parlay.legs_count})
          </h3>
          <div className="space-y-2">
            {parlay.legs?.map((leg, i) => (
              <Card key={i} className="border-border bg-card/50">
                <CardContent className="p-3">
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-sm">
                        <span className="font-mono text-xs text-muted-foreground">Leg {i + 1}</span>
                        <span className="font-bold">{leg.home}</span>
                        <span className="text-muted-foreground">vs</span>
                        <span className="font-bold">{leg.away}</span>
                      </div>
                      <Badge variant="outline" className="text-xs font-mono">
                        {leg.odds.toFixed(2)}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <CalendarDays className="w-3 h-3" />
                        {format(new Date(leg.date), "MMM dd, HH:mm")}
                      </span>
                      <span className="flex items-center gap-1">
                        <Target className="w-3 h-3" />
                        {leg.market}: <span className="text-primary font-medium">{leg.selection}</span>
                      </span>
                      <span className="flex items-center gap-1">
                        {(leg.probability * 100).toFixed(0)}% implied
                      </span>
                      {leg.result && (
                        <ParlayStatusBadge status={leg.result.toLowerCase()} />
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PredictionQueue({
  predictions,
  selectedIds,
  onRemove,
  onCreate,
  isCreating,
}: {
  predictions: AIPredictionBoardItem[];
  selectedIds: string[];
  onRemove: (id: string) => void;
  onCreate: () => void;
  isCreating: boolean;
}) {
  return (
    <Card className="border-primary/20 bg-primary/[0.03]">
      <CardHeader className="pb-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-lg">
              <ClipboardCheck className="h-5 w-5 text-primary" />
              Prediction shortlist
            </CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Pilihan dari AI Prediction Board yang siap ditinjau dan dibuat menjadi parlay.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline">
              <Link href="/risk-center">
                Kembali ke Prediction Board
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
            <Button onClick={onCreate} disabled={selectedIds.length < 2 || isCreating}>
            <GitMerge className="h-4 w-4" />
              {isCreating ? "Creating..." : `Create parlay (${selectedIds.length})`}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {selectedIds.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-6 text-center">
            <p className="text-sm text-muted-foreground">
              Belum ada pertandingan di shortlist. Pilih checkbox pada AI Prediction Board untuk memulai.
            </p>
            <Button asChild variant="outline" size="sm" className="mt-4">
              <Link href="/risk-center">Buka AI Prediction Board</Link>
            </Button>
          </div>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {predictions.map((prediction) => (
                <div
                  key={prediction.id}
                  className="rounded-lg border border-primary/30 bg-card/60 p-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-semibold">
                        {prediction.homeTeam} <span className="text-muted-foreground">vs</span> {prediction.awayTeam}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {prediction.market} · {prediction.selection} · {prediction.odds?.toFixed(2) ?? "—"}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                        <span>Probability {(prediction.probability == null ? "—" : `${(prediction.probability * 100).toFixed(1)}%`)}</span>
                        <span>Confidence {prediction.confidence.toFixed(1)}</span>
                        <span className={prediction.ev >= 0 ? "text-emerald-400" : "text-red-400"}>EV {(prediction.ev * 100).toFixed(1)}%</span>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0 text-muted-foreground hover:text-red-400"
                      onClick={() => onRemove(prediction.id)}
                      aria-label={`Hapus ${prediction.homeTeam} vs ${prediction.awayTeam} dari shortlist`}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function Parlays() {
  const { data: parlays, isLoading, error } = useListSupabaseParlays();
  const { data: predictions = [] } = usePredictionBoard();
  const [selectedParlay, setSelectedParlay] = useState<Parlay | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectedPredictionIds, setSelectedPredictionIds] = useState<string[]>(readSelectedPredictionIds);
  const [readiness, setReadiness] = useState<ParlayReadiness | null>(null);
  const [stake, setStake] = useState("");
  const verify = useVerifyParlays();
  const merge = useMergeParlays();
  const createFromPredictions = useCreateParlayFromPredictions();
  const { open, withPassword, onSubmit, onCancel } = useAdminPassword();
  const { toast } = useToast();

  useEffect(() => {
    writeSelectedPredictionIds(selectedPredictionIds);
  }, [selectedPredictionIds]);

  const toggleParlay = (id: string) => {
    setSelectedIds((current) => current.includes(id) ? current.filter((value) => value !== id) : current.length < 7 ? [...current, id] : current);
    setReadiness(null);
  };
  const runVerify = () => {
    withPassword((pwd) => {
      void pwd;
      const parsedStake = Number(stake);
      verify.mutate({
        parlayIds: selectedIds,
        ...(Number.isFinite(parsedStake) && parsedStake > 0 ? { stake: parsedStake } : {}),
      }, {
        onSuccess: setReadiness,
        onError: (mutationError) => toast({ title: "Verification failed", description: mutationError.message, variant: "destructive" }),
      });
    });
  };
  const runMerge = () => {
    withPassword((pwd) => {
      void pwd;
      const parsedStake = Number(stake);
      merge.mutate({
        parlayIds: selectedIds,
        ...(Number.isFinite(parsedStake) && parsedStake > 0 ? { stake: parsedStake } : {}),
      }, {
        onSuccess: (result) => {
          setReadiness(result.readiness);
          setSelectedIds([]);
          toast({ title: "Merged parlay created", description: `New parlay ${result.parlayId} dibuat tanpa mengubah histori parlay sumber.` });
        },
        onError: (mutationError) => toast({ title: "Merge blocked", description: mutationError.message, variant: "destructive" }),
      });
    });
  };
  const runCreateFromPredictions = () => {
    withPassword((pwd) => {
      void pwd;
      createFromPredictions.mutate({ predictionIds: selectedPredictionIds }, {
        onSuccess: (result) => {
          setSelectedPredictionIds([]);
          toast({
            title: "Manual AI parlay created",
            description: result.parlayId
              ? `Parlay ${result.parlayId} dibuat dari ${result.legs.length} prediksi.`
              : "Parlay berhasil dibuat.",
          });
        },
        onError: (mutationError) => toast({
          title: "Create parlay failed",
          description: mutationError.message,
          variant: "destructive",
        }),
      });
    });
  };
  const queuedPredictions = selectedPredictionIds
    .map((id) => predictions.find((prediction) => prediction.id === id))
    .filter((prediction): prediction is (typeof predictions)[number] => Boolean(prediction));

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight text-foreground">AI Parlays</h1>
         <p className="text-muted-foreground">
           Final workspace untuk meninjau shortlist dari AI Prediction Board, membuat parlay, dan memeriksa histori WIN/LOSS.
         </p>
      </div>

      <PredictionQueue
        predictions={queuedPredictions}
        selectedIds={selectedPredictionIds}
        onRemove={(id) => setSelectedPredictionIds((current) => current.filter((value) => value !== id))}
        onCreate={runCreateFromPredictions}
        isCreating={createFromPredictions.isPending}
      />

      {error && (
        <Card className="border-red-500/20 bg-red-500/5">
          <CardContent className="flex items-center gap-3 py-4">
            <AlertCircle className="w-5 h-5 text-red-500" />
            <span className="text-sm text-red-500">Failed to load parlays: {error.message}</span>
          </CardContent>
        </Card>
      )}

      <VerificationPanel
        readiness={readiness}
        selectedCount={selectedIds.length}
        onVerify={runVerify}
        onMerge={runMerge}
        isVerifying={verify.isPending}
        isMerging={merge.isPending}
        stake={stake}
        onStakeChange={setStake}
      />

      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="text-lg font-semibold">AI Parlays & History</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-border hover:bg-transparent">
                    <TableHead className="w-10 text-muted-foreground">Select</TableHead>
                    <TableHead className="text-muted-foreground">Parlay</TableHead>
                    <TableHead className="text-muted-foreground">Legs</TableHead>
                    <TableHead className="text-muted-foreground">Combined Odds</TableHead>
                    <TableHead className="text-muted-foreground">EV</TableHead>
                    <TableHead className="text-muted-foreground">Win Prob</TableHead>
                    <TableHead className="text-muted-foreground">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {parlays?.length ? (
                    parlays.map((parlay: Parlay) => (
                      <TableRow
                        key={parlay.parlay_id}
                        className="border-border cursor-pointer hover:bg-secondary/30 transition-colors"
                        onClick={() => setSelectedParlay(parlay)}
                      >
                        <TableCell onClick={(event) => event.stopPropagation()}>
                          <input
                            aria-label={`Select ${parlay.parlay_name}`}
                            type="checkbox"
                            checked={selectedIds.includes(parlay.parlay_id)}
                            onChange={() => toggleParlay(parlay.parlay_id)}
                            disabled={parlay.status !== "active"}
                            className="h-4 w-4 accent-primary"
                          />
                        </TableCell>
                        <TableCell className="font-medium">{parlay.parlay_name}</TableCell>
                        <TableCell className="tabular-nums">{parlay.legs_count}</TableCell>
                        <TableCell className="tabular-nums">{parlay.combined_odds.toFixed(2)}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <EVOIndicator value={parlay.expected_value} />
                            <span className={`tabular-nums ${parlay.expected_value > 0.05 ? 'text-emerald-500' : parlay.expected_value < -0.05 ? 'text-red-500' : ''}`}>
                              {(parlay.expected_value * 100).toFixed(1)}%
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="tabular-nums">{(parlay.win_probability * 100).toFixed(1)}%</TableCell>
                        <TableCell>
                          <ParlayStatusBadge status={parlay.status} />
                        </TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                        No AI parlays found.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {selectedParlay && (
        <ParlayDetailModal
          parlay={selectedParlay}
          onClose={() => setSelectedParlay(null)}
        />
      )}
      <AdminPasswordDialog open={open} onOpenChange={onCancel} onSubmit={onSubmit} />
    </div>
  );
}
