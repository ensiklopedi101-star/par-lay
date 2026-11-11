/**
 * Panel komposisi parlay.
 *
 * Menampilkan hasil mesin yang MEMILIH 3–5 leg dari puluhan kandidat —
 * bukan daftar leg yang dikirim manusia.
 *
 * Yang membedakan panel ini dari halaman parlay biasa: ia menunjukkan
 * **proses pemilihannya**. Berapa kandidat layak, berapa kombinasi diuji,
 * kenapa sebagian dibuang, dan seberapa besar korelasi menurunkan peluang.
 * Tanpa itu, "parlay 5 leg" tidak bisa dibedakan dari tebakan.
 */

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle, Combine, Info, Layers, TrendingDown, TrendingUp } from "lucide-react";
import type { ParlayComposition, ScoredCombination } from "@/api/parlay-hooks";

const pct = (x: number) => `${(x * 100).toFixed(2)}%`;

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-md border bg-muted/20 p-2">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-sm font-semibold">{value}</div>
      {hint && <div className="text-[10px] text-muted-foreground">{hint}</div>}
    </div>
  );
}

function LegList({ combination }: { combination: ScoredCombination }) {
  return (
    <div className="space-y-1">
      {combination.legs.map((leg) => (
        <div
          key={`${leg.fixtureId}-${leg.marketKey}`}
          className="flex flex-wrap items-center gap-2 rounded border bg-background px-2 py-1 text-xs"
        >
          <Badge variant="outline" className="text-[10px]">
            {leg.selection.family}
          </Badge>
          <span className="font-medium">{leg.selection.label}</span>
          <span className="text-muted-foreground">@{leg.selection.odds}</span>
          <span className="text-muted-foreground">{leg.league}</span>
          <span className="ml-auto text-emerald-600">
            EV {pct(leg.selection.evConservative)}
          </span>
        </div>
      ))}
    </div>
  );
}

