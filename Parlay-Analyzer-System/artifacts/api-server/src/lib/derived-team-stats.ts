/**
 * Derivasi blok `team_season_stats` dari hasil pertandingan mentah.
 *
 * Mengapa modul ini ada (Fase A blueprint, 23 Nov 2026): statistik tim selama
 * ini hanya masuk lewat ekstensi Chrome FootyStats yang dioperasikan manual.
 * Bundesliga 2026-27 berhenti di 16/18 tim — Bayern Munich dan 1. FC Cologne
 * tidak pernah terkirim — sehingga setiap fixture mereka ditolak gerbang
 * statistik SEBELUM analisis. Padahal bahan bakunya sudah ada di rumah
 * sendiri: skor akhir di `fixtures` (musim berjalan) dan `research_matches`
 * (musim-musim sebelumnya).
 *
 * Blok yang dihasilkan meniru format FootyStats persis (kunci + format
 * string) supaya lolos `assessTeamStatsQuality` dan terbaca
 * `parseTeamRates` tanpa perubahan apa pun di jalur baca.
 *
 * Satu-satunya blok yang tidak bisa diturunkan dari skor adalah xG asli.
 * `stats_xg` di sini adalah PROXY yang diturunkan secara deterministik:
 *
 *   xG_proxy  = 0.75 · GF/laga  + 0.25 · rata-rata GA liga
 *   xGA_proxy = 0.75 · GA/laga  + 0.25 · rata-rata GA liga
 *
 * yaitu kekuatan gol tim yang disusutkan ke arah rata-rata liga — persis
 * semangat shrinkage yang sudah dipakai `estimateLambdas`. Residual
 * `xG vs Actual` mengikuti definisi FootyStats (GF − xG). Proxy ini memberi
 * gerbang kuant sinyal arah (over/under-performance), BUKAN pengukuran xG;
 * baris ekstensi FootyStats yang asli selalu menimpa baris turunan ini
 * lewat jalur merge ingest yang sudah ada.
 */

export interface TeamMatchPerspective {
  gf: number;
  ga: number;
  venue: "H" | "A";
  /** urutan kronologis tidak penting kecuali untuk "Last 6" — kirim terurut lama→baru */
  result: "W" | "D" | "L";
}

export type DerivedStatsBlocks = Record<string, Record<string, string>>;

const two = (n: number): string => n.toFixed(2);
const signed = (n: number): string => `${n >= 0 ? "+" : ""}${n.toFixed(2)}`;
const pct = (count: number, total: number): string =>
  total > 0 ? `${Math.round((count / total) * 100)}%` : "0%";
const rateText = (goals: number, matches: number): string =>
  matches > 0 ? two(goals / matches) : "0.00";

