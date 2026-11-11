import { test } from "node:test";
import assert from "node:assert/strict";
import { composeAndSaveParlay, COMPOSER_GENERATED_BY } from "./parlay-composer";
import type { CompositionCandidate } from "../lib/quant/composition";
import type { SelectionEval } from "../lib/quant/pipeline";

function sel(overrides: Partial<SelectionEval> = {}): SelectionEval {
  return {
    key: "over_2.5",
    label: "Over 2.5",
    family: "Totals",
    odds: 1.9,
    line: 2.5,
    pFinal: 0.56,
    pMarket: 0.53,
    pModelOnly: 0.58,
    outcome: "win" as never,
    ev: 0.064,
    evConservative: 0.02,
    sigma: 0.0286,
    stakePct: 0.02,
    minOdds: 1.5,
    passes: true,
    rejectReasons: [],
    ...overrides,
  };
}

function cand(fixtureId: number, ev = 0.02): CompositionCandidate {
  return {
    marketKey: `over_2.5-${fixtureId}`,
    fixtureId,
    league: "england-premier-league",
    date: "2026-11-21",
    selection: sel({ evConservative: ev }),
  };
}

/**
 * Klien tiruan yang mencatat apa yang ditulis.
 *
 * Meniru cukup banyak perilaku supaya jalur sukses dan jalur gagal bisa
 * dibedakan tanpa database sungguhan.
 */
function recordingClient(state: {
  failParlayInsert?: boolean;
  failLegInsert?: boolean;
} = {}) {
  const writes: Array<{ table: string; rows: any }> = [];
  const deletes: Array<{ table: string; id: unknown }> = [];

  return {
    writes,
    deletes,
    from(table: string) {
      const builder: any = {
        insert(rows: any) {
          writes.push({ table, rows });
          const failing =
            table === "parlays" ? state.failParlayInsert : state.failLegInsert;
          const outcome = {
            data: failing ? null : table === "parlays" ? { id: "parlay-abc" } : null,
            error: failing ? { message: "insert ditolak" } : null,
          };
          const result: any = {
            /* Bentuk PostgREST: insert().select().single() */
            select: () => ({ single: () => Promise.resolve(outcome) }),
            /* insert() tanpa select() langsung di-await */
            then: (resolve: (v: unknown) => void) => resolve({ error: outcome.error }),
          };
          return result;
        },
        delete() {
          return {
            eq: (_col: string, id: unknown) => {
              deletes.push({ table, id });
              return Promise.resolve({ error: null });
            },
          };
        },
      };
      return builder;
    },
  } as any;
}

test("menyimpan parlay beserta leg saat kombinasi layak", async () => {
  const client = recordingClient();
  const result = await composeAndSaveParlay([cand(1, 0.05), cand(2, 0.04), cand(3, 0.03)], {
    client,
    seed: 1,
  });

  assert.equal(result.saved, true);
  assert.equal(result.parlayId, "parlay-abc");
  assert.equal(result.note, null);

  const parlayWrite = client.writes.find((w: any) => w.table === "parlays");
  assert.ok(parlayWrite, "harus menulis ke tabel parlays");
  assert.equal(parlayWrite.rows.generated_by, COMPOSER_GENERATED_BY);
  assert.equal(parlayWrite.rows.status, "active");
  assert.ok(parlayWrite.rows.expected_value > 0);

  const legWrite = client.writes.find((w: any) => w.table === "parlay_legs");
  assert.ok(legWrite, "harus menulis ke tabel parlay_legs");
  assert.equal(legWrite.rows.length, result.composition.best!.legs.length);
});

test("alasan yang disimpan berasal dari angka, bukan narasi", async () => {
  const client = recordingClient();
  await composeAndSaveParlay([cand(1, 0.05), cand(2, 0.04), cand(3, 0.03)], { client, seed: 1 });

  const parlayWrite = client.writes.find((w: any) => w.table === "parlays");
  const reasoning: string = parlayWrite.rows.reasoning;

  assert.ok(reasoning.includes("kombinasi diuji"), "harus menyebut jumlah kombinasi");
  assert.ok(reasoning.includes("Odds gabungan"), "harus menyebut odds gabungan");
  assert.ok(reasoning.includes("Toleransi overestimasi"));
  assert.ok(reasoning.includes("heuristik"), "batas kejujuran harus ikut tersimpan");
});

test("tidak ada kombinasi layak: tidak menulis apa pun ke database", async () => {
  const client = recordingClient();
  const result = await composeAndSaveParlay([cand(1), cand(2)], { client });

  assert.equal(result.saved, false);
  assert.equal(result.parlayId, null);
  assert.ok(result.note, "harus menjelaskan kenapa tidak ada parlay");
  assert.equal(client.writes.length, 0, "tidak boleh menyimpan parlay kosong/gagal");
});

test("supabase tidak tersedia: komposisi tetap dilaporkan", async () => {
  const result = await composeAndSaveParlay([cand(1, 0.05), cand(2, 0.04), cand(3, 0.03)], {
    client: null as any,
    seed: 1,
  });

  assert.equal(result.saved, false);
  assert.ok(result.composition.best, "kombinasi tetap disusun walau tidak disimpan");
  assert.ok(result.note!.includes("Supabase tidak tersedia"));
});

test("gagal menyimpan leg: parlay dihapus lagi, tidak ditinggal tanpa leg", async () => {
  const client = recordingClient({ failLegInsert: true });
  const result = await composeAndSaveParlay([cand(1, 0.05), cand(2, 0.04), cand(3, 0.03)], {
    client,
    seed: 1,
  });

  assert.equal(result.saved, false);
  assert.equal(result.parlayId, null);
  assert.ok(result.note!.includes("dibatalkan"));
  assert.deepEqual(client.deletes, [{ table: "parlays", id: "parlay-abc" }]);
});

test("gagal menyimpan parlay: tidak mencoba menulis leg", async () => {
  const client = recordingClient({ failParlayInsert: true });
  const result = await composeAndSaveParlay([cand(1, 0.05), cand(2, 0.04), cand(3, 0.03)], {
    client,
    seed: 1,
  });

  assert.equal(result.saved, false);
  assert.equal(client.deletes.length, 0, "tidak ada parlay untuk dihapus");
  assert.ok(!client.writes.some((w: any) => w.table === "parlay_legs"));
});

test("hasil komposisi bisa direproduksi dengan benih yang sama", async () => {
  const candidates = [cand(1, 0.05), cand(2, 0.04), cand(3, 0.03), cand(4, 0.025)];
  const a = await composeAndSaveParlay(candidates, { client: recordingClient(), seed: 42 });
  const b = await composeAndSaveParlay(candidates, { client: recordingClient(), seed: 42 });

  assert.deepEqual(
    a.composition.best!.legs.map((l) => l.fixtureId),
    b.composition.best!.legs.map((l) => l.fixtureId),
    "benih sama harus menghasilkan leg yang sama",
  );
  assert.equal(a.composition.best!.evDecision, b.composition.best!.evDecision);
});
