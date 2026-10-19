import { useState } from "react";
import {
  AlertTriangle,
  Check,
  FlaskConical,
  KeyRound,
  Loader2,
  RefreshCw,
  RotateCcw,
  Sparkles,
} from "lucide-react";
import {
  useGetLearningLoopState,
  useLearningLoopAction,
  type LearningLoopProposalView,
} from "@/api/parlay-hooks";
import { AdminPasswordDialog } from "@/components/AdminPasswordDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useAdminPassword } from "@/hooks/use-admin-password";

function percent(value: unknown): string {
  if (value == null) return "—";
  const numeric = Number(value);
  return Number.isFinite(numeric) ? `${(numeric * 100).toFixed(1)}%` : "—";
}

function policyDescription(policy: {
  minConfidence?: number;
  minEvPercent?: number;
  excludedMarketFamilies?: string[];
} | null | undefined): string {
  if (!policy) return "Kebijakan tidak tersedia";
  const blocked = policy.excludedMarketFamilies?.length
    ? ` · dikecualikan: ${policy.excludedMarketFamilies.join(", ")}`
    : "";
  return `Confidence ≥ ${Number(policy.minConfidence ?? 6.5).toFixed(1)} · EV ≥ ${Number(policy.minEvPercent ?? 0).toFixed(1)}%${blocked}`;
}

function ProposalBacktest({ proposal }: { proposal: LearningLoopProposalView }) {
  if (!proposal.backtest) return null;
  const baseline = proposal.backtest.baseline ?? {};
  const candidate = proposal.backtest.candidate ?? {};
  const eligible = proposal.backtest.eligible === true;
  return (
    <div className="mt-3 rounded-md border border-border/70 bg-background/50 p-3 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className={eligible
          ? "border-emerald-500/30 text-emerald-400"
          : "border-amber-500/30 text-amber-400"}>
          {eligible ? "Lolos backtest" : "Belum lolos"}
        </Badge>
        <span className="text-muted-foreground">
          Holdout {String(proposal.backtest.validationSamples ?? proposal.validation_sample_size)} sampel
        </span>
      </div>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <div>
          <div className="font-medium">Kebijakan aktif</div>
          <div className="text-muted-foreground">
            {String(baseline.selected ?? 0)} terpilih · hit {percent(baseline.hitRate)} · ROI {percent(baseline.roiPerBet)}
          </div>
        </div>
        <div>
          <div className="font-medium">Kandidat</div>
          <div className="text-muted-foreground">
            {String(candidate.selected ?? 0)} terpilih · hit {percent(candidate.hitRate)} · ROI {percent(candidate.roiPerBet)}
          </div>
        </div>
      </div>
      <p className="mt-2 text-muted-foreground">
        Kandidat hanya layak dipromosikan jika jumlah holdout cukup, ROI membaik, dan kalibrasi tidak memburuk secara material.
      </p>
    </div>
  );
}