export function ParlayCompositionPanel({
  composition,
  isLoading,
}: {
  composition?: ParlayComposition;
  isLoading?: boolean;
}) {
  if (!composition) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Combine className="h-4 w-4" />
            Komposisi Parlay
          </CardTitle>
        </CardHeader>
        <CardContent>{isLoading ? <Skeleton className="h-24 w-full" /> : null}</CardContent>
      </Card>
    );
  }

  const best = composition.best;
  const correlationDrag = best ? best.pIndependent - best.pDecision : 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Combine className="h-4 w-4" />
          Komposisi Parlay
          <Badge
            variant="outline"
            className={
              best
                ? "ml-auto border-emerald-500/40 text-emerald-600"
                : "ml-auto border-muted-foreground/40 text-muted-foreground"
            }
          >
            {best ? `${best.legs.length} leg tersusun` : "tidak ada parlay"}
          </Badge>
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Mesin memilih {composition.minLegs}–{composition.maxLegs} leg dari seluruh kandidat,
          dengan korelasi antar-leg diperhitungkan dan dibayar.
        </p>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* ── Proses pemilihan ── */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat
            label="Kandidat layak"
            value={String(composition.eligible)}
            hint="EV konservatif &gt; 0"
          />
          <Stat
            label="Kombinasi diuji"
            value={composition.combinationsEvaluated.toLocaleString("id-ID")}
            hint="semua ukuran 3–5 leg"
          />
          <Stat
            label="Dibuang"
            value={String(composition.rejected.length)}
            hint="lihat alasannya"
          />
          <Stat
            label="Baris ledger"
            value={String(composition.ledgerRows ?? 0)}
            hint="sumber harga"
          />
        </div>

        {!best && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              Tidak ada parlay yang disusun
            </div>
            <ul className="mt-1 space-y-1 text-xs leading-relaxed text-muted-foreground">
              {composition.notes.map((note, i) => (
                <li key={i}>• {note}</li>
              ))}
            </ul>
          </div>
        )}

        {/* ── Kombinasi terpilih ── */}
        {best && (
          <div className="space-y-2 rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3">
            <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
              <Layers className="h-4 w-4 text-emerald-600" />
              Parlay terpilih
              <span className="text-muted-foreground">·</span>
              <span className="font-mono">{best.combinedOdds.toFixed(2)}</span>
            </div>

            <LegList combination={best} />

            <div className="grid grid-cols-2 gap-2 pt-1 sm:grid-cols-4">
              <Stat label="Peluang" value={pct(best.pDecision)} hint="setelah korelasi" />
              <Stat
                label="EV keputusan"
                value={pct(best.evDecision)}
                hint="yang dipakai memilih"
              />
              <Stat label="EV pesimis" value={pct(best.evPessimistic)} hint="tiap leg −1σ" />
              <Stat
                label="Toleransi bias"
                value={`${(best.breakEvenBias * 100).toFixed(1)} poin`}
                hint="sebelum EV = 0"
              />
            </div>

            {/* Korelasi: bila menurunkan peluang, itu pagar yang bekerja. */}
            {correlationDrag > 0.0001 && (
              <div className="flex items-start gap-2 rounded border bg-background/60 px-2 py-1.5 text-xs">
                <TrendingDown className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
                <span className="text-muted-foreground">
                  Korelasi menurunkan peluang gabungan{" "}
                  <strong>{(correlationDrag * 100).toFixed(2)} poin</strong> (independen{" "}
                  {pct(best.pIndependent)} → korelasi {pct(best.pCorrelated)}). Angka ini yang
                  dipakai, bukan yang lebih indah.
                </span>
              </div>
            )}
          </div>
        )}

        {/* ── Alternatif ── */}
        {composition.alternatives.length > 0 && (
          <div className="space-y-1.5">
            <div className="text-xs font-medium text-muted-foreground">
              Alternatif ({composition.alternatives.length})
            </div>
            {composition.alternatives.map((alt, i) => (
              <div
                key={i}
                className="flex flex-wrap items-center gap-2 rounded border bg-muted/20 px-2 py-1.5 text-xs"
              >
                <TrendingUp className="h-3 w-3 text-muted-foreground" />
                <span>{alt.legs.length} leg</span>
                <span className="font-mono">@{alt.combinedOdds.toFixed(2)}</span>
                <span className="text-muted-foreground">peluang {pct(alt.pDecision)}</span>
                <span className="ml-auto text-emerald-600">EV {pct(alt.evDecision)}</span>
              </div>
            ))}
          </div>
        )}

        {/* ── Pembuangan: kenapa sebagian kandidat tidak masuk ── */}
        {composition.rejected.length > 0 && (
          <details className="rounded-md border bg-muted/20 p-2">
            <summary className="cursor-pointer text-xs font-medium">
              Kenapa {composition.rejected.length} kandidat dibuang
            </summary>
            <ul className="mt-1.5 space-y-1 text-[11px] leading-relaxed text-muted-foreground">
              {composition.rejected.slice(0, 8).map((r, i) => (
                <li key={i}>
                  • <span className="font-mono">{r.marketKey}</span> (fixture {r.fixtureId}):{" "}
                  {r.reason}
                </li>
              ))}
              {composition.rejected.length > 8 && (
                <li>• … dan {composition.rejected.length - 8} lainnya</li>
              )}
            </ul>
          </details>
        )}

        {/* ── Catatan jujur ── */}
        {composition.notes.length > 0 && best && (
          <div className="space-y-1 rounded-md border bg-muted/30 p-3">
            <div className="flex items-center gap-1.5 text-xs font-medium">
              <Info className="h-3.5 w-3.5" />
              Batas angka ini
            </div>
            <ul className="space-y-1 text-xs leading-relaxed text-muted-foreground">
              {composition.notes.map((note, i) => (
                <li key={i}>• {note}</li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default ParlayCompositionPanel;
