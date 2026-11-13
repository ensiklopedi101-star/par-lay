/**
 * Panel Laporan Ledger & Kalibrasi (P3 — playbook §8).
 *
 * Menampilkan dua pandangan dari `GET /api/learning/ledger`:
 *
 *  1. **Kalibrasi (semua baris)** — Brier model vs pasar, BSS, ECE, bin
 *     kalibrasi, dan CLV. Ini kualitas probabilitas, bukan kualitas keputusan:
 *     dihitung atas seluruh ledger tanpa memandang apakah seleksinya dipilih.
 *
 *  2. **Taruhan (baris `was_bet` saja)** — ROI, hit rate, dan vonis hanya dari
 *     seleksi yang lolos gerbang. ROI "semua baris" sengaja tidak ditampilkan:
 *     hampir semua baris adalah pasar yang tidak dipilih dan overround akan
 *     memicu vonis refuted palsu.
 *
 * Komponen ini fetching sendiri (self-fetching) — dipasang langsung di halaman
 * AI Learning tanpa memaksa halaman membawa state query. Semua angka berasal
 * dari server; tidak ada perhitungan klien yang bisa beda dari basis data.
 */

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  ClipboardCheck,
  Info,
  Layers,
  Scale,
  Target,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { useGetLedgerReport } from "@/api/parlay-hooks";

function pct(x: number | null, digits = 1): string {
  if (x == null || !Number.isFinite(x)) return "—";
  return `${(x * 100).toFixed(digits)}%`;
}

function num(x: number | null, digits = 4): string {
  if (x == null || !Number.isFinite(x)) return "—";
  return x.toFixed(digits);
}

