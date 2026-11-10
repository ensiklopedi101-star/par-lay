/**
 * Pure bet-settlement math.
 *
 * This module intentionally has no dependency on Supabase or the logger: the
 * WIN/LOSS decision is the part of settlement that must stay deterministic and
 * auditable, so it is isolated from all I/O.
 *
 * Conventions used by the stored `market_bet` label:
 *   - 1X2   : "Home Win" | "HT Home" | "Draw" | "1X2 Away"
 *   - Totals: "Over 2.5 Goals" | "Under 3.25"
 *   - AH    : "Asian Handicap Home -0.25" | "AH Away +0.75"
 *   - BTTS  : "BTTS Yes" | "BTTS No" | "Both Teams to Score - No"
 *   - DNB   : "Draw No Bet Home"
 */

export type SettlementOutcome = "WIN" | "LOSS" | "HALF_WIN" | "HALF_LOSS" | "PUSH";

/* ─────────────────────────────────────────
   Line helpers
───────────────────────────────────────── */

/**
 * Every market outcome lands on a quarter-goal grid (whole goals are integers
 * and Asian lines use .0/.25/.5/.75), so four units per goal is an exact
 * integer representation. Rounding here removes binary floating point noise
 * such as `0.1 + 0.2` and keeps quarter-line comparisons reliable.
 */
function quarterUnits(value: number): number {
  return Math.round(value * 4);
}

/** Quarter lines (.25 / .75) split the stake across two neighbouring lines. */
export function isQuarterLine(line: number): boolean {
  const remainder = Math.abs(quarterUnits(line)) % 4;
  return remainder === 1 || remainder === 3;
}

function settleUnits(units: number): "WIN" | "PUSH" | "LOSS" {
  return units > 0 ? "WIN" : units === 0 ? "PUSH" : "LOSS";
}

/**
 * Settle a bet from a margin expressed relative to its line:
 *   - handicap : margin = goals in favour of the selection + handicap line
 *   - totals   : margin = goals scored - over line (line - goals for under)
 *
 * Quarter lines are two half stakes at `line - 0.25` and `line + 0.25`, which
 * is exactly why AH -0.25 on a draw is HALF_LOSS and AH +0.75 losing by one
 * goal is also HALF_LOSS. Whole and half lines can only win, push or lose.
 */
export function settleAgainstLine(margin: number, line: number): SettlementOutcome {
  const marginUnits = quarterUnits(margin);
  if (!isQuarterLine(line)) return settleUnits(marginUnits);

  const lowerHalf = settleUnits(marginUnits - 1);
  const upperHalf = settleUnits(marginUnits + 1);

  if (lowerHalf === "WIN" && upperHalf === "WIN") return "WIN";
  if (lowerHalf === "LOSS" && upperHalf === "LOSS") return "LOSS";
  if (lowerHalf === "PUSH" && upperHalf === "PUSH") return "PUSH";
  if (upperHalf === "WIN") return "HALF_WIN";
  if (lowerHalf === "WIN") return "HALF_WIN";
  if (upperHalf === "LOSS") return "HALF_LOSS";
  if (lowerHalf === "LOSS") return "HALF_LOSS";
  /* One half won and the other lost: the stake is refunded. Unreachable on a
     quarter line, kept so the helper is total. */
  return "PUSH";
}

/* ─────────────────────────────────────────
   Market label parsing
───────────────────────────────────────── */

/**
 * Extract the numeric line from a market label.
 * Handles "over_2_5", "Over 2.25 Goals", "Asian Handicap Home -0.25" and
 * "AH Away +0.75".
 */
export function extractLine(market: string): number | null {
  const normalized = market.toLowerCase().replace(/,/g, ".");
  const lineMatch = normalized.match(
    /(?:over|under|handicap|asian[\s_-]*handicap|spread|\bah\b).*?([-+]?\d+(?:[._]\d+)?)/,
  ) ?? normalized.match(/([-+]?\d+(?:[._]\d+)?)/);
  if (!lineMatch) return null;
  const parsed = Number(lineMatch[1]!.replace(/_/g, "."));
  return Number.isFinite(parsed) ? parsed : null;
}

