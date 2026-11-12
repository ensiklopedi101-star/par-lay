import { classifyOddsMarket, type SupportedOddsMarket } from "./odds-market";

/*
 * Batas umur snapshot odds yang masih dianggap "terverifikasi".
 *
 * Nilai default 3 jam hanya masuk akal kalau sinkronisasi odds berjalan lebih
 * sering daripada itu. Sebelumnya workflow berjalan setiap 6 jam, sehingga
 * selama ~3 jam di setiap siklus SEMUA fixture terlihat "stale" dan scanner
 * menolak memanggil AI walaupun datanya baik. Sekarang jadwal sync dibuat per
 * jam (`.github/workflows/odds-sync.yml`) dan batas ini bisa disetel lewat
 * `ODDS_MAX_AGE_HOURS` (1-24) tanpa mengubah kode.
 */
const DEFAULT_ODDS_MAX_AGE_HOURS = 3;

function resolveOddsMaxAgeHours(raw = process.env.ODDS_MAX_AGE_HOURS): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_ODDS_MAX_AGE_HOURS;
  return Math.min(24, Math.max(1, parsed));
}

export const ODDS_MAX_AGE_HOURS = resolveOddsMaxAgeHours();
export const MAX_VERIFIED_ODDS_AGE_MS = ODDS_MAX_AGE_HOURS * 60 * 60 * 1000;

export interface MarketOddsSnapshot {
  match_id?: string | number | null;
  bookmaker?: string | null;
  market_type: string;
  odds_1: number | null;
  odds_2: number | null;
  odds_draw: number | null;
  captured_at?: string | null;
}

export type MarketOddsStatus =
  | "verified"
  | "missing_market"
  | "missing_line"
  | "line_mismatch"
  | "missing_selection"
  | "missing_price"
  | "stale"
  | "unsupported";

type SelectionSide = "home" | "away" | "draw" | "over" | "under" | "yes" | "no";

export interface MarketOddsResolution {
  status: MarketOddsStatus;
  odds: number | null;
  capturedAt: string | null;
  marketType: SupportedOddsMarket | null;
  line: number | null;
  matchedLine: number | null;
  reason: string;
}

interface ParsedMarketSelection {
  marketType: SupportedOddsMarket;
  side: SelectionSide | null;
  line: number | null;
  lineRequired: boolean;
}

function normalizedText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function containsTeam(market: string, team: string | undefined): boolean {
  const normalizedTeam = normalizedText(team ?? "");
  return normalizedTeam.length >= 3 && normalizedText(market).includes(normalizedTeam);
}

function selectionLine(value: string): number | null {
  const matches = value.match(/[+-]?\d+(?:\.\d+)?/g);
  if (!matches?.length) return null;
  const line = Number(matches[matches.length - 1]);
  return Number.isFinite(line) ? line : null;
}

export interface StructuredMarketSelectionInput {
  marketType?: unknown;
  outcome?: unknown;
  line?: unknown;
  selection?: unknown;
}

function structuredLine(value: unknown, selection: unknown, outcome: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const numeric = Number(value.trim());
    if (Number.isFinite(numeric)) return numeric;
    const extracted = selectionLine(value);
    if (extracted != null) return extracted;
  }
  return selectionLine(String(selection ?? outcome ?? ""));
}

/**
 * Convert an AI's canonical market/outcome/line fields into the stable label
 * understood by the odds resolver and the existing prediction schema.
 * Unsupported combinations return null instead of guessing at a different bet.
 */
