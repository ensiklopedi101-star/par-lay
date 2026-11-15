/**
 * Ingest gudang riset historis (xgabora/Club-Football-Match-Data, MIT)
 * ke tabel `research_matches`. Idempoten (upsert per pertandingan),
 * jadi aman dijalankan ulang terjadwal.
 *
 * Sumber CSV dibaca dari --file <path> bila diberikan; selain itu
 * diunduh dari GitHub. Hanya 7 divisi liga sistem dan musim >=
 * --from (bawaan 2020-08-01) yang disimpan — file sumber 238.860
 * baris menyusut ke belasan ribu baris ringkas.
 *
 * Butuh SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
 * Pakai: npx tsx scripts/ingest-research-matches.ts [--file Matches.csv] [--from 2020-08-01]
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { parseCsvLine, toResearchMatchRow, type ResearchMatchRow } from "../src/lib/research-matches";

const SOURCE_URL =
  "https://raw.githubusercontent.com/xgabora/Club-Football-Match-Data/main/data/Matches.csv";
const BATCH_SIZE = 500;

function argValue(flag: string): string | null {
  const idx = process.argv.indexOf(flag);
  return idx >= 0 ? (process.argv[idx + 1] ?? null) : null;
}

async function loadCsvText(): Promise<string> {
  const file = argValue("--file");
  if (file) return readFileSync(file, "utf-8");
  const response = await fetch(SOURCE_URL);
  if (!response.ok) throw new Error(`Unduh CSV gagal: HTTP ${response.status}`);
  return response.text();
}

async function main(): Promise<void> {
  const url = process.env["SUPABASE_URL"];
  const key = process.env["SUPABASE_SERVICE_ROLE_KEY"];
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY belum diset");
  const fromDate = argValue("--from") ?? "2020-08-01";

  const text = await loadCsvText();
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const headers = parseCsvLine(lines[0]!);
  const rows: ResearchMatchRow[] = [];
  for (const line of lines.slice(1)) {
    const cells = parseCsvLine(line);
    const record: Record<string, string> = {};
    headers.forEach((header, i) => {
      record[header] = cells[i] ?? "";
    });
    const row = toResearchMatchRow(record, fromDate);
    if (row) rows.push(row);
  }
  console.log(`CSV: ${lines.length - 1} baris → ${rows.length} baris gudang (sejak ${fromDate})`);

  /*
   * supabase-js menginisialisasi RealtimeClient yang butuh WebSocket
   * global (ada di Node >= 22). Skrip ini tidak memakai realtime sama
   * sekali, jadi sediakan transport dari paket `ws` bila global tidak
   * ada — membuat skrip tetap jalan di Node 20 tanpa mengganti client.
   */
  const clientOptions: Record<string, unknown> = { auth: { persistSession: false } };
  if (typeof (globalThis as { WebSocket?: unknown }).WebSocket === "undefined") {
    try {
      const wsModule = await import("ws");
      clientOptions["global"] = { WebSocket: wsModule.default ?? wsModule.WebSocket };
    } catch {
      throw new Error(
        "WebSocket global tidak tersedia (Node < 22) dan paket 'ws' tidak ditemukan. Jalankan dengan Node >= 22.",
      );
    }
  }
  const supabase = createClient(url, key, clientOptions as never);
  let upserted = 0;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const { error } = await supabase
      .from("research_matches")
      .upsert(batch, { onConflict: "division,match_date,home_team,away_team" });
    if (error) throw new Error(`upsert batch ${i}: ${error.message}`);
    upserted += batch.length;
    console.log(`  ${upserted}/${rows.length}`);
  }
  console.log(`Selesai: ${upserted} baris research_matches.`);
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
