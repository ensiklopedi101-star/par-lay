/**
 * Closing odds — harga dan probabilitas fair sesaat sebelum kick-off.
 *
 * Ini inti Fase 2: tanpa `odds_close`, CLV tidak bisa dihitung, dan seluruh
 * gerbang Fase 3 (`CLV > 0`, t-stat, vonis "supported") tidak akan pernah bisa
 * dievaluasi. Modul ini murni: tidak menyentuh database, sehingga bisa diuji
 * tanpa Supabase dan tanpa fixture nyata.
 *
 * Kontrak yang dijaga:
 *  - Harga penutup diambil dari snapshot TERAKHIR yang `captured_at`-nya masih
 *    sebelum kick-off. Snapshot setelah kick-off tidak boleh dipakai: memakai
 *    harga in-play akan membuat CLV tampak bagus atau buruk secara palsu.
 *  - Probabilitas fair dihitung dengan de-vig yang sama seperti engine
 *    (`shin`), supaya `close_fair_prob` sebanding dengan `p_market_fair`.
 *  - Satu market hanya dihargai bila SELURUH outcome-nya ada. Setengah pasar
 *    tidak bisa di-de-vig; menebak sisanya akan mengarang probabilitas.
 */

import { devig } from "./quant/devig";

export type MarketFamily = "ML" | "Totals" | "AH" | "BTTS";

/** Satu baris `odds_movement_history` yang sudah dinormalkan. */
export interface OddsSnapshotRow {
  bookmaker: string;
  /** mis. "ML", "Totals 2.5", "Spread -0.25", "Both Teams To Score" */
  marketType: string;
  capturedAt: string;
  homeOdds: number | null;
  awayOdds: number | null;
  drawOdds: number | null;
  overOdds: number | null;
  underOdds: number | null;
  bttsYes: number | null;
  bttsNo: number | null;
}

export interface ClosingPrice {
  marketKey: string;
  oddsClose: number;
  closeFairProb: number;
  bookmaker: string;
  capturedAt: string;
}

export interface ClosingResult {
  prices: Map<string, ClosingPrice>;
  /** market_key yang diminta tetapi tidak bisa dihargai, beserta alasannya. */
  skipped: Array<{ marketKey: string; reason: string }>;
}

export interface ParsedMarketKey {
  family: MarketFamily;
  /** home | draw | away | over | under | yes | no */
  side: string;
  /** garis untuk Totals/AH, null untuk ML dan BTTS */
  line: number | null;
}

/**
 * `market_key` yang ditulis engine (lihat `lib/quant/pipeline.ts`):
 *   ML:home | ML:draw | ML:away
 *   TOT:over:2.5 | TOT:under:2.5
 *   BTTS:yes | BTTS:no
 *   AH:home:-0.25 | AH:away:0.25
 *
 * Mengembalikan null untuk kunci yang tidak dikenal — pemanggil harus
 * melewatinya, bukan menebak.
 */
export function parseMarketKey(key: string): ParsedMarketKey | null {
  const parts = String(key).split(":");
  const head = parts[0]?.trim();

  if (head === "ML") {
    const side = parts[1]?.trim();
    if (side === "home" || side === "draw" || side === "away") {
      return { family: "ML", side, line: null };
    }
    return null;
  }

  if (head === "BTTS") {
    const side = parts[1]?.trim();
    if (side === "yes" || side === "no") {
      return { family: "BTTS", side, line: null };
    }
    return null;
  }

  if (head === "TOT") {
    const side = parts[1]?.trim();
    const line = Number(parts[2]);
    if ((side === "over" || side === "under") && Number.isFinite(line)) {
      return { family: "Totals", side, line };
    }
    return null;
  }

  if (head === "AH") {
    const side = parts[1]?.trim();
    const line = Number(parts[2]);
    if ((side === "home" || side === "away") && Number.isFinite(line)) {
      return { family: "AH", side, line };
    }
    return null;
  }

  return null;
}

