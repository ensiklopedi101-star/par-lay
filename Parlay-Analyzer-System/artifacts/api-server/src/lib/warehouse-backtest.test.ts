import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  eloAdjustedLambdas,
  prepareWarehouseSamples,
  seasonStartYear,
  type WarehouseMatch,
} from "./warehouse-backtest";

function match(partial: Partial<WarehouseMatch>): WarehouseMatch {
  return {
    league_slug: "england-premier-league",
    match_date: "2023-08-12",
    home_team: "Arsenal",
    away_team: "Chelsea",
    home_elo: 1900,
    away_elo: 1800,
    ft_home: 2,
    ft_away: 1,
    odd_home: 2.0,
    odd_draw: 3.4,
    odd_away: 3.6,
    over25: 1.9,
    under25: 1.9,
    handi_size: -0.5,
    handi_home: 2.0,
    handi_away: 1.9,
    ...partial,
  };
}

/** Satu musim penuh mini: 4 tim, kandang-tandang, agar prior musim berikutnya terbentuk. */
function seasonMatches(seasonStart: number): WarehouseMatch[] {
  const teams = ["Arsenal", "Chelsea", "Liverpool", "Everton"];
  const rows: WarehouseMatch[] = [];
  teams.forEach((home, i) => {
    teams.forEach((away, j) => {
      if (home === away) return;
      rows.push(match({
        match_date: `${seasonStart}-${String(8 + ((i + j) % 5)).padStart(2, "0")}-15`,
        home_team: home,
        away_team: away,
        ft_home: (i + j) % 3,
        ft_away: (i * j) % 2,
      }));
    });
  });
  return rows;
}

describe("warehouse-backtest", () => {
  it("seasonStartYear memetakan musim Eropa dengan benar", () => {
    assert.equal(seasonStartYear("2023-08-12"), 2023);
    assert.equal(seasonStartYear("2024-02-10"), 2023);
    assert.equal(seasonStartYear("2024-06-30"), 2023);
  });

  it("eloAdjustedLambdas menaikkan λ tim yang Elo-nya lebih kuat", () => {
    const base = { lambdaHome: 1.5, lambdaAway: 1.1 };
    const adjusted = eloAdjustedLambdas(base, 2000, 1600, 0.5);
    assert.ok(adjusted.lambdaHome > base.lambdaHome);
    assert.ok(adjusted.lambdaAway < base.lambdaAway);
    assert.deepEqual(eloAdjustedLambdas(base, 2000, 1600, 0), base);
  });

  it("sampel hanya lahir bila prior musim sebelumnya ada (anti look-ahead)", () => {
    const season1 = seasonMatches(2022);
    const season2 = seasonMatches(2023);
    const prep = prepareWarehouseSamples([...season1, ...season2]);
    // Musim pertama tidak punya prior; musim kedua (12 laga) yang jadi sampel.
    // Syarat minimal 10 laga prior per tim tidak terpenuhi di liga mini
    // (6 laga/tim), jadi yang terhitung adalah skippedNoPrior musim kedua.
    assert.equal(prep.samples.length, 0);
    assert.ok(prep.skippedNoPrior >= 12);
  });
});
