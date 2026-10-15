import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { format } from "date-fns";
import {
  useGetEvent,
  useListEvents,
  type EventDetail,
  type FixtureEvent,
  type Market,
} from "@/api/parlay-hooks";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  type ManualOutcomeKey,
  type ManualParlayLeg,
} from "@/utils/manual-parlay-selection";

type OutcomeOption = {
  id: string;
  bookmaker: string;
  marketType: string;
  marketLine: string | null;
  outcomeKey: ManualOutcomeKey;
  selection: string;
  odds: number;
};

function numericOdds(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) && number > 1 ? number : null;
}

function stringValue(value: unknown): string | null {
  if (value == null || value === "") return null;
  return String(value);
}

function buildOutcomeOptions(event: FixtureEvent | undefined, detail: EventDetail | undefined): OutcomeOption[] {
  if (!event || !detail?.bookmakers) return [];
  const options: OutcomeOption[] = [];
  const push = (
    bookmaker: string,
    marketType: string,
    marketLine: string | null,
    outcomeKey: ManualOutcomeKey,
    selection: string,
    rawOdds: unknown,
  ) => {
    const odds = numericOdds(rawOdds);
    if (odds == null) return;
    options.push({
      id: [bookmaker, marketType, marketLine ?? "", outcomeKey].join("::"),
      bookmaker,
      marketType,
      marketLine,
      outcomeKey,
      selection,
      odds,
    });
  };

  for (const [bookmaker, markets] of Object.entries(detail.bookmakers) as [string, Market[]][]) {
    for (const market of markets) {
      for (const entry of market.odds ?? []) {
        const line = stringValue(entry.line);
        if (entry.home !== undefined || entry.away !== undefined) {
          push(bookmaker, market.name, line, "home", event.home, entry.home);
          if (entry.draw !== undefined) push(bookmaker, market.name, line, "draw", "Draw", entry.draw);
          push(bookmaker, market.name, line, "away", event.away, entry.away);
        } else if (entry.over !== undefined || entry.under !== undefined) {
          push(bookmaker, market.name, line, "over", line ? `Over ${line}` : "Over", entry.over);
          push(bookmaker, market.name, line, "under", line ? `Under ${line}` : "Under", entry.under);
        } else if (entry.yes !== undefined || entry.no !== undefined) {
          push(bookmaker, market.name, null, "yes", "Yes", entry.yes);
          push(bookmaker, market.name, null, "no", "No", entry.no);
        }
      }
    }
  }

  return options;
}

