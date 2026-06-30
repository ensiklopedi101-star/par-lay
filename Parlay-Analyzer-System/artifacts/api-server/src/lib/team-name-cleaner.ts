/**
 * Robust team name cleaner for FootyStats CSV exports.
 * Handles junk text like "Badge", "Logo", duplicate team names, and club suffixes.
 */

const JUNK_WORDS = [
  "badge", "logo", "crest", "emblem", "icon", "shield",
  "fc", "afc", "cf", "sc", "ssc", "ac", "as", "us", "pfc", "dfc",
  "football club", "football", "calcio", "club",
];

const KNOWN_SUFFIX_PATTERNS = [
  // "Manchester City FC Badge" → "Manchester City"
  /^(.+?)\s+(?:fc\s+)?badge$/i,
  /^(.+?)\s+(?:fc\s+)?logo$/i,
  /^(.+?)\s+(?:fc\s+)?crest$/i,
  // "Logo Manchester City" → "Manchester City"
  /^(?:badge|logo|crest)\s+(.+)$/i,
  // "Manchester City FC Manchester City" → "Manchester City"
  /^(.+?)\s+fc\s+\1$/i,
  /^(.+?)\s+\1$/i,
];

/**
 * Clean a raw team name from FootyStats by removing junk text.
 * Examples:
 *   "Manchester City FC Badge" → "Manchester City"
 *   "Logo Manchester City"       → "Manchester City"
 *   "Manchester City FC"         → "Manchester City"
 *   "Brighton & Hove Albion FC"  → "Brighton & Hove Albion"
 */
export function cleanTeamName(raw: string): string {
  let cleaned = raw.trim();

  // 1. Remove known suffix patterns
  for (const pattern of KNOWN_SUFFIX_PATTERNS) {
    const match = cleaned.match(pattern);
    if (match) {
      cleaned = match[1]!;
      break;
    }
  }

  // 2. Remove standalone junk words at the end (case-insensitive, whole word)
  let changed = true;
  while (changed) {
    changed = false;
    const lower = cleaned.toLowerCase();
    for (const junk of JUNK_WORDS) {
      // Remove as suffix: "X FC" → "X"
      const suffixRe = new RegExp(`\\s+${junk}$`, "i");
      if (suffixRe.test(lower)) {
        cleaned = cleaned.replace(suffixRe, "");
        changed = true;
        break;
      }
      // Remove as prefix: "FC X" → "X"
      const prefixRe = new RegExp(`^${junk}\\s+`, "i");
      if (prefixRe.test(lower)) {
        cleaned = cleaned.replace(prefixRe, "");
        changed = true;
        break;
      }
    }
  }

  // 3. Collapse duplicate team names: "Manchester City Manchester City" → "Manchester City"
  const words = cleaned.split(/\s+/);
  if (words.length >= 4) {
    const half = Math.floor(words.length / 2);
    const first = words.slice(0, half).join(" ");
    const second = words.slice(half).join(" ");
    if (first.toLowerCase() === second.toLowerCase()) {
      cleaned = first;
    }
  }

  return cleaned.trim();
}

/**
 * Convert a cleaned name to a slug for uniqueness.
 */
export function slugifyTeamName(cleaned: string): string {
  return cleaned
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}
