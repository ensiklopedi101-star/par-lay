/**
 * Panel transparansi settlement.
 *
 * Hit rate dan ROI adalah angka akhir. Panel ini menampilkan PROSES-nya:
 * berapa yang sudah selesai, berapa menunggu, berapa yang tersendat karena
 * skor belum terisi. Tanpa ini, "0 hasil" tidak bisa dibedakan antara
 * "belum ada pertandingan" dan "ada yang rusak".
 *
 * Semua angka berasal dari server (`/api/sync/settlement-summary`), tidak ada
 * perhitungan di sisi klien yang bisa berbeda dari basis data.
 */

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  Hourglass,
  Info,
  Layers,
  Target,
  TrendingDown,
} from "lucide-react";
import type { SettlementSummary } from "@/api/parlay-hooks";

function pct(part: number, whole: number): string {
  if (!whole) return "—";
  return `${Math.round((part / whole) * 100)}%`;
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

export function SettlementTransparencyPanel({
  summary,
  isLoading,
}: {
  summary?: SettlementSummary;
  isLoading?: boolean;
}) {
  if (isLoading) {
    return (
      <Card className="bg-card border-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Transparansi Settlement
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-16 w-full" />
        </CardContent>
      </Card>
    );
  }

  const p = summary?.predictions;
  const s = summary?.selections;
  const coverage = summary?.coverage;
  const notes = summary?.notes ?? [];
  const missingScore = summary?.fixturesMissingScore ?? 0;

  return (
    <Card className="bg-card border-border">
      <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
        <div>
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Transparansi Settlement
          </CardTitle>
          <p className="text-[11px] text-muted-foreground/70 mt-0.5">
            Berapa yang selesai, berapa menunggu, dan apa yang menghalangi hasil keluar.
          </p>
        </div>
        {missingScore > 0 ? (
          <Badge variant="outline" className="gap-1 bg-amber-500/15 text-amber-400 border-amber-500/30">
            <AlertTriangle className="w-3 h-3" />
            {missingScore} tanpa skor
          </Badge>
        ) : (
          <Badge variant="outline" className="gap-1 bg-emerald-500/15 text-emerald-400 border-emerald-500/30">
            <CheckCircle2 className="w-3 h-3" />
            Tidak ada hambatan
          </Badge>
        )}
      </CardHeader>

      <CardContent className="space-y-3">
        {/* Prediksi tingkat fixture */}
        <div>
          <p className="mb-1.5 text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <Target className="w-3 h-3" /> Prediksi (tingkat pertandingan)
          </p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <StatBlock label="Total" value={String(p?.total ?? 0)} Icon={Layers} hint="semua prediksi tersimpan" />
            <StatBlock
              label="Selesai"
              value={String(p?.settled ?? 0)}
              Icon={CheckCircle2}
              hint={p ? `${pct(p.settled, p.total)} dari total` : undefined}
              tone="good"
            />
            <StatBlock
              label="Menunggu"
              value={String(p?.pending ?? 0)}
              Icon={Hourglass}
              hint="belum ada hasil"
              tone={(p?.pending ?? 0) > 0 ? "warn" : "default"}
            />
            <StatBlock
              label="NO BET"
              value={String(p?.noBet ?? 0)}
              Icon={TrendingDown}
              hint="sengaja tidak diambil"
            />
          </div>
        </div>

        {/* Ledger quant */}
        <div>
          <p className="mb-1.5 text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <ClipboardCheck className="w-3 h-3" /> Ledger quant (per market)
          </p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <StatBlock label="Total baris" value={String(coverage?.total ?? 0)} Icon={Layers} hint="satu market = satu baris" />
            <StatBlock
              label="Punya outcome"
              value={String(coverage?.withOutcome ?? 0)}
              Icon={CheckCircle2}
              hint={coverage ? `${pct(coverage.withOutcome, coverage.total)} terisi` : undefined}
              tone={(coverage?.withOutcome ?? 0) > 0 ? "good" : "warn"}
            />
            <StatBlock
              label="Punya odds_close"
              value={String(coverage?.withClosingOdds ?? 0)}
              Icon={ClipboardCheck}
              hint="dasar hitung CLV"
              tone={(coverage?.withClosingOdds ?? 0) > 0 ? "good" : "warn"}
            />
            <StatBlock
              label="Baris diambil"
              value={String(coverage?.betRows ?? 0)}
              Icon={Target}
              hint="was_bet = true"
            />
          </div>
        </div>

        {/* Sebaran outcome */}
        {summary?.outcomes?.length ? (
          <div className="rounded-lg border border-border overflow-hidden">
            <div className="px-3 py-2 bg-muted/40 text-[10px] uppercase tracking-wider text-muted-foreground">
              Sebaran outcome ledger
            </div>
            <div className="divide-y divide-border">
              {summary.outcomes.map((o) => (
                <div key={o.outcome} className="px-3 py-1.5 flex items-center justify-between text-[11px]">
                  <span className="font-mono">{o.outcome}</span>
                  <span className="tabular-nums text-muted-foreground">{o.count}</span>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {/* Catatan: kenapa hasil belum keluar */}
        {notes.length > 0 ? (
          <div className="rounded-lg border border-border bg-muted/40 p-2.5 space-y-1.5">
            <p className="text-[11px] font-medium text-foreground/80 flex items-center gap-1.5">
              <Info className="w-3 h-3" /> Kenapa hasil belum lengkap
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
      </CardContent>
    </Card>
  );
}
