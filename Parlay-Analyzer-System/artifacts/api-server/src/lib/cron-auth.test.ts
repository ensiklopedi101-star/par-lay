import { test } from "node:test";
import assert from "node:assert/strict";
import { bearerToken, isCronAuthorized } from "./cron-auth";

const SECRET = "rahasia-cron-123";

test("Vercel Cron memakai Authorization: Bearer — harus diterima", () => {
  assert.equal(
    isCronAuthorized({ secret: SECRET, authorization: `Bearer ${SECRET}` }),
    true,
  );
});

test("skema Bearer tidak peka huruf besar kecil, nilainya tetap peka", () => {
  assert.equal(isCronAuthorized({ secret: SECRET, authorization: `bearer ${SECRET}` }), true);
  assert.equal(isCronAuthorized({ secret: SECRET, authorization: `Bearer ${SECRET}x` }), false);
  assert.equal(isCronAuthorized({ secret: SECRET, authorization: `Bearer ${SECRET.toUpperCase()}` }), false);
});

test("GitHub Actions memakai ?token= — tetap diterima", () => {
  assert.equal(isCronAuthorized({ secret: SECRET, queryToken: SECRET }), true);
});

test("panggilan manual memakai x-cron-secret — tetap diterima", () => {
  assert.equal(isCronAuthorized({ secret: SECRET, headerSecret: SECRET }), true);
});

test("array header dari Node diambil nilai pertamanya", () => {
  assert.equal(isCronAuthorized({ secret: SECRET, headerSecret: [SECRET, "lain"] }), true);
  /* Nilai pertama yang menentukan: `?token=salah&token=rahasia` tidak boleh
   * lolos hanya karena ada nilai benar di posisi kedua. */
  assert.equal(isCronAuthorized({ secret: SECRET, queryToken: ["salah", SECRET] }), false);
});

test("tanpa rahasia yang cocok, akses ditolak", () => {
  assert.equal(isCronAuthorized({ secret: SECRET }), false);
  assert.equal(isCronAuthorized({ secret: SECRET, queryToken: "salah" }), false);
  assert.equal(isCronAuthorized({ secret: SECRET, authorization: "Basic abc" }), false);
  assert.equal(isCronAuthorized({ secret: SECRET, authorization: `Bearer ` }), false);
});

test("CRON_SECRET kosong mematikan endpoint, bukan membuka akses", () => {
  assert.equal(isCronAuthorized({ secret: undefined, queryToken: "apa pun" }), false);
  assert.equal(isCronAuthorized({ secret: "", headerSecret: "" }), false);
  assert.equal(isCronAuthorized({ secret: "", authorization: "Bearer " }), false);
});

test("bearerToken hanya menerima skema Bearer", () => {
  assert.equal(bearerToken("Bearer abc"), "abc");
  assert.equal(bearerToken("  Bearer   abc  "), "abc");
  assert.equal(bearerToken("Basic abc"), null);
  assert.equal(bearerToken(null), null);
});
