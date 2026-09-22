import { BarChart3, BookOpen, Lightbulb } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useGetLearningSummary } from "@/api/parlay-hooks";

function formatPercent(value: number | null | undefined) {
  return value == null ? "—" : `${(value * 100).toFixed(1)}%`;
}

function outcomeClass(outcome: string) {
  if (outcome === "WIN" || outcome === "HALF_WIN") return "text-emerald-400";
  if (outcome === "LOSS" || outcome === "HALF_LOSS") return "text-red-400";
  return "text-amber-400";
}

export default function AILearningTransparency() {
  const { data: learning, isLoading, isError } = useGetLearningSummary();

  return (
    <Card className="border-primary/20 bg-primary/[0.02]">
      <CardHeader className="flex flex-col gap-2 border-b border-border/60 pb-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle className="flex items-center gap-2 text-lg font-semibold">
            <BookOpen className="h-5 w-5 text-primary" />
            AI Learning Transparency
          </CardTitle>
          <p className="mt-1 max-w-3xl text-xs text-muted-foreground">
            Ini yang benar-benar dipelajari sistem dari hasil settlement. NO BET dipisahkan, partial result dan PUSH tidak disembunyikan.
          </p>
        </div>
        {learning && (
          <Badge
            variant="outline"
            className={
              learning.dataQuality.status === "usable"
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                : "border-amber-500/30 bg-amber-500/10 text-amber-400"
            }
          >
            {learning.dataQuality.status === "usable"
              ? "Sampel cukup untuk sinyal"
              : learning.dataQuality.status === "early_signal"
                ? "Sinyal awal"
                : "Belum cukup sampel"}
          </Badge>
        )}
      </CardHeader>
      <CardContent className="space-y-5 pt-5">
        {isLoading ? (
          <div className="grid gap-3 sm:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-20 w-full" />)}
          </div>
        ) : isError || !learning ? (
          <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-4 text-sm text-red-400">
            Ringkasan AI learning belum dapat dimuat. Data prediksi tetap aman; coba refresh setelah API siap.
          </div>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-lg border border-border/70 bg-background/50 p-3">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Sample settled</div>
                <div className="mt-1 text-2xl font-semibold tabular-nums">{learning.totals.settled}</div>
                <div className="text-xs text-muted-foreground">minimum rekomendasi {learning.dataQuality.minimumRecommendedSample}</div>
              </div>
              <div className="rounded-lg border border-border/70 bg-background/50 p-3">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Hit rate decisive</div>
                <div className="mt-1 text-2xl font-semibold tabular-nums">{formatPercent(learning.totals.hitRate)}</div>
                <div className="text-xs text-muted-foreground">
                  {learning.totals.wins} W · {learning.totals.losses} L · {learning.totals.halfWins} HW · {learning.totals.halfLosses} HL
                </div>
              </div>
              <div className="rounded-lg border border-border/70 bg-background/50 p-3">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Push / no bet</div>
                <div className="mt-1 text-2xl font-semibold tabular-nums">{learning.totals.pushes} / {learning.totals.noBetExcluded}</div>
                <div className="text-xs text-muted-foreground">PUSH tetap netral · NO BET dikeluarkan</div>
              </div>
              <div className="rounded-lg border border-border/70 bg-background/50 p-3">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">ROI estimasi</div>
                <div className={`mt-1 text-2xl font-semibold tabular-nums ${(learning.totals.roiPercent ?? 0) >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                  {formatPercent(learning.totals.roiPercent)}
                </div>
                <div className="text-xs text-muted-foreground">{learning.totals.roiSamples} hasil dengan odds valid</div>
              </div>
            </div>

            <div className="rounded-lg border border-primary/20 bg-primary/[0.04] p-4">
              <div className="flex items-start gap-3">
                <Lightbulb className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                <div className="min-w-0">
                  <div className="text-sm font-semibold">Keputusan belajar berikutnya</div>
                  {learning.recommendedMarket ? (
                    <>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <span className="text-lg font-semibold text-primary">{learning.recommendedMarket.market}</span>
                        <Badge variant="outline" className="border-primary/30 text-primary">{learning.recommendedMarket.family}</Badge>
                        <span className="text-xs text-muted-foreground">
                          {learning.recommendedMarket.sampleSize} sampel · hit {formatPercent(learning.recommendedMarket.hitRate)}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">{learning.recommendedMarket.reason}</p>
                    </>
                  ) : (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Belum ada market dengan minimal 3 sampel. Sistem belum akan memaksakan rekomendasi dari data yang terlalu kecil.
                    </p>
                  )}
                  <p className="mt-2 text-xs text-muted-foreground">{learning.dataQuality.explanation}</p>
                </div>
              </div>
            </div>

            <div className="grid gap-5 lg:grid-cols-[1.45fr_1fr]">
              <div>
                <div className="mb-3 flex items-center gap-2">
                  <BarChart3 className="h-4 w-4 text-primary" />
                  <h3 className="text-sm font-semibold">Peta keberhasilan market</h3>
                </div>
                {learning.marketBreakdown.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-border p-5 text-sm text-muted-foreground">
                    Belum ada market settled yang bisa dibandingkan.
                  </div>
                ) : (
                  <div className="overflow-x-auto rounded-lg border border-border/70">
                    <table className="w-full min-w-[650px] text-left text-xs">
                      <thead className="bg-secondary/30 text-muted-foreground">
                        <tr>
                          <th className="px-3 py-2 font-medium">Market</th>
                          <th className="px-3 py-2 font-medium">Sampel</th>
                          <th className="px-3 py-2 font-medium">W / L</th>
                          <th className="px-3 py-2 font-medium">HW / HL</th>
                          <th className="px-3 py-2 font-medium">Push</th>
                          <th className="px-3 py-2 font-medium">Hit</th>
                          <th className="px-3 py-2 font-medium">ROI</th>
                        </tr>
                      </thead>
                      <tbody>
                        {learning.marketBreakdown.slice(0, 8).map((market) => (
                          <tr key={market.market} className="border-t border-border/60">
                            <td className="px-3 py-2">
                              <div className="font-medium">{market.market}</div>
                              <div className="text-[10px] text-muted-foreground">{market.family}</div>
                            </td>
                            <td className="px-3 py-2 tabular-nums">{market.sampleSize}</td>
                            <td className="px-3 py-2 tabular-nums">
                              <span className="text-emerald-400">{market.wins}</span> / <span className="text-red-400">{market.losses}</span>
                            </td>
                            <td className="px-3 py-2 tabular-nums">{market.halfWins} / {market.halfLosses}</td>
                            <td className="px-3 py-2 tabular-nums text-amber-400">{market.pushes}</td>
                            <td className="px-3 py-2 tabular-nums">{formatPercent(market.hitRate)}</td>
                            <td className={`px-3 py-2 tabular-nums ${(market.roiPercent ?? 0) >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                              {formatPercent(market.roiPercent)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div>
                <div className="mb-3 flex items-center gap-2">
                  <BookOpen className="h-4 w-4 text-primary" />
                  <h3 className="text-sm font-semibold">Lesson terbaru</h3>
                </div>
                <div className="space-y-2">
                  {learning.recentLessons.slice(0, 5).map((lesson, index) => (
                    <div key={`${lesson.fixtureId}-${lesson.createdAt ?? index}`} className="rounded-lg border border-border/70 bg-background/40 p-3">
                      <div className="flex items-start justify-between gap-2 text-xs">
                        <span className="font-medium">{lesson.homeTeam} vs {lesson.awayTeam}</span>
                        <span className={`font-semibold ${outcomeClass(lesson.outcome)}`}>{lesson.outcome}</span>
                      </div>
                      <div className="mt-1 text-[10px] text-muted-foreground">
                        {lesson.market} {lesson.odds != null ? `· odds ${lesson.odds.toFixed(2)}` : ""}
                      </div>
                      <p className="mt-2 line-clamp-3 text-xs leading-relaxed text-muted-foreground">{lesson.lessonText}</p>
                    </div>
                  ))}
                  {learning.recentLessons.length === 0 && (
                    <div className="rounded-lg border border-dashed border-border p-5 text-sm text-muted-foreground">
                      Belum ada lesson settled.
                    </div>
                  )}
                </div>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}