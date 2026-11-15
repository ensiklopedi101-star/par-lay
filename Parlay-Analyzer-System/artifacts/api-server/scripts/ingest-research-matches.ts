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
 * Penulisan memakai HTTP langsung ke PostgREST (fetch bawaan Node),
 * BUKAN supabase-js: client itu menginisialisasi RealtimeClient yang
 * menuntut WebSocket dan dua kali menggagalkan job CI di Node 20.
 * Skrip batch seperti ini tidak butuh realtime sama sekali.
 *
 * Butuh SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
 * Pakai: npx tsx scripts/ingest-research-matches.ts [--file Matches.csv] [--from 2020-08-01]
 */
import { readFileSync } from "node:fs";
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

/** Upsert satu batch via PostgREST; merge-duplicates pada kunci unik tabel. */
async function upsertBatch(
  baseUrl: string,
  serviceKey: string,
  batch: ResearchMatchRow[],
): Promise<void> {
  let response: Response;
  try {
    response = await fetch(
    `${baseUrl.replace(/\/$/, "")}/rest/v1/research_matches?on_conflict=division,match_date,home_team,away_team`,
    {
      method: "POST",
      headers: {
        "apikey": serviceKey,
        "Authorization": `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify(batch),
    },
    );
  } catch (error) {
    throw new Error(
      `Tidak bisa menghubungi PostgREST di ${baseUrl} — periksa SUPABASE_URL. (${error instanceof Error ? error.message : String(error)})`,
    );
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`PostgREST upsert gagal: HTTP ${response.status} ${detail.slice(0, 300)}`);
  }
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

  let upserted = 0;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    await upsertBatch(url, key, rows.slice(i, i + BATCH_SIZE));
    upserted += Math.min(BATCH_SIZE, rows.length - i);
    console.log(`  ${upserted}/${rows.length}`);
  }
  console.log(`Selesai: ${upserted} baris research_matches.`);
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
