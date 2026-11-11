/**
 * Lapis komposisi parlay: memilih 3–5 leg dari puluhan kandidat.
 *
 * Masalah yang diperbaiki
 * -----------------------
 * Sistem ini menganalisis puluhan market per hari (satu pertandingan bisa
 * menghasilkan 4–8 `SelectionEval`), lalu `decision = BET` diambil per
 * pertandingan. Tetapi **tidak ada satu pun lapisan yang memilih kombinasi
 * leg**. `createMergedParlay()` hanya menggabungkan kandidat yang sudah
 * dikirim — ia menyaring duplikat dan confidence, lalu menyimpannya. Kalau
 * pengirim memberi 2 leg, hasilnya parlay 2 leg. Tidak ada pemilihan.
 *
 * Sementara itu `analyzeParlay()` di `lib/quant/parlay.ts` sudah punya model
 * korelasi Monte Carlo yang benar — dan **tidak pernah dipanggil siapa pun**.
 * Ia mengevaluasi kombinasi yang sudah jadi, bukan mencarinya.
 *
 * Modul ini menutup celah itu: diberi banyak leg yang layak, ia mencari
 * kombinasi dengan EV terbaik SETELAH koreksi korelasi, dengan batasan yang
 * membuat hasilnya bisa dipertanggungjawabkan.
 *
 * Kenapa tidak cukup "ambil EV tertinggi"
 * ---------------------------------------
 * Kandidat terbaik sering datang dari pertandingan yang sama atau liga yang
 * sama. Menggabungkannya menggelembungkan odds gabungan tanpa menambah edge
 * nyata — dua pasar dari satu pertandingan bergerak bersama. Karena itu:
 *
 *  1. Maksimum satu leg per pertandingan (dua pasar satu laga saling
 *     bergantung, dan satu hasil buruk membunuh keduanya sekaligus).
 *  2. Korelasi dihitung dan dibayar: EV keputusan memakai
 *     `min(p_independen, p_berkorelasi)` — korelasi positif tidak boleh
 *     dipakai untuk memperindah angka.
 *  3. Setiap leg wajib EV konservatif > 0. Satu leg negatif membuat parlay
 *     negatif, seberapa pun bagusnya leg lain.
 *  4. Jumlah leg dibatasi 3–5. Lebih dari itu, error probabilitas menumpuk
 *     secara perkalian dan peluang menang runtuh.
 *
 * Yang TIDAK diklaim modul ini
 * ----------------------------
 * Prior korelasi (`pairwiseCorrelation`) masih heuristik, bukan hasil estimasi
 * residual ledger. Angka EV di sini adalah perkiraan yang konservatif, bukan
 * jaminan. Setiap keluaran membawa catatan itu agar tidak dibaca sebagai janji.
 */

import type { SelectionEval } from "./pipeline";
import { analyzeParlay, type ParlayLeg } from "./parlay";

/** Batas leg: 3–5 seperti instruksi persona, bukan 2 dan bukan 7. */
export const MIN_LEGS = 3;
export const MAX_LEGS = 5;

/** Batas bawaan jumlah kandidat yang dievaluasi — menjaga waktu tetap wajar. */
export const DEFAULT_MAX_CANDIDATES = 30;

/**
 * Saklar sementara untuk menaikkan kembali `MIN_LEGS` ke 2.
 * Lihat catatan `buildParlayComposition` soal kelayakan data sekarang.
 */
export const ALLOW_TWO_LEG_PARLAY = true;

export interface CompositionCandidate {
  /** Kunci market, mis. `over_2.5` — dipakai untuk deduplikasi. */
  marketKey: string;
  fixtureId: number;
  league: string;
  /** Tanggal pertandingan `YYYY-MM-DD`; makin tepat, makin baik korelasi. */
  date?: string | null;
  selection: SelectionEval;
}

export interface RejectedCandidate {
  marketKey: string;
  fixtureId: number;
  reason: string;
}

