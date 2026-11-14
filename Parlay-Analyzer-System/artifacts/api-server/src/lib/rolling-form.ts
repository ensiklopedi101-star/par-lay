/**
 * Form musim berjalan point-in-time untuk backtest.
 *
 * Pasar tahu form musim ini; model prior-only tidak. Tracker ini
 * merekonstruksi apa yang BOLEH diketahui sebelum sebuah pertandingan:
 * hanya hasil pertandingan yang kick-off-nya lebih dulu. `ratesFor`
 * dibaca SEBELUM `record` pertandingan yang sedang dinilai — membalik
 * urutan itu adalah look-ahead dan mengkhianati seluruh backtest.
 *
 * Data mentahnya skor final dari tabel fixtures sendiri, jadi tidak
 * ada sumber baru dan tidak ada statistik agregat yang bocor.
 */
import type { TeamRatesParsed } from "./match-context";

interface TeamAccum {
  matches: number;
  gf: number;
  ga: number;
  homeMatches: number;
  homeGf: number;
  homeGa: number;
  awayMatches: number;
  awayGf: number;
  awayGa: number;
}

function emptyAccum(): TeamAccum {
  return {
    matches: 0, gf: 0, ga: 0,
    homeMatches: 0, homeGf: 0, homeGa: 0,
    awayMatches: 0, awayGf: 0, awayGa: 0,
  };
}

const per = (total: number, matches: number): number | null =>
  matches > 0 ? total / matches : null;

export class RollingFormTracker {
  private readonly teams = new Map<string, TeamAccum>();

  private accum(teamKey: string): TeamAccum {
    let acc = this.teams.get(teamKey);
    if (!acc) {
      acc = emptyAccum();
      this.teams.set(teamKey, acc);
    }
    return acc;
  }

  /** Rates musim berjalan tim SEBELUM pertandingan berikutnya dicatat. */
  ratesFor(teamKey: string): TeamRatesParsed | null {
    const acc = this.teams.get(teamKey);
    if (!acc || acc.matches === 0) return null;
    return {
      matches: acc.matches,
      goalsFor: per(acc.gf, acc.matches),
      goalsAgainst: per(acc.ga, acc.matches),
      goalsForHome: per(acc.homeGf, acc.homeMatches),
      goalsForAway: per(acc.awayGf, acc.awayMatches),
      goalsAgainstHome: per(acc.homeGa, acc.homeMatches),
      goalsAgainstAway: per(acc.awayGa, acc.awayMatches),
      xgFor: null,
      xgAgainst: null,
      xgResidual: null,
      btts: null,
      bttsHome: null,
      bttsAway: null,
      fts: null,
      ftsHome: null,
      shotsOver105: null,
      formPoints: null,
      formMatches: acc.matches,
      formPpg: null,
      last6: null,
      htWin: null,
    };
  }

  /** Catat satu hasil final. Panggil hanya setelah rates kedua tim dibaca. */
  record(homeKey: string, awayKey: string, homeGoals: number, awayGoals: number): void {
    const home = this.accum(homeKey);
    home.matches += 1;
    home.gf += homeGoals;
    home.ga += awayGoals;
    home.homeMatches += 1;
    home.homeGf += homeGoals;
    home.homeGa += awayGoals;

    const away = this.accum(awayKey);
    away.matches += 1;
    away.gf += awayGoals;
    away.ga += homeGoals;
    away.awayMatches += 1;
    away.awayGf += awayGoals;
    away.awayGa += homeGoals;
  }
}
