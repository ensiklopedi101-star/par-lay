/**
 * Kontrak baru untuk LLM (persona v5) + klasifikasi hasil untuk pembelajaran.
 *
 * KELEMAHAN YANG DIPERBAIKI:
 *  - LLM tidak lagi menulis probabilitas/EV/stake (itu dihitung kode).
 *  - LLM hanya membaca BERITA (cedera, line-up, rotasi, motivasi) dan
 *    mengeluarkan penyesuaian λ kecil + bukti. Dibatasi ±12% oleh
 *    sanitizeLlmAdjustment() di strength.ts.
 *  - Pelajaran pasca-laga tidak lagi ditulis untuk setiap LOSS ("faktor kunci
 *    yang tidak terprediksi") karena itu memaksa narasi atas noise
 *    (resulting / outcome bias) dan di-inject kembali ke prompt berikutnya.
 */

export const PERSONA_V5 = `Anda adalah Analis Informasi Pra-Laga. Anda BUKAN penghasil probabilitas.

TUGAS TUNGGAL: dari berita yang diberikan, tentukan apakah ada informasi material yang belum tentu tercermin di statistik musiman: cedera/absen pemain kunci, line-up resmi, rotasi (jadwal padat), skorsing, motivasi ekstrem (sudah juara/degradasi), cuaca ekstrem.

ATURAN KERAS:
1. DILARANG menulis probabilitas, EV, stake, confidence, atau rekomendasi bet. Semua itu dihitung mesin.
2. Setiap klaim WAJIB punya bukti (type, detail ≥ 10 karakter, source_url). Tanpa bukti → keluarkan evidence kosong.
3. Anda hanya boleh mengusulkan pengali gol yang diharapkan: lambda_home_mult dan lambda_away_mult dalam rentang 0.88–1.12. Nilai 1.00 = tidak ada informasi material.
4. Jika ragu, gunakan 1.00. Kurangnya informasi BUKAN alasan menggeser angka.
5. Jangan menafsirkan pergerakan odds; pasar sudah dipakai mesin sebagai prior.
6. Catat data_gaps: informasi penting yang tidak tersedia.

OUTPUT: satu objek JSON valid saja:
{
  "lambda_home_mult": 1.00,
  "lambda_away_mult": 1.00,
  "evidence": [{"type":"injury","detail":"...","source_url":"https://..."}],
  "data_gaps": ["line-up resmi belum rilis"]
}`;

export type ResultClass =
  | "variance"            // proses baik, hasil buruk → JANGAN buat pelajaran naratif
  | "process_error"       // harga bergerak melawan kita / data buruk → buat pelajaran
  | "good_process_win"    // proses baik, hasil baik
  | "lucky_win"           // menang tetapi CLV negatif → jangan perkuat pola
  | "unclassified";

export function classifyResult(args: {
  outcome: "win" | "half_win" | "push" | "half_loss" | "loss" | "void";
  clv: number | null;
  dataQualityFlag?: boolean;
}): ResultClass {
  const won = args.outcome === "win" || args.outcome === "half_win";
  const lost = args.outcome === "loss" || args.outcome === "half_loss";
  if (args.dataQualityFlag && lost) return "process_error";
  if (args.clv == null) return "unclassified";
  if (lost) return args.clv < -0.03 ? "process_error" : "variance";
  if (won) return args.clv < -0.03 ? "lucky_win" : "good_process_win";
  return "unclassified";
}

/** Prompt pelajaran hanya dipakai untuk process_error. */
export function buildProcessLessonPrompt(ctx: { match: string; market: string; clvPct: number; flags: string[] }): string {
  return [
    `Pertandingan: ${ctx.match}. Market: ${ctx.market}. CLV: ${(ctx.clvPct * 100).toFixed(1)}%.`,
    `Flag proses: ${ctx.flags.join(", ") || "tidak ada"}.`,
    "Tulis maksimal 2 kalimat tentang KESALAHAN PROSES (kualitas data, waktu pengambilan harga, pencocokan market).",
    "DILARANG menyebut skor akhir sebagai alasan. DILARANG memberi saran 'lebih yakin/kurang yakin'.",
  ].join("\n");
}

/**
 * Retrieval pelajaran: cocokkan berdasarkan ID tim kanonik, BUKAN kata pertama
 * nama tim ("Manchester" cocok ke United & City, "Real" ke Madrid & Sociedad).
 */
export function lessonQueryKey(teamId: string | number, leagueId: string | number): string {
  return `team:${teamId}|league:${leagueId}`;
}
