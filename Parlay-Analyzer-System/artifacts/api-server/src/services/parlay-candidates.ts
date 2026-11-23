/**
 * Menjembatani hasil engine per-pertandingan menjadi kandidat komposisi.
 *
 * `runQuantEngine()` menilai satu pertandingan pada satu waktu dan
 * menghasilkan `SelectionEval[]`. Untuk menyusun parlay lintas pertandingan,
 * bagian-bagian itu harus dikumpulkan lebih dulu — dan di sinilah tempatnya.
 *
 * Mengapa modul terpisah, bukan langsung di `ai-analysis.ts`
 * ---------------------------------------------------------
 * `ai-analysis.ts` sudah 1800+ baris dan memegang jalur keputusan utama.
 * Menambah logika komposisi di sana membuat perubahan kecil pun berisiko.
 * Modul ini murni fungsi: diberi kumpulan hasil engine, ia mengembalikan
 * kandidat yang layak untuk `buildParlayComposition()`.
 *
 * Hubungan dengan `prediction_selections`
 * ---------------------------------------
 * `quant-shadow.ts` sudah menulis setiap `SelectionEval` ke ledger, tetapi
 * hanya untuk pertandingan yang **punya analisis AI**. Pertandingan yang
 * tidak dianalisis (tidak ada berita, tidak ada nilai) tetap tidak punya
 * harga di ledger. Modul ini bisa bekerja dari dua sumber:
 *
 *  1. Hasil engine langsung (jalur utama, saat scan berjalan), atau
 *  2. Baris `prediction_selections` yang sudah tersimpan (jalur susulan).
 *
 * Keduanya menghasilkan `CompositionCandidate` yang sama, sehingga mesin
 * komposisi tidak perlu tahu asalnya.
 */

import type { SelectionEval } from "../lib/quant/pipeline";
import type { CompositionCandidate } from "../lib/quant/composition";

export interface FixtureAnalysisInput {
  fixtureId: number;
  league: string;
  /** Tanggal pertandingan `YYYY-MM-DD`. */
  date?: string | null;
  /** Semua market yang sudah dinilai engine. */
  selections: SelectionEval[];
}

/**
 * Ambil kandidat dari hasil engine per-pertandingan.
 *
 * Hanya market yang `passes` yang diambil: artinya EV konservatif positif dan
 * lolos penyaringan engine. Penyaringan ulang tetap terjadi di
 * `screenCandidates()`, tetapi menyaring di sini menghemat simulasi.
 */
export function candidatesFromAnalyses(
  analyses: FixtureAnalysisInput[],
): CompositionCandidate[] {
  const candidates: CompositionCandidate[] = [];

  for (const analysis of analyses) {
    if (!Number.isInteger(analysis.fixtureId)) continue;

    for (const selection of analysis.selections) {
      if (!selection.passes) continue;
      candidates.push({
        /* `key` unik per pertandingan (`over_2.5`, `btts_yes`, …). Digabung
         * dengan fixtureId supaya bisa dilacak balik ke baris ledger. */
        marketKey: selection.key,
        fixtureId: analysis.fixtureId,
        league: analysis.league,
        date: analysis.date ?? null,
        selection,
      });
    }
  }

  return candidates;
}

/** Baris `prediction_selections` yang sudah tersimpan. */
export interface SelectionRow {
  fixture_id: number | string;
  market_key: string;
  family: string;
  line: number | null;
  odds: number;
  p_final: number;
  p_market_fair: number | null;
  p_model_only: number | null;
  ev: number;
  ev_conservative: number;
  bookmaker?: string | null;
}

export interface FixtureMeta {
  fixtureId: number;
  league: string;
  date?: string | null;
  homeTeam?: string | null;
  awayTeam?: string | null;
  /** Timestamp kick-off penuh (ISO). Diisi loader produksi; tanpa ini
   *  pagar "belum kick-off" tidak bisa ditegakkan untuk fixture tsb. */
  kickoffAt?: string | null;
  /** Status fixture dari provider (FT/AET/PEN/settled/dll.). */
  statusShort?: string | null;
}

/** Status yang berarti pertandingan sudah selesai — tidak boleh direkomendasikan. */
export const FINISHED_FIXTURE_STATUSES = new Set([
  "FT", "AET", "PEN", "FINISHED", "COMPLETED", "SETTLED",
]);

/**
 * Pagar integritas komposisi: fixture hanya boleh masuk tiket bila
 * BELUM kick-off dan belum selesai pada saat penyusunan.
 *
 * Akar masalah (23 Nov 2026): ledger menampung seleksi untuk fixture
 * yang sudah dimainkan, dan tanpa pagar ini komposer menyusun "Tiket
 * Hari Ini" dari pertandingan 20–22 Nov yang hasilnya sudah diketahui
 * — rekomendasi tercemar look-ahead, tidak sah sebagai bukti live.
 * Bila kickoffAt tidak diketahui, fixture dilewatkan dari pagar waktu
 * (pemanggil lama tanpa metadata waktu), tetapi status selesai selalu
 * membuangnya.
 */