export interface ScoredCombination {
  legs: CompositionCandidate[];
  combinedOdds: number;
  /** Probabilitas gabungan tanpa korelasi. */
  pIndependent: number;
  /** Probabilitas gabungan dengan korelasi (Monte Carlo). */
  pCorrelated: number;
  /** Yang dipakai untuk keputusan: min(keduanya). */
  pDecision: number;
  /** EV gabungan dengan `pDecision`. */
  evDecision: number;
  /** EV bila setiap leg overestimasi sampai titik impas — harus tetap > 0. */
  evPessimistic: number;
  /** Berapa poin setiap leg boleh overestimasi sebelum EV = 0. */
  breakEvenBias: number;
  /** Margin gabungan yang dibayar ke bandar (null bila pMarket tidak lengkap). */
  marginPaid: number | null;
}

export interface ParlayComposition {
  /** Kombinasi terpilih, atau null bila tidak ada yang memenuhi syarat. */
  best: ScoredCombination | null;
  /** Beberapa alternatif teratas, supaya bisa dibandingkan manusia. */
  alternatives: ScoredCombination[];
  /** Kandidat yang lolos penyaringan awal. */
  eligible: number;
  /** Kandidat yang dibuang sebelum pencarian, beserta sebabnya. */
  rejected: RejectedCandidate[];
  /** Berapa kombinasi yang benar-benar dievaluasi. */
  combinationsEvaluated: number;
  minLegs: number;
  maxLegs: number;
  generatedAt: string;
  /** Catatan jujur soal keterbatasan angka ini. */
  notes: string[];
}

/* ─────────────────────────── Penyaringan ─────────────────────────── */

/**
 * Saring kandidat sebelum pencarian.
 *
 * Semua alasan penolakan dicatat — bukan dibuang diam-diam. Tanpa itu,
 * "kenapa hanya 4 leg yang layak dari 40 kandidat" tidak bisa dijawab.
 */
export function screenCandidates(
  candidates: CompositionCandidate[],
): { eligible: CompositionCandidate[]; rejected: RejectedCandidate[] } {
  const rejected: RejectedCandidate[] = [];
  const byFixture = new Map<number, CompositionCandidate>();

  for (const candidate of candidates) {
    const { selection } = candidate;

    if (!Number.isInteger(candidate.fixtureId)) {
      rejected.push({ ...ident(candidate), reason: "fixtureId bukan bilangan bulat" });
      continue;
    }
    if (!Number.isFinite(selection.odds) || selection.odds <= 1) {
      rejected.push({ ...ident(candidate), reason: "odds tidak valid (≤ 1)" });
      continue;
    }
    if (!Number.isFinite(selection.pFinal) || selection.pFinal <= 0 || selection.pFinal >= 1) {
      rejected.push({ ...ident(candidate), reason: "probabilitas model di luar (0,1)" });
      continue;
    }
    /* Leg dengan EV konservatif ≤ 0 tidak boleh masuk parlay: satu leg
     * negatif membuat gabungannya negatif, seberapa pun bagusnya leg lain. */
    if (!(selection.evConservative > 0)) {
      rejected.push({
        ...ident(candidate),
        reason: `EV konservatif ≤ 0 (${(selection.evConservative * 100).toFixed(2)}%)`,
      });
      continue;
    }

    /* Satu leg per pertandingan. Bila ada dua pasar dari laga yang sama,
     * pertahankan yang EV konservatifnya lebih tinggi dan catat yang kalah. */
    const existing = byFixture.get(candidate.fixtureId);
    if (existing) {
      const keep = existing.selection.evConservative >= selection.evConservative ? existing : candidate;
      const drop = keep === existing ? candidate : existing;
      byFixture.set(candidate.fixtureId, keep);
      rejected.push({
        ...ident(drop),
        reason:
          `pertandingan yang sama sudah diwakili ${keep.marketKey}; ` +
          "dua pasar satu laga saling bergantung dan satu hasil buruk membunuh keduanya",
      });
      continue;
    }

    byFixture.set(candidate.fixtureId, candidate);
  }

  return { eligible: Array.from(byFixture.values()), rejected };
}

const ident = (candidate: CompositionCandidate) => ({
  marketKey: candidate.marketKey,
  fixtureId: candidate.fixtureId,
});

/* ─────────────────────────── Pencarian ─────────────────────────── */

