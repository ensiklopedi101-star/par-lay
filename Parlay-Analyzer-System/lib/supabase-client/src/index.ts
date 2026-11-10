import { createClient, SupabaseClient } from "@supabase/supabase-js";

/**
 * Klien Supabase bersama.
 *
 * Sebelumnya modul ini `throw` saat diimpor bila environment variable belum
 * ada. Di serverless hal itu berbahaya: modul bisa dievaluasi lebih awal
 * (saat bundling atau cold start) sebelum environment siap, dan satu galat di
 * sini mematikan seluruh fungsi.
 *
 * Sekarang kredensial dibaca saat klien dipakai, dan `null` dikembalikan bila
 * belum ada — pemanggil yang memutuskan cara menanganinya.
 */

let cached: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient | null {
  if (cached) return cached;

  const url = process.env["SUPABASE_URL"];
  const key = process.env["SUPABASE_SERVICE_ROLE_KEY"];
  if (!url || !key) return null;

  cached = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return cached;
}

export const supabase: SupabaseClient = getSupabaseClient() as SupabaseClient;

export { SupabaseClient };
