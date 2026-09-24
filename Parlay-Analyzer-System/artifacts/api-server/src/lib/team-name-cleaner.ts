/**
 * Robust team name cleaner for FootyStats CSV exports.
 * Handles junk text like "Badge", "Logo", duplicate team names, and club suffixes.
 */

const JUNK_WORDS = [
  "badge", "logo", "crest", "emblem", "icon", "shield",
  "fc", "afc", "cf", "sc", "ssc", "ac", "as", "us", "pfc", "dfc",
  "football club", "football", "calcio", "club",
];

/**
 * Explicit aliases that are known to represent the same club.
 *
 * Keep this list conservative: unlike generic suffix removal, these mappings
 * are entity decisions and should only be added when the identity is certain.
 */
const CANONICAL_TEAM_NAMES: Record<string, string> = {
  heerenveen: "Heerenveen",
  "sc heerenveen": "Heerenveen",
  utrecht: "Utrecht",
  "fc utrecht": "Utrecht",
  // Chinese Super League historical FootyStats names → current database names.
  // These are explicit entity aliases, not generic suffix removal.
  "tianjin teda": "Tianjin Jinmen Tiger",
  "qingdao youth island": "Qingdao West Coast FC",
  "shanghai sipg": "Shanghai Port FC",
  "dalian zhixing": "Dalian Yingbo FC",
  "shandong luneng taishan": "Shandong Taishan FC",
  "henan jianye": "Henan",
  "shenyang urban": "Liaoning Tieren FC",
  "zhejiang professional": "Zhejiang FC",
  "sichuan jiuniu": "Shenzhen Peng City",
  "chengdu better city": "Chengdu Rongcheng",
  "chongqing tongliang long": "Chongqing Tonglianglong FC",
  "qingdao jonoon": "Qingdao Hainiu FC",
  "shanghai shenhua": "Shanghai Shenhua FC",
  "wuhan three towns": "Wuhan Three Towns FC",
};

/**
 * Entity aliases that cannot be derived safely from punctuation/suffix
 * cleanup alone. League-scoped aliases are intentionally kept separate from
 * global aliases because short names such as "Frankfurt" can refer to more
 * than one club outside the competition where the alias was observed.
 */
const TEAM_ALIASES_BY_LEAGUE: Record<string, Record<string, string>> = {
  "germany-bundesliga": {
    augsburg: "FC Augsburg",
    bayern: "Bayern Munich",
    bremen: "Werder Bremen",
    dortmund: "Borussia Dortmund",
    frankfurt: "Eintracht Frankfurt",
    freiburg: "SC Freiburg",
    hamburg: "Hamburger SV",
    hoffenheim: "TSG Hoffenheim",
    leipzig: "RB Leipzig",
    leverkusen: "Bayer Leverkusen",
    mainz: "FSV Mainz",
    "gladbach": "Borussia Monchengladbach",
    "koln": "1. FC Cologne",
    cologne: "1. FC Cologne",
    paderborn: "SC Paderborn 07",
    schalke: "Schalke 04",
    stuttgart: "VfB Stuttgart",
    union: "Union Berlin",
    elversberg: "SV 07 Elversberg",
  },
  "england-premier-league": {
    brighton: "Brighton & Hove Albion",
    "brighton hove albion": "Brighton & Hove Albion",
  },
};

const GLOBAL_TEAM_ALIASES: Record<string, string> = {
  "manchester utd": "Manchester United",
  "manchester united": "Manchester United",
  "ac milan": "AC Milan",
  milan: "AC Milan",
  "inter milan": "Inter",
  "inter milano": "Inter",
  internazionale: "Inter",
  "juventus turin": "Juventus",
  "paris saint germain": "Paris Saint-Germain",
  psg: "Paris Saint-Germain",
};

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

function normalizeNameKey(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizeLeagueKey(value: string | null | undefined): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\/_\s]+/g, "-")
    .replace(/-+/g, "-");
}

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

  const trimmed = cleaned.trim();
  return CANONICAL_TEAM_NAMES[trimmed.toLowerCase()] ?? trimmed;
}

/**
 * Resolve a provider/imported team name to one stable entity label.
 *
 * This is deliberately more conservative than fuzzy matching. Fuzzy matching
 * remains useful as a fallback during analysis, but persistence and data
 * repair must use explicit aliases so two different clubs are never merged by
 * accident.
 */
export function canonicalTeamName(raw: string, leagueSlug?: string | null): string {
  const cleaned = cleanTeamName(raw);
  const key = normalizeNameKey(cleaned);
  if (!key) return "";

  const leagueKey = normalizeLeagueKey(leagueSlug);
  const leagueAliases = TEAM_ALIASES_BY_LEAGUE[leagueKey];
  return leagueAliases?.[key] ?? GLOBAL_TEAM_ALIASES[key] ?? cleaned;
}

/**
 * Stable comparison key for matching fixtures, imported stats, and legacy
 * rows that were stored under an alias.
 */
export function teamIdentityKey(raw: string, leagueSlug?: string | null): string {
  return normalizeNameKey(canonicalTeamName(raw, leagueSlug));
}

/**
 * Expose the alias dictionaries for diagnostics and admin tooling without
 * allowing callers to mutate the internal maps.
 */
export function getTeamAliasDictionary(): {
  global: Record<string, string>;
  byLeague: Record<string, Record<string, string>>;
} {
  return {
    global: { ...GLOBAL_TEAM_ALIASES },
    byLeague: Object.fromEntries(
      Object.entries(TEAM_ALIASES_BY_LEAGUE).map(([league, aliases]) => [league, { ...aliases }]),
    ),
  };
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