export default function LearningLoopControls() {
  const admin = useAdminPassword();
  const stateQuery = useGetLearningLoopState(Boolean(admin.password));
  const action = useLearningLoopAction();
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [pendingLabel, setPendingLabel] = useState<string | null>(null);
  const state = stateQuery.data;

  function runAction(path: string, label: string, body?: unknown) {
    setActionError(null);
    setActionMessage(null);
    admin.withPassword(() => {
      setPendingLabel(label);
      action.mutate({ path, body }, {
        onSuccess: () => {
          setActionMessage(`${label} selesai.`);
          setPendingLabel(null);
        },
        onError: (error) => {
          setActionError(error.message);
          setPendingLabel(null);
        },
      });
    });
  }

  function requireAdminForRefresh() {
    admin.withPassword(() => {
      void stateQuery.refetch();
    });
  }

  function promote(proposal: LearningLoopProposalView) {
    if (!window.confirm(`Aktifkan kandidat "${proposal.title}"? Prediksi berikutnya akan memakai kebijakan versi baru.`)) return;
    runAction(`/learning/proposals/${proposal.id}/promote`, "Promosi kebijakan");
  }

  function rollback(versionId: string, versionNumber: number) {
    if (!window.confirm(`Kembalikan kebijakan aktif ke versi ${versionNumber}? Riwayat versi tetap disimpan.`)) return;
    runAction(`/learning/versions/${versionId}/rollback`, "Rollback kebijakan");
  }

  return (
    <>
      <Card className="border-primary/20 bg-primary/[0.02]">
        <CardHeader className="border-b border-border/60 pb-4">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Sparkles className="h-5 w-5 text-primary" />
            Siklus belajar Gemini yang terkontrol
          </CardTitle>
          <CardDescription className="max-w-4xl">
            Hasil settlement diklasifikasikan dari snapshot asli. Gemini hanya mengusulkan pengetatan ambang dan pengecualian market; kandidat diuji pada holdout kronologis, lalu admin memutuskan promosi atau rollback.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5 pt-5">
          {stateQuery.isLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
          ) : stateQuery.isError || !state ? (
            <div className="rounded-lg border border-amber-500/25 bg-amber-500/5 p-4">
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">Kontrol learning belum dapat dimuat.</p>
                  <p className="mt-1 break-words text-xs text-muted-foreground">
                    {stateQuery.error?.message ?? "Masuk sebagai admin untuk membuka learning loop."}
                    {" "}Pastikan migration learning loop sudah diterapkan dan admin password tersedia.
                  </p>
                  <Button size="sm" variant="outline" className="mt-3" onClick={requireAdminForRefresh}>
                    <KeyRound className="mr-2 h-4 w-4" />
                    Masuk / muat ulang
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-lg border border-border/70 bg-background/50 p-3">
                  <div className="text-xs text-muted-foreground">Evaluasi tersimpan</div>
                  <div className="mt-1 text-xl font-semibold tabular-nums">{state.evaluations.total}</div>
                  <div className="text-[11px] text-muted-foreground">{state.evaluations.classified} telah diklasifikasi</div>
                </div>
                <div className="rounded-lg border border-border/70 bg-background/50 p-3">
                  <div className="text-xs text-muted-foreground">Menunggu klasifikasi</div>
                  <div className="mt-1 text-xl font-semibold tabular-nums">{state.evaluations.pendingClassification}</div>
                  <div className="text-[11px] text-muted-foreground">Diproses maksimal 10 per permintaan</div>
                </div>
                <div className="rounded-lg border border-border/70 bg-background/50 p-3">
                  <div className="text-xs text-muted-foreground">Settlement lama belum diimpor</div>
                  <div className="mt-1 text-xl font-semibold tabular-nums">{state.evaluations.notImported}</div>
                  <div className="text-[11px] text-muted-foreground">NO BET dan baris tanpa skor dilewati</div>
                </div>
                <div className="rounded-lg border border-primary/20 bg-primary/[0.06] p-3">
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Check className="h-3.5 w-3.5 text-emerald-400" />
                    Kebijakan aktif · versi {state.activeVersion.versionNumber ?? "—"}
                  </div>
                  <div className="mt-1 text-xs font-medium leading-relaxed">
                    {policyDescription(state.activeVersion.policy)}
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={action.isPending || state.evaluations.notImported <= 0}
                  onClick={() => runAction("/learning/evaluations/backfill", "Impor settlement lama")}
                >
                  {pendingLabel === "Impor settlement lama" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                  Impor settlement lama
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={action.isPending || state.evaluations.pendingClassification <= 0}
                  onClick={() => runAction("/learning/evaluations/classify", "Klasifikasi 10 evaluasi", { limit: 10 })}
                >
                  {pendingLabel === "Klasifikasi 10 evaluasi" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FlaskConical className="mr-2 h-4 w-4" />}
                  Klasifikasikan maksimal 10
                </Button>
                <Button
                  size="sm"
                  disabled={action.isPending || state.evaluations.classified < 30}
                  onClick={() => runAction("/learning/proposals", "Buat proposal kebijakan")}
                  title="Memerlukan sekurangnya 20 data training dan 10 data holdout yang diklasifikasi."
                >
                  {pendingLabel === "Buat proposal kebijakan" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                  Buat proposal dari data training
                </Button>
                <Button size="sm" variant="ghost" disabled={action.isPending} onClick={() => void stateQuery.refetch()}>
                  Muat ulang
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Split berdasarkan waktu: 70% data awal untuk usulan, 30% data terbaru ditahan sebagai validasi. Minimal 20 training + 10 holdout.
              </p>

              {actionError && (
                <div role="alert" className="rounded-md border border-red-500/25 bg-red-500/5 px-3 py-2 text-sm text-red-400">
                  {actionError}
                </div>
              )}
              {actionMessage && (
                <div role="status" className="rounded-md border border-emerald-500/25 bg-emerald-500/5 px-3 py-2 text-sm text-emerald-400">
                  {actionMessage}
                </div>
              )}

              <div className="space-y-3">
                <h3 className="text-sm font-semibold">Proposal kebijakan</h3>
                {state.proposals.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
                    Belum ada proposal. Impor dan klasifikasikan data settlement untuk memulai.
                  </div>
                ) : state.proposals.map((proposal) => (
                  <ProposalCard
                    key={proposal.id}
                    proposal={proposal}
                    busy={action.isPending}
                    onBacktest={() => runAction(`/learning/proposals/${proposal.id}/backtest`, "Backtest proposal")}
                    onPromote={() => promote(proposal)}
                    onReject={() => runAction(`/learning/proposals/${proposal.id}/reject`, "Tolak proposal")}
                  />
                ))}
              </div>

              <div className="space-y-3">
                <h3 className="text-sm font-semibold">Versi kebijakan tersimpan</h3>
                <div className="space-y-2">
                  {state.versions.map((version) => (
                    <div key={version.id} className="flex flex-col gap-2 rounded-lg border border-border/70 bg-background/40 p-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium">Versi {version.version_number}</span>
                          {version.is_active && <Badge className="bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/15">Aktif</Badge>}
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">{policyDescription(version.policy)}</p>
                      </div>
                      {!version.is_active && version.rollback_eligible && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={action.isPending}
                          onClick={() => rollback(version.id, version.version_number)}
                        >
                          <RotateCcw className="mr-2 h-4 w-4" />
                          Rollback
                        </Button>
                      )}
                    </div>
                  ))}
                  {state.versions.length === 0 && (
                    <div className="text-sm text-muted-foreground">Belum ada versi kebijakan.</div>
                  )}
                </div>
              </div>
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                Usulan Gemini tidak aktif otomatis dan tidak menulis ulang persona dasar. Backtest ini menguji kebijakan seleksi terhadap hasil historis yang ditahan; bukan replay inference Gemini penuh.
              </p>
            </>
          )}
        </CardContent>
      </Card>
      <AdminPasswordDialog
        open={admin.open}
        onOpenChange={admin.setOpen}
        onSubmit={admin.onSubmit}
      />
    </>
  );
}

