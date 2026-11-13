import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { collectPagedRows } from "./odds-history";

/*
 * Regresi scan 13 Nov 2026: query odds batch tanpa paginasi terpotong di
 * 1000 baris PostgREST (hanya ±23 match), sehingga 137 fixture salah
 * dinyatakan "menunggu odds". Helper ini wajib menguras semua halaman.
 */
describe("collectPagedRows", () => {
  it("menguras semua halaman sampai halaman pendek", async () => {
    const all = Array.from({ length: 2350 }, (_, i) => i);
    const rows = await collectPagedRows<number>(async (from, to) => ({
      data: all.slice(from, to + 1),
      error: null,
    }), 1000);
    assert.equal(rows.length, 2350);
    assert.equal(rows[2349], 2349);
  });

  it("berhenti setelah satu halaman bila kurang dari pageSize", async () => {
    let calls = 0;
    const rows = await collectPagedRows<number>(async () => {
      calls++;
      return { data: [1, 2, 3], error: null };
    }, 1000);
    assert.deepEqual(rows, [1, 2, 3]);
    assert.equal(calls, 1);
  });

  it("melempar error dari fetchPage", async () => {
    await assert.rejects(
      collectPagedRows<number>(async () => ({ data: null, error: new Error("postgrest down") })),
      /postgrest down/,
    );
  });

  it("menghormati maxPages sebagai pengaman", async () => {
    const rows = await collectPagedRows<number>(async (from, to) => ({
      data: Array.from({ length: to - from + 1 }, (_, i) => from + i),
      error: null,
    }), 100, 3);
    assert.equal(rows.length, 300);
  });
});
