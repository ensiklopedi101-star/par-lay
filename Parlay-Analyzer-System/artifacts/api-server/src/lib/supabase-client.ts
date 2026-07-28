import { createClient, SupabaseClient } from "@supabase/supabase-js";
import WebSocket from "ws";

const supabaseUrl = process.env["SUPABASE_URL"];
const supabaseKey = process.env["SUPABASE_SERVICE_ROLE_KEY"];

export const supabase: SupabaseClient =
  supabaseUrl && supabaseKey
    ? createClient(supabaseUrl, supabaseKey, {
        auth: { autoRefreshToken: false, persistSession: false },
         // `ws` is compatible at runtime, but its constructor type differs
         // slightly from Supabase Realtime's browser-oriented declaration.
         realtime: { transport: WebSocket as unknown as typeof globalThis.WebSocket },
      })
    : (null as unknown as SupabaseClient);
