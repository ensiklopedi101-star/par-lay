import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseMarketKey,
  parseMarketType,
  extractLine,
  selectClosingSnapshots,
  computeClosingPrices,
  type OddsSnapshotRow,
} from "./closing-odds";

const KICKOFF = "2026-11-21T15:00:00Z";

function row(over: Partial<OddsSnapshotRow> = {}): OddsSnapshotRow {
  return {
    bookmaker: "Bet365",
    marketType: "ML",
    capturedAt: "2026-11-21T14:50:00Z",
    homeOdds: 2.1,
    awayOdds: 3.4,
    drawOdds: 3.6,
    overOdds: null,
    underOdds: null,
    bttsYes: null,
    bttsNo: null,
    ...over,
  };
}

/* ── parsing kunci engine ── */

test("parseMarketKey: ML tiga sisi", () => {
  assert.deepEqual(parseMarketKey("ML:home"), { family: "ML", side: "home", line: null });
  assert.deepEqual(parseMarketKey("ML:draw"), { family: "ML", side: "draw", line: null });
  assert.deepEqual(parseMarketKey("ML:away"), { family: "ML", side: "away", line: null });
});

test("parseMarketKey: Totals membawa garis", () => {
  assert.deepEqual(parseMarketKey("TOT:over:2.5"), { family: "Totals", side: "over", line: 2.5 });
  assert.deepEqual(parseMarketKey("TOT:under:3"), { family: "Totals", side: "under", line: 3 });
});

test("parseMarketKey: AH garis negatif dipertahankan", () => {
  assert.deepEqual(parseMarketKey("AH:home:-0.25"), { family: "AH", side: "home", line: -0.25 });
  assert.deepEqual(parseMarketKey("AH:away:0.25"), { family: "AH", side: "away", line: 0.25 });
});

test("parseMarketKey: kunci tak dikenal ditolak, bukan ditebak", () => {
  assert.equal(parseMarketKey("nonsense"), null);
  assert.equal(parseMarketKey("ML:sideways"), null);
  assert.equal(parseMarketKey("TOT:over"), null);
  assert.equal(parseMarketKey(""), null);
});

/* ── parsing market_type penyedia ── */

test("parseMarketType: nilai nyata dari database", () => {
  assert.deepEqual(parseMarketType("ML"), { family: "ML", line: null });
  assert.deepEqual(parseMarketType("Totals 2.5"), { family: "Totals", line: 2.5 });
  assert.deepEqual(parseMarketType("Totals 2.75"), { family: "Totals", line: 2.75 });
  assert.deepEqual(parseMarketType("Spread -0.25"), { family: "AH", line: -0.25 });
  assert.deepEqual(parseMarketType("Both Teams To Score"), { family: "BTTS", line: null });
});

test("parseMarketType: bentuk lain yang mungkin muncul", () => {
  assert.deepEqual(parseMarketType("h2h"), { family: "ML", line: null });
  assert.deepEqual(parseMarketType("Goals Over/Under 2.5"), { family: "Totals", line: 2.5 });
  assert.equal(parseMarketType("Total Corners"), null);
  assert.equal(parseMarketType("Exact Total Goals"), null);
});

test("extractLine: angka terakhir, termasuk negatif", () => {
  assert.equal(extractLine("Totals 2.5"), 2.5);
  assert.equal(extractLine("Spread -0.25"), -0.25);
  assert.equal(extractLine("Alternate Totals 2.5 (3)"), 3);
  assert.equal(extractLine("ML"), null);
});

/* ── pemilihan snapshot penutup ── */

test("snapshot setelah kick-off dibuang", () => {
  const rows = [
    row({ capturedAt: "2026-11-21T14:50:00Z" }),
    row({ capturedAt: "2026-11-21T15:05:00Z", homeOdds: 1.9 }), // in-play
  ];
  const chosen = selectClosingSnapshots(rows, KICKOFF);
  assert.equal(chosen.length, 1);
  assert.equal(chosen[0]!.capturedAt, "2026-11-21T14:50:00Z");
});

test("snapshot tepat pada kick-off dibuang", () => {
  const rows = [row({ capturedAt: KICKOFF })];
  assert.equal(selectClosingSnapshots(rows, KICKOFF).length, 0);
});

test("yang dipilih adalah snapshot terakhir sebelum kick-off", () => {
  const rows = [
    row({ capturedAt: "2026-11-21T09:00:00Z", homeOdds: 2.30 }),
    row({ capturedAt: "2026-11-21T14:50:00Z", homeOdds: 2.10 }),
    row({ capturedAt: "2026-11-21T12:00:00Z", homeOdds: 2.20 }),
  ];
  const chosen = selectClosingSnapshots(rows, KICKOFF);
  assert.equal(chosen.length, 1);
  assert.equal(chosen[0]!.homeOdds, 2.10);
});