function ProposalCard({
  proposal,
  busy,
  onBacktest,
  onPromote,
  onReject,
}: {
  proposal: LearningLoopProposalView;
  busy: boolean;
  onBacktest: () => void;
  onPromote: () => void;
  onReject: () => void;
}) {
  const eligible = proposal.backtest?.eligible === true;
  const canBacktest = proposal.status === "draft" || proposal.status === "insufficient_data";
  const canPromote = proposal.status === "backtested" && eligible;
  const canReject = proposal.status !== "approved" && proposal.status !== "rejected";
  return (
    <div className="rounded-lg border border-border/70 bg-background/40 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="text-sm font-semibold">{proposal.title}</h4>
            <Badge variant="outline">{proposal.status}</Badge>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{proposal.rationale}</p>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Training {proposal.training_sample_size} · holdout {proposal.validation_sample_size} · {policyDescription(proposal.candidate_policy)}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {canBacktest && (
            <Button size="sm" variant="outline" disabled={busy} onClick={onBacktest}>
              <FlaskConical className="mr-2 h-4 w-4" />
              Uji holdout
            </Button>
          )}
          {canPromote && (
            <Button size="sm" disabled={busy} onClick={onPromote}>
              <Check className="mr-2 h-4 w-4" />
              Promosikan
            </Button>
          )}
          {canReject && (
            <Button size="sm" variant="ghost" disabled={busy} onClick={onReject}>Tolak</Button>
          )}
        </div>
      </div>
      <ProposalBacktest proposal={proposal} />
    </div>
  );
}
