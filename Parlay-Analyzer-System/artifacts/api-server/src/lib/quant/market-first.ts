/**
 * Komposer PASAR-DULU (market-first).
 *
 * Perubahan arah yang dibuktikan backtest gudang (9.181 pertandingan,
 * skill model −7,76%, t=−18,2): probabilitas model murni tidak layak
 * menjadi hakim tiket — pasar jauh lebih akurat. Maka:
 *
 *  - Probabilitas resmi leg = probabilitas fair pasar (de-vig).
 *  - Model statistik tidak lagi menentukan peluang; ia memberi
 *    KARAKTER leg: apakah statistik mendukung harga pasar, diam saja,
 *    atau justru bertentangan (leg rapuh).
 *  - Tiket 5–8 leg selalu bisa disusun dari kandidat yang cukup,
 *    mengejar target odds gabungan sambil memaksimalkan peluang
 *    gabungan — dan peluang sebenarnya tertulis di muka tiket.
 *
 * Kejujuran yang tidak dinegosiasikan: EV tiket terhadap harga bandar
 * hampir selalu negatif karena margin menumpuk per leg. Angka itu
 * ditampilkan, bukan disembunyikan. Nilai pendekatan ini adalah
 * disiplin memilih (harga terbaik, leg stabil, tanpa filler buta),
 * bukan klaim mengalahkan pasar.
 */
import type { SelectionEval } from "./pipeline";
import { analyzeParlay, type ParlayLeg } from "./parlay";

export type LegCharacter =
  | "didukung-statistik"
  | "pasar-stabil"
  | "rapuh"
  | "kontradiktif";

export interface MarketFirstLeg {
  marketKey: string;
  fixtureId: number;
  league: string;
  date?: string | null;
  selection: SelectionEval;
  /** Probabilitas yang dipakai: fair pasar; fallback pFinal bila pasar tak ada. */
  pUsed: number;
  character: LegCharacter;
  /** Skor kestabilan 0–1: peluang pasar tinggi + statistik sejalan + sigma kecil. */
  stability: number;
  characterNote: string;
}

/** Selisih probabilitas model vs pasar yang masih dianggap "sejalan". */
export const AGREE_TOLERANCE = 0.05;
/** Selisih yang membuat statistik dianggap bertentangan dengan harga. */
export const CONTRADICT_TOLERANCE = 0.12;

/**
 * Beri karakter pada satu leg dari hubungan model ↔ pasar.
 * Statistik tidak mengubah peluang; ia menilai apakah harga pasar
 * didukung, dibiarkan, atau patut dicurigai.
 */
export function classifyLeg(selection: SelectionEval): {
  character: LegCharacter;
  stability: number;
  note: string;
} {
  const pMarket = selection.pMarket;
  const pModel = selection.pModelOnly;
  if (pMarket == null || !(pMarket > 0 && pMarket < 1)) {
    return {
      character: "pasar-stabil",
      stability: 0.4,
      note: "Probabilitas pasar tidak tersedia — karakter hanya dari model, perlakukan hati-hati.",
    };
  }
  const gap = pModel - pMarket;
  const sigmaPenalty = Math.min(0.25, Math.max(0, selection.sigma) * 0.5);
  if (gap >= AGREE_TOLERANCE) {
    return {
      character: "didukung-statistik",
      stability: Math.min(1, 0.55 + pMarket * 0.4 - sigmaPenalty),
      note: `Statistik lebih optimistis dari pasar (+${(gap * 100).toFixed(1)} poin) — harga didukung performa.`,
    };
  }
  if (gap <= -CONTRADICT_TOLERANCE) {
    return {
      character: "kontradiktif",
      stability: Math.max(0, 0.3 - sigmaPenalty),
      note: `Statistik jauh lebih pesimistis dari pasar (${(gap * 100).toFixed(1)} poin) — harga pasar patut dicurigai.`,
    };
  }
  if (gap <= -AGREE_TOLERANCE) {
    return {
      character: "rapuh",
      stability: Math.max(0.05, 0.45 + pMarket * 0.25 - sigmaPenalty),
      note: `Statistik lebih pesimistis dari pasar (${(gap * 100).toFixed(1)} poin) — leg kurang kokoh dari harganya.`,
    };
  }
  return {
    character: "pasar-stabil",
    stability: Math.min(0.95, 0.5 + pMarket * 0.4 - sigmaPenalty),
    note: "Statistik dan pasar sejalan — leg mengikuti harga pasar apa adanya.",
  };
}