export function ManualLegPicker({
  open,
  onOpenChange,
  onAdd,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (leg: ManualParlayLeg) => void;
}) {
  const { data: events = [], isLoading: eventsLoading } = useListEvents({ limit: 500 });
  const [fixtureValue, setFixtureValue] = useState("");
  const [optionId, setOptionId] = useState("");
  const [probabilityPercent, setProbabilityPercent] = useState("");
  const fixtureId = Number(fixtureValue);
  const { data: detail, isLoading: detailLoading } = useGetEvent(fixtureId);
  const fixture = useMemo(
    () => events.find((event) => event.id === fixtureId),
    [events, fixtureId],
  );
  const oddsOptions = useMemo(
    () => buildOutcomeOptions(fixture, detail),
    [detail, fixture],
  );
  const selectedOption = oddsOptions.find((option) => option.id === optionId);
  const eligibleEvents = events.filter((event) => (event.oddsCount ?? 0) > 0);
  const probability = Number(probabilityPercent) / 100;
  const canAdd = Boolean(selectedOption && fixture)
    && Number.isFinite(probability)
    && probability > 0
    && probability < 1;

  const addLeg = () => {
    if (!fixture || !selectedOption || !canAdd) return;
    onAdd({
      id: selectedOption.id + `::${fixture.id}`,
      fixtureId: fixture.id,
      homeTeam: fixture.home,
      awayTeam: fixture.away,
      league: fixture.leagueSlug ?? "",
      fixtureDate: fixture.date,
      bookmaker: selectedOption.bookmaker,
      marketType: selectedOption.marketType,
      marketLine: selectedOption.marketLine,
      outcomeKey: selectedOption.outcomeKey,
      selection: selectedOption.selection,
      odds: selectedOption.odds,
      probability,
      capturedAt: fixture.oddsCapturedAt ?? null,
    });
    setOptionId("");
    setProbabilityPercent("");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Pilih leg manual</DialogTitle>
          <DialogDescription>
            Pilih fixture mendatang dan market dari odds yang tersimpan. Leg ini dicatat sebagai pilihan Anda, bukan prediksi AI.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="manual-leg-fixture">Fixture mendatang dengan odds</Label>
            <Select
              value={fixtureValue}
              onValueChange={(value) => {
                setFixtureValue(value);
                setOptionId("");
              }}
            >
              <SelectTrigger id="manual-leg-fixture">
                <SelectValue placeholder={eventsLoading ? "Memuat fixture..." : "Pilih pertandingan"} />
              </SelectTrigger>
              <SelectContent>
                {eligibleEvents.map((event) => (
                  <SelectItem key={event.id} value={String(event.id)}>
                    {event.home} vs {event.away} · {format(new Date(event.date), "dd MMM HH:mm")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {!eventsLoading && eligibleEvents.length === 0 && (
              <p className="text-xs text-muted-foreground">Belum ada fixture mendatang dengan odds tersimpan.</p>
            )}
          </div>

          {fixture && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-secondary/20 p-3 text-xs">
              <span className="font-medium">{fixture.home} vs {fixture.away}</span>
              <Badge variant="outline">{fixture.oddsCount ?? 0} snapshot</Badge>
              <span className="text-muted-foreground">
                Odds terakhir dicatat: {fixture.oddsCapturedAt
                  ? format(new Date(fixture.oddsCapturedAt), "dd MMM yyyy HH:mm")
                  : "waktu tidak tersedia"}
              </span>
            </div>
          )}

          {fixtureId > 0 && (
            <div className="space-y-2">
              <Label htmlFor="manual-leg-market">Bookmaker · market · pilihan</Label>
              <Select value={optionId} onValueChange={setOptionId}>
                <SelectTrigger id="manual-leg-market">
                  <SelectValue placeholder={detailLoading ? "Memuat market..." : "Pilih hasil dan odds"} />
                </SelectTrigger>
                <SelectContent>
                  {oddsOptions.map((option) => (
                    <SelectItem key={option.id} value={option.id}>
                      {option.bookmaker} · {option.marketType}
                      {option.marketLine ? ` ${option.marketLine}` : ""}
                      {" · "}{option.selection} @ {option.odds.toFixed(2)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {!detailLoading && oddsOptions.length === 0 && (
                <p className="text-xs text-amber-400">Tidak ada market pilihan yang dapat digunakan pada fixture ini.</p>
              )}
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="manual-leg-probability">Perkiraan peluang Anda (%)</Label>
            <Input
              id="manual-leg-probability"
              type="number"
              min="1"
              max="99"
              step="1"
              inputMode="numeric"
              placeholder="Contoh: 58"
              value={probabilityPercent}
              onChange={(event) => setProbabilityPercent(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Diperlukan untuk menghitung peluang gabungan dan EV. Nilai ini berasal dari Anda, bukan perkiraan AI.
            </p>
          </div>

          {selectedOption && (
            <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm">
              <div className="font-medium">{selectedOption.selection} · {selectedOption.odds.toFixed(2)}</div>
              <div className="mt-1 text-xs text-muted-foreground">
                {selectedOption.bookmaker} · {selectedOption.marketType}{selectedOption.marketLine ? ` ${selectedOption.marketLine}` : ""}
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Batal
            </Button>
            <Button type="button" onClick={addLeg} disabled={!canAdd}>
              <Plus className="h-4 w-4" />
              Tambahkan leg
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
