import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchLeagueEvents } from "./odds-fetcher";

/**
 * Verifikasi bahwa permintaan `/events` benar-benar memakai `limit=200` dan
 * berpindah halaman lewat `skip`. Tanpa `limit`, penyedia hanya mengembalikan
 * 20 event terdekat — itulah akar masalah jadwal yang tidak pernah jauh ke
 * depan.
 */
test("paginasikan /events dengan limit 200 dan skip bertingkat", async () => {
  const urls: string[] = [];
  const realFetch = globalThis.fetch;

  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    urls.push(url);
    const parsed = new URL(url);
    const skip = Number(parsed.searchParams.get("skip") ?? 0);
    const limit = Number(parsed.searchParams.get("limit") ?? 0);
    /* Halaman pertama penuh (200), halaman kedua hanya 5 → berhenti. */
    const count = skip === 0 ? limit : Math.min(limit, 5);
    const events = Array.from({ length: count }, (_, i) => ({
      id: 900000 + skip + i,
      home: "Home",
      away: "Away",
      date: "2027-01-01T15:00:00Z",
      status: "pending",
    }));
    return new Response(JSON.stringify(events), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  try {
    const events = await fetchLeagueEvents("england-premier-league", "kunci-uji");
    assert.equal(events.length, 205);
    assert.equal(new Set(events.map((e) => e.id)).size, 205);
    assert.equal(urls.length, 2);

    const first = new URL(urls[0]!);
    assert.equal(first.pathname, "/v3/events");
    assert.equal(first.searchParams.get("limit"), "200");
    assert.equal(first.searchParams.get("skip"), "0");
    assert.equal(first.searchParams.get("status"), "pending");
    assert.equal(first.searchParams.get("sport"), "football");
    assert.equal(first.searchParams.get("league"), "england-premier-league");

    assert.equal(new URL(urls[1]!).searchParams.get("skip"), "200");
  } finally {
    globalThis.fetch = realFetch;
  }
});
