import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { recoverStaleScanJob } from "./scan-job-status";

/*
 * Regresi 13 Nov 2026: job scan yatim "running" selamanya setelah
 * instance mati di tengah panggilan AI (berhenti di 93/151).
 */
const STALE = 3 * 60 * 1000;
const base = { status: "running", pending: [11, 12], updatedAt: new Date(1_000_000).toISOString() };

describe("recoverStaleScanJob", () => {
  it("job running yang membeku dengan antrean → partial", () => {
    const { job, recovered } = recoverStaleScanJob(base, 1_000_000 + STALE + 1, STALE);
    assert.equal(recovered, true);
    assert.equal(job.status, "partial");
    assert.deepEqual(job.pending, [11, 12]);
  });

  it("job running yang membeku tanpa antrean → failed", () => {
    const { job, recovered } = recoverStaleScanJob(
      { ...base, pending: [] },
      1_000_000 + STALE + 1,
      STALE,
    );
    assert.equal(recovered, true);
    assert.equal(job.status, "failed");
  });

  it("job running yang masih segar tidak disentuh", () => {
    const { job, recovered } = recoverStaleScanJob(base, 1_000_000 + STALE - 1, STALE);
    assert.equal(recovered, false);
    assert.equal(job.status, "running");
  });

  it("job yang sudah selesai tidak disentuh", () => {
    const done = { ...base, status: "completed" };
    const { job, recovered } = recoverStaleScanJob(done, 1_000_000 + STALE * 10, STALE);
    assert.equal(recovered, false);
    assert.equal(job.status, "completed");
  });
});
