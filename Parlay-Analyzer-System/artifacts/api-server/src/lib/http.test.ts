import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import {
  DEFAULT_HTTP_TIMEOUT_MS,
  HttpTimeoutError,
  fetchWithTimeout,
  resolveRequestTimeoutMs,
} from "./http";

test("timeout default 20 detik bila env tidak diatur", () => {
  assert.equal(DEFAULT_HTTP_TIMEOUT_MS, 20_000);
  assert.equal(resolveRequestTimeoutMs(undefined), 20_000);
});

test("nilai env yang sah dipakai, yang rusak jatuh ke default", () => {
  assert.equal(resolveRequestTimeoutMs("15000"), 15_000);
  assert.equal(resolveRequestTimeoutMs("500"), DEFAULT_HTTP_TIMEOUT_MS);
  assert.equal(resolveRequestTimeoutMs("999999"), DEFAULT_HTTP_TIMEOUT_MS);
  assert.equal(resolveRequestTimeoutMs("abc"), DEFAULT_HTTP_TIMEOUT_MS);
  assert.equal(resolveRequestTimeoutMs(""), DEFAULT_HTTP_TIMEOUT_MS);
});

test("perintah yang menggantung dihentikan, bukan menunggu selamanya", async () => {
  /* Server yang menerima koneksi tetapi tidak pernah menjawab — persis pola
   * yang membuat satu event sync bertahan 9 menit di produksi. */
  const server = createServer(() => {
    /* sengaja tidak ada respons */
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  try {
    await assert.rejects(
      () => fetchWithTimeout(`http://127.0.0.1:${port}/`, {}, 300),
      (err: unknown) => err instanceof HttpTimeoutError,
    );
  } finally {
    server.closeAllConnections?.();
    server.close();
  }
});

test("respons normal tetap diteruskan apa adanya", async () => {
  const server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  try {
    const res = await fetchWithTimeout(`http://127.0.0.1:${port}/`, {}, 2_000);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });
  } finally {
    server.closeAllConnections?.();
    server.close();
  }
});