/** Bangkitkan semua kombinasi berukuran `size` dari `items`. */
function combinations<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  const current: T[] = [];
  const walk = (start: number) => {
    if (current.length === size) {
      result.push([...current]);
      return;
    }
    /* Pruning: sisa item harus cukup untuk mengisi slot yang belum terisi. */
    for (let i = start; i <= items.length - (size - current.length); i++) {
      current.push(items[i]!);
      walk(i + 1);
      current.pop();
    }
  };
  walk(0);
  return result;
}

function toParlayLeg(candidate: CompositionCandidate): ParlayLeg {
  return {
    p: candidate.selection.pFinal,
    odds: candidate.selection.odds,
    pMarket: candidate.selection.pMarket,
    league: candidate.league,
    marketFamily: candidate.selection.family,
    date: candidate.date ?? undefined,
  };
}

/**
 * Susun parlay dari kandidat yang tersedia.
 *
 * @param candidates leg yang lolos tahap sebelumnya (dari `decision = BET`
 *                   atau dari `selections` bertanda `passes`).
 * @param options.maxCandidates batasi jumlah kandidat teratas yang dicari.
 */
export function buildParlayComposition(
  candidates: CompositionCandidate[],
  options: {
    minLegs?: number;
    maxLegs?: number;
    maxCandidates?: number;
    /** Jumlah alternatif yang dikembalikan di samping yang terbaik. */
    topN?: number;
    /** Benih Monte Carlo — tetap agar hasil bisa direproduksi saat diuji. */
    seed?: number;
  } = {},
): ParlayComposition {
  const notes: string[] = [];
  const minLegs = Math.max(ALLOW_TWO_LEG_PARLAY ? 2 : MIN_LEGS, options.minLegs ?? MIN_LEGS);
  const maxLegs = Math.min(MAX_LEGS, Math.max(minLegs, options.maxLegs ?? MAX_LEGS));
  const topN = options.topN ?? 3;
  const maxCandidates = Math.max(maxLegs, options.maxCandidates ?? DEFAULT_MAX_CANDIDATES);

  const empty: ParlayComposition = {
    best: null,
    alternatives: [],
    eligible: 0,
    rejected: [],
    combinationsEvaluated: 0,
    minLegs,
    maxLegs,
    generatedAt: new Date().toISOString(),
    notes: [],
  };

  const { eligible, rejected } = screenCandidates(candidates);
  const base = { ...empty, eligible: eligible.length, rejected };

  if (eligible.length < minLegs) {
    base.notes.push(
      `Hanya ${eligible.length} leg layak (EV konservatif > 0), sedangkan parlay butuh minimal ` +
        `${minLegs}. Tidak ada parlay yang disusun — memaksakan kombinasi dari leg di bawah ` +
        "standar lebih buruk daripada tidak bertaruh.",
    );
    return base;
  }

  /* Ambil kandidat EV tertinggi. Peringkat ini hanya untuk memangkas ruang
   * pencarian — penilaian akhir tetap lewat simulasi korelasi, karena
   * EV per-leg tertinggi tidak selalu menghasilkan parlay terbaik. */
  const pool = [...eligible]
    .sort((a, b) => b.selection.evConservative - a.selection.evConservative)
    .slice(0, maxCandidates);

  if (eligible.length > pool.length) {
    notes.push(
      `${eligible.length} leg layak, tetapi hanya ${pool.length} dengan EV konservatif tertinggi ` +
        "yang dievaluasi — pembatasan waktu, bukan penilaian bahwa sisanya buruk.",
    );
  }

  const scored: ScoredCombination[] = [];
  let evaluated = 0;

  for (let size = minLegs; size <= Math.min(maxLegs, pool.length); size++) {
    for (const combo of combinations(pool, size)) {
      evaluated++;
      /* Simulasi lebih sedikit untuk pencarian, karena jumlah kombinasi bisa
       * besar. Hasil akhir dihitung ulang dengan simulasi penuh. */
      const quick = analyzeParlay(combo.map(toParlayLeg), {
        sims: 4000,
        seed: options.seed ?? 20260101,
      });
      if (!(quick.evDecision > 0)) continue;
      scored.push({
        legs: combo,
        combinedOdds: quick.combinedOdds,
        pIndependent: quick.pIndependent,
        pCorrelated: quick.pCorrelated,
        pDecision: quick.pDecision,
        evDecision: quick.evDecision,
        evPessimistic: quick.evPessimistic,
        breakEvenBias: quick.breakEvenBias,
        marginPaid: quick.marginPaid,
      });
    }
  }

  if (scored.length === 0) {
    base.combinationsEvaluated = evaluated;
    base.notes.push(
      `Tidak ada kombinasi dengan EV positif setelah koreksi korelasi dari ${evaluated} ` +
        "kombinasi yang diuji. Ini hasil yang sah: lebih baik menolak daripada memaksa parlay.",
    );
    return base;
  }

  /* Urutkan: EV keputusan tertinggi, tetapi leg dengan breakEvenBias lebih
   * besar (lebih tahan terhadap overestimasi) didahulukan saat EV berdekatan.
   * Selisih di bawah 1 poin-persen dianggap berdekatan — lebih dari itu,
   * EV yang menentukan. */
  const ranked = [...scored].sort((a, b) => {
    const diff = b.evDecision - a.evDecision;
    if (Math.abs(diff) > 0.01) return diff;
    return b.breakEvenBias - a.breakEvenBias;
  });

  /* Hitung ulang 5 teratas dengan simulasi penuh agar angkanya tidak
   * dipengaruhi simulasi cepat. */
  const refined = ranked.slice(0, Math.max(topN, 5)).map((combo) => {
    const full = analyzeParlay(combo.legs.map(toParlayLeg), {
      sims: 40000,
      seed: options.seed ?? 20260101,
    });
    return {
      ...combo,
      pIndependent: full.pIndependent,
      pCorrelated: full.pCorrelated,
      pDecision: full.pDecision,
      evDecision: full.evDecision,
      evPessimistic: full.evPessimistic,
      breakEvenBias: full.breakEvenBias,
      marginPaid: full.marginPaid,
    };
  });

  const best = refined[0]!;

  /* Jujur soal keterbatasan angka. */
  notes.push(
    "Prior korelasi masih heuristik (liga, tanggal, keluarga market), belum diestimasi dari " +
      "residual ledger. Angka EV di sini konservatif, bukan jaminan.",
  );
  notes.push(
    `Setiap leg boleh overestimasi paling banyak ${(best.breakEvenBias * 100).toFixed(1)} poin ` +
      "sebelum parlay ini berubah menjadi EV nol.",
  );
  if (best.evPessimistic <= 0) {
    notes.push(
      "EV tetap negatif dalam skenario pesimis (setiap leg dikurangi satu sigma). Anggap ini " +
        "taruhan berisiko tinggi, bukan nilai yang aman.",
    );
  }

  return {
    ...base,
    best,
    alternatives: refined.slice(1, topN + 1),
    combinationsEvaluated: evaluated,
    generatedAt: new Date().toISOString(),
    notes,
  };
}

