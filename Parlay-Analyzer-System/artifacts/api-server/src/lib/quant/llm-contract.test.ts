import { test } from "node:test";
import assert from "node:assert/strict";
import { extractLambdaAdjustment, V5_CONTRACT_SUFFIX, PERSONA_V5 } from "./llm-contract.js";

test("kontrak V5 melarang model melaporkan EV dan stake sendiri", () => {
  assert.match(V5_CONTRACT_SUFFIX, /DILARANG melaporkan EV/);
  assert.match(V5_CONTRACT_SUFFIX, /stake/i);
  assert.match(PERSONA_V5, /BUKAN penghasil probabilitas/);
});

test("extractLambdaAdjustment menerima adjustment berbukti dan memotong ke ±12%", () => {
  const text = `narasi {"selections":[],"lambda_adjustment":{"lambda_home_mult":1.40,"lambda_away_mult":0.95,"evidence":[{"type":"injury","detail":"Striker utama absen karena cedera hamstring","source_url":"https://example.com/news"}]}} selesai`;
  const adj = extractLambdaAdjustment(text);
  assert.ok(adj);
  assert.equal(adj!.lambdaHomeMult, 1.12);
  assert.equal(adj!.lambdaAwayMult, 0.95);
  assert.equal(adj!.evidence.length, 1);
});

test("adjustment tanpa bukti dibuang (null), bukan diterapkan", () => {
  const text = `{"lambda_adjustment":{"lambda_home_mult":1.10,"lambda_away_mult":1.0,"evidence":[]}}`;
  assert.equal(extractLambdaAdjustment(text), null);
});

test("teks tanpa lambda_adjustment menghasilkan null", () => {
  assert.equal(extractLambdaAdjustment("tidak ada json di sini"), null);
  assert.equal(extractLambdaAdjustment(`{"selections":[{"probability":0.5}]}`), null);
});

test("Persona V6 terpadu: tanpa perintah lama yang bertabrakan", async () => {
  const { PERSONA_V6 } = await import("./llm-contract.js");
  assert.doesNotMatch(PERSONA_V6, /Sharp Money Detection/i);
  assert.doesNotMatch(PERSONA_V6, /stake 1-3%/i);
  assert.doesNotMatch(PERSONA_V6, /ANALISIS EV/i);
  assert.match(PERSONA_V6, /jangan hitung ulang/i);
  assert.match(PERSONA_V6, /NO BET/);
  assert.match(PERSONA_V6, /lambda_adjustment/);
});