function StatBlock({
  label,
  value,
  hint,
  Icon,
  tone = "default",
}: {
  label: string;
  value: string;
  hint?: string;
  Icon: typeof Target;
  tone?: "default" | "good" | "warn" | "bad";
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

type VerdictLevel = "insufficient" | "early" | "supported" | "refuted";

const VERDICT_BADGE: Record<VerdictLevel, { label: string; className: string }> = {
  supported: {
    label: "Didukung bukti",
    className: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  },
  early: {
    label: "Indikasi awal",
    className: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  },
  refuted: {
    label: "Tidak didukung",
    className: "bg-red-500/15 text-red-400 border-red-500/30",
  },
  insufficient: {
    label: "Sampel belum cukup",
    className: "bg-muted text-muted-foreground border-border",
  },
};

function eceTone(ece: number | null): "default" | "good" | "warn" | "bad" {
  if (ece == null) return "default";
  if (ece <= 0.05) return "good";
  if (ece <= 0.1) return "warn";
  return "bad";
}

export function LedgerReportPanel() {
  const { data, isLoading, error } = useGetLedgerReport();

  if (isLoading) {
    return (
      <Card className="bg-card border-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Laporan Ledger &amp; Kalibrasi
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (error || !data) {
    return (
      <Card className="bg-card border-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Laporan Ledger &amp; Kalibrasi
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
            <AlertTriangle className="w-3 h-3 text-amber-400" />
            Laporan ledger tidak bisa dimuat — {error instanceof Error ? error.message : "server tidak merespons"}.
          </p>
        </CardContent>
      </Card>
    );
  }

  const report = data;
  const { counts, all, bets, notes } = report;
  const verdictBadge = bets ? VERDICT_BADGE[bets.verdict.level] : null;

  return (
    <Card className="bg-card border-border">
      <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
        <div>
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Laporan Ledger &amp; Kalibrasi
          </CardTitle>
          <p className="text-[11px] text-muted-foreground/70 mt-0.5">
            Kualitas probabilitas (semua baris) dan kualitas keputusan (baris was_bet).
          </p>
        </div>
        {counts.total === 0 ? (
          <Badge variant="outline" className="gap-1 bg-amber-500/15 text-amber-400 border-amber-500/30">
            <AlertTriangle className="w-3 h-3" />
            Ledger kosong
          </Badge>
        ) : verdictBadge ? (
          <Badge variant="outline" className={`gap-1 ${verdictBadge.className}`}>
            {bets?.verdict.level === "supported" ? (
              <CheckCircle2 className="w-3 h-3" />
            ) : bets?.verdict.level === "refuted" ? (
              <TrendingDown className="w-3 h-3" />
            ) : (
              <Info className="w-3 h-3" />
            )}
            {verdictBadge.label}
          </Badge>
        ) : (
          <Badge variant="outline" className="gap-1 bg-muted text-muted-foreground border-border">
            <Info className="w-3 h-3" />
            Belum ada was_bet
          </Badge>
        )}
      </CardHeader>

      <CardContent className="space-y-3">
        {/* Cakupan ledger */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <StatBlock label="Total baris" value={String(counts.total)} Icon={Layers} hint="1 market = 1 baris" />
          <StatBlock
            label="Punya outcome"
            value={String(counts.withOutcome)}
            Icon={CheckCircle2}
            hint={`${pct(counts.total ? counts.withOutcome / counts.total : null, 0)} terisi`}
            tone={counts.withOutcome > 0 ? "good" : "warn"}
          />
          <StatBlock
            label="Punya odds_close"
            value={String(counts.withClosingOdds)}
            Icon={ClipboardCheck}
            hint="dasar CLV"
            tone={counts.withClosingOdds > 0 ? "good" : "warn"}
          />
          <StatBlock
            label="Baris was_bet"
            value={String(counts.wasBet)}
            Icon={Target}
            hint="lolos gerbang"
            tone={counts.wasBet > 0 ? "good" : "default"}
          />
        </div>

        {/* ─── Kalibrasi: semua baris ─── */}
        <div>
          <p className="mb-1.5 text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <Scale className="w-3 h-3" /> Kalibrasi probabilitas (semua baris)
          </p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <StatBlock
              label="Brier model"
              value={num(all?.scores?.brierModel ?? null)}
              Icon={BarChart3}
              hint={all?.scores ? `n = ${all.scores.n}` : "butuh ≥ 5 baris selesai"}
              tone="default"
            />
            <StatBlock
              label="Brier pasar"
              value={num(all?.scores?.brierMarket ?? null)}
              Icon={BarChart3}
              hint="de-vig saat bet dibuat"
            />
            <StatBlock
              label="BSS vs pasar"
              value={pct(all?.brierSkill ?? null, 2)}
              Icon={Scale}
              hint={all?.brierSkill != null ? (all.brierSkill > 0 ? "model lebih baik" : "pasar lebih baik") : "belum bisa dihitung"}
              tone={all?.brierSkill == null ? "default" : all.brierSkill > 0 ? "good" : "bad"}
            />
            <StatBlock
              label="ECE"
              value={num(all?.ece ?? null, 3)}
              Icon={Target}
              hint="makin kecil makin kalibrasi"
              tone={eceTone(all?.ece ?? null)}
            />
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 mt-2">
            <StatBlock
              label="Skill log-loss"
              value={pct(all?.scores?.skillVsMarket ?? null, 2)}
              Icon={Scale}
              hint={all?.scores?.skillVsMarket != null ? "> 0 model lebih baik" : "pasar referensi belum ada"}
              tone={
                all?.scores?.skillVsMarket == null
                  ? "default"
                  : all.scores.skillVsMarket > 0
                    ? "good"
                    : "bad"
              }
            />
            <StatBlock
              label="CLV rata-rata"
              value={pct(all?.clv?.mean ?? null, 2)}
              Icon={TrendingUp}
              hint={all?.clv ? `n = ${all.clv.n}, t = ${all.clv.tStat.toFixed(2)}` : "butuh ≥ 3 odds_close"}
              tone={all?.clv == null ? "default" : all.clv.mean > 0 ? "good" : "bad"}
            />
            <StatBlock
              label="CLV positif"
              value={pct(all?.clv?.positiveRate ?? null, 0)}
              Icon={CheckCircle2}
              hint="proporsi CLV > 0"
              tone={all?.clv == null ? "default" : all.clv.positiveRate >= 0.5 ? "good" : "warn"}
            />
            <StatBlock
              label="Fair-based share"
              value={pct(all?.clv?.fairBasedShare ?? null, 0)}
              Icon={Info}
              hint="CLV dari probabilitas fair penutupan"
            />
          </div>
        </div>

        {/* Bin kalibrasi */}
        {all && all.calibration.length > 0 ? (
          <div className="rounded-lg border border-border overflow-hidden">
            <div className="px-3 py-2 bg-muted/40 text-[10px] uppercase tracking-wider text-muted-foreground">
              Bin kalibrasi (prediksi vs kenyataan)
            </div>
            <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-3 px-3 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border">
              <span>Rentang</span>
              <span className="text-right">n</span>
              <span className="text-right">Prediksi</span>
              <span className="text-right">Observed</span>
            </div>
            <div className="divide-y divide-border">
              {all.calibration.map((bin) => (
                <div
                  key={bin.label}
                  className="grid grid-cols-[1fr_auto_auto_auto] gap-x-3 px-3 py-1.5 text-[11px] tabular-nums"
                >
                  <span>{bin.label}</span>
                  <span className="text-right text-muted-foreground">{bin.n}</span>
                  <span className="text-right">{pct(bin.meanPredicted, 1)}</span>
                  <span
                    className={`text-right ${
                      Math.abs(bin.meanPredicted - bin.observed) > 0.1 ? "text-amber-400" : "text-foreground"
                    }`}
                  >
                    {pct(bin.observed, 1)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {/* ─── Taruhan: baris was_bet saja ─── */}
        <div>
          <p className="mb-1.5 text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <Target className="w-3 h-3" /> Keputusan taruhan (baris was_bet saja)
          </p>
          {bets ? (
            <>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <StatBlock
                  label="ROI"
                  value={pct(bets.roi, 1)}
                  Icon={bets.roi != null && bets.roi >= 0 ? TrendingUp : TrendingDown}
                  hint={
                    bets.roiCI
                      ? `CI [${pct(bets.roiCI.lo, 1)}, ${pct(bets.roiCI.hi, 1)}]`
                      : "butuh ≥ 5 bet selesai"
                  }
                  tone={bets.roi == null ? "default" : bets.roi >= 0 ? "good" : "bad"}
                />
                <StatBlock
                  label="Hit rate"
                  value={pct(bets.hitRate, 1)}
                  Icon={CheckCircle2}
                  hint={`${bets.nSettled}/${bets.n} selesai`}
                  tone={bets.hitRate == null ? "default" : bets.hitRate >= 0.5 ? "good" : "warn"}
                />
                <StatBlock
                  label="Profit"
                  value={`${bets.profit >= 0 ? "+" : ""}${bets.profit.toFixed(2)} u`}
                  Icon={bets.profit >= 0 ? TrendingUp : TrendingDown}
                  hint={`staked ${bets.staked.toFixed(0)} u`}
                  tone={bets.profit >= 0 ? "good" : "bad"}
                />
                <StatBlock
                  label="EV klaim rata-rata"
                  value={pct(bets.avgClaimedEv, 2)}
                  Icon={BarChart3}
                  hint={bets.avgOdds != null ? `avg odds ${bets.avgOdds.toFixed(2)}` : undefined}
                />
              </div>
              <div className="mt-2 rounded-lg border border-border bg-muted/30 p-2.5 space-y-1">
                <p className="text-[11px] font-medium text-foreground/80">{bets.verdict.headline}</p>
                <ul className="space-y-1">
                  {bets.verdict.reasons.map((r, i) => (
                    <li key={i} className="text-[11px] text-muted-foreground flex gap-1.5">
                      <span className="text-muted-foreground/50">•</span>
                      <span>{r}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </>
          ) : (
            <p className="text-[11px] text-muted-foreground rounded-lg border border-border bg-muted/30 p-2.5">
              Belum ada baris `was_bet` — belum ada seleksi yang lolos gerbang, sehingga ROI dan
              vonis taruhan tidak bisa dihitung. Ini bukan berarti model jelek; belum ada
              keputusan yang layak diukur.
            </p>
          )}
        </div>

        {/* Catatan jujur */}
        {notes.length > 0 ? (
          <div className="rounded-lg border border-border bg-muted/40 p-2.5 space-y-1.5">
            <p className="text-[11px] font-medium text-foreground/80 flex items-center gap-1.5">
              <Info className="w-3 h-3" /> Catatan
            </p>
            <ul className="space-y-1">
              {notes.map((n, i) => (
                <li key={i} className="text-[11px] text-muted-foreground flex gap-1.5">
                  <span className="text-muted-foreground/50">•</span>
                  <span>{n}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <p className="text-[10px] text-muted-foreground/60">
          Diperbarui otomatis tiap 2 menit · {new Date(report.generatedAt).toLocaleString("id-ID")}
        </p>
      </CardContent>
    </Card>
  );
}