/**
 * `market_type` dari penyedia → keluarga pasar + garis.
 *
 * Nilai nyata di `odds_movement_history` (dihitung dari database):
 *   "ML", "Totals 2.5", "Totals 2.75", "Spread -0.25", "Both Teams To Score"
 */
export function parseMarketType(
  marketType: string,
): { family: MarketFamily; line: number | null } | null {
  const raw = String(marketType ?? "").trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();

  if (lower === "ml" || lower === "h2h" || lower.includes("match winner") || lower.includes("1x2")) {
    return { family: "ML", line: null };
  }
  if (lower.includes("both teams to score") || lower.startsWith("btts")) {
    return { family: "BTTS", line: null };
  }

  /*
   * Pasar yang BUKAN gol harus ditolak lebih dulu. Database berisi
   * "Total Corners" (2.108 baris) dan "Exact Total Goals" (2.653 baris) —
   * keduanya mengandung kata "total", dan salah memasukkannya ke Totals akan
   * menghasilkan close_fair_prob dari pasar yang sama sekali berbeda.
   */
  if (lower.includes("corner") || lower.includes("card") || lower.includes("booking")) {
    return null;
  }
  if (lower.includes("exact")) {
    return null;
  }

  const line = extractLine(raw);

  if (lower.startsWith("totals") || lower.startsWith("total") || lower.includes("over/under")) {
    return { family: "Totals", line };
  }
  if (lower.startsWith("spread") || lower.includes("handicap")) {
    return { family: "AH", line };
  }

  return null;
}

/** Angka terakhir di dalam string, mis. "Totals 2.5" → 2.5, "Spread -0.25" → -0.25. */
export function extractLine(value: string): number | null {
  const matches = String(value).match(/-?\d+(?:\.\d+)?/g);
  if (!matches || matches.length === 0) return null;
  const last = Number(matches[matches.length - 1]);
  return Number.isFinite(last) ? last : null;
}

function validOdds(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 1;
}

/**
 * De-vig satu pasar penuh. Mengembalikan null bila outcome tidak lengkap.
 * `shin` dipakai agar sebanding dengan `p_market_fair` di engine.
 */
function fairFromOdds(odds: number[]): number[] | null {
  if (odds.length < 2 || !odds.every(validOdds)) return null;
  try {
    const result = devig(odds, "shin");
    /* De-vig yang menghasilkan probabilitas di luar (0,1) menandakan harga
       rusak (mis. odds 1.01 bertiga). Tolak daripada menyimpan angka omong kosong. */
    if (!result.probs.every((p) => Number.isFinite(p) && p > 0 && p < 1)) return null;
    return result.probs;
  } catch {
    return null;
  }
}

/**
 * Pilih snapshot terakhir per (bookmaker, family, line) yang captured_at-nya
 * masih sebelum kick-off.
 *
 * `captured_at` dibandingkan sebagai waktu, bukan string, karena format
 * penyedia tidak selalu ISO dengan zona yang sama.
 */
export function selectClosingSnapshots(
  rows: OddsSnapshotRow[],
  kickoff: Date | string,
): OddsSnapshotRow[] {
  const kickoffMs = new Date(kickoff).getTime();
  if (!Number.isFinite(kickoffMs)) return [];

  const latest = new Map<string, { row: OddsSnapshotRow; at: number }>();
  for (const row of rows) {
    const at = new Date(row.capturedAt).getTime();
    if (!Number.isFinite(at) || at >= kickoffMs) continue;

    const parsed = parseMarketType(row.marketType);
    if (!parsed) continue;

    const key = `${row.bookmaker}::${parsed.family}::${parsed.line ?? ""}`;
    const existing = latest.get(key);
    if (!existing || at > existing.at) latest.set(key, { row, at });
  }

  return Array.from(latest.values())
    .sort((a, b) => a.at - b.at)
    .map((entry) => entry.row);
}

/**
 * Hitung harga penutup + probabilitas fair untuk setiap `market_key` yang
 * diminta. Hanya kunci yang pasar penuhnya tersedia yang dihargai.
 */
