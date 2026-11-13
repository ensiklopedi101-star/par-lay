/**
 * Jalankan replay 63 prediksi lampau terhadap gerbang sistem saat ini.
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/backtest-legacy.ts
 *
 * Read-only: hanya membaca `prediction_learning_evaluations`, tidak menulis
 * apa pun. Metodologi dan batas kejujurannya ada di src/lib/legacy-backtest.ts
 * — ini replay gerbang, BUKAN menjalankan ulang model pada masa lalu.
 */
import { supabase } from "../src/lib/supabase-client.js";
import { buildLegacyBacktest, type LegacySample } from "../src/lib/legacy-backtest.js";

async function main(): Promise<void> {
  if (!supabase) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY belum diatur");
  const { data, error } = await supabase
    .from("prediction_learning_evaluations")
    .select("prediction_id, market_bet, outcome, odds, ev_percent, analysis_at")
    .in("outcome", ["WIN", "LOSS", "HALF_WIN", "HALF_LOSS", "PUSH"])
    .order("analysis_at", { ascending: true });
  if (error) throw new Error(error.message);

  const samples: LegacySample[] = (data ?? []).map((row) => ({
    predictionId: String(row.prediction_id),
    marketBet: (row.market_bet as string | null) ?? null,
    outcome: row.outcome as LegacySample["outcome"],
    odds: row.odds == null ? null : Number(row.odds),
    evPercent: row.ev_percent == null ? null : Number(row.ev_percent),
    analysisAt: (row.analysis_at as string | null) ?? null,
  }));

  const report = buildLegacyBacktest(samples);
  const pct = (value: number | null) => (value == null ? "—" : `${(value * 100).toFixed(1)}%`);
  console.log(`Total settled lampau : ${report.total}`);
  console.log(`Dapat di-replay       : ${report.replayable} (sisanya ${report.insufficientData} insufficient_data)`);
  console.log(`Sistem lama (semua)   : hit ${pct(report.legacyAll.hitRate)} · ROI ${pct(report.legacyAll.roiPerBet)} dari ${report.legacyAll.roiSamples} baris ber-odds`);
  console.log(`Gerbang saat ini      : ${report.keptCurrent.n} lolos · hit ${pct(report.keptCurrent.hitRate)} · ROI ${pct(report.keptCurrent.roiPerBet)}`);
  console.log(`Bila gate di-enforce  : ${report.keptIfEnforced.n} lolos · hit ${pct(report.keptIfEnforced.hitRate)} · ROI ${pct(report.keptIfEnforced.roiPerBet)}`);
  console.log(`Brier/log-loss (p rekonstruksi, n=${report.keptCurrent.probabilitySamples}): ${report.keptCurrent.brier ?? "—"} / ${report.keptCurrent.logLoss ?? "—"}`);
  console.log("\nPERINGATAN: sampel replay sangat kecil dan probabilitas direkonstruksi dari EV warisan. Ini diagnosis kontrak data, bukan bukti skill model.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
