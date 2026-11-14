/**
 * Backtest model Poisson vs pasar — runner CLI (read-only).
 *
 * Logika penyiapan sampel hidup di services/model-backtest.ts dan dipakai
 * bersama endpoint GET /api/learning/model-backtest, jadi angka CLI dan
 * angka panel Transparansi tidak bisa berbeda.
 *
 * Butuh SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
 * Pakai: npx tsx scripts/backtest-model.ts [--out report.json]
 */
import { writeFileSync } from "node:fs";
import { getModelBacktest } from "../src/services/model-backtest";

async function main(): Promise<void> {
  const result = await getModelBacktest(true);
  const outIdx = process.argv.indexOf("--out");
  if (outIdx >= 0 && process.argv[outIdx + 1]) {
    writeFileSync(process.argv[outIdx + 1]!, JSON.stringify(result, null, 2));
  }
  console.log(JSON.stringify(result, null, 2));
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
