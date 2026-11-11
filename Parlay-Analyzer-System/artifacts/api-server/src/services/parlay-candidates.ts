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
}

export interface FixtureMeta {
  fixtureId: number;
  league: string;
  date?: string | null;
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
): CompositionCandidate[] {
  const candidates: CompositionCandidate[] = [];

  for (const row of rows) {
    const fixtureId = Number(row.fixture_id);
    if (!Number.isInteger(fixtureId)) continue;
    /* Tanpa liga dan tanggal, korelasi tidak bisa dihitung dengan benar.
     * Lebih baik melewatkan daripada mengarang nilai netral. */
    const meta = fixtureMeta.get(fixtureId);
    if (!meta) continue;

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

    if (!passing) continue;

    candidates.push({
      marketKey: row.market_key,
      fixtureId,
      league: meta.league,
      date: meta.date ?? null,
      selection,
    });
  }

  return candidates;
}
