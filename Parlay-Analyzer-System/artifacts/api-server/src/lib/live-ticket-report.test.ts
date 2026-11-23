import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildLiveTicketReport,
  variantOfTicketName,
  type LiveTicketLegRow,
  type LiveTicketRow,
} from "./live-ticket-report";

const ticket = (
  id: string,
  name: string,
  status: string,
  winProb: number | null,
): LiveTicketRow => ({ id, parlay_name: name, status, win_probability: winProb, created_at: "2026-11-23T04:23:43Z" });

const leg = (parlay_id: string, odds: number, result: string | null): LiveTicketLegRow => ({
  parlay_id,
  odds,
  result,
});

test("nama tiket dipetakan ke varian; legacy tidak termasuk", () => {
  assert.equal(variantOfTicketName("Tiket Utama — 23/11/2026"), "Utama");
  assert.equal(variantOfTicketName("Tiket Jackpot — 23/11/2026"), "Jackpot");
  assert.equal(variantOfTicketName("AI Batch Parlay — 17/11/2026"), null);
  assert.equal(variantOfTicketName(null), null);
});

test("hit-rate, ROI satuan, dan selisih kalibrasi dihitung dari tiket settled saja", () => {
  const tickets: LiveTicketRow[] = [
    ticket("a", "Tiket Utama — 1/11/2026", "won", 0.10),
    ticket("b", "Tiket Utama — 2/11/2026", "lost", 0.20),
    ticket("c", "Tiket Utama — 3/11/2026", "active", 0.15),
  ];
  const legs: LiveTicketLegRow[] = [
    leg("a", 2.0, "WIN"), leg("a", 2.0, "WIN"), // gabungan 4.0
    leg("b", 1.5, "WIN"), leg("b", 1.5, "LOSS"),
    leg("c", 1.8, null),
  ];
  const report = buildLiveTicketReport(tickets, legs, { settled: 258, withClose: 0 });
  const utama = report.variants.find((v) => v.variant === "Utama")!;
  assert.equal(utama.recorded, 3);
  assert.equal(utama.active, 1);
  assert.equal(utama.settled, 2);
  assert.equal(utama.hitRate, 0.5);
  // payout: menang 4.0 + kalah 0 → ROI = 4/2 - 1 = +100%
  assert.equal(utama.roi, 1.0);
  // janji rata-rata tiket settled = (0.10+0.20)/2 = 0.15; aktual 0.5
  assert.ok(Math.abs((utama.avgPromisedProb ?? 0) - 0.15) < 1e-9);
  assert.ok(Math.abs((utama.calibrationGap ?? 0) - 0.35) < 1e-9);
  assert.equal(utama.sampleSufficient, false);
  assert.equal(utama.legHitRate, 0.75); // 3 hit dari 4 leg settled
  assert.equal(report.ledger.target, 300);
  assert.equal(report.ledger.pct, 86);
});

test("tiket serba-push membayar refund (ROI dihitung payout 1)", () => {
  const tickets: LiveTicketRow[] = [ticket("p", "Tiket Booster — 1/11/2026", "settled", 0.3)];
  const legs: LiveTicketLegRow[] = [leg("p", 2.0, "PUSH"), leg("p", 2.0, "PUSH")];
  const report = buildLiveTicketReport(tickets, legs, { settled: 0, withClose: 0 });
  const booster = report.variants.find((v) => v.variant === "Booster")!;
  assert.equal(booster.pushed, 1);
  assert.equal(booster.roi, 0);
  assert.equal(booster.hitRate, 0);
});

test("belum ada tiket settled → verdict menyatakan belum ada bukti, bukan nol persen", () => {
  const tickets: LiveTicketRow[] = [ticket("x", "Tiket Utama — 23/11/2026", "active", 0.1351)];
  const report = buildLiveTicketReport(tickets, [leg("x", 1.9, null)], { settled: 12, withClose: 0 });
  const utama = report.variants.find((v) => v.variant === "Utama")!;
  assert.equal(utama.hitRate, null);
  assert.equal(utama.roi, null);
  assert.match(report.verdict, /belum ada yang settled/);
  assert.equal(report.generatedFrom.legacyTickets, 0);
});

test("tiket legacy dihitung terpisah dan tidak mengotori varian", () => {
  const tickets: LiveTicketRow[] = [
    ticket("l1", "AI Batch Parlay — 17/11/2026", "lost", 0.38),
    ticket("u1", "Tiket Utama — 23/11/2026", "active", 0.13),
  ];
  const report = buildLiveTicketReport(tickets, [], { settled: 0, withClose: 0 });
  assert.equal(report.generatedFrom.legacyTickets, 1);
  assert.equal(report.generatedFrom.recordedTickets, 1);
});