function buildBlocks(
  matches: TeamMatchPerspective[],
  leagueGaAvg: number,
): DerivedStatsBlocks {
  const mp = matches.length;
  const home = matches.filter((m) => m.venue === "H");
  const away = matches.filter((m) => m.venue === "A");
  const sum = (xs: TeamMatchPerspective[], pick: (m: TeamMatchPerspective) => number) =>
    xs.reduce((acc, m) => acc + pick(m), 0);
  const count = (xs: TeamMatchPerspective[], pred: (m: TeamMatchPerspective) => boolean) =>
    xs.filter(pred).length;

  const gf = sum(matches, (m) => m.gf);
  const ga = sum(matches, (m) => m.ga);
  const gfRate = mp > 0 ? gf / mp : 0;
  const gaRate = mp > 0 ? ga / mp : 0;

  const xgProxy = 0.75 * gfRate + 0.25 * leagueGaAvg;
  const xgaProxy = 0.75 * gaRate + 0.25 * leagueGaAvg;

  const wins = count(matches, (m) => m.result === "W");
  const draws = count(matches, (m) => m.result === "D");
  const losses = mp - wins - draws;
  const points = wins * 3 + draws;
  const cleanSheets = count(matches, (m) => m.ga === 0);
  const failedToScore = count(matches, (m) => m.gf === 0);
  const btts = count(matches, (m) => m.gf > 0 && m.ga > 0);
  const over25 = count(matches, (m) => m.gf + m.ga > 2);
  const over35 = count(matches, (m) => m.gf + m.ga > 3);
  const under = (line: number) => count(matches, (m) => m.gf + m.ga < line + 0.5);

  const homeRate = home.length > 0 ? sum(home, (m) => m.gf) / home.length : 0;
  const awayRate = away.length > 0 ? sum(away, (m) => m.gf) / away.length : 0;
  const homeAdvantage = awayRate > 0
    ? `${homeRate >= awayRate ? "+" : ""}${Math.round((homeRate / awayRate - 1) * 100)}%`
    : "0%";

  const last6 = matches.slice(-6).map((m) => m.result).join(" ");

  return {
    stats_xg: {
      MP: String(mp),
      GF: rateText(gf, mp),
      GA: rateText(ga, mp),
      xG: two(xgProxy),
      xGA: two(xgaProxy),
      xGD: signed(xgProxy - xgaProxy),
      "xG vs Actual": signed(gfRate - xgProxy),
    },
    stats_fts: {
      MP: String(mp),
      FTS: String(failedToScore),
      "FTS %": pct(failedToScore, mp),
      "Home %": pct(count(home, (m) => m.gf === 0), home.length),
      "Away %": pct(count(away, (m) => m.gf === 0), away.length),
    },
    stats_btts: {
      MP: String(mp),
      BTTS: String(btts),
      "BTTS %": pct(btts, mp),
      "Home %": pct(count(home, (m) => m.gf > 0 && m.ga > 0), home.length),
      "Away %": pct(count(away, (m) => m.gf > 0 && m.ga > 0), away.length),
    },
    stats_goals_scored: {
      MP: String(mp),
      "Goals Scored": String(gf),
      "Per Match": `${rateText(gf, mp)} Scored / match`,
      Home: `${rateText(sum(home, (m) => m.gf), home.length)} / match`,
      Away: `${rateText(sum(away, (m) => m.gf), away.length)} / match`,
      "Home Advantage": homeAdvantage,
    },
    stats_goals_conceded: {
      MP: String(mp),
      "Goals Conceded": String(ga),
      "Per Match": `${rateText(ga, mp)} Conceded / match`,
      Home: `${rateText(sum(home, (m) => m.ga), home.length)} / match`,
      Away: `${rateText(sum(away, (m) => m.ga), away.length)} / match`,
    },
    stats_over_25: {
      MP: String(mp),
      "Over 2.5": String(over25),
      "%": pct(over25, mp),
      Home: pct(count(home, (m) => m.gf + m.ga > 2), home.length),
      Away: pct(count(away, (m) => m.gf + m.ga > 2), away.length),
    },
    stats_over_35: {
      MP: String(mp),
      "Over 3.5": String(over35),
      "%": pct(over35, mp),
      Home: pct(count(home, (m) => m.gf + m.ga > 3), home.length),
      Away: pct(count(away, (m) => m.gf + m.ga > 3), away.length),
    },
    stats_under: {
      MP: String(mp),
      "Under 0.5": pct(under(0), mp),
      "Under 1.5": pct(under(1), mp),
      "Under 2.5": pct(under(2), mp),
      "Under 3.5": pct(under(3), mp),
      "Under 4.5": pct(under(4), mp),
      "Under 5.5": pct(under(5), mp),
    },
    stats_team_form: {
      MP: String(mp),
      W: String(wins),
      D: String(draws),
      L: String(losses),
      Pts: String(points),
      PPG: rateText(points, mp),
      GF: String(gf),
      GA: String(ga),
      GD: String(gf - ga),
      CS: pct(cleanSheets, mp),
      FTS: pct(failedToScore, mp),
      BTTS: pct(btts, mp),
      "Over 2.5": pct(over25, mp),
      "Last 6": last6,
    },
  };
}

export function buildDerivedTeamStats(
  matches: TeamMatchPerspective[],
  leagueGoalsAgainstAverage: number,
): DerivedStatsBlocks {
  if (matches.length === 0) return {};
  return buildBlocks(matches, leagueGoalsAgainstAverage);
}

/** Rata-rata gol kemasukan per penampilan tim — penyebut proxy xG. */
export function leagueGoalsAgainstAverage(matches: TeamMatchPerspective[]): number {
  if (matches.length === 0) return 0;
  return matches.reduce((acc, m) => acc + m.ga, 0) / matches.length;
}
