import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildAutomationStatus,
  estimateRunsPerDay,
  HOBBY_CRON_LIMIT,
  REQUIRED_SCHEDULED_ACTIONS,
} from "./automation-status";

/** Klien tiruan: hanya dibutuhkan dua hitungan `fixtures`. */
function fakeClient(counts: { past?: number; scored?: number }) {
  return {
    from() {
      let notNull = false;
      const builder: any = {
        select() {
          return builder;
        },
        lt() {
          return builder;
        },
        not() {
          notNull = true;
          return builder;
        },
        then(resolve: (v: unknown) => void) {
          const count = notNull ? (counts.scored ?? 0) : (counts.past ?? 0);
          resolve({ count, error: null });
        },
      };
      return builder;
    },
  } as any;
}

const VERCEL_SYNC_ONLY = [{ path: "/api/cron?action=sync", schedule: "0 6 * * *" }];

test("menghitung frekuensi harian dari ekspresi cron", () => {
  assert.equal(estimateRunsPerDay("0 6 * * *"), 1, "sekali sehari");
  assert.equal(estimateRunsPerDay("0 * * * *"), 24, "tiap jam");
  assert.equal(estimateRunsPerDay("*/5 * * * *"), 288, "tiap 5 menit");
  assert.equal(estimateRunsPerDay("30 2 * * 1"), 1, "mingguan dihitung konservatif 1");
  assert.equal(estimateRunsPerDay("ekspresi rusak"), 1, "tidak dikenali → konservatif");
});

test("sync saja tidak cukup — hasil, closing, dan outcomes dilaporkan sebagai celah", async () => {
  const status = await buildAutomationStatus({
    vercelCrons: VERCEL_SYNC_ONLY,
    supabase: fakeClient({}),
  });

  const missing = status.gaps.map((gap) => gap.action);
  assert.ok(missing.includes("results"), "penarikan hasil harus dilaporkan hilang");
  assert.ok(missing.includes("closing"), "closing odds harus dilaporkan hilang");
  assert.ok(missing.includes("outcomes"), "outcome harus dilaporkan hilang");
  assert.ok(!missing.includes("sync"), "sync sudah terjadwal, bukan celah");
  assert.deepEqual(status.coveredByVercel, ["sync"]);
});

test("jadwal node-cron tidak dihitung sebagai cakupan di Vercel", async () => {
  /* Kondisi nyata: scheduler/index.ts memang menjadwalkan settlement,
     tetapi scheduler itu tidak pernah hidup di serverless. */
  const status = await buildAutomationStatus({
    vercelCrons: VERCEL_SYNC_ONLY,
    nodeCronSchedules: [{ action: "results", schedule: "0 6 * * *" }],
    supabase: fakeClient({}),
  });

  const results = status.gaps.find((gap) => gap.action === "results");
  assert.ok(results, "results tetap harus muncul sebagai celah");
  assert.equal(results!.onlyOnDeadScheduler, true);
  assert.equal(results!.unscheduled, false);
  assert.ok(
    status.notes.some((note) => note.includes("tidak hidup di Vercel")),
    "sebabnya harus dijelaskan, bukan sekadar ditandai",
  );
});

test("celah yang sama sekali tidak terjadwal ditandai berbeda", async () => {
  const status = await buildAutomationStatus({
    vercelCrons: VERCEL_SYNC_ONLY,
    supabase: fakeClient({}),
  });

  const results = status.gaps.find((gap) => gap.action === "results")!;
  assert.equal(results.unscheduled, true);
  assert.equal(results.onlyOnDeadScheduler, false);
});

test("dampak nyata dilaporkan sebagai angka fixture, bukan peringatan umum", async () => {
  const status = await buildAutomationStatus({
    vercelCrons: VERCEL_SYNC_ONLY,
    supabase: fakeClient({ past: 894, scored: 77 }),
  });

  assert.equal(status.fixturesAwaitingScore, 817);
  assert.ok(
    status.notes.some((note) => note.includes("817 fixture")),
    "angka dampak harus muncul di catatan",
  );
});

test("batas Hobby dilaporkan saat slot cron habis", async () => {
  const status = await buildAutomationStatus({
    vercelCrons: [
      { path: "/api/cron?action=sync", schedule: "0 6 * * *" },
      { path: "/api/cron?action=results", schedule: "0 7 * * *" },
    ],
    supabase: fakeClient({}),
  });

  assert.equal(status.atHobbyLimit, true);
  assert.ok(status.notes.some((note) => note.includes(`${HOBBY_CRON_LIMIT}/${HOBBY_CRON_LIMIT}`)));
});

test("aksi gabungan `daily` menutup semua kebutuhan dalam satu slot cron", async () => {
  /* Inilah bentuk yang dipakai produksi: Vercel Hobby hanya memberi dua slot,
     jadi sync + results + closing + outcomes harus menumpang di satu aksi. */
  const status = await buildAutomationStatus({
    vercelCrons: [{ path: "/api/cron?action=daily", schedule: "0 6 * * *" }],
    supabase: fakeClient({}),
  });

  assert.deepEqual(status.gaps, [], "tidak boleh ada celah bila `daily` menutup semuanya");
  assert.deepEqual(
    status.coveredByVercel.sort(),
    [...REQUIRED_SCHEDULED_ACTIONS].sort(),
    "semua aksi wajib harus tercatat tercakup",
  );
});

test("aksi tunggal tetap dilaporkan sebagai celah meski ada di dekat `daily`", async () => {
  /* Pengaman: hanya `daily` yang boleh menutup banyak tugas. Aksi lain tidak
     mendapat perlakuan khusus, supaya laporan tidak menutupi celah nyata. */
  const status = await buildAutomationStatus({
    vercelCrons: [{ path: "/api/cron?action=sync", schedule: "0 6 * * *" }],
    supabase: fakeClient({}),
  });

  assert.deepEqual(status.coveredByVercel, ["sync"]);
  assert.equal(status.gaps.length, 3);
});

test("supabase tidak tersedia tidak menggagalkan laporan", async () => {
  const status = await buildAutomationStatus({
    vercelCrons: VERCEL_SYNC_ONLY,
    supabase: null as any,
  });

  assert.equal(status.fixturesAwaitingScore, 0);
  assert.ok(status.gaps.length > 0, "celah tetap terdeteksi tanpa database");
});
