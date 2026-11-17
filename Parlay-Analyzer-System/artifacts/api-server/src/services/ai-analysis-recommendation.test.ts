import { test } from "node:test";
import assert from "node:assert/strict";
import { extractPredictionRecommendation } from "./ai-analysis";

/**
 * Regresi produksi 17 Nov 2026: Gemini merekomendasikan market yang valid
 * (Troyes Over 2.5, Bilbao BTTS Yes) tetapi menulis fixture_id sebagai
 * label "Home vs Away" karena prompt tidak pernah memberi ID numerik.
 * Parser lama hanya menerima ID persis, lalu jatuh ke objek root yang
 * kosong — kedua laga tercatat sebagai NO BET analitis confidence 0.
 */

const TEAMS = { homeTeam: "Athletic Bilbao", awayTeam: "Espanyol Barcelona" };

function responseWith(fixtureIdField: string) {
  return [
    "## ANALISIS SINGKAT",
    "Kedua tim berpotensi mencetak gol.",
    "",
    "## KODE (JSON)",
    "```json",
    JSON.stringify({
      ticket_name: "kandidat-x",
      risk_level: "Medium",
      total_odds: 0,
      selections: [
        {
          fixture_id: fixtureIdField,
          market_type: "BTTS",
          outcome: "Yes",
          line: null,
          probability: 0.63,
          confidence: 8.0,
          odds: 1.94,
          rationale: "Kedua tim rutin mencetak gol.",
        },
      ],
      lambda_adjustment: { lambda_home_mult: 1.0, lambda_away_mult: 1.0, evidence: [] },
    }),
    "```",
  ].join("\n");
}

test("fixture_id numerik persis tetap dipilih seperti sebelumnya", () => {
  const rec = extractPredictionRecommendation(responseWith("72478708"), "72478708", TEAMS);
  assert.ok(rec.marketBet && rec.marketBet.length > 0);
  assert.equal(rec.probability, 0.63);
  assert.equal(rec.confidence, 8.0);
});

test("fixture_id berupa label laga tidak lagi dibuang sebagai NO BET", () => {
  const rec = extractPredictionRecommendation(
    responseWith("Athletic Bilbao vs Espanyol Barcelona"),
    "72478708",
    TEAMS,
  );
  assert.ok(rec.marketBet && rec.marketBet.length > 0, "marketBet harus terbaca dari seleksi");
  assert.equal(rec.probability, 0.63);
  assert.equal(rec.confidence, 8.0);
  assert.equal(rec.odds, 1.94);
});

test("seleksi tunggal dengan fixture_id asing tetap dipakai (respons satu fixture)", () => {
  const rec = extractPredictionRecommendation(responseWith("tidak-dikenal"), "72478708", TEAMS);
  assert.ok(rec.marketBet && rec.marketBet.length > 0);
  assert.equal(rec.probability, 0.63);
});

test("NO BET eksplisit (selections kosong) tetap NO BET", () => {
  const text = "## KODE (JSON)\n```json\n{\"selections\": [], \"lambda_adjustment\": {\"lambda_home_mult\": 1, \"lambda_away_mult\": 1, \"evidence\": []}}\n```";
  const rec = extractPredictionRecommendation(text, "72478708", TEAMS);
  assert.equal(rec.marketBet, null);
});
