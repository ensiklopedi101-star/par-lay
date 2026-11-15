import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseCsvLine, toResearchMatchRow } from "./research-matches";

describe("research-matches (gudang riset xgabora)", () => {
  it("parseCsvLine menghormati kutip dan koma di dalam nama", () => {
    assert.deepEqual(parseCsvLine('E0,"Team, A",B,1.5'), ["E0", "Team, A", "B", "1.5"]);
    assert.deepEqual(parseCsvLine('a,"b""c",d'), ["a", 'b"c', "d"]);
  });

  it("memetakan divisi liga sistem dan menolak di luar cakupan", () => {
    const base = {
      Division: "E0", MatchDate: "2024-08-17", HomeTeam: "Arsenal", AwayTeam: "Wolves",
      HomeElo: "1900.5", AwayElo: "1700.25", FTHome: "2", FTAway: "0", HTHome: "1", HTAway: "0",
      OddHome: "1.4", OddDraw: "4.8", OddAway: "7.0", Over25: "1.75", Under25: "2.05",
    };
    const row = toResearchMatchRow(base);
    assert.equal(row?.league_slug, "england-premier-league");
    assert.equal(row?.home_elo, 1900.5);
    assert.equal(row?.ht_home, 1);
    assert.equal(toResearchMatchRow({ ...base, Division: "SC0" }), null);
    assert.equal(toResearchMatchRow({ ...base, MatchDate: "2019-05-01" }), null);
    assert.equal(toResearchMatchRow({ ...base, OddHome: "" })?.odd_home, null);
  });
});
