import { createClient, SupabaseClient } from "@supabase/supabase-js";

/**
 * Klien Supabase untuk API server.
 *
 * Tiga keputusan yang penting untuk serverless:
 *
 *  1. **Tanpa `ws`.** Paket `ws` hanya dibutuhkan untuk Supabase Realtime, dan
 *     tidak ada satu pun panggilan `.channel()` / `.subscribe()` di API ini
 *     (diperiksa dengan grep). Membuangnya mengecilkan bundle fungsi dan
 *     menghilangkan risiko modul native gagal dimuat.
 *  2. **Kredensial dibaca saat dipakai, bukan saat modul diimpor.** Di Vercel
 *     environment variable tersedia saat runtime, tetapi modul bisa dievaluasi
 *     lebih awal. Membacanya di dalam fungsi membuat urutannya tidak penting.
 *  3. **Tetap `null` bila kredensial tidak ada**, seperti sebelumnya, supaya
 *     route yang sudah punya penjagaan (`20261111` team cleanup, closing-odds)
 *     men-degrade dengan rapi alih-alih crash saat bootstrap.
 */

function resolveClient(): SupabaseClient {
  const url = process.env["SUPABASE_URL"];
  const key = process.env["SUPABASE_SERVICE_ROLE_KEY"];
  if (!url || !key) return null as unknown as SupabaseClient;

  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export const supabase: SupabaseClient = resolveClient();