test("bookmaker berbeda disimpan terpisah", () => {
  const rows = [
    row({ bookmaker: "Bet365" }),
    row({ bookmaker: "Pinnacle", homeOdds: 2.05 }),
  ];
  assert.equal(selectClosingSnapshots(rows, KICKOFF).length, 2);
});

test("kick-off tidak valid → tidak ada yang dipilih", () => {
  assert.equal(selectClosingSnapshots([row()], "bukan tanggal").length, 0);
});

/* ── harga penutup ── */

test("ML:home menghasilkan odds_close dan close_fair_prob yang jumlahnya 1", () => {
  const { prices } = computeClosingPrices(
    ["ML:home", "ML:draw", "ML:away"],
    [row()],
    KICKOFF,
  );
  const home = prices.get("ML:home")!;
  const draw = prices.get("ML:draw")!;
  const away = prices.get("ML:away")!;
  assert.equal(home.oddsClose, 2.1);
  const total = home.closeFairProb + draw.closeFairProb + away.closeFairProb;
  assert.ok(Math.abs(total - 1) < 1e-9, `jumlah probabilitas ${total} harus 1`);
});

test("margin bandar dibuang — probabilitas fair lebih kecil dari implisit mentah", () => {
  const { prices } = computeClosingPrices(["ML:home"], [row()], KICKOFF);
  const implied = 1 / 2.1;
  assert.ok(prices.get("ML:home")!.closeFairProb < implied);
});

test("outcome tidak lengkap → dilewati, bukan ditebak", () => {
  const { prices, skipped } = computeClosingPrices(
    ["ML:home"],
    [row({ drawOdds: null })],
    KICKOFF,
  );
  assert.equal(prices.size, 0);
  assert.equal(skipped.length, 1);
  assert.match(skipped[0]!.reason, /tidak lengkap/);
});

test("garis Totals harus cocok persis", () => {
  const totalsRow = row({
    marketType: "Totals 2.5",
    homeOdds: null,
    awayOdds: null,
    drawOdds: null,
    overOdds: 1.85,
    underOdds: 1.95,
  });
  const match = computeClosingPrices(["TOT:over:2.5"], [totalsRow], KICKOFF);
  assert.equal(match.prices.size, 1);
  assert.equal(match.prices.get("TOT:over:2.5")!.oddsClose, 1.85);

  const mismatch = computeClosingPrices(["TOT:over:3"], [totalsRow], KICKOFF);
  assert.equal(mismatch.prices.size, 0);
});

test("BTTS memakai pasangan yes/no sendiri", () => {
  const bttsRow = row({
    marketType: "Both Teams To Score",
    homeOdds: null,
    awayOdds: null,
    drawOdds: null,
    bttsYes: 1.72,
    bttsNo: 2.05,
  });
  const yes = computeClosingPrices(["BTTS:yes"], [bttsRow], KICKOFF).prices.get("BTTS:yes")!;
  const no = computeClosingPrices(["BTTS:no"], [bttsRow], KICKOFF).prices.get("BTTS:no")!;
  assert.equal(yes.oddsClose, 1.72);
  assert.ok(Math.abs(yes.closeFairProb + no.closeFairProb - 1) < 1e-9);
});

test("AH:away dengan garis positif memetakan ke garis kandang negatif", () => {
  const ahRow = row({
    marketType: "Spread -0.25",
    drawOdds: null,
    homeOdds: 1.98,
    awayOdds: 1.92,
  });
  const away = computeClosingPrices(["AH:away:0.25"], [ahRow], KICKOFF).prices.get("AH:away:0.25");
  assert.ok(away, "AH:away:0.25 harus cocok dengan Spread -0.25");
  assert.equal(away!.oddsClose, 1.92);
});

test("odds tidak valid tidak menghasilkan probabilitas", () => {
  const { prices } = computeClosingPrices(
    ["ML:home"],
    [row({ homeOdds: 1.0, drawOdds: 3.6, awayOdds: 3.4 })],
    KICKOFF,
  );
  assert.equal(prices.size, 0);
});

test("tanpa snapshot sama sekali → semua dilewati", () => {
  const { prices, skipped } = computeClosingPrices(["ML:home", "BTTS:yes"], [], KICKOFF);
  assert.equal(prices.size, 0);
  assert.equal(skipped.length, 2);
});

test("kunci tak dikenal dilaporkan, tidak membuat crash", () => {
  const { prices, skipped } = computeClosingPrices(["???", "ML:home"], [row()], KICKOFF);
  assert.equal(prices.size, 1);
  assert.equal(skipped.length, 1);
  assert.match(skipped[0]!.reason, /tidak dikenal/);
});
