import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchEventsOddsMulti } from "./odds-fetcher";

test("/odds/multi: maksimal 10 id, filter markets dikirim, hasil dipetakan per id", async () => {
  const urls: string[] = [];
  const realFetch = globalThis.fetch;

  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    urls.push(url);
    const parsed = new URL(url);
    const ids = String(parsed.searchParams.get("eventIds") ?? "").split(",").filter(Boolean);
    /* Bentuk respons nyata: array event dengan `bookmakers`. */
    const body = ids.map((id) => ({
      id: Number(id),
      home: "Home",
      away: "Away",
      date: "2026-11-21T12:30:00Z",
      status: "pending",
      bookmakers: { "1xbet": [] },
    }));
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  try {
    const ids = Array.from({ length: 23 }, (_, i) => 700000 + i);
    const result = await fetchEventsOddsMulti(ids, "kunci-uji", "1xbet", ["ML", "Totals", "HT"]);

    /* Hanya 10 id pertama yang dikirim. */
    assert.equal(result.size, 10);
    assert.equal(result.has(700000), true);
    assert.equal(result.has(700009), true);
    assert.equal(result.has(700010), false);
    assert.equal(urls.length, 1);

    const parsed = new URL(urls[0]!);
    assert.equal(parsed.pathname, "/v3/odds/multi");
    assert.equal(parsed.searchParams.get("eventIds")!.split(",").length, 10);
    /* HT tidak dikirim karena penyedia tidak punya pasar itu. */
    assert.equal(parsed.searchParams.get("markets"), "ML,Totals");
    assert.equal(parsed.searchParams.get("bookmakers"), "1xbet");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("/odds/multi: bentuk respons tak dikenal → error, bukan 'tidak ada odds'", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ status: "ok" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;

  try {
    await assert.rejects(() => fetchEventsOddsMulti([1, 2], "kunci-uji", "1xbet", ["ML"]));
  } finally {
    globalThis.fetch = realFetch;
  }
});