/** Collapse separators so "btts_no", "BTTS-No", "BTTS: No" all read the same. */
function words(value: string): string {
  return value.replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * Build the market label used to settle a parlay leg from the leg's own
 * `market` + `selection` columns.
 *
 * AI legs store the full market label in both columns, while manual legs store
 * the odds market type in `market` and the picked outcome in `selection`
 * (a team name, "Draw", "Over 2.5", "Yes", ...). Team names are mapped back to
 * the canonical Home/Away tokens that `calculateResult` understands.
 */
export function parlayLegMarketText(
  leg: { market?: string | null; selection?: string | null },
  teams: { homeTeam?: string | null; awayTeam?: string | null } = {},
): string | null {
  const market = (leg.market ?? "").trim();
  const selection = (leg.selection ?? "").trim();
  if (!market && !selection) return null;

  const selectionKey = selection.toLowerCase().replace(/\s+/g, " ");
  const homeTeam = (teams.homeTeam ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  const awayTeam = (teams.awayTeam ?? "").trim().toLowerCase().replace(/\s+/g, " ");

  if (homeTeam && selectionKey === homeTeam) return `${market} Home`.trim();
  if (awayTeam && selectionKey === awayTeam) return `${market} Away`.trim();
  /* AI legs store the full market label in both columns. */
  if (!market) return selection;
  if (!selection || market.toLowerCase() === selectionKey) return market;
  return `${market} ${selection}`;
}

/* ─────────────────────────────────────────
   Settlement decision
───────────────────────────────────────── */

/**
 * Decide WIN/LOSS (including half results and pushes) from the final score and
 * the selected market. Returns null when the market cannot be interpreted so
 * callers can keep the row retryable instead of inventing an outcome.
 */
export function calculateResult(
  homeGoals: number,
  awayGoals: number,
  bestMarket: string | null,
  predictionText: string | null,
  homeGoalsHT?: number | null,
  awayGoalsHT?: number | null,
): SettlementOutcome | null {
  const market = (bestMarket ?? "").toLowerCase().trim();
  const text = (predictionText ?? "").toLowerCase();
  const isHalfTime = /\b(ht|half[\s-]?time|first[\s-]?half)\b/.test(market);
  const evaluatedHomeGoals = isHalfTime ? homeGoalsHT : homeGoals;
  const evaluatedAwayGoals = isHalfTime ? awayGoalsHT : awayGoals;
  if (evaluatedHomeGoals == null || evaluatedAwayGoals == null) return null;
  const evaluatedTotal = evaluatedHomeGoals + evaluatedAwayGoals;
  const evaluatedDiff = evaluatedHomeGoals - evaluatedAwayGoals;

  /* Over / Under — quarter lines (2.25, 2.75, …) split the stake. */
  if (market.includes("over")) {
    const line = extractLine(market) ?? 2.5;
    return settleAgainstLine(evaluatedTotal - line, line);
  }
  if (market.includes("under")) {
    const line = extractLine(market) ?? 2.5;
    return settleAgainstLine(line - evaluatedTotal, line);
  }

  /*
   * BTTS — the YES/NO side must be read before defaulting to YES. The stored
   * label can be "BTTS No", "btts_no", "BTTS: No" or "Both Teams to Score - No".
   */
  const marketWords = words(market);
  const isBtts = /\bbtts\b/.test(marketWords) || /\bboth teams? (?:to )?score\b/.test(marketWords);
  if (isBtts) {
    const wantsNo = /\b(no|not|tidak)\b/.test(marketWords)
      || /\bbtts\b[\s:_.-]*\bno\b/.test(text)
      || text.includes("tidak kedua tim mencetak");
    const bothTeamsScored = evaluatedHomeGoals > 0 && evaluatedAwayGoals > 0;
    if (wantsNo) return bothTeamsScored ? "LOSS" : "WIN";
    return bothTeamsScored ? "WIN" : "LOSS";
  }

  /* Draw No Bet */
  if (market.includes("draw no bet") || /\bdnb\b/.test(market)) {
    const isAwaySelection = /\b(away|visitor|tamu)\b/.test(market);
    const selectedTeamDiff = isAwaySelection ? -evaluatedDiff : evaluatedDiff;
    return selectedTeamDiff > 0 ? "WIN" : selectedTeamDiff === 0 ? "PUSH" : "LOSS";
  }

  /* Asian Handicap — supports whole, half and quarter lines. */
  const isAsianHandicap = market.includes("handicap")
    || market.includes("spread")
    || /\bah\b/.test(market)
    || /\b(home|away|visitor|tamu)\b.*[-+]\d/.test(market);
  if (isAsianHandicap) {
    const line = extractLine(market);
    if (line !== null) {
      const isAwaySelection = /\b(away|visitor|tamu)\b|(?:^|[\s_])2(?:$|[\s_])/.test(market);
      const selectedTeamDiff = isAwaySelection ? -evaluatedDiff : evaluatedDiff;
      return settleAgainstLine(selectedTeamDiff + line, line);
    }
    return selectedTeamWins(market, evaluatedHomeGoals, evaluatedAwayGoals) ? "WIN" : "LOSS";
  }

  /* 1x2 / Moneyline */
  if (market.includes("home") || market === "1" || market === "1x2_home") {
    return evaluatedHomeGoals > evaluatedAwayGoals ? "WIN" : "LOSS";
  }
  if (market.includes("away") || market === "2" || market === "1x2_away") {
    return evaluatedAwayGoals > evaluatedHomeGoals ? "WIN" : "LOSS";
  }
  if (market.includes("draw") || market === "x" || market === "1x2_draw") {
    return evaluatedHomeGoals === evaluatedAwayGoals ? "WIN" : "LOSS";
  }

  /* Fallback: infer from the prediction prose (legacy rows only). */
  if (text.includes("menang") && (text.includes("home") || text.includes("tuan rumah"))) {
    return evaluatedHomeGoals > evaluatedAwayGoals ? "WIN" : "LOSS";
  }
  if (text.includes("menang") && (text.includes("away") || text.includes("tamu"))) {
    return evaluatedAwayGoals > evaluatedHomeGoals ? "WIN" : "LOSS";
  }

  return null; /* market tidak dikenali */
}

function selectedTeamWins(market: string, homeGoals: number, awayGoals: number): boolean {
  return /\b(away|visitor|tamu)\b|(?:^|[\s_])2(?:$|[\s_])/.test(market)
    ? awayGoals > homeGoals
    : homeGoals > awayGoals;
}
