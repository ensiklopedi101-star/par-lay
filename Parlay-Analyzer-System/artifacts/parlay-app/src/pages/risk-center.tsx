import { AlertTriangle, ExternalLink } from "lucide-react";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useGetRiskCenter } from "@/api/parlay-hooks";
import { formatLeagueName } from "@/utils/format-league";

export default function RiskCenter() {
  const {
    data: riskCenter,
    isLoading,
    isError,
  } = useGetRiskCenter();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Risk Center</h1>
        <p className="mt-2 text-muted-foreground">
          Prediksi aktif sebelum kickoff yang perlu diperiksa sebelum dipasang.
        </p>
      </div>

      <Card className="bg-card border-border">
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            <CardTitle className="text-lg font-semibold">Prediksi yang perlu perhatian</CardTitle>
          </div>
          {riskCenter && (
            <div className="flex flex-wrap gap-2 text-xs">
              <Badge variant="outline" className="border-amber-500/30 text-amber-500">
                Review {riskCenter.summary.review}
              </Badge>
              <Badge variant="outline" className="border-red-500/30 text-red-500">
                Invalidated {riskCenter.summary.invalidated}
              </Badge>
            </div>
          )}
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
            </div>
          ) : isError ? (
            <div className="rounded-md border border-red-500/20 bg-red-500/5 p-4 text-sm text-red-400">
              Risk Center belum dapat dimuat. Silakan coba lagi sebentar.
            </div>
          ) : riskCenter?.items.length ? (
            <div className="space-y-3">
              {riskCenter.items.map((item) => {
                const isInvalidated = item.revalidationStatus === "invalidated";
                return (
                  <div
                    key={item.predictionId}
                    className={`rounded-md border p-4 ${
                      isInvalidated
                        ? "border-red-500/30 bg-red-500/5"
                        : "border-amber-500/30 bg-amber-500/5"
                    }`}
                  >
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold">
                            {item.homeTeam} <span className="text-muted-foreground">vs</span> {item.awayTeam}
                          </span>
                          <Badge
                            variant="outline"
                            className={isInvalidated
                              ? "border-red-500/40 text-red-500"
                              : "border-amber-500/40 text-amber-500"}
                          >
                            {isInvalidated ? "INVALIDATED" : "REVIEW"}
                          </Badge>
                          {item.inParlay && (
                            <Badge variant="outline" className="border-primary/30 text-primary">
                              In parlay
                            </Badge>
                          )}
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {formatLeagueName(item.league)} · {item.market} · kickoff{" "}
                          {new Date(item.fixtureDate).toLocaleString()}
                        </div>
                        <p className={`mt-2 text-sm ${isInvalidated ? "text-red-300" : "text-amber-300"}`}>
                          {item.revalidationNote}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-row items-center gap-3 text-xs text-muted-foreground lg:flex-col lg:items-end">
                        <span>Odds: {item.bestOdds != null ? item.bestOdds.toFixed(2) : "N/A"}</span>
                        <span>Confidence: {item.confidence != null ? item.confidence.toFixed(1) : "N/A"}</span>
                        <Link
                          href={`/fixtures?fixture=${item.fixtureId}`}
                          className="inline-flex items-center gap-1 text-primary hover:underline"
                        >
                          Buka fixture <ExternalLink className="h-3 w-3" />
                        </Link>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="rounded-md border border-emerald-500/20 bg-emerald-500/5 p-4 text-sm text-emerald-400">
              Tidak ada prediksi aktif yang perlu direview sebelum kickoff.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}