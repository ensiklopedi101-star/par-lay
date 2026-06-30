#!/usr/bin/env node
/**
 * Seed default Gemini persona (Quant Sniper v4) into scheduler_config.ai_persona.
 *
 * Reads the persona from the current source of truth:
 *   src/services/ai-analysis.ts → DEFAULT_SYSTEM_INSTRUCTION
 *
 * Usage:
 *   cd artifacts/api-server
 *   node scripts/seed-persona.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const url = process.env["SUPABASE_URL"];
const key = process.env["SUPABASE_SERVICE_ROLE_KEY"];

if (!url || !key) {
  console.error("Error: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
  process.exit(1);
}

const sourcePath = join(__dirname, "../src/services/ai-analysis.ts");
const source = readFileSync(sourcePath, "utf8");

const match = source.match(/export const DEFAULT_SYSTEM_INSTRUCTION = `([\s\S]+?)`;$/m);
if (!match) {
  console.error("Error: could not extract DEFAULT_SYSTEM_INSTRUCTION from ai-analysis.ts");
  process.exit(1);
}

const persona = match[1].trim();

const supabase = createClient(url, key, { db: { schema: "public" } });

const { data: existing, error: readError } = await supabase
  .from("scheduler_config")
  .select("id")
  .limit(1)
  .maybeSingle();

if (readError) {
  console.error("Error reading scheduler_config:", readError.message);
  process.exit(1);
}

if (existing?.id) {
  const { error } = await supabase
    .from("scheduler_config")
    .update({ ai_persona: persona })
    .eq("id", existing.id);

  if (error) {
    console.error("Error updating scheduler_config:", error.message);
    process.exit(1);
  }
  console.log(`Updated scheduler_config id=${existing.id} with ai_persona (${persona.length} chars)`);
} else {
  const { data, error } = await supabase
    .from("scheduler_config")
    .insert({ ai_persona: persona })
    .select("id")
    .single();

  if (error) {
    console.error("Error inserting scheduler_config:", error.message);
    process.exit(1);
  }
  console.log(`Inserted scheduler_config id=${data.id} with ai_persona (${persona.length} chars)`);
}
