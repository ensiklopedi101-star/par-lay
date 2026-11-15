/**
 * Pemetaan dataset historis xgabora/Club-Football-Match-Data ke baris
 * `research_matches`. Murni (tanpa I/O) agar bisa diuji: skrip ingest
 * membaca CSV, modul ini yang memutuskan baris mana yang masuk gudang
 * riset dan dalam bentuk apa.
 *
 * Hanya 7 divisi yang punya padanan liga di sistem. EloRatings.csv
 * sumber TIDAK dipakai: Elo pra-pertandingan sudah menempel di setiap
 * baris Matches.csv (HomeElo/AwayElo), jadi menyimpan 274 ribu baris
 * Elo harian hanya akan menggandakan data.
 */
export const RESEARCH_DIVISIONS: Record<string, string> = {
  E0: "england-premier-league",
  E1: "england-championship",
  SP1: "spain-laliga",
  I1: "italy-serie-a",
  D1: "germany-bundesliga",
  F1: "france-ligue-1",
  N1: "netherlands-eredivisie",
};

export interface ResearchMatchRow {
  division: string;
  league_slug: string;
  match_date: string;
  home_team: string;
  away_team: string;
  home_elo: number | null;
  away_elo: number | null;
  form3_home: number | null;
  form5_home: number | null;
  form3_away: number | null;
  form5_away: number | null;
  ft_home: number | null;
  ft_away: number | null;
  ht_home: number | null;
  ht_away: number | null;
  odd_home: number | null;
  odd_draw: number | null;
  odd_away: number | null;
  over25: number | null;
  under25: number | null;
  handi_size: number | null;
  handi_home: number | null;
  handi_away: number | null;
}

/** Parser CSV satu baris yang menghormati tanda kutip (nama tim aman). */
export function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      cells.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  cells.push(current);
  return cells;
}

const num = (value: string | undefined): number | null => {
  if (value == null || value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const int = (value: string | undefined): number | null => {
  const n = num(value);
  return n == null ? null : Math.trunc(n);
};

/**
 * Ubah satu baris CSV (sudah dipetakan header→nilai) menjadi baris
 * gudang, atau null bila di luar cakupan (divisi lain / sebelum `from` /
 * tanggal tidak terbaca).
 */
export function toResearchMatchRow(
  record: Record<string, string>,
  fromDate = "2020-08-01",
): ResearchMatchRow | null {
  const leagueSlug = RESEARCH_DIVISIONS[record["Division"] ?? ""];
  if (!leagueSlug) return null;
  const matchDate = (record["MatchDate"] ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(matchDate) || matchDate < fromDate) return null;
  const home = (record["HomeTeam"] ?? "").trim();
  const away = (record["AwayTeam"] ?? "").trim();
  if (!home || !away) return null;
  return {
    division: record["Division"]!,
    league_slug: leagueSlug,
    match_date: matchDate,
    home_team: home,
    away_team: away,
    home_elo: num(record["HomeElo"]),
    away_elo: num(record["AwayElo"]),
    form3_home: num(record["Form3Home"]),
    form5_home: num(record["Form5Home"]),
    form3_away: num(record["Form3Away"]),
    form5_away: num(record["Form5Away"]),
    ft_home: int(record["FTHome"]),
    ft_away: int(record["FTAway"]),
    ht_home: int(record["HTHome"]),
    ht_away: int(record["HTAway"]),
    odd_home: num(record["OddHome"]),
    odd_draw: num(record["OddDraw"]),
    odd_away: num(record["OddAway"]),
    over25: num(record["Over25"]),
    under25: num(record["Under25"]),
    handi_size: num(record["HandiSize"]),
    handi_home: num(record["HandiHome"]),
    handi_away: num(record["HandiAway"]),
  };
}
