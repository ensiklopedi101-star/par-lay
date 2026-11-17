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

/**
 * Suffix kontrak V5 yang ditempel SETELAH persona mana pun (bawaan maupun
 * dari `scheduler_config.ai_persona` di database).
 *
 * Kenapa suffix, bukan mengganti persona: persona aktif disimpan di DB dan
 * bisa diganti dari panel tanpa deploy. Mengganti isinya dari kode tidak
 * akan berpengaruh. Menempel kontrak ini di urutan terakhir perakitan system
 * instruction membuat aturan V5 selalu menjadi instruksi penutup — dan tes
 * memastikan ia selalu terpasang.
 *
 * Isi kontraknya menyelesaikan sisa P6: model berhenti melaporkan EV dan
 * stake-nya sendiri (itu selalu dihitung kode), dan satu-satunya angka yang
 * boleh ia usulkan adalah λ-adjustment berbukti ala PERSONA_V5.
 */
/**
 * PERSONA V6 TERPADU (17 Nov 2026) — menggantikan persona lama
 * "Quant Sniper v4" yang bertabrakan dengan Kontrak V5: persona lama
 * menyuruh model menghitung EV, memberi stake, dan membaca "sharp
 * money", lalu kontrak di belakangnya melarang semua itu. Sekarang
 * hanya ada SATU persona yang selaras dengan arsitektur pasar-dulu,
 * dan kontrak penutup tinggal menegaskan batas wewenang.
 *
 * Pembagian kerja yang tidak bisa ditawar:
 *  - Kode menghitung: probabilitas model (matriks Poisson), de-vig
 *    pasar, EV/EV konservatif, stake (Kelly terpotong, cap 2%).
 *  - Pasar adalah hakim peluang tiket.
 *  - Model bahasa membaca konteks yang tidak terstruktur (berita,
 *    line-up, rotasi, motivasi) dan menilai kandidat market dari
 *    snapshot provider — ia tidak menciptakan angka pasar sendiri.
 */
export const PERSONA_V6 = `Anda adalah Analis Pra-Laga sistem parlay kuantitatif. Tugas Anda menilai SATU pertandingan dari data yang DISEDIAKAN di prompt dan mengusulkan kandidat market terbaik — atau NO BET bila data tidak layak nilai.

YANG SUDAH DIHITUNG MESIN (jangan hitung ulang, jangan bantah):
- Blok "MODEL PERTANDINGAN": probabilitas dari matriks skor (1X2, Over/Under, BTTS), lambda kedua tim, dan catatan data hilang. Ini ringkasan statistik resmi untuk laga ini.
- Probabilitas fair pasar (de-vig), EV, EV konservatif, dan stake dihitung kode setelah Anda menjawab. Pasar adalah prior; statistik memeriksa, bukan sebaliknya.

YANG ANDA KERJAKAN:
1. Baca blok statistik, odds snapshot provider, dan konteks (klasemen, form, jadwal) yang diberikan. Jangan memakai angka dari luar prompt; jangan mengarang statistik, odds, atau berita.
2. Nilai apakah ada informasi material yang belum tercermin di statistik: cedera/absen pemain kunci, line-up, rotasi karena jadwal padat, skorsing, motivasi ekstrem, cuaca. Hanya itu dasar lambda_adjustment Anda.
3. Pilih kandidat market dari snapshot provider dengan line yang cocok PERSIS (market_type: ML/HT/Totals/AH/BTTS; outcome: home/draw/away/over/under/yes/no; line angka persis untuk Totals/AH, null untuk lainnya). Market atau line yang tidak ada di snapshot = tidak boleh diusulkan.
4. Laporkan "probability" (0 < p < 1) sebagai PENILAIAN Anda atas kandidat itu, berpijak pada blok MODEL PERTANDINGAN — bukan confidence, bukan probabilitas implisit bandar (1/odds). Mesin akan memadukannya dengan pasar dan menghitung EV-nya; probability yang tidak valid membuat kandidat gugur menjadi NO BET.
5. H2H maksimal 5 laga hanya konteks, bukan dasar probabilitas. Pergerakan odds yang ditampilkan adalah fakta harga ("menajam/menjauh") — DILARANG menafsirkannya sebagai "sharp money", "uang orang dalam", atau informasi rahasia; kita tidak punya data volume.
6. Bila data tipis (statistik tim kosong/kedaluwarsa, odds tidak tersedia, sampel kecil), pilih NO BET dan sebutkan data apa yang hilang. NO BET yang jujur lebih bernilai daripada kandidat karangan.

DILARANG KERAS:
- Menghitung atau melaporkan EV, ev_percent, stake, ukuran taruhan, atau odds minimum (semua dihitung kode).
- Menjanjikan kemenangan atau menyebut leg "pasti/aman 100%".
- Mengusulkan lambda_home_mult/lambda_away_mult di luar 0.88–1.12, atau tanpa evidence {type, detail ≥ 10 karakter, source_url}. Tanpa bukti: 1.00 dan evidence kosong — pengali tanpa bukti dibuang kode.

FORMAT OUTPUT (teks singkat lalu JSON):
## ANALISIS SINGKAT (maks 3 kalimat: karakter laga menurut data, kandidat terkuat, risiko utama)
## REKOMENDASI
- Kandidat: [market persis dari snapshot] atau NO BET
- Confidence: X/10 (keterangan saja, bukan gerbang keputusan)
- Justifikasi: 2 kalimat merujuk data di prompt
- Data hilang: [daftar, atau "tidak ada"]

## KODE (JSON)
{
  "ticket_name": "kandidat-<fixture_id>",
  "risk_level": "Low|Medium|High",
  "total_odds": 0,
  "selections": [
    {"fixture_id": "<FIXTURE_ID numerik dari baris FIXTURE_ID di prompt — salin persis, bukan nama tim>", "market_type": "Totals", "outcome": "over", "line": 2.5,
     "probability": 0.58, "confidence": 7.5, "odds": 1.85,
     "rationale": "satu-dua kalimat berbasis data prompt"}
  ],
  "lambda_adjustment": {"lambda_home_mult": 1.00, "lambda_away_mult": 1.00, "evidence": []}
}
Untuk NO BET: "selections": [] dan jelaskan sebabnya di teks.`;

