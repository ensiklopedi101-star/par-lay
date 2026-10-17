export type SupportedOddsMarket = "ML" | "Totals" | "AH" | "HT" | "BTTS";

export function normalizeMarketToken(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
    .replace(/[()\/]/g, "_")
    .replace(/_+/g, "_");
}

export function classifyOddsMarket(value: unknown): SupportedOddsMarket | null {
  const token = normalizeMarketToken(value);
  if (!token) return null;
  const baseToken = token.replace(/[_:]+[-+]?\d+(?:\.\d+)?$/, "");
  if (
    baseToken === "ht"
    || baseToken.includes("half_time")
    || baseToken.includes("halftime")
    || baseToken.includes("ht_result")
    || baseToken.includes("first_half")
  ) return "HT";
  if (
    baseToken === "btts"
    || baseToken.includes("both_teams")
    || baseToken.includes("both_team")
    || baseToken.includes("both_teams_to_score")
  ) return "BTTS";
  if (
    baseToken === "ah"
    || baseToken.startsWith("ah_")
    || baseToken.includes("asian_handicap")
    || baseToken.includes("handicap")
    || baseToken.includes("alternate_spread")
    || baseToken.includes("spread")
  ) return "AH";
  if (
    baseToken === "ou"
    || baseToken.startsWith("ou_")
    || baseToken === "totals"
    || baseToken === "over_under"
    || baseToken.includes("alternate_total")
    || baseToken.includes("total")
    || baseToken.includes("over")
    || baseToken.includes("under")
  ) return "Totals";
  if (
    baseToken === "ml"
    || baseToken === "h2h"
    || baseToken === "1x2"
    || baseToken.includes("match_winner")
    || baseToken.includes("match_result")
  ) return "ML";
  return null;
}
