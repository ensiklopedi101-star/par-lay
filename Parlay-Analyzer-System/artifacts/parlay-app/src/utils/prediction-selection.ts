const STORAGE_KEY = "terminal-bet-ai-parlay-predictions";

export function readSelectedPredictionIds(): string[] {
  if (typeof window === "undefined") return [];

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) && parsed.every((value) => typeof value === "string")
      ? parsed
      : [];
  } catch {
    return [];
  }
}

export function writeSelectedPredictionIds(ids: string[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
}