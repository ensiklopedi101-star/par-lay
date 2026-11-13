import { test } from "node:test";
import assert from "node:assert/strict";
import { buildLedgerReport, toLedgerBet, type SelectionLedgerRow } from "./ledger-report.js";

function row(partial: Partial<SelectionLedgerRow>): SelectionLedgerRow {
  return {
    fixture_id: "1",
    model_version: 2,
    market_key: "ML:home",
    family: "ML",
    line: null,
    odds: 2.0,
    p_final: 0.55,
    p_market_fair: 0.5,
    p_model_only: 0.6,
    odds_close: 1.9,
    close_fair_prob: 0.52,
    outcome: "win",
    was_bet: false,
    ...partial,
  };
}

test("toLedgerBet menolak outcome karangan dan memetakan kolom DB", () => {
  const bet = toLedgerBet(row({ outcome: "WIN_BANGET" as never }));
  assert.equal(bet.outcome, null);
  assert.equal(toLedgerBet(row({})).oddsClose, 1.9);
});

test("ledger kosong: vonis insufficient, semua gate gagal dengan alasan — bukan crash", () => {
  const report = buildLedgerReport([]);
  assert.equal(report.verdict.level, "insufficient");
  assert.equal(report.progress.settled, 0);
  assert.equal(report.progress.pct, 0);
  assert.ok(report.gates.every((g) => !g.passed));
  assert.ok(report.gates.every((g) => g.detail.length > 0));
});

test("sampel kecil tidak boleh menghasilkan vonis supported berapa pun bagusnya", () => {
  const rows = Array.from({ length: 20 }, (_, i) => row({ fixture_id: String(i) }));
  const report = buildLedgerReport(rows);
  assert.notEqual(report.verdict.level, "supported");
  assert.equal(report.gates.find((g) => g.id === "settled_300")!.passed, false);
});

test("300 seleksi menang dengan CLV positif: gate Fase 3 lulus dan vonis supported", () => {
  const rows = Array.from({ length: 300 }, (_, i) =>
    row({ fixture_id: String(i), outcome: i % 3 === 0 ? "loss" : "win" }),
  );
  const report = buildLedgerReport(rows);
  assert.equal(report.progress.settled, 300);
  assert.equal(report.gates.find((g) => g.id === "settled_300")!.passed, true);
  assert.equal(report.gates.find((g) => g.id === "clv_significant")!.passed, true);
  assert.equal(report.verdict.level, "supported");
  assert.ok(report.overall.blendFit != null);
  assert.ok(report.overall.blendFit!.weight >= 0);
});

test("laporan memisahkan per versi model dan per family (v1 LLM vs v2 quant)", () => {
  const rows = [
    ...Array.from({ length: 10 }, (_, i) => row({ fixture_id: `a${i}`, model_version: 1 })),
    ...Array.from({ length: 10 }, (_, i) => row({ fixture_id: `b${i}`, model_version: 2, family: "Totals", market_key: "TOT:over:2.5" })),
  ];
  const report = buildLedgerReport(rows);
  assert.deepEqual(report.byModelVersion.map((s) => s.key).sort(), ["v1", "v2"]);
  assert.deepEqual(report.byFamily.map((s) => s.key).sort(), ["ML", "Totals"]);
});
