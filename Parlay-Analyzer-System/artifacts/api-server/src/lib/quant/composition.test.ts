import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildParlayComposition,
  screenCandidates,
  toParlayLegRows,
  MAX_LEGS,
  type CompositionCandidate,
} from "./composition";
import type { SelectionEval } from "./pipeline";

/** SelectionEval tiruan dengan hanya kolom yang dipakai komposisi. */
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
    evConservative: 0.01,
    sigma: 0.0286,
    stakePct: 0.02,
    minOdds: 1.5,
    passes: true,
    rejectReasons: [],
    ...overrides,
  };
}

function cand(
  fixtureId: number,
  overrides: Omit<Partial<CompositionCandidate>, "selection"> & { selection?: Partial<SelectionEval> } = {},
): CompositionCandidate {
  const { selection, ...rest } = overrides;
  return {
    marketKey: `over_2.5-${fixtureId}`,
    fixtureId,
    league: "england-premier-league",
    date: "2026-11-21",
    selection: sel(selection),
    ...rest,
  };
}

/* ─────────────────────── Penyaringan ─────────────────────── */

test("leg dengan EV konservatif ≤ 0 dibuang beserta alasannya", () => {
  const { eligible, rejected } = screenCandidates([
    cand(1, { selection: { evConservative: 0.02 } }),
    cand(2, { selection: { evConservative: -0.01 } }),
    cand(3, { selection: { evConservative: 0 } }),
  ]);

  assert.equal(eligible.length, 1);
  assert.equal(eligible[0]!.fixtureId, 1);
  assert.equal(rejected.length, 2);
  assert.ok(
    rejected.every((r) => r.reason.includes("EV konservatif ≤ 0")),
    "alasan penolakan harus bisa dibaca manusia",
  );
});

test("hanya satu leg per pertandingan; yang EV-nya lebih tinggi bertahan", () => {
  const { eligible, rejected } = screenCandidates([
    cand(1, { marketKey: "over_2.5", selection: { evConservative: 0.01 } }),
    cand(1, { marketKey: "btts_yes", selection: { evConservative: 0.04 } }),
  ]);

  assert.equal(eligible.length, 1);
  assert.equal(eligible[0]!.marketKey, "btts_yes", "EV konservatif 4% mengalahkan 1%");
  assert.equal(rejected.length, 1);
  assert.ok(rejected[0]!.reason.includes("saling bergantung"));
});

test("odds dan probabilitas tidak valid ditolak dengan sebab berbeda", () => {
  const { rejected } = screenCandidates([
    cand(1, { selection: { odds: 1 } }),
    cand(2, { selection: { pFinal: 1 } }),
    cand(3, { selection: { pFinal: 0 } }),
  ]);

  assert.equal(rejected.length, 3);
  assert.ok(rejected[0]!.reason.includes("odds"));
  assert.ok(rejected[1]!.reason.includes("probabilitas"));
  assert.ok(rejected[2]!.reason.includes("probabilitas"));
});

/* ─────────────────────── Komposisi ─────────────────────── */

test("kandidat kurang dari minimum: menolak, bukan memaksakan", () => {
  const result = buildParlayComposition([cand(1), cand(2)]);

  assert.equal(result.best, null);
  assert.equal(result.eligible, 2);
  assert.ok(
    result.notes.some((n) => n.includes("minimal")),
    "harus menjelaskan kenapa tidak ada parlay",
  );
});

test("menyusun parlay 3 leg dari kandidat yang layak", () => {
  const result = buildParlayComposition([
    cand(1, { selection: { evConservative: 0.05 } }),
    cand(2, { selection: { evConservative: 0.04 } }),
    cand(3, { selection: { evConservative: 0.03 } }),
    cand(4, { selection: { evConservative: 0.02 } }),
    cand(5, { selection: { evConservative: 0.01 } }),
  ]);

  assert.ok(result.best, "harus ada kombinasi terpilih");
  assert.ok(result.best!.legs.length >= 2 && result.best!.legs.length <= MAX_LEGS);
  assert.ok(result.best!.evDecision > 0, "EV keputusan harus positif");
  assert.ok(result.combinationsEvaluated > 0);
});

test("satu leg per pertandingan selalu terjaga di kombinasi akhir", () => {
  const result = buildParlayComposition([
    cand(1, { marketKey: "a", selection: { evConservative: 0.05 } }),
    cand(1, { marketKey: "b", selection: { evConservative: 0.04 } }),
    cand(2, { selection: { evConservative: 0.04 } }),
    cand(3, { selection: { evConservative: 0.03 } }),
  ]);

  assert.ok(result.best);
  const fixtures = result.best!.legs.map((l) => l.fixtureId);
  assert.equal(new Set(fixtures).size, fixtures.length, "tidak boleh ada fixture ganda");
});