export function isFixtureComposable(meta: FixtureMeta, now: Date): boolean {
  const status = (meta.statusShort ?? "").toUpperCase();
  if (FINISHED_FIXTURE_STATUSES.has(status)) return false;
  if (meta.kickoffAt) {
    const kickoff = new Date(meta.kickoffAt).getTime();
    if (Number.isFinite(kickoff) && kickoff <= now.getTime()) return false;
  }
  return true;
}

/**
 * Rekonstruksi kandidat dari baris ledger yang sudah tersimpan.
 *
 * Dipakai untuk menyusun parlay di luar proses scan — mis. dari cron, ketika
 * hasil engine tidak lagi ada di memori. `SelectionEval` dibentuk ulang dari
 * kolom yang tersimpan; kolom yang tidak disimpan (stakePct, minOdds) diisi
 * nilai netral karena tidak dipakai dalam komposisi.
 */
export function candidatesFromSelectionRows(
  rows: SelectionRow[],
  fixtureMeta: Map<number, FixtureMeta>,
  options: { requirePassing?: boolean; now?: Date } = {},
): CompositionCandidate[] {
  const now = options.now ?? new Date();
  /* requirePassing (bawaan true) mempertahankan perilaku komposisi EV
   * lama. Jalur pasar-dulu memanggil dengan false: probabilitas pasar
   * adalah hakimnya, dan menyaring kandidat dengan EV konservatif
   * model terlebih dahulu justru membuang hampir semua bahan tiket
   * (di produksi: 588 baris menyusut menjadi 2). */
  const requirePassing = options.requirePassing ?? true;
  const candidates: CompositionCandidate[] = [];

  for (const row of rows) {
    const fixtureId = Number(row.fixture_id);
    if (!Number.isInteger(fixtureId)) continue;
    /* Tanpa liga dan tanggal, korelasi tidak bisa dihitung dengan benar.
     * Lebih baik melewatkan daripada mengarang nilai netral. */
    const meta = fixtureMeta.get(fixtureId);
    if (!meta) continue;
    /* Pagar anti look-ahead: pertandingan yang sudah kick-off/selesai
     * tidak pernah boleh direkomendasikan (lihat isFixtureComposable). */
    if (!isFixtureComposable(meta, now)) continue;

    const passing = row.ev_conservative > 0;
    const selection: SelectionEval = {
      key: row.market_key,
      label: row.market_key.replace(/_/g, " "),
      family: row.family as SelectionEval["family"],
      odds: row.odds,
      line: row.line,
      pFinal: row.p_final,
      pMarket: row.p_market_fair,
      pModelOnly: row.p_model_only ?? row.p_final,
      /* Distribusi hasil tidak disimpan di ledger; hanya baris yang lolos
       * (EV konservatif > 0) yang dibentuk ulang, dan komposisi memakai
       * `pFinal` bukan `outcome`. Nol di semua komponen adalah pengisi
       * netral, bukan klaim tentang hasil. */
      outcome: { win: row.p_final, halfWin: 0, push: 0, halfLoss: 0, loss: 1 - row.p_final },
      ev: row.ev,
      evConservative: row.ev_conservative,
      sigma: 0,
      stakePct: 0,
      minOdds: 0,
      passes: passing,
      rejectReasons: passing ? [] : ["EV konservatif ≤ 0"],
    };

    if (requirePassing && !passing) continue;

    candidates.push({
      marketKey: row.market_key,
      fixtureId,
      league: meta.league,
      date: meta.date ?? null,
      homeTeam: meta.homeTeam ?? null,
      awayTeam: meta.awayTeam ?? null,
      bookmaker: row.bookmaker ?? null,
      selection,
    });
  }

  /* Ledger bisa memuat market yang sama dari dua jalur/bandar (v1 LLM
   * dan v2 quant, atau 1xbet vs M88). Untuk kunci yang sama, baris dari
   * bookmaker eksekusi (M88 — proksi Saba) yang dipertahankan, agar
   * rekomendasi memakai line & odds yang bisa dipasang pemilik sistem. */
  const rank = (b?: string | null) => (b === "M88" ? 0 : b === "1xbet" ? 1 : 2);
  const byKey = new Map<string, CompositionCandidate>();
  for (const c of candidates) {
    const key = `${c.fixtureId}|${c.marketKey}`;
    const existing = byKey.get(key);
    if (!existing || rank(c.bookmaker) < rank(existing.bookmaker)) byKey.set(key, c);
  }
  return [...byKey.values()];
}
