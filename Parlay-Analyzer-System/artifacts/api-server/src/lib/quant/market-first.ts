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
import type { PriceHuntResult } from "./price-hunt";
import type { ContextRisk } from "./context-risk";
import { friendlyMarketLabel, substitutionHint } from "./market-label";

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
  homeTeam?: string | null;
  awayTeam?: string | null;
  bookmaker?: string | null;
  /** Panduan ganti line bila aplikasi pemilik sistem tak menyediakannya. */
  substitutionHint?: string | null;
  /** Label market yang bisa dibaca manusia, mis. "Over 2.5 Gol". */
  displayLabel: string;
  selection: SelectionEval;
  /** Probabilitas yang dipakai: fair pasar; fallback pFinal bila pasar tak ada. */
  pUsed: number;
  character: LegCharacter;
  /** Skor kestabilan 0–1: peluang pasar tinggi + statistik sejalan + sigma kecil. */
  stability: number;
  characterNote: string;
  /** Hasil berburu harga lintas bandar (diisi jalur live bila data ada). */
  priceHunt?: PriceHuntResult;
  /** Risiko konteks jadwal (istirahat/padat) bila dinilai. */
  contextRisk?: ContextRisk;
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
  homeTeam?: string | null;
  awayTeam?: string | null;
  bookmaker?: string | null;
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
  /** Dampak berburu harga pada odds gabungan (diisi jalur live). */
  priceImpact?: { usedCombined: number; bestCombined: number; uplift: number };
}

export interface MarketFirstOptions {
  minLegs?: number;
  maxLegs?: number;
  /** Target odds gabungan (bawaan 2.0 — "melipatgandakan"). */
  targetOdds?: number;
  /** Peluang pasar minimum per leg agar dianggap kandidat (bawaan 0.55). */
  minMarketProb?: number;
  /** Odds minimum leg (bawaan 1,25): di bawah ini leg tidak menyumbang hasil yang berarti. */
  minOdds?: number;
  /** Peluang pasar maksimum leg (bawaan 0,90): di atas ini leg nyaris-pasti tanpa nilai. */
  maxMarketProb?: number;
  seed?: number;
  /** Risiko konteks per kandidat, kunci `${fixtureId}|${marketKey}`. */
  contextByCandidate?: Map<string, ContextRisk>;
}

const MIN_LEGS_DEFAULT = 5;
const MAX_LEGS_DEFAULT = 8;

interface PoolBounds {
  minProb: number;
  maxProb: number;
  minOdds: number;
  maxOdds?: number;
}

interface PreparedPool {
  pool: MarketFirstLeg[];
  excludedWorthless: number;
}

