import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { assessContext, backedSideFromKey } from "./context-risk";

describe("context-risk", () => {
  it("istirahat pendek tim yang didukung = risiko tinggi", () => {
    const risk = assessContext({
      backed: "home", homeRestDays: 3, awayRestDays: 7, homeMatches14: 2, awayMatches14: 2,
    });
    assert.equal(risk.level, "tinggi");
    assert.ok(risk.scoreMultiplier < 1);
    assert.ok(risk.flags.some((f) => f.includes("3 hari")));
  });

  it("jadwal segar tanpa ketimpangan = risiko rendah", () => {
    const risk = assessContext({
      backed: "away", homeRestDays: 6, awayRestDays: 7, homeMatches14: 1, awayMatches14: 1,
    });
    assert.equal(risk.level, "rendah");
    assert.equal(risk.flags.length, 0);
  });

  it("tanpa data jadwal = tidak-diketahui, bukan dianggap aman", () => {
    const risk = assessContext({
      backed: "home", homeRestDays: null, awayRestDays: null, homeMatches14: null, awayMatches14: null,
    });
    assert.equal(risk.level, "tidak-diketahui");
  });

  it("backedSideFromKey membaca kunci engine", () => {
    assert.equal(backedSideFromKey("ML:home"), "home");
    assert.equal(backedSideFromKey("AH:away:-1.5"), "away");
    assert.equal(backedSideFromKey("TOT:over:2.5"), null);
    assert.equal(backedSideFromKey("BTTS:yes"), null);
  });
});