export function normalizeStructuredMarketSelection(
  input: StructuredMarketSelectionInput,
  teams: { homeTeam?: string; awayTeam?: string } = {},
): string | null {
  const marketType = classifyOddsMarket(input.marketType);
  if (!marketType) return null;

  const outcome = String(input.outcome ?? input.selection ?? "").trim();
  const normalizedOutcome = normalizedText(outcome);
  const isHome = ["home", "home win", "home team", "1", "team 1"].includes(normalizedOutcome)
    || containsTeam(outcome, teams.homeTeam);
  const isAway = ["away", "away win", "away team", "visitor", "2", "team 2"].includes(normalizedOutcome)
    || containsTeam(outcome, teams.awayTeam);
  const isDraw = ["draw", "tie", "x"].includes(normalizedOutcome);
  const line = structuredLine(input.line, input.selection, input.outcome);

  if (marketType === "Totals") {
    const side = normalizedOutcome.startsWith("over") ? "Over"
      : normalizedOutcome.startsWith("under") ? "Under"
        : null;
    return side && line != null ? `${side} ${line} Goals` : null;
  }

  if (marketType === "AH") {
    if (isHome === isAway || line == null) return null;
    const side = isHome ? "Home" : "Away";
    const formattedLine = line > 0 ? `+${line}` : String(line);
    return `Asian Handicap ${side} ${formattedLine}`;
  }

  if (marketType === "BTTS") {
    if (["yes", "btts", "both teams", "both teams to score"].includes(normalizedOutcome)) return "BTTS Yes";
    if (["no", "not", "no btts"].includes(normalizedOutcome)) return "BTTS No";
    return null;
  }

  if (isDraw && !isHome && !isAway) {
    return marketType === "HT" ? "HT Draw" : "Draw";
  }
  if (isHome !== isAway && !isDraw) {
    const side = isHome ? "Home" : "Away";
    return marketType === "HT" ? `HT ${side}` : `${side} Win`;
  }
  return null;
}

function snapshotLine(row: MarketOddsSnapshot): number | null {
  const oddsDraw = Number(row.odds_draw);
  if (row.odds_draw != null && Number.isFinite(oddsDraw) && Math.abs(oddsDraw) <= 20) {
    return oddsDraw;
  }
  return selectionLine(row.market_type);
}

function recommendationMarketType(value: string): SupportedOddsMarket | null {
  const market = value.toLowerCase();
  if (market.includes("btts") || market.includes("both teams")) return "BTTS";
  if (market.includes("over") || market.includes("under")) return "Totals";
  if (market.includes("handicap") || market.includes("spread") || /\bah\b/.test(market)) return "AH";
  if (/\bht\b/.test(market) || market.includes("half-time") || market.includes("half time") || market.includes("first half")) return "HT";
  if (
    /\b(home|away|visitor|draw|tie)\b/.test(market)
    || /(?:^|\s)x(?:\s|$)/.test(market)
    || /^(1|2)$/.test(market.trim())
  ) return "ML";
  return null;
}

function parseSelection(
  market: string,
  homeTeam?: string,
  awayTeam?: string,
): ParsedMarketSelection | null {
  const value = market.trim();
  const lower = value.toLowerCase();
  const marketType = recommendationMarketType(value);
  if (!marketType || !value || /^no[\s_-]*bet\b/i.test(value)) return null;

  if (marketType === "Totals") {
    const side = /\bunder\b/i.test(value) ? "under" : /\bover\b/i.test(value) ? "over" : null;
    return { marketType, side, line: selectionLine(value), lineRequired: true };
  }

  if (marketType === "AH") {
    const isAway = /\b(away|visitor|visitors)\b/i.test(value) || containsTeam(value, awayTeam);
    const isHome = /\bhome\b/i.test(value) || containsTeam(value, homeTeam);
    const side = isAway === isHome ? null : isAway ? "away" : "home";
    return { marketType, side, line: selectionLine(value), lineRequired: true };
  }

  if (marketType === "BTTS") {
    const side = /\b(no|not)\b/i.test(value) ? "no" : /\b(yes|btts)\b/i.test(value) ? "yes" : null;
    return { marketType, side, line: null, lineRequired: false };
  }

  const sideText = normalizedText(value);
  const isAway = /\b(away|visitor|visitors)\b/i.test(value) || containsTeam(value, awayTeam);
  const isHome = /\bhome\b/i.test(value) || containsTeam(value, homeTeam);
  const isDraw = /\b(draw|tie)\b/i.test(value) || /(?:^|\s)x(?:\s|$)/i.test(value);
  const side: SelectionSide | null = isDraw
    ? "draw"
    : isAway !== isHome
      ? isAway ? "away" : "home"
      : sideText === "2"
        ? "away"
        : sideText === "x"
          ? "draw"
          : sideText === "1"
            ? "home"
            : null;
  return { marketType, side, line: null, lineRequired: false };
}

function selectionPrice(row: MarketOddsSnapshot, side: SelectionSide): number | null {
  const field = side === "home" || side === "over" || side === "yes"
    ? row.odds_1
    : side === "away" || side === "under" || side === "no"
      ? row.odds_2
      : row.odds_draw;
  const odds = Number(field);
  return Number.isFinite(odds) && odds > 1 ? odds : null;
}

function result(
  status: MarketOddsStatus,
  reason: string,
  options: Partial<MarketOddsResolution> = {},
): MarketOddsResolution {
  return {
    status,
    reason,
    odds: null,
    capturedAt: null,
    marketType: null,
    line: null,
    matchedLine: null,
    ...options,
  };
}

/**
 * Resolve the exact selected market/outcome/line from provider snapshots.
 * A family-only match is never enough for totals or Asian Handicap because it
 * can silently use a different line's price.
 */
export function resolveMarketOdds(
  market: string,
  rows: MarketOddsSnapshot[],
  options: {
    homeTeam?: string;
    awayTeam?: string;
    now?: number;
    maxAgeMs?: number;
  } = {},
): MarketOddsResolution {
  const selection = parseSelection(market, options.homeTeam, options.awayTeam);
  if (!selection) {
    return result("unsupported", "Market prediksi tidak dikenali sebagai pilihan provider yang terstruktur.");
  }
  if (!selection.side) {
    return result("missing_selection", "Sisi pilihan market tidak dapat ditentukan dengan aman.", {
      marketType: selection.marketType,
      line: selection.line,
    });
  }
  if (selection.lineRequired && selection.line == null) {
    return result("missing_line", "Line harus tercantum pada market prediksi sebelum odds dapat dicocokkan.", {
      marketType: selection.marketType,
    });
  }

  const familyRows = rows.filter((row) => classifyOddsMarket(row.market_type) === selection.marketType);
  if (familyRows.length === 0) {
    return result("missing_market", "Provider belum memiliki odds untuk jenis market prediksi ini.", {
      marketType: selection.marketType,
      line: selection.line,
    });
  }

  const matchingRows = selection.lineRequired
    ? familyRows.filter((row) => {
        const line = snapshotLine(row);
        return line != null && Math.abs(line - Number(selection.line)) <= 0.001;
      })
    : familyRows;

  if (matchingRows.length === 0) {
    const hasLineData = familyRows.some((row) => snapshotLine(row) != null);
    return result(
      hasLineData ? "line_mismatch" : "missing_line",
      hasLineData
        ? `Odds provider tersedia, tetapi tidak untuk line ${selection.line}.`
        : "Provider tidak menyertakan line yang diperlukan untuk mencocokkan market.",
      {
        marketType: selection.marketType,
        line: selection.line,
        matchedLine: familyRows.map(snapshotLine).find((line) => line != null) ?? null,
      },
    );
  }

  const orderedRows = matchingRows.slice().sort((a, b) => {
    const aTime = a.captured_at ? new Date(a.captured_at).getTime() : Number.NEGATIVE_INFINITY;
    const bTime = b.captured_at ? new Date(b.captured_at).getTime() : Number.NEGATIVE_INFINITY;
    return bTime - aTime;
  });
  const row = orderedRows[0]!;
  const odds = selectionPrice(row, selection.side);
  const capturedAt = row.captured_at ?? null;
  const capturedTime = capturedAt ? new Date(capturedAt).getTime() : Number.NaN;
  const age = (options.now ?? Date.now()) - capturedTime;
  const isFresh = Number.isFinite(capturedTime)
    && age >= 0
    && age <= (options.maxAgeMs ?? MAX_VERIFIED_ODDS_AGE_MS);
  const common = {
    odds,
    capturedAt,
    marketType: selection.marketType,
    line: selection.line,
    matchedLine: selection.lineRequired ? snapshotLine(row) : null,
  };

  if (odds == null) {
    return result("missing_price", "Market dan line cocok, tetapi harga untuk sisi pilihan tidak tersedia.", common);
  }
  if (!isFresh) {
    return result("stale", "Odds cocok, tetapi snapshot sudah kedaluwarsa atau waktu pengambilannya tidak valid.", common);
  }

  return result("verified", "Odds provider cocok dengan market, sisi pilihan, line, dan batas freshness.", common);
}