test("korelasi menurunkan EV, bukan menaikkannya", () => {
  /* Dua parlay identik kecuali liga. Yang satu liga punya korelasi lebih
   * tinggi. Karena keputusan memakai min(p_independen, p_berkorelasi),
   * pCorrelated tidak boleh lebih besar dari pIndependent. */
  const sameLeague = buildParlayComposition([
    cand(1, { league: "serie-a", date: "2026-11-21" }),
    cand(2, { league: "serie-a", date: "2026-11-21" }),
    cand(3, { league: "serie-a", date: "2026-11-21" }),
  ]);

  assert.ok(sameLeague.best);
  assert.ok(
    sameLeague.best!.pDecision <= sameLeague.best!.pIndependent + 1e-9,
    "korelasi positif tidak boleh dipakai memperindah peluang",
  );
});

test("EV pesimis dan titik impas bias dilaporkan apa adanya", () => {
  const result = buildParlayComposition([
    cand(1, { selection: { evConservative: 0.06 } }),
    cand(2, { selection: { evConservative: 0.05 } }),
    cand(3, { selection: { evConservative: 0.04 } }),
  ]);

  assert.ok(result.best);
  assert.equal(typeof result.best!.evPessimistic, "number");
  assert.ok(result.best!.breakEvenBias >= -1);
  assert.ok(
    result.notes.some((n) => n.includes("overestimasi")),
    "titik impas bias harus dijelaskan ke pembaca",
  );
});

test("selalu menyatakan bahwa prior korelasi masih heuristik", () => {
  const result = buildParlayComposition([
    cand(1, { selection: { evConservative: 0.06 } }),
    cand(2, { selection: { evConservative: 0.05 } }),
    cand(3, { selection: { evConservative: 0.04 } }),
  ]);

  assert.ok(
    result.notes.some((n) => n.includes("heuristik")),
    "jangan pernah membiarkan angka ini dibaca sebagai jaminan",
  );
});

test("maksimum leg tidak pernah melebihi 5", () => {
  const many = Array.from({ length: 12 }, (_, i) =>
    cand(i + 1, { selection: { evConservative: 0.05 - i * 0.001 } }),
  );
  const result = buildParlayComposition(many);

  assert.ok(result.best);
  assert.ok(result.best!.legs.length <= MAX_LEGS, `maksimum ${MAX_LEGS} leg`);
});

test("pembatasan jumlah kandidat dilaporkan, bukan disembunyikan", () => {
  const many = Array.from({ length: 40 }, (_, i) => cand(i + 1, { selection: { evConservative: 0.05 } }));
  const result = buildParlayComposition(many, { maxCandidates: 10 });

  assert.ok(
    result.notes.some((n) => n.includes("pembatasan waktu")),
    "harus jujur bahwa sebagian kandidat tidak dievaluasi",
  );
});

test("tidak ada kombinasi EV positif: menolak dengan penjelasan", () => {
  /* Harga terlalu rendah dibanding probabilitas → tidak ada yang lolos. */
  const result = buildParlayComposition([
    cand(1, { selection: { evConservative: 0.001, odds: 1.01, pFinal: 0.5 } }),
    cand(2, { selection: { evConservative: 0.001, odds: 1.01, pFinal: 0.5 } }),
    cand(3, { selection: { evConservative: 0.001, odds: 1.01, pFinal: 0.5 } }),
  ]);

  if (result.best === null) {
    assert.ok(
      result.notes.some((n) => n.includes("menolak") || n.includes("EV positif")),
      "penolakan harus punya alasan yang bisa dibaca",
    );
  } else {
    /* Kalau ternyata lolos, minimal EV-nya harus benar-benar positif. */
    assert.ok(result.best.evDecision > 0);
  }
});

/* ─────────────────────── Jembatan DB ─────────────────────── */

test("baris parlay_legs diberi urutan dan mengikuti bentuk kolom tabel", () => {
  const result = buildParlayComposition([
    cand(1, { selection: { evConservative: 0.06 } }),
    cand(2, { selection: { evConservative: 0.05 } }),
    cand(3, { selection: { evConservative: 0.04 } }),
  ]);

  assert.ok(result.best);
  const rows = toParlayLegRows(result.best!, "parlay-1", { now: "2026-11-11T00:00:00Z" });

  assert.equal(rows.length, result.best!.legs.length);
  rows.forEach((row, index) => {
    assert.equal(row.parlay_id, "parlay-1");
    assert.equal(row.leg_order, index + 1);
    assert.equal(row.result, null);
    assert.equal(row.created_at, "2026-11-11T00:00:00Z");
    assert.ok(row.odds > 1);
    assert.ok(row.probability > 0 && row.probability < 1);
  });
});
