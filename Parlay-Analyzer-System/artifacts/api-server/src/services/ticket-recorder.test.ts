import { test } from "node:test";
import assert from "node:assert/strict";
import { recordVariantTickets, ticketSignature } from "./ticket-recorder";

/**
 * Supabase palsu minimal untuk ticket-recorder: meniru rantai
 * select/in/gte, insert().select().single(), dan insert legs.
 */
function makeFakeSupabase() {
  const parlays: Array<Record<string, unknown>> = [];
  const legs: Array<Record<string, unknown>> = [];
  let seq = 0;

  function query(table: string) {
    const rows = table === "parlays" ? parlays : legs;
    const filters: Array<(r: Record<string, unknown>) => boolean> = [];
    const builder: any = {
      select: () => builder,
      in: (col: string, values: unknown[]) => {
        const set = new Set(values.map(String));
        filters.push((r) => set.has(String(r[col])));
        return builder;
      },
      gte: (col: string, value: unknown) => {
        filters.push((r) => new Date(String(r[col])).getTime() >= new Date(String(value)).getTime());
        return builder;
      },
      insert: (payload: Record<string, unknown> | Array<Record<string, unknown>>) => {
        if (Array.isArray(payload)) {
          legs.push(...payload);
          return Promise.resolve({ error: null });
        }
        const row = { id: `p-${++seq}`, ...payload };
        parlays.push(row);
        return {
          select: () => ({
            single: () => Promise.resolve({ data: { id: row.id }, error: null }),
          }),
        };
      },
      then: (resolve: (v: unknown) => void) => {
        resolve({ data: rows.filter((r) => filters.every((f) => f(r))), error: null });
      },
    };
    return builder;
  }

  return { client: { from: (t: string) => query(t) } as any, parlays, legs };
}

const FRIENDLY: Record<string, string> = {
  "TOT:over:2.5": "Over 2.5 Goals",
  "BTTS:yes": "BTTS Yes",
  "ML:home": "Home Win",
};

function fakeTicket(marketKeys: string[]): any {
  return {
    legs: marketKeys.map((marketKey, i) => ({
      marketKey,
      fixtureId: 100 + i,
      league: "Test League",
      displayLabel: FRIENDLY[marketKey] ?? marketKey,
      pUsed: 0.6,
      selection: { odds: 1.5 },
    })),
    combinedOdds: 4.2,
    pCombined: 0.22,
    evVsBook: -0.05,
    notes: ["catatan uji"],
  };
}

function fakeVariants(utamaLegs: string[] | null): any {
  return {
    utama: utamaLegs ? fakeTicket(utamaLegs) : null,
    booster: null,
    jackpot: null,
    variantNotes: { utama: null, booster: "tidak ada penguat", jackpot: "tidak cukup leg" },
  };
}

test("tanda tangan stabil terhadap urutan leg", () => {
  const a = ticketSignature("utama", [
    { fixtureId: 2, marketKey: "BTTS:yes" },
    { fixtureId: 1, marketKey: "TOT:over:2.5" },
  ]);
  const b = ticketSignature("utama", [
    { fixtureId: 1, marketKey: "TOT:over:2.5" },
    { fixtureId: 2, marketKey: "BTTS:yes" },
  ]);
  assert.equal(a, b);
});

test("tiket tercatat dengan generated_by MARKET_FIRST dan leg prediction_id null", async () => {
  const fake = makeFakeSupabase();
  const result = await recordVariantTickets(fakeVariants(["TOT:over:2.5", "BTTS:yes"]), {
    supabase: fake.client,
    now: new Date("2026-11-23T08:00:00Z"),
  });
  assert.equal(result.recorded.length, 1);
  assert.equal(result.recorded[0]!.variant, "utama");
  assert.equal(fake.parlays[0]!["generated_by"], "MARKET_FIRST_UTAMA");
  assert.equal(fake.legs.length, 2);
  assert.equal(fake.legs[0]!["prediction_id"], null);
  assert.equal(fake.legs[0]!["market"], "Over 2.5 Goals");
});

test("isi sama di hari yang sama tidak dicatat dua kali; isi berubah tercatat baru", async () => {
  const fake = makeFakeSupabase();
  const now = new Date("2026-11-23T08:00:00Z");
  await recordVariantTickets(fakeVariants(["TOT:over:2.5", "BTTS:yes"]), { supabase: fake.client, now });
  const second = await recordVariantTickets(fakeVariants(["TOT:over:2.5", "BTTS:yes"]), { supabase: fake.client, now });
  assert.equal(second.recorded.length, 0);
  assert.match(second.skipped.find((s) => s.variant === "utama")!.reason, /sama persis/);
  const changed = await recordVariantTickets(fakeVariants(["TOT:over:2.5", "ML:home"]), { supabase: fake.client, now });
  assert.equal(changed.recorded.length, 1);
  assert.equal(fake.parlays.length, 2);
});
