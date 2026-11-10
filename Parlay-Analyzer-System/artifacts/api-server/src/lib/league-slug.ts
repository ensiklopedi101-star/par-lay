/**
 * League slug canonicalisation and validation.
 *
 * Why this exists: the Chrome extension derived the league from `parts[1]` of a
 * FootyStats URL, so `footystats.org/spain/la-liga` produced "la-liga". The
 * ingest route normalised that to "la-liga", accepted it, and created 20 empty
 * Spanish team rows under a *new* league_slug. Twenty La Liga clubs ended up
 * filed under england-premier-league, and nothing complained.
 *
 * The fix is not another alias table — it is refusing to write rows for a
 * league that does not exist. A typo must fail loudly, not silently create a
 * parallel universe of data.
 */

import { supabase } from "./supabase-client";
import { logger } from "./logger";

/**
 * FootyStats URLs use `/{country}/{competition}`; the app stores those two
 * parts joined by a dash (`spain/la-liga` → `spain-la-liga`). Accept a full
 * URL, a path, or an already-correct slug.
 */
export function normalizeLeagueSlug(raw: string): string {
  let value = String(raw ?? "").trim();
  try {
    if (/^https?:\/\//i.test(value)) {
      value = new URL(value).pathname;
    }
  } catch {
    /* fall through to string handling */
  }

  const parts = value
    .split(/[?#]/)[0]!
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => !/^(www\.)?footystats\.org$/i.test(part))
    /* Drop season segments: /spain/la-liga/2025-2026 */
    .filter((part) => !/^\d{4}([-/]\d{2,4})?$/.test(part))
    /* Drop stats-page segments: /england/premier-league/xg-table */
    .filter((part) => !/^(xg|goals|btts|over|under|shots|form|half).*table/i.test(part))
    .filter((part) => !/^(stats|table|tables)$/i.test(part));

  return parts
    .join("-")
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Alternate spellings that map onto a real slug. Keep this list short — every
 * entry is a piece of technical debt. Ideally the extension sends the exact
 * slug and this stays empty.
 */
const SLUG_ALIASES: Record<string, string> = {
  "spain-la-liga": "spain-la-liga",
  "spain-laliga": "spain-la-liga",
  "la-liga": "spain-la-liga",
  "england-premier-league": "england-premier-league",
  "england-epl": "england-premier-league",
  "premier-league": "england-premier-league",
  "italy-serie-a": "italy-serie-a",
  "serie-a": "italy-serie-a",
  "germany-bundesliga": "germany-bundesliga",
  "bundesliga": "germany-bundesliga",
  "france-ligue-1": "france-ligue-1",
  "ligue-1": "france-ligue-1",
  "netherlands-eredivisie": "netherlands-eredivisie",
  "eredivisie": "netherlands-eredivisie",
  "england-championship": "england-championship",
  "china-chinese-super-league": "china-chinese-super-league",
  "south-korea-k-league-1": "south-korea-k-league-1",
  "republic-of-korea-k-league-1": "south-korea-k-league-1",
  "japan-j1-league": "japan-j1-league",
  "uefa-champions-league": "uefa-champions-league",
  "uefa-europa-league": "uefa-europa-league",
  "international-fifa-world-cup": "international-fifa-world-cup",
};

/** Applies the alias table. Does not touch the database. */
export function applySlugAlias(slug: string): string {
  return SLUG_ALIASES[slug] ?? slug;
}

let cachedSlugs: { slugs: Set<string>; loadedAt: number } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000;

/** All league slugs that actually exist in the `leagues` table. */
export async function loadKnownLeagueSlugs(): Promise<Set<string>> {
  if (cachedSlugs && Date.now() - cachedSlugs.loadedAt < CACHE_TTL_MS) {
    return cachedSlugs.slugs;
  }
  /*
   * `supabase` is null when SUPABASE_URL / SERVICE_ROLE_KEY are absent. That
   * must degrade to "validation skipped", not crash the ingest route — a
   * missing credential should not turn a 422 into a 500.
   */
  if (!supabase) {
    logger.warn("[LEAGUE-SLUG] Supabase client tidak tersedia; validasi slug dilewati");
    return new Set();
  }
  const { data, error } = await supabase.from("leagues").select("slug");
  if (error) {
    logger.warn({ error }, "[LEAGUE-SLUG] gagal memuat daftar liga; validasi dilewati");
    return new Set();
  }
  const slugs = new Set(
    (data ?? [])
      .map((row) => String((row as { slug?: unknown }).slug ?? "").trim().toLowerCase())
      .filter(Boolean),
  );
  cachedSlugs = { slugs, loadedAt: Date.now() };
  return slugs;
}

export interface ResolvedLeague {
  ok: boolean;
  slug: string;
  raw: string;
  /** Populated when ok === false. */
  reason?: string;
  suggestions?: string[];
}

/**
 * Turn whatever the caller sent into a slug that exists, or explain why not.
 *
 * When the leagues table cannot be read (network/credentials), validation is
 * skipped and the normalised slug is returned with a warning — ingestion must
 * not stop dead because a lookup failed.
 */
export async function resolveLeagueSlug(raw: string): Promise<ResolvedLeague> {
  const normalized = normalizeLeagueSlug(raw);
  if (!normalized) {
    return { ok: false, slug: "", raw: String(raw ?? ""), reason: "league slug kosong setelah normalisasi" };
  }

  const aliased = applySlugAlias(normalized);
  const known = await loadKnownLeagueSlugs();

  if (known.size === 0) {
    return { ok: true, slug: aliased, raw: String(raw ?? ""), reason: "daftar liga tidak terbaca; slug dipakai apa adanya" };
  }
  if (known.has(aliased)) {
    return { ok: true, slug: aliased, raw: String(raw ?? "") };
  }

  /* Suggest the closest known slugs so the caller can fix the extension. */
  const suggestions = [...known]
    .map((slug) => ({ slug, distance: levenshtein(aliased, slug) }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 3)
    .filter((c) => c.distance <= Math.max(3, Math.floor(aliased.length / 3)))
    .map((c) => c.slug);

  return {
    ok: false,
    slug: aliased,
    raw: String(raw ?? ""),
    reason: `league_slug "${aliased}" tidak ada di tabel leagues`,
    suggestions,
  };
}

/** Small Levenshtein for "did you mean" hints only. */
function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(
        prev[j]! + 1,
        cur[j - 1]! + 1,
        prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = cur;
  }
  return prev[n]!;
}

/** Test hook: clears the slug cache so tests do not leak state. */
export function __clearLeagueSlugCache(): void {
  cachedSlugs = null;
}
