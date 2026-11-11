import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSettlementSummary } from "./settlement-summary";

/**
 * Klien tiruan minimal: cukup untuk `select(..., { count, head })` plus
 * rantai filter yang dipakai modul ini. Bentuk ini sengaja meniru perilaku
 * PostgREST — hasil akhirnya `{ count, error }`.
 */
function fakeClient(counts: {
  predictionsTotal?: number;
  predictionsSettled?: number;
  predictionsNoBet?: number;
  selectionsTotal?: number;
  selectionsWithOutcome?: number;
  selectionsWithClose?: number;
  selectionsBet?: number;
  fixturesPast?: number;
  fixturesScored?: number;
  outcomes?: { outcome: string }[];
}) {
  return {
    from(table: string) {
      const filters: string[] = [];
      const builder: any = {
        select() {
          return builder;
        },
        in() {
          filters.push("in");
          return builder;
        },
        eq() {
          filters.push("eq");
          return builder;
        },
        not() {
          filters.push("not");
          return builder;
        },
        lt() {
          filters.push("lt");
          return builder;
        },
        limit() {
          return Promise.resolve({ data: counts.outcomes ?? [], error: null });
        },
        then(resolve: (v: unknown) => void) {
          let count = 0;
          if (table === "ai_predictions") {
            count = filters.includes("in")
              ? (counts.predictionsSettled ?? 0)
              : filters.includes("eq")
                ? (counts.predictionsNoBet ?? 0)
                : (counts.predictionsTotal ?? 0);
          } else if (table === "prediction_selections") {
            count = filters.includes("not")
              ? filters.includes("eq")
                ? (counts.selectionsBet ?? 0)
                : (counts.selectionsWithOutcome ?? 0)
              : (counts.selectionsTotal ?? 0);
          } else if (table === "fixtures") {
            count =
              filters.includes("not") && filters.includes("lt")
                ? (counts.fixturesScored ?? 0)
                : (counts.fixturesPast ?? 0);
          }
          resolve({ count, error: null });
        },
      };
      return builder;
    },
  } as never;
}

test("menghitung pending dari total dikurangi settled dan no_bet", async () => {
  const summary = await buildSettlementSummary({
    supabase: fakeClient({
      predictionsTotal: 81,
      predictionsSettled: 63,
      predictionsNoBet: 14,
    }),
  });
  assert.equal(summary.predictions.total, 81);
  assert.equal(summary.predictions.settled, 63);
  assert.equal(summary.predictions.noBet, 14);
  assert.equal(summary.predictions.pending, 4);
});

test("pending tidak pernah negatif meski data tidak konsisten", async () => {
  const summary = await buildSettlementSummary({
    supabase: fakeClient({
      predictionsTotal: 10,
      predictionsSettled: 9,
      predictionsNoBet: 9,
    }),
  });
  assert.equal(summary.predictions.pending, 0);
});

test("ledger kosong memunculkan catatan yang bisa dibaca manusia", async () => {
  const summary = await buildSettlementSummary({
    supabase: fakeClient({ selectionsTotal: 0 }),
  });
  assert.equal(summary.selections.total, 0);
  assert.ok(
    summary.notes.some((n) => n.includes("masih kosong")),
    "harus menjelaskan bahwa ledger kosong",
  );
});

test("menjelaskan odds_close kosong dan outcome kosong secara terpisah", async () => {
  const summary = await buildSettlementSummary({
    supabase: fakeClient({
      selectionsTotal: 20,
      selectionsWithOutcome: 0,
      selectionsWithClose: 0,
    }),
  });
  assert.ok(summary.notes.some((n) => n.includes("outcome")));
  assert.ok(summary.notes.some((n) => n.includes("odds_close")));
});

test("menghitung fixture lewat tanpa skor sebagai penghalang settlement", async () => {
  const summary = await buildSettlementSummary({
    supabase: fakeClient({ fixturesPast: 894, fixturesScored: 0 }),
  });
  assert.equal(summary.fixturesMissingScore, 894);
  assert.ok(summary.notes.some((n) => n.includes("belum punya skor akhir")));
});

test("menjumlahkan sebaran outcome dari baris ledger", async () => {
  const summary = await buildSettlementSummary({
    supabase: fakeClient({
      selectionsTotal: 5,
      selectionsWithOutcome: 5,
      outcomes: [
        { outcome: "win" },
        { outcome: "win" },
        { outcome: "loss" },
        { outcome: "push" },
        { outcome: "loss" },
      ],
    }),
  });
  assert.deepEqual(summary.outcomes, [
    { outcome: "win", count: 2 },
    { outcome: "loss", count: 2 },
    { outcome: "push", count: 1 },
  ]);
});

test("tanpa Supabase mengembalikan ringkasan kosong, bukan melempar", async () => {
  const summary = await buildSettlementSummary({ supabase: null as never });
  assert.equal(summary.predictions.total, 0);
  assert.equal(summary.selections.total, 0);
  assert.ok(summary.notes.length > 0);
});