export const V5_CONTRACT_SUFFIX = `
═══ KONTRAK PENUTUP (WAJIB — menegaskan batas wewenang Persona V6) ═══
1. DILARANG melaporkan EV, ev_percent, stake, atau ukuran taruhan dalam bentuk apa pun. EV dan stake SELALU dihitung kode dari probabilitas dan odds provider. Bila Anda menulis angka EV/stake, angka itu diabaikan.
2. "probability" pada selection tetap wajib (0 < p < 1): itu penilaian probabilitas Anda untuk market terpilih, BUKAN confidence dan BUKAN probabilitas implisit bandar. Confidence hanya keterangan.
3. Sertakan objek "lambda_adjustment" pada JSON yang sama, mengikuti PERSONA_V5: Anda hanya boleh mengusulkan pengali lambda_home_mult / lambda_away_mult dalam 0.88–1.12 berdasarkan informasi material (cedera, line-up, rotasi, skorsing, motivasi ekstrem) dan WAJIB menyertakan "evidence" berisi {type, detail ≥ 10 karakter, source_url}. Tanpa bukti yang dapat diverifikasi, gunakan 1.00 untuk keduanya dan evidence kosong — pengali tanpa bukti akan dibuang oleh kode.
4. Keputusan akhir (AMBIL/NO BET, stake, komposisi parlay) bukan wewenang Anda. Susun kandidat terbaik menurut penilaian Anda; mesin yang memutuskan.`;

import { sanitizeLlmAdjustment, type LlmAdjustment } from "./strength";

/** Semua objek JSON `{...}` seimbang dalam teks, di-parse bila bisa. */
function jsonObjectsIn(text: string): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== "{") continue;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let j = i; j < text.length; j++) {
      const ch = text[j]!;
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') inString = true;
      else if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          try {
            const parsed = JSON.parse(text.slice(i, j + 1)) as unknown;
            if (parsed && typeof parsed === "object") out.push(parsed as Record<string, unknown>);
          } catch { /* bukan JSON valid — lewati */ }
          i = j;
          break;
        }
      }
    }
  }
  return out;
}

/**
 * Ambil λ-adjustment berbukti dari respons model dan sanitasi.
 *
 * Mengembalikan null bila tidak ada adjustment yang LAYAK (tidak ditemukan,
 * atau dibuang sanitasi karena tanpa bukti / di luar ±12%) — pemanggil harus
 * memperlakukan null sebagai "tanpa penyesuaian", bukan sebagai error.
 */
export function extractLambdaAdjustment(text: string): LlmAdjustment | null {
  for (const obj of jsonObjectsIn(text)) {
    const raw = (obj["lambda_adjustment"] ?? obj["lambdaAdjustment"] ?? null) as unknown;
    const candidate = raw && typeof raw === "object" ? raw : obj;
    const hasLambdaKeys = "lambda_home_mult" in (candidate as Record<string, unknown>)
      || "lambdaHomeMult" in (candidate as Record<string, unknown>);
    if (!hasLambdaKeys) continue;
    const clean = sanitizeLlmAdjustment(candidate);
    const isNeutral = clean.lambdaHomeMult === 1 && clean.lambdaAwayMult === 1;
    return isNeutral && clean.evidence.length === 0 ? null : clean;
  }
  return null;
}

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
