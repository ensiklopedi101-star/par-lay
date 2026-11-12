/**
 * Penjaga integritas blok statistik sebelum dipakai mesin analisis.
 *
 * Dua hal yang dijaga di sini, keduanya berasal dari audit 12 Nov 2026:
 *
 * 1. **Blok yang bertentangan dengan nama kolomnya.** Seluruh 18 baris La Liga
 *    2026-27 menyimpan tabel *Goals Conceded* di kolom `stats_goals_scored`
 *    (terlihat dari nilai "1.00 Conceded / match"). Tanpa penjaga, angka gol
 *    kebobolan dipakai sebagai gol dicetak dan analisis jadi salah tanpa error.
 *    Blok seperti ini sekarang dibuang, sehingga gerbang kualitas memicu
 *    `StatsEmptyError` — gagal keras, bukan salah diam-diam.
 *
 * 2. **Blok turunan yang bisa direkonstruksi.** 27 tim kehilangan
 *    `stats_over_25` (dan 5 di antaranya `stats_under`) saat migrasi 11 Nov
 *    hanya menyalin 4 dari 11 kolom ketika menggabungkan duplikat. Semua tim
 *    itu masih menyimpan "Over 2.5" di `stats_team_form`, jadi nilainya bisa
 *    diisi ulang tanpa impor baru: `under` = 100 − `over`.
 */

type StatsRow = Record<string, unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMeaningful(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.length > 0;
  if (isRecord(value)) return Object.keys(value).length > 0;
  return false;
}

/** Teks gabungan key+value sebuah blok, dipakai untuk membaca labelnya. */
export function statBlockText(block: unknown): string {
  if (!isRecord(block)) return "";
  const chunks: string[] = [];
  for (const [key, value] of Object.entries(block)) {
    chunks.push(key, value == null ? "" : String(value));
  }
  return chunks.join(" ").toLowerCase();
}

interface ContradictionRule {
  column: string;
  /** Label yang menandakan isinya milik kolom lain. */
  misleading: RegExp;
  /** Label yang menandakan isinya memang milik kolom ini. */
  expected: RegExp;
  /** Nama kolom tujuan yang benar, untuk pesan log. */
  belongsTo: string;
}

const CONTRADICTION_RULES: ContradictionRule[] = [
  {
    column: "stats_goals_scored",
    misleading: /conceded/i,
    expected: /scored/i,
    belongsTo: "stats_goals_conceded",
  },
  {
    column: "stats_goals_conceded",
    misleading: /\bscored\b/i,
    expected: /conceded/i,
    belongsTo: "stats_goals_scored",
  },
];

export interface ContradictoryColumn {
  column: string;
  belongsTo: string;
  sample: string;
}

/** Kolom yang isinya jelas milik kolom lain (mis. "Conceded" di kolom scored). */
export function findContradictoryColumns(row: StatsRow): ContradictoryColumn[] {
  const found: ContradictoryColumn[] = [];
  for (const rule of CONTRADICTION_RULES) {
    const block = row[rule.column];
    if (!isMeaningful(block)) continue;
    const text = statBlockText(block);
    if (!text) continue;
    if (rule.misleading.test(text) && !rule.expected.test(text)) {
      found.push({
        column: rule.column,
        belongsTo: rule.belongsTo,
        sample: isRecord(block)
          ? String(Object.values(block).find((value) => typeof value === "string") ?? "").slice(0, 60)
          : "",
      });
    }
  }
  return found;
}

const OVER_25_KEY = /^over\s*2[.,]5(\s*%|\s*goals)?$/i;

function parsePercent(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== "string") return null;
  const match = raw.match(/-?\d+(?:[.,]\d+)?/);
  if (!match) return null;
  const value = Number(match[0].replace(",", "."));
  return Number.isFinite(value) ? value : null;
}

/** Nilai "Over 2.5" dari `stats_team_form`, mis. `"Over 2.5": "63%"`. */
export function over25FromForm(form: unknown): number | null {
  if (!isRecord(form)) return null;
  for (const [key, value] of Object.entries(form)) {
    if (!OVER_25_KEY.test(key.trim())) continue;
    const parsed = parsePercent(value);
    if (parsed != null && parsed >= 0 && parsed <= 100) return parsed;
  }
  return null;
}

/** Persentase Over 2.5 yang sudah tersimpan di kolom `stats_over_25`. */
export function over25FromBlock(block: unknown): number | null {
  if (!isRecord(block)) return null;
  const candidates = ["Over 2.5", "%", "Over"];
  for (const key of candidates) {
    const value = block[key];
    if (value == null) continue;
    const parsed = parsePercent(value);
    if (parsed != null && parsed >= 0 && parsed <= 100) return parsed;
  }
  return null;
}

export interface NormalizedStatsRow {
  stats: StatsRow;
  /** Kolom yang dibuang karena isinya milik kolom lain. */
  removed: ContradictoryColumn[];
  /** Kolom yang diisi ulang dari `stats_team_form`. */
  derived: string[];
}

/**
 * Bersihkan satu baris statistik: buang blok yang bertentangan dengan nama
 * kolom, lalu lengkapi `stats_over_25`/`stats_under` dari form bila kosong.
 */
export function normalizeStatsRow(row: StatsRow): NormalizedStatsRow {
  const stats: StatsRow = { ...row };
  const removed = findContradictoryColumns(row);
  for (const hit of removed) delete stats[hit.column];

  const derived: string[] = [];
  const staleOver = !isMeaningful(stats.stats_over_25);
  const staleUnder = !isMeaningful(stats.stats_under);
  /*
   * Sumber angka Over 2.5: kolom `stats_over_25` lebih dulu (paling dekat
   * dengan data yang tersimpan), baru `stats_team_form` sebagai cadangan.
   * Dengan begitu `under` selalu konsisten dengan `over` di baris yang sama.
   */
  const over = (staleOver || staleUnder)
    ? over25FromBlock(stats.stats_over_25) ?? over25FromForm(stats.stats_team_form)
    : null;

  if (over != null) {
    if (staleOver) {
      stats.stats_over_25 = {
        "Over 2.5": `${over}%`,
        "%": `${over}%`,
        "Derived From": "stats_team_form",
      };
      derived.push("stats_over_25");
    }
    if (staleUnder) {
      const under = Number((100 - over).toFixed(1));
      stats.stats_under = {
        "Under 2.5": `${under}%`,
        "Derived From": "100 - stats_team_form[Over 2.5]",
      };
      derived.push("stats_under");
    }
  }

  return { stats, removed, derived };
}
