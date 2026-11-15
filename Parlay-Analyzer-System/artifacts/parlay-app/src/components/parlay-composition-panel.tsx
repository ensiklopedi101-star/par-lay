/**
 * Panel komposisi parlay.
 *
 * Menampilkan hasil mesin yang MEMILIH 5–8 leg dari puluhan kandidat —
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
import { AlertTriangle, Combine, Layers, TrendingUp } from "lucide-react";
import type { ParlayComposition } from "@/api/parlay-hooks";

const pct = (x: number) => `${(x * 100).toFixed(2)}%`;
const characterLabel: Record<string, string> = {
  "didukung-statistik": "statistik mendukung",
  "pasar-stabil": "stabil",
  "rapuh": "kurang kokoh",
  "kontradiktif": "statistik menolak",
};

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-md border bg-muted/20 p-2">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-sm font-semibold">{value}</div>
      {hint && <div className="text-[10px] text-muted-foreground">{hint}</div>}
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
            Tiket Hari Ini
          </CardTitle>
        </CardHeader>
        <CardContent>{isLoading ? <Skeleton className="h-24 w-full" /> : null}</CardContent>
      </Card>
    );
  }

  const utama = composition.marketFirst ?? composition.variants?.utama ?? null;
  const formed = [composition.variants?.utama, composition.variants?.booster, composition.variants?.jackpot]
    .filter(Boolean).length;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Combine className="h-4 w-4" />
          Tiket Hari Ini
          <Badge
            variant="outline"
            className={
              utama
                ? "ml-auto border-emerald-500/40 text-emerald-600"
                : "ml-auto border-muted-foreground/40 text-muted-foreground"
            }
          >
            {utama ? `${utama.legs.length} leg utama tersusun` : "tidak ada parlay"}
          </Badge>
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Tiga pilihan: 🎯 Utama paling aman · 🚀 Booster seimbang · 💎 Jackpot paling berani.
        </p>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Data dianalisis" value={String(composition.ledgerRows ?? 0)} hint="baris harga pasar" />
          <Stat label="Tiket terbentuk" value={`${formed} dari 3`} hint="Utama · Booster · Jackpot" />
          <Stat label="Leg utama" value={utama ? String(utama.legs.length) : "—"} hint="minimum 5, maksimum 8" />
          <Stat label="Target Utama" value={utama ? `${utama.targetOdds.toFixed(1)}×` : "4.0×"} hint={utama?.targetReached ? "tercapai ✓" : "belum tercapai"} />
        </div>

        {!utama && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              Tidak ada parlay utama yang disusun
            </div>
            <ul className="mt-1 space-y-1 text-xs leading-relaxed text-muted-foreground">
              {(composition.variants?.variantNotes?.utama ? [composition.variants.variantNotes.utama] : composition.notes).map((note, i) => (
                <li key={i}>• {note}</li>
              ))}
            </ul>
          </div>
        )}

        {/* ── Tiket pasar-dulu ── */}
        {composition.marketFirst && (
          <div className="space-y-2 rounded-md border border-sky-500/30 bg-sky-500/5 p-3">
            <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
              <Layers className="h-4 w-4 text-sky-600" />
              🎯 Parlay Utama ({composition.marketFirst.legs.length} leg)
              <span className="text-muted-foreground">·</span>
              <span className="font-mono">@{composition.marketFirst.combinedOdds.toFixed(2)}</span>
              <Badge variant="outline" className="text-[10px]">
                peluang pasar {pct(composition.marketFirst.pCombined)}
              </Badge>
              {!composition.marketFirst.targetReached && (
                <Badge variant="outline" className="border-amber-500/40 text-[10px] text-amber-600">
                  target {composition.marketFirst.targetOdds.toFixed(1)}× belum tercapai
                </Badge>
              )}
            </div>
            <div className="space-y-1">
              {composition.marketFirst.legs.map((leg) => (
                <div
                  key={`${leg.fixtureId}-${leg.marketKey}`}
                  className="flex flex-wrap items-center gap-2 rounded border bg-background px-2 py-1 text-xs"
                >
                  <Badge variant="outline" className="text-[10px]">{leg.selection.family}</Badge>
                  <span className="font-medium">
                    {leg.homeTeam && leg.awayTeam ? `${leg.homeTeam} vs ${leg.awayTeam} — ` : ""}{leg.displayLabel}
                  </span>
                  <span className="text-muted-foreground">@{leg.selection.odds}</span>
                  <span className="ml-auto text-muted-foreground">
                    peluang {pct(leg.pUsed)} · {characterLabel[leg.character] ?? leg.character}
                  </span>
                  {leg.priceHunt && leg.priceHunt.uplift > 0.001 && (
                    <span className="text-emerald-600">
                      terbaik @{leg.priceHunt.bestOdds.toFixed(2)} ({leg.priceHunt.bestBookmaker})
                    </span>
                  )}
                  {leg.contextRisk && leg.contextRisk.level !== "tidak-diketahui" && (
                    <span className={
                      leg.contextRisk.level === "tinggi"
                        ? "text-red-500"
                        : leg.contextRisk.level === "sedang"
                          ? "text-amber-600"
                          : "text-emerald-600"
                    }>
                      konteks {leg.contextRisk.level}{leg.contextRisk.level === "tinggi" ? " ⚠" : ""}
                    </span>
                  )}
                  {leg.priceHunt?.drift === "menjauh" && (
                    <span className="text-amber-600">harga menjauh ⚠</span>
                  )}
                  {leg.priceHunt?.drift === "menajam" && (
                    <span className="text-sky-600">harga menajam</span>
                  )}
                </div>
              ))}
            </div>
            {composition.marketFirst.priceImpact && composition.marketFirst.priceImpact.uplift > 0.001 && (
              <div className="rounded border border-emerald-500/30 bg-emerald-500/5 px-2 py-1.5 text-xs text-muted-foreground">
                Berburu harga menaikkan odds gabungan dari{" "}
                <strong>{composition.marketFirst.priceImpact.usedCombined.toFixed(2)}</strong> menjadi{" "}
                <strong className="text-emerald-600">{composition.marketFirst.priceImpact.bestCombined.toFixed(2)}</strong>{" "}
                (+{(composition.marketFirst.priceImpact.uplift * 100).toFixed(1)}%) — pertandingan dan
                pilihan yang sama, hanya harga belinya yang lebih baik.
              </div>
            )}
            <div className="grid grid-cols-2 gap-2 pt-1 sm:grid-cols-4">
              <Stat label="Peluang tiket" value={pct(composition.marketFirst.pCombined)} hint="dari probabilitas fair pasar" />
              <Stat label="Odds wajar" value={composition.marketFirst.fairOdds.toFixed(2)} hint="1 / peluang" />
              <Stat label="Odds bandar" value={composition.marketFirst.combinedOdds.toFixed(2)} hint="yang ditawarkan" />
              <Stat label="EV vs bandar" value={pct(composition.marketFirst.evVsBook)} hint="margin menumpuk — wajar negatif" />
            </div>
            <details className="text-[11px] leading-relaxed text-muted-foreground">
              <summary className="cursor-pointer font-medium text-foreground">Kenapa tiket ini dipilih?</summary>
              <ul className="mt-1 space-y-1">
                {composition.marketFirst.notes.map((note, i) => (
                  <li key={i}>• {note}</li>
                ))}
              </ul>
            </details>
          </div>
        )}

        {/* ── Varian Booster & Jackpot ── */}
        {composition.variants && (["booster", "jackpot"] as const).map((name) => {
          const ticket = composition.variants?.[name];
          const note = composition.variants?.variantNotes?.[name];
          const title = name === "booster" ? "🚀 Parlay Booster" : "💎 Parlay Jackpot";
          if (!ticket) {
            return note ? (
              <div key={name} className="rounded-md border bg-muted/20 p-3 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{title}</span> — tidak disusun: {note}
              </div>
            ) : null;
          }
          return (
            <div key={name} className={`space-y-2 rounded-md border p-3 ${name === "booster" ? "border-violet-500/30 bg-violet-500/5" : "border-fuchsia-500/30 bg-fuchsia-500/5"}`}>
              <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                <Layers className="h-4 w-4" />
                {title} ({ticket.legs.length} leg)
                <span className="font-mono">@{ticket.combinedOdds.toFixed(2)}</span>
                <Badge variant="outline" className="text-[10px]">peluang {pct(ticket.pCombined)}</Badge>
              </div>
              <div className="space-y-1">
                {ticket.legs.map((leg) => (
                  <div key={`${leg.fixtureId}-${leg.marketKey}`} className="flex flex-wrap items-center gap-2 rounded border bg-background px-2 py-1 text-xs">
                    <Badge variant="outline" className="text-[10px]">{leg.selection.family}</Badge>
                    <span className="font-medium">
                      {leg.homeTeam && leg.awayTeam ? `${leg.homeTeam} vs ${leg.awayTeam} — ` : ""}{leg.displayLabel}
                      {("boosterMarketKey" in ticket && ticket.boosterMarketKey === leg.marketKey) ? " ⭐ PENGUAT" : ""}
                    </span>
                    <span className="text-muted-foreground">@{leg.selection.odds}</span>
                    <span className="ml-auto text-muted-foreground">peluang {pct(leg.pUsed)} · {characterLabel[leg.character] ?? leg.character}</span>
                  </div>
                ))}
              </div>
              <ul className="space-y-1 text-[11px] leading-relaxed text-muted-foreground">
                {ticket.notes.slice(0, 3).map((n, i) => (<li key={i}>• {n}</li>))}
              </ul>
            </div>
          );
        })}

      </CardContent>
    </Card>
  );
}

export default ParlayCompositionPanel;