export function computeClosingPrices(
  marketKeys: string[],
  snapshotRows: OddsSnapshotRow[],
  kickoff: Date | string,
): ClosingResult {
  const prices = new Map<string, ClosingPrice>();
  const skipped: Array<{ marketKey: string; reason: string }> = [];

  const closing = selectClosingSnapshots(snapshotRows, kickoff);

  /* Kelompokkan snapshot penutup per bookmaker+family+line, simpan yang paling
     akhir. Satu pasar dihargai dari satu snapshot saja — mencampur bookmaker
     akan membuat jumlah probabilitas tidak lagi 1. */
  const byMarket = new Map<string, OddsSnapshotRow>();
  for (const row of closing) {
    const parsed = parseMarketType(row.marketType);
    if (!parsed) continue;
    byMarket.set(`${row.bookmaker}::${parsed.family}::${parsed.line ?? ""}`, row);
  }

  for (const key of marketKeys) {
    const want = parseMarketKey(key);
    if (!want) {
      skipped.push({ marketKey: key, reason: "market_key tidak dikenal" });
      continue;
    }

    let found: { row: OddsSnapshotRow; probs: number[]; odds: number } | null = null;
    let sawMarket = false;

    for (const [marketKeyId, row] of byMarket) {
      const parsed = parseMarketType(row.marketType);
      if (!parsed || parsed.family !== want.family) continue;
      if (parsed.family === "Totals" && parsed.line !== want.line) continue;
      /* Untuk AH, garis baris selalu garis kandang. `AH:away:L` memakai garis -L. */
      if (parsed.family === "AH") {
        const homeLine = want.side === "home" ? want.line : want.line == null ? null : -want.line;
        if (parsed.line !== homeLine) continue;
      }
      sawMarket = true;

      if (parsed.family === "ML") {
        const probs = fairFromOdds([
          row.homeOdds as number,
          row.drawOdds as number,
          row.awayOdds as number,
        ]);
        const index = want.side === "home" ? 0 : want.side === "draw" ? 1 : 2;
        const odds = index === 0 ? row.homeOdds : index === 1 ? row.drawOdds : row.awayOdds;
        if (probs && validOdds(odds)) {
          found = { row, probs, odds };
          void marketKeyId;
          break;
        }
      } else if (parsed.family === "Totals") {
        const probs = fairFromOdds([row.overOdds as number, row.underOdds as number]);
        const index = want.side === "over" ? 0 : 1;
        const odds = index === 0 ? row.overOdds : row.underOdds;
        if (probs && validOdds(odds)) {
          found = { row, probs, odds };
          break;
        }
      } else if (parsed.family === "BTTS") {
        const probs = fairFromOdds([row.bttsYes as number, row.bttsNo as number]);
        const index = want.side === "yes" ? 0 : 1;
        const odds = index === 0 ? row.bttsYes : row.bttsNo;
        if (probs && validOdds(odds)) {
          found = { row, probs, odds };
          break;
        }
      } else if (parsed.family === "AH") {
        const probs = fairFromOdds([row.homeOdds as number, row.awayOdds as number]);
        const index = want.side === "home" ? 0 : 1;
        const odds = index === 0 ? row.homeOdds : row.awayOdds;
        if (probs && validOdds(odds)) {
          found = { row, probs, odds };
          break;
        }
      }
    }

    if (!found) {
      skipped.push({
        marketKey: key,
        reason: sawMarket
          ? "harga tidak lengkap — de-vig butuh semua outcome"
          : "tidak ada snapshot penutup untuk pasar ini",
      });
      continue;
    }

    const index = want.family === "ML"
      ? (want.side === "home" ? 0 : want.side === "draw" ? 1 : 2)
      : (want.side === "over" || want.side === "yes" || want.side === "home" ? 0 : 1);

    prices.set(key, {
      marketKey: key,
      oddsClose: found.odds,
      closeFairProb: found.probs[index]!,
      bookmaker: found.row.bookmaker,
      capturedAt: found.row.capturedAt,
    });
  }

  return { prices, skipped };
}