/** Siapkan pool leg: satu per laga, gerbang kualitas selalu diterapkan. */
function preparePool(
  candidates: MarketFirstCandidate[],
  options: MarketFirstOptions,
  bounds: PoolBounds,
): PreparedPool {
  let excludedWorthless = 0;
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
    if (!(pUsed > 0 && pUsed < 1) || pUsed < bounds.minProb || pUsed > bounds.maxProb) continue;
    /* Gerbang kualitas: leg nyaris-pasti berharga ~1,00 (mis. Under 8.5)
     * dan line pajangan ekstrem tidak boleh memakan slot tiket. */
    if (selection.odds < bounds.minOdds || (bounds.maxOdds != null && selection.odds > bounds.maxOdds)) {
      excludedWorthless++;
      continue;
    }
    if (selection.family === "Totals" && selection.line != null && (selection.line < 1.5 || selection.line > 3.5)) {
      excludedWorthless++;
      continue;
    }
    if (selection.family === "AH" && selection.line != null && Math.abs(selection.line) > 2) {
      excludedWorthless++;
      continue;
    }
    const { character, stability, note } = classifyLeg(selection);
    const contextRisk = options.contextByCandidate?.get(`${candidate.fixtureId}|${candidate.marketKey}`);
    const leg: MarketFirstLeg = {
      marketKey: candidate.marketKey,
      fixtureId: candidate.fixtureId,
      league: candidate.league,
      date: candidate.date ?? null,
      homeTeam: candidate.homeTeam ?? null,
      awayTeam: candidate.awayTeam ?? null,
      bookmaker: candidate.bookmaker ?? null,
      substitutionHint: substitutionHint(candidate.marketKey),
      displayLabel: friendlyMarketLabel(candidate.marketKey),
      selection,
      pUsed,
      character,
      stability: contextRisk ? stability * contextRisk.scoreMultiplier : stability,
      characterNote: contextRisk && contextRisk.flags.length > 0
        ? `${note} Konteks: ${contextRisk.flags.join(" ")}`
        : note,
      contextRisk,
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
  const selectionScore = (leg: MarketFirstLeg) =>
    leg.pUsed * (leg.contextRisk?.scoreMultiplier ?? 1);
  const pool = Array.from(byFixture.values()).sort(
    (a, b) => selectionScore(b) - selectionScore(a) || b.stability - a.stability,
  );
  return { pool, excludedWorthless };
}

interface Attempt {
  legs: MarketFirstLeg[];
  combinedOdds: number;
  pCombined: number;
  evVsBook: number;
  marginPaid: number | null;
}

function evaluateLegs(legs: MarketFirstLeg[], seed?: number): Attempt {
  const parlayLegs: ParlayLeg[] = legs.map((leg) => ({
    p: leg.pUsed,
    odds: leg.selection.odds,
    pMarket: leg.selection.pMarket,
    league: leg.league,
    marketFamily: leg.selection.family,
    date: leg.date ?? undefined,
  }));
  const analysis = analyzeParlay(parlayLegs, { sims: 20000, seed: seed ?? 20260101 });
  return {
    legs,
    combinedOdds: analysis.combinedOdds,
    pCombined: analysis.pDecision,
    evVsBook: analysis.evDecision,
    marginPaid: analysis.marginPaid,
  };
}

export const EXECUTION_BOOKMAKER = "M88";

function finalizeTicket(
  chosen: Attempt,
  targetOdds: number,
  prefixNotes: string[],
): MarketFirstTicket {
  const notes = [...prefixNotes];
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
  const contextRisky = chosen.legs.filter((l) => l.contextRisk?.level === "tinggi");
  if (contextRisky.length > 0) {
    notes.push(
      `${contextRisky.length} leg berisiko konteks TINGGI (jadwal) tetap terpilih karena kandidat segar tidak cukup — leg ini kandidat pertama untuk diganti manual.`,
    );
  }
  const nonExecution = chosen.legs.filter((l) => l.bookmaker && l.bookmaker !== EXECUTION_BOOKMAKER);
  if (nonExecution.length > 0) {
    notes.push(
      `⚠ ${nonExecution.length} leg berasal dari ${[...new Set(nonExecution.map((l) => l.bookmaker))].join(", ")} (bukan ${EXECUTION_BOOKMAKER}/Saba) — periksa dulu ketersediaan line & odds-nya di aplikasi Anda sebelum memasang.`,
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

function qualityNote(excludedWorthless: number, minOdds: number, maxMarketProb: number): string[] {
  return excludedWorthless > 0
    ? [`${excludedWorthless} kandidat dibuang oleh gerbang kualitas (odds < ${minOdds.toFixed(2)}, peluang > ${(maxMarketProb * 100).toFixed(0)}%, atau line di luar rentang utama — leg nyaris-pasti tanpa hasil).`]
    : [];
}

/**
 * Susun tiket pasar-dulu (varian Utama): peluang gabungan tertinggi
 * yang mencapai target odds, dari leg-leg stabil berpeluang ≥ 55%.
 */
export function buildMarketFirstTicket(
  candidates: MarketFirstCandidate[],
  options: MarketFirstOptions = {},
): MarketFirstTicket | null {
  const minLegs = Math.max(2, options.minLegs ?? MIN_LEGS_DEFAULT);
  const maxLegs = Math.max(minLegs, options.maxLegs ?? MAX_LEGS_DEFAULT);
  const targetOdds = Math.max(1.2, options.targetOdds ?? 2);
  const minMarketProb = options.minMarketProb ?? 0.55;
  const minOdds = options.minOdds ?? 1.25;
  const maxMarketProb = options.maxMarketProb ?? 0.9;

  const { pool, excludedWorthless } = preparePool(candidates, options, {
    minProb: minMarketProb, maxProb: maxMarketProb, minOdds,
  });
  if (pool.length < minLegs) return null;

  const attempts: Attempt[] = [];
  for (let size = minLegs; size <= Math.min(maxLegs, pool.length); size++) {
    attempts.push(evaluateLegs(pool.slice(0, size), options.seed));
  }
  const reaching = attempts.filter((a) => a.combinedOdds >= targetOdds);
  const chosen = (reaching.length > 0
    ? reaching.sort((a, b) => b.pCombined - a.pCombined)[0]
    : attempts.sort((a, b) => b.pCombined - a.pCombined)[0])!;
  return finalizeTicket(chosen, targetOdds, qualityNote(excludedWorthless, minOdds, maxMarketProb));
}

/* ───────────────────── Tiga varian parlay ───────────────────── */

export type ParlayVariantName = "utama" | "booster" | "jackpot";

export interface VariantTicket extends MarketFirstTicket {
  variant: ParlayVariantName;
  /** Kunci leg penguat (hanya varian booster). */
  boosterMarketKey?: string;
}

export interface ParlayVariants {
  utama: VariantTicket | null;
  booster: VariantTicket | null;
  jackpot: VariantTicket | null;
  /** Alasan terbuka bila sebuah varian tidak terbentuk. */
  variantNotes: Record<ParlayVariantName, string | null>;
}

export interface ParlayVariantOptions extends MarketFirstOptions {
  /** Target odds Parlay Utama (bawaan 4). */
  mainTargetOdds?: number;
  /** Target odds gabungan minimum Jackpot (bawaan 20). */
  jackpotTargetOdds?: number;
  /** Lantai peluang gabungan Jackpot (bawaan 0,025). */
  jackpotMinProb?: number;
}

/** Leg penguat: odds besar yang masih masuk akal dan didukung statistik. */
function isBoosterLeg(leg: MarketFirstLeg): boolean {
  return leg.selection.odds >= 1.85 && leg.selection.odds <= 2.3
    && leg.pUsed >= 0.48 && leg.pUsed < 0.55
    && leg.character === "didukung-statistik";
}

/** Syarat nilai Jackpot: statistik mendukung kuat ATAU EV konservatif > 0. */
function hasJackpotValue(leg: MarketFirstLeg): boolean {
  const gap = leg.selection.pModelOnly - (leg.selection.pMarket ?? leg.pUsed);
  return gap >= AGREE_TOLERANCE || leg.selection.evConservative > 0;
}

/**
 * Susun tiga varian parlay dari kumpulan kandidat yang sama:
 *  - Utama: leg stabil, peluang gabungan dimaksimalkan pada target odds.
 *  - Booster: leg Utama + tepat satu leg penguat berodds 1,85–2,30 yang
 *    didukung statistik.
 *  - Jackpot: leg berodds 1,80–3,00 yang LOLOS syarat nilai (statistik
 *    mendukung kuat atau EV konservatif positif), target gabungan ≥ 20×
 *    dengan lantai peluang — ditolak terbuka bila tidak layak.
 */
export function buildParlayVariants(
  candidates: MarketFirstCandidate[],
  options: ParlayVariantOptions = {},
): ParlayVariants {
  const minLegs = Math.max(2, options.minLegs ?? MIN_LEGS_DEFAULT);
  const maxLegs = Math.max(minLegs, options.maxLegs ?? MAX_LEGS_DEFAULT);
  const minOdds = options.minOdds ?? 1.25;
  const maxMarketProb = options.maxMarketProb ?? 0.9;
  const notes: Record<ParlayVariantName, string | null> = { utama: null, booster: null, jackpot: null };

  /* — Utama — */
  const utamaBase = buildMarketFirstTicket(candidates, { ...options, targetOdds: options.mainTargetOdds ?? 4 });
  const utama: VariantTicket | null = utamaBase ? { ...utamaBase, variant: "utama" } : null;
  if (!utama) notes.utama = "Kandidat stabil tidak cukup untuk 5 leg.";

  /* — Booster — */
  let booster: VariantTicket | null = null;
  const stable = preparePool(candidates, options, { minProb: 0.55, maxProb: maxMarketProb, minOdds });
  const boosterPoolAll = preparePool(candidates, options, {
    minProb: 0.4, maxProb: 0.55, minOdds, maxOdds: 2.3,
  }).pool.filter(isBoosterLeg);
  /* Leg penguat wajib dari pertandingan yang belum terwakili leg stabil,
   * agar tidak tersingkir deduplikasi satu-leg-per-laga. */
  const stableFixtures = new Set(stable.pool.map((l) => l.fixtureId));
  const boosterCandidates = boosterPoolAll.filter((l) => !stableFixtures.has(l.fixtureId));
  if (stable.pool.length >= minLegs - 1 && boosterCandidates.length > 0) {
    const boosterLeg = [...boosterCandidates].sort(
      (a, b) => b.stability * b.pUsed - a.stability * a.pUsed,
    )[0]!;
    const attempts: Attempt[] = [];
    for (let size = minLegs; size <= Math.min(maxLegs, stable.pool.length + 1); size++) {
      const legs = [...stable.pool.slice(0, size - 1), boosterLeg]
        .filter((l, i, arr) => arr.findIndex((x) => x.fixtureId === l.fixtureId) === i);
      if (legs.length < minLegs) continue;
      attempts.push(evaluateLegs(legs, options.seed));
    }
    if (attempts.length > 0) {
      const chosen = attempts.sort((a, b) => b.pCombined - a.pCombined)[0]!;
      const ticket = finalizeTicket(chosen, options.mainTargetOdds ?? 4, [
        `Satu leg penguat: ${boosterLeg.displayLabel} @${boosterLeg.selection.odds.toFixed(2)} (${boosterLeg.homeTeam ?? ""} vs ${boosterLeg.awayTeam ?? ""}) — leg paling berisiko di tiket ini, dipilih karena statistik mendukungnya di atas pasar.`,
        ...qualityNote(stable.excludedWorthless, minOdds, maxMarketProb),
      ]);
      booster = { ...ticket, variant: "booster", boosterMarketKey: boosterLeg.marketKey };
    }
  }
  if (!booster) {
    notes.booster = boosterCandidates.length === 0
      ? "Tidak ada leg penguat yang didukung statistik pada rentang odds 1,85–2,30 hari ini."
      : "Leg stabil tidak cukup untuk menemani satu leg penguat.";
  }

  /* — Jackpot — */
  let jackpot: VariantTicket | null = null;
  const jackpotTarget = options.jackpotTargetOdds ?? 20;
  const jackpotFloor = options.jackpotMinProb ?? 0.025;
  const jackpotPool = preparePool(candidates, options, {
    minProb: 0.3, maxProb: maxMarketProb, minOdds: 1.8, maxOdds: 3,
  }).pool.filter(hasJackpotValue);
  if (jackpotPool.length >= minLegs) {
    const attempts: Attempt[] = [];
    for (let size = minLegs; size <= Math.min(maxLegs, jackpotPool.length); size++) {
      attempts.push(evaluateLegs(jackpotPool.slice(0, size), options.seed));
    }
    const layak = attempts
      .filter((a) => a.combinedOdds >= jackpotTarget && a.pCombined >= jackpotFloor)
      .sort((a, b) => b.pCombined - a.pCombined)[0];
    if (layak) {
      const ticket = finalizeTicket(layak, jackpotTarget, [
        `Jackpot: semua leg lolos syarat nilai (statistik mendukung ≥ ${(AGREE_TOLERANCE * 100).toFixed(0)} poin di atas pasar atau EV konservatif positif). Peluang tiket ${(layak.pCombined * 100).toFixed(1)}% — setara kira-kira 1 dari ${Math.max(1, Math.round(1 / layak.pCombined))} tiket.`,
      ]);
      jackpot = { ...ticket, variant: "jackpot" };
    } else {
      notes.jackpot = `Tidak ada kombinasi jackpot yang mencapai odds ${jackpotTarget}× dengan peluang ≥ ${(jackpotFloor * 100).toFixed(1)}% — ditolak daripada mengarang leg panjang.`;
    }
  } else {
    notes.jackpot = `Hanya ${jackpotPool.length} leg berodds 1,80–3,00 yang lolos syarat nilai — jackpot tidak disusun.`;
  }

  return { utama, booster, jackpot, variantNotes: notes };
}
