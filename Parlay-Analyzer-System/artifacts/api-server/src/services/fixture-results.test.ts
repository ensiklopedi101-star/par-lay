import { test } from "node:test";
import assert from "node:assert/strict";
import { refreshElapsedFixtureResults, HISTORICAL_WINDOW_DAYS } from "./fixture-results";

/**
 * Klien tiruan minimal untuk `fixtures`.
 *
 * Cukup meniru PostgREST: `select(...)` → rantai filter → hasil akhir
 * `{ data }` atau `{ count }` untuk `head: true`.
 */
function fakeClient(state: {
  /** Fixture lewat tanpa skor, urut dari yang paling baru. */
  waiting?: Array<{ fixture_id: number; fixture_date: string }>;
  /** Fixture lewat tanpa skor yang lebih tua dari jendela historis. */
  tooOld?: number;
}) {
  const waiting = state.waiting ?? [];

  return {
    from(table: string) {
      if (table !== "fixtures") throw new Error(`tabel tak terduga: ${table}`);

      const filters: { head: boolean; lteWindow: boolean; ltNow: boolean; isNull: boolean } = {
        head: false,
        lteWindow: false,
        ltNow: false,
        isNull: false,
      };

      const builder: any = {
        select(_cols: string, opts?: { count?: string; head?: boolean }) {
          filters.head = Boolean(opts?.head);
          return builder;
        },
        lt(_col: string, value: string) {
          /* Dua pemakaian `lt(fixture_date, ...)`: batas "sekarang" dan batas
             jendela 31 hari. Dibedakan dari selisih harinya. */
          const days = (Date.now() - new Date(value).getTime()) / 86_400_000;
          if (days > HISTORICAL_WINDOW_DAYS - 1) filters.lteWindow = true;
          else filters.ltNow = true;
          return builder;
        },
        gte() {
          return builder;
        },
        is() {
          filters.isNull = true;
          return builder;
        },
        order() {
          return builder;
        },
        limit(n: number) {
          /* Kueri data: kembalikan baris. Kueri hitung memakai `head: true`
             dan tidak pernah memanggil `limit()` di modul ini. */
          return Promise.resolve({ data: waiting.slice(0, n), error: null });
        },
        then(resolve: (v: unknown) => void) {
          /* Hanya kueri `head: true` yang menghasilkan `{ count }`. */
          if (!filters.head) {
            resolve({ data: waiting, error: null });
            return;
          }
          let count = 0;
          if (filters.lteWindow) count = state.tooOld ?? 0;
          else if (filters.ltNow && filters.isNull) count = waiting.length + (state.tooOld ?? 0);
          resolve({ count, error: null });
        },
      };
      return builder;
    },
  } as any;
}

const past = (daysAgo: number, id: number) => ({
  fixture_id: id,
  fixture_date: new Date(Date.now() - daysAgo * 86_400_000).toISOString(),
});

test("menarik skor untuk fixture lewat yang belum berskor", async () => {
  const client = fakeClient({ waiting: [past(1, 101), past(2, 102), past(3, 103)], tooOld: 0 });
  const seen: number[][] = [];

  const summary = await refreshElapsedFixtureResults({
    supabase: client,
    refresh: async (ids) => {
      seen.push(ids);
      return { refreshed: 2, notFound: 1, skipped: 0, errors: 0 };
    },
  });

  assert.equal(summary.candidates, 3);
  assert.equal(summary.refreshed, 2);
  assert.equal(summary.notFound, 1);
  assert.deepEqual(seen[0], [101, 102, 103]);
});

test("fixture tanpa skor karena penyedia belum menerbitkan bukan dianggap error", async () => {
  const client = fakeClient({ waiting: [past(0.2, 201)], tooOld: 0 });

  const summary = await refreshElapsedFixtureResults({
    supabase: client,
    refresh: async () => ({ refreshed: 0, notFound: 0, skipped: 1, errors: 0 }),
  });

  assert.equal(summary.errors, 0);
  assert.equal(summary.refreshed, 0);
  assert.ok(
    summary.notes.some((note) => note.includes("tidak ada yang menghasilkan skor")),
    "harus menjelaskan bahwa hasil belum terbit",
  );
});

test("fixture di luar jendela 31 hari dilaporkan, bukan dilewati diam-diam", async () => {
  /* Semua yang menunggu sudah terlalu tua → tidak ada kandidat, tapi angkanya jujur. */
  const client = fakeClient({ waiting: [], tooOld: 589 });

  const summary = await refreshElapsedFixtureResults({ supabase: client });

  assert.equal(summary.candidates, 0);
  assert.equal(summary.tooOld, 589);
  assert.ok(
    summary.notes.some((note) => note.includes("lebih tua dari")),
    "harus menyebut batas historis dan saran isi manual",
  );
});

test("batas per putaran dihormati dan tidak pernah melebihi maksimum", async () => {
  const many = Array.from({ length: 400 }, (_, i) => past(1, 1000 + i));
  const client = fakeClient({ waiting: many, tooOld: 0 });
  let requested = 0;

  await refreshElapsedFixtureResults({
    supabase: client,
    // Nilai yang terlalu besar harus dipangkas ke batas modul.
    limit: 5000,
    refresh: async (ids) => {
      requested = ids.length;
      return { refreshed: ids.length, notFound: 0, skipped: 0, errors: 0 };
    },
  });

  assert.equal(requested, 120, "maksimum 120 fixture per putaran");
});

test("supabase tidak tersedia: mengembalikan catatan, bukan melempar", async () => {
  const summary = await refreshElapsedFixtureResults({ supabase: null as any });

  assert.equal(summary.refreshed, 0);
  assert.ok(summary.notes.some((note) => note.includes("Supabase tidak tersedia")));
});

test("kegagalan penyedia dilaporkan sebagai error, bukan crash", async () => {
  const client = fakeClient({ waiting: [past(1, 301)], tooOld: 0 });

  const summary = await refreshElapsedFixtureResults({
    supabase: client,
    refresh: async () => {
      throw new Error("koneksi putus");
    },
  });

  assert.equal(summary.errors, 1);
  assert.ok(summary.notes.some((note) => note.includes("koneksi putus")));
});

test("tidak pernah mengklaim mengarang hasil", async () => {
  const client = fakeClient({ waiting: [past(1, 401)], tooOld: 0 });
  const summary = await refreshElapsedFixtureResults({
    supabase: client,
    refresh: async () => ({ refreshed: 1, notFound: 0, skipped: 0, errors: 0 }),
  });

  assert.ok(
    summary.notes.some((note) => note.includes("tidak pernah mengarang hasil")),
    "jaminan kejujuran harus tertulis di keluaran",
  );
});