/* ─────────────────────────── Jembatan ke DB ─────────────────────────── */

export interface ParlayLegRow {
  parlay_id: string;
  prediction_id: string | null;
  fixture_id: number;
  leg_order: number;
  market: string;
  selection: string;
  odds: number;
  probability: number;
  confidence: number | null;
  result: null;
  created_at: string;
}

/**
 * Ubah kombinasi terpilih menjadi baris `parlay_legs`.
 *
 * Dipisah dari `parlay-builder.ts` karena modul ini tidak boleh menyentuh
 * database — ia harus bisa diuji tanpa Supabase.
 */
export function toParlayLegRows(
  combination: ScoredCombination,
  parlayId: string,
  options: { now?: string; predictionIdFor?: (fixtureId: number) => string | null } = {},
): ParlayLegRow[] {
  const createdAt = options.now ?? new Date().toISOString();
  return combination.legs.map((leg, index) => ({
    parlay_id: parlayId,
    prediction_id: options.predictionIdFor?.(leg.fixtureId) ?? null,
    fixture_id: leg.fixtureId,
    leg_order: index + 1,
    market: leg.selection.label,
    selection: leg.marketKey,
    odds: leg.selection.odds,
    probability: leg.selection.pFinal,
    confidence: null,
    result: null,
    created_at: createdAt,
  }));
}
