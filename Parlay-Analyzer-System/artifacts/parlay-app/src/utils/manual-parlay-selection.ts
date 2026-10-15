export type ManualOutcomeKey = "home" | "draw" | "away" | "over" | "under" | "yes" | "no";

export interface ManualParlayLeg {
  id: string;
  fixtureId: number;
  homeTeam: string;
  awayTeam: string;
  league: string;
  fixtureDate: string;
  bookmaker: string;
  marketType: string;
  marketLine: string | null;
  outcomeKey: ManualOutcomeKey;
  selection: string;
  odds: number;
  probability: number;
  capturedAt: string | null;
}

const STORAGE_KEY = "terminal-bet-ai-manual-parlay-legs";

function isManualParlayLeg(value: unknown): value is ManualParlayLeg {
  if (!value || typeof value !== "object") return false;
  const leg = value as Partial<ManualParlayLeg>;
  return typeof leg.id === "string"
    && Number.isInteger(leg.fixtureId)
    && typeof leg.homeTeam === "string"
    && typeof leg.awayTeam === "string"
    && typeof leg.league === "string"
    && typeof leg.fixtureDate === "string"
    && typeof leg.bookmaker === "string"
    && typeof leg.marketType === "string"
    && (leg.marketLine == null || typeof leg.marketLine === "string")
    && ["home", "draw", "away", "over", "under", "yes", "no"].includes(String(leg.outcomeKey))
    && typeof leg.selection === "string"
    && typeof leg.odds === "number"
    && Number.isFinite(leg.odds)
    && leg.odds > 1
    && typeof leg.probability === "number"
    && leg.probability > 0
    && leg.probability < 1
    && (leg.capturedAt == null || typeof leg.capturedAt === "string");
}

export function readManualParlayLegs(): ManualParlayLeg[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(parsed)
      ? parsed.filter(isManualParlayLeg).slice(0, 7)
      : [];
  } catch {
    return [];
  }
}

export function writeManualParlayLegs(legs: ManualParlayLeg[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(legs.slice(0, 7)));
  } catch {
    // The server remains the source of truth once the parlay is created.
  }
}