export interface MarketFirstCandidate {
  marketKey: string;
  fixtureId: number;
  league: string;
  date?: string | null;
  selection: SelectionEval;
}

export interface MarketFirstTicket {
  legs: MarketFirstLeg[];
  combinedOdds: number;
  /** Peluang gabungan berbasis pasar (min dari independen & terkorelasi). */
  pCombined: number;
  /** Odds wajar dari peluang gabungan: 1 / pCombined. */
  fairOdds: number;
  /** EV jujur terhadap harga bandar — biasanya negatif (margin menumpuk). */
  evVsBook: number;
  /** Margin gabungan yang dibayar ke bandar (dari analyzeParlay). */
  marginPaid: number | null;
  targetOdds: number;
  targetReached: boolean;
  notes: string[];
}

export interface MarketFirstOptions {
  minLegs?: number;
  maxLegs?: number;
  /** Target odds gabungan (bawaan 2.0 — "melipatgandakan"). */
  targetOdds?: number;
  /** Peluang pasar minimum per leg agar dianggap kandidat (bawaan 0.55). */
  minMarketProb?: number;
  seed?: number;
}

const MIN_LEGS_DEFAULT = 5;
const MAX_LEGS_DEFAULT = 8;

/**
 * Susun tiket pasar-dulu. Algoritme:
 *  1. Satu leg per pertandingan — leg berkarakter terbaik (bukan
 *     sekadar EV tertinggi; kontradiktif selalu kalah).
 *  2. Untuk tiap ukuran 5..8, ambil leg dengan pUsed tertinggi yang
 *     mencapai target odds; pilih ukuran dengan pCombined terbesar.
 *  3. Bila tidak ada ukuran yang mencapai target, kembalikan tiket
 *     berpeluang tertinggi dan nyatakan target tidak tercapai.
 * Tiket TIDAK ditolak hanya karena EV negatif — itu memang sifat
 * parlay melawan margin; kejujuran angka menggantikan penolakan.
 */
