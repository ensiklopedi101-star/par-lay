import { createClient, SupabaseClient } from "@supabase/supabase-js";

const url = process.env["SUPABASE_URL"];
const key = process.env["SUPABASE_SERVICE_ROLE_KEY"];

if (!url || !key) {
  throw new Error(
    "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set. Check your environment variables.",
  );
}

export const supabase: SupabaseClient = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
});

export { SupabaseClient };
