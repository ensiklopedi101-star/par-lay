/**
 * STATS_DICTIONARY — Kamus Konteks Statistik Terminal.BET
 *
 * Menyediakan pemetaan nama statistik + metrik untuk:
 * 1. AI (Gemini) prompt builder — agar LLM memahami konteks setiap angka
 * 2. Chrome Extension ingestion — validasi payload yang masuk
 * 3. Dokumentasi internal — single source of truth untuk 11 laci statistik
 */

export interface StatMeta {
  name: string;          // Nama manusiawi
  description: string;   // Penjelasan singkat
  metrics: string[];      // Kunci metrik yang diharapkan dalam JSONB
  data_source: string;    // Sumber data (FootyStats, manual, dll)
  typical_values: string; // Rentang nilai tipikal untuk konteks
}

export const STATS_DICTIONARY: Record<string, StatMeta> = {
  stats_xg: {
    name: "Expected Goals (xG)",
    description: "Metrik offensif & defensif berbasis xG. Mengukur kualitas peluang yang dibuat dan diterima.",
    metrics: ["xG", "xGA", "xGD", "GF", "GA", "xG vs Actual"],
    data_source: "FootyStats / Understat",
    typical_values: "xG: 0.8-2.2 per match, xGA: 0.8-2.0",
  },
  stats_fts: {
    name: "Failed to Score",
    description: "Persentase pertandingan di mana tim gagal mencetak gol. Indikator konsistensi offensif.",
    metrics: ["xFTS", "xFTS %", "Home %", "Away %"],
    data_source: "FootyStats",
    typical_values: "FTS%: 10-40% (lebih rendah = lebih baik)",
  },
  stats_btts: {
    name: "Both Teams to Score",
    description: "Persentase pertandingan di mana kedua tim mencetak gol. Indikator pertahanan terbuka.",
    metrics: ["BTTS", "BTTS %", "Home %", "Away %"],
    data_source: "FootyStats",
    typical_values: "BTTS%: 40-60% (liga rata-rata ~50%)",
  },
  stats_goals_conceded: {
    name: "Goals Conceded",
    description: "Rata-rata gol yang kemasukan per pertandingan, dengan split home/away.",
    metrics: ["Goals Conceded", "Per Match", "Home", "Away", "Home Advantage"],
    data_source: "FootyStats",
    typical_values: "Per match: 0.5-2.0 (lebih rendah = pertahanan kuat)",
  },
  stats_goals_scored: {
    name: "Goals Scored",
    description: "Rata-rata gol yang dicetak per pertandingan, dengan split home/away.",
    metrics: ["Goals Scored", "Per Match", "Home", "Away", "Home Advantage"],
    data_source: "FootyStats",
    typical_values: "Per match: 0.8-2.5 (lebih tinggi = serangan kuat)",
  },
  stats_shots: {
    name: "Match Shots",
    description: "Total tembakan (shots) per pertandingan dengan threshold over/under.",
    metrics: ["Over 10.5", "Over 11.5", "Over 12.5", "Over 13.5", "Over 14.5", "Over 15.5"],
    data_source: "FootyStats",
    typical_values: "Shots per match: 8-18",
  },
  stats_over_25: {
    name: "Over 2.5 Goals",
    description: "Persentase pertandingan dengan total gol > 2.5. Indikator keliaran liga.",
    metrics: ["Over 2.5", "%", "Home", "Away"],
    data_source: "FootyStats",
    typical_values: "%: 35-60% (EPL ~50%, Serie A ~45%)",
  },
  stats_over_35: {
    name: "Over 3.5 Goals",
    description: "Persentase pertandingan dengan total gol > 3.5. Indikator high-scoring league.",
    metrics: ["Over 3.5", "%", "Home", "Away"],
    data_source: "FootyStats",
    typical_values: "%: 20-40% (EPL ~30%, Bundesliga ~35%)",
  },
  stats_under: {
    name: "Under Goals",
    description: "Persentase pertandingan dengan total gol di bawah threshold tertentu.",
    metrics: ["Under 2.5", "Under 0.5", "Under 1.5", "Under 3.5", "Under 4.5", "Under 5.5"],
    data_source: "FootyStats",
    typical_values: "Under 2.5%: 40-65% (inverse dari Over 2.5)",
  },
  stats_team_form: {
    name: "Team Form & General",
    description: "Form terkini, klasemen, dan statistik umum. Indikator momentum psikologis.",
    metrics: ["MP", "W", "D", "L", "GF", "GA", "GD", "Pts", "Last 6", "PPG", "Clean sheet (CS)", "FTS", "BTTS", "Over 2.5", "Next Match"],
    data_source: "FootyStats",
    typical_values: "PPG: 0.8-2.5 (Champions ~2.3, Relegation ~0.8)",
  },
  stats_ht: {
    name: "Half Time (HT) Stats",
    description: "Performasi tim di babak pertama. Indikator strategik awal pertandingan.",
    metrics: ["MP", "W - D - L (HT)", "win %", "Draw %", "Loss %"],
    data_source: "FootyStats",
    typical_values: "HT win%: 25-45%, HT draw%: 35-50%",
  },
};

/* 11 valid stat_type keys untuk validasi payload */
export const VALID_STAT_TYPES = Object.keys(STATS_DICTIONARY);

/**
 * Format stats untuk prompt Gemini.
 * Menggabungkan nama metrik dari kamus dengan value dari database.
 * Contoh: "xG: 1.74 (Expected Goals per match)"
 */
export function formatStatsWithDictionary(
  statType: string,
  statData: Record<string, unknown>,
): string {
  const meta = STATS_DICTIONARY[statType];
  if (!meta) {
    return JSON.stringify(statData);
  }

  const lines: string[] = [`${meta.name} (${meta.description})`];
  for (const metric of meta.metrics) {
    const val = statData[metric] ?? statData[metric.toLowerCase().replace(/\s+/g, "_")] ?? null;
    if (val !== null && val !== undefined) {
      lines.push(`  ${metric}: ${val}`);
    }
  }
  return lines.join("\n");
}

/**
 * Validasi payload statistik dari ekstensi Chrome.
 * Pastikan stat_type valid dan semua metrik yang diharapkan ada.
 */
export function validateStatPayload(
  statType: string,
  statData: Record<string, unknown>,
): { valid: boolean; missing: string[]; unknown: string[] } {
  const meta = STATS_DICTIONARY[statType];
  if (!meta) {
    return { valid: false, missing: [], unknown: ["Invalid stat_type"] };
  }

  const normalizeMetric = (value: string) => value
    .trim()
    .toLowerCase()
    .replace(/[%()]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  const keys = Object.keys(statData);
  const normalizedKeys = new Set(keys.map(normalizeMetric));
  const expected = meta.metrics.map(normalizeMetric);
  const missing = expected.filter((e) => !normalizedKeys.has(e));
  const unknown = keys.filter((k) => !expected.includes(normalizeMetric(k)));

  return { valid: missing.length === 0, missing, unknown };
}