export function buildMarketFirstTicket(
  candidates: MarketFirstCandidate[],
  options: MarketFirstOptions = {},
): MarketFirstTicket | null {
  const minLegs = Math.max(2, options.minLegs ?? MIN_LEGS_DEFAULT);
  const maxLegs = Math.max(minLegs, options.maxLegs ?? MAX_LEGS_DEFAULT);
  const targetOdds = Math.max(1.2, options.targetOdds ?? 2);
  const minMarketProb = options.minMarketProb ?? 0.55;
  const notes: string[] = [];

  const rankedCharacter: Record<LegCharacter, number> = {
    "didukung-statistik": 3,
    "pasar-stabil": 2,
    "rapuh": 1,
    "kontradiktif": 0,
  };

  const byFixture = new Map<number, MarketFirstLeg>();
  for (const candidate of candidates) {
    const { selection } = candidate;
    const pUsed = selection.pMarket != null && selection.pMarket > 0 && selection.pMarket < 1
      ? selection.pMarket
      : selection.pFinal;
    if (!Number.isFinite(selection.odds) || selection.odds <= 1) continue;
    if (!(pUsed > 0 && pUsed < 1) || pUsed < minMarketProb) continue;
    const { character, stability, note } = classifyLeg(selection);
    const leg: MarketFirstLeg = {
      marketKey: candidate.marketKey,
      fixtureId: candidate.fixtureId,
      league: candidate.league,
      date: candidate.date ?? null,
      selection,
      pUsed,
      character,
      stability,
      characterNote: note,
    };
    const existing = byFixture.get(candidate.fixtureId);
    if (!existing) {
      byFixture.set(candidate.fixtureId, leg);
      continue;
    }
    const better =
      rankedCharacter[leg.character] !== rankedCharacter[existing.character]
        ? rankedCharacter[leg.character] > rankedCharacter[existing.character]
        : leg.stability * leg.pUsed > existing.stability * existing.pUsed;
    if (better) byFixture.set(candidate.fixtureId, leg);
  }

  const pool = Array.from(byFixture.values()).sort(
    (a, b) => b.pUsed - a.pUsed || b.stability - a.stability,
  );
  if (pool.length < minLegs) {
    notes.push(
      `Hanya ${pool.length} pertandingan dengan peluang pasar ≥ ${(minMarketProb * 100).toFixed(0)}% — di bawah minimum ${minLegs} leg.`,
    );
    return null;
  }

  const toParlayLegs = (legs: MarketFirstLeg[]): ParlayLeg[] =>
    legs.map((leg) => ({
      p: leg.pUsed,
      odds: leg.selection.odds,
      pMarket: leg.selection.pMarket,
      league: leg.league,
      marketFamily: leg.selection.family,
      date: leg.date ?? undefined,
    }));

  interface Attempt {
    legs: MarketFirstLeg[];
    combinedOdds: number;
    pCombined: number;
    evVsBook: number;
    marginPaid: number | null;
  }
  const attempts: Attempt[] = [];
  for (let size = minLegs; size <= Math.min(maxLegs, pool.length); size++) {
    const legs = pool.slice(0, size);
    const analysis = analyzeParlay(toParlayLegs(legs), {
      sims: 20000,
      seed: options.seed ?? 20260101,
    });
    attempts.push({
      legs,
      combinedOdds: analysis.combinedOdds,
      pCombined: analysis.pDecision,
      evVsBook: analysis.evDecision,
      marginPaid: analysis.marginPaid,
    });
  }

  const reaching = attempts.filter((a) => a.combinedOdds >= targetOdds);
  const chosen = (reaching.length > 0
    ? reaching.sort((a, b) => b.pCombined - a.pCombined)[0]
    : attempts.sort((a, b) => b.pCombined - a.pCombined)[0])!;
  const targetReached = chosen.combinedOdds >= targetOdds;

  if (!targetReached) {
    notes.push(
      `Target odds ${targetOdds.toFixed(2)} tidak tercapai oleh kombinasi berpeluang tertinggi ` +
      `(mentok ${chosen.combinedOdds.toFixed(2)}). Tiket tetap disusun dari leg teraman; mencapai target ` +
      "membutuhkan leg berpeluang lebih rendah.",
    );
  }
  const fragile = chosen.legs.filter((l) => l.character === "rapuh" || l.character === "kontradiktif");
  if (fragile.length > 0) {
    notes.push(
      `${fragile.length} leg berkarakter rapuh/kontradiktif ikut karena keterbatasan kandidat — periksa sebelum memasang.`,
    );
  }
  notes.push(
    "Peluang tiket dihitung dari probabilitas fair pasar (de-vig), bukan model. " +
    "EV negatif mencerminkan margin bandar yang menumpuk per leg — ditampilkan apa adanya.",
  );

  return {
    legs: chosen.legs,
    combinedOdds: chosen.combinedOdds,
    pCombined: chosen.pCombined,
    fairOdds: chosen.pCombined > 0 ? 1 / chosen.pCombined : Infinity,
    evVsBook: chosen.evVsBook,
    marginPaid: chosen.marginPaid,
    targetOdds,
    targetReached,
    notes,
  };
}
