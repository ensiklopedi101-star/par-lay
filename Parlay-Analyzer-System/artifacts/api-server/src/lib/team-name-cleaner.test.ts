import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { canonicalTeamName, teamNamesEquivalent } from "./team-name-cleaner";

/*
 * Regresi kasus "Rennes ganda" (13 Nov 2026): FootyStats mengirim nama
 * resmi panjang sementara impor lain memakai nama pendek. Keduanya lolos
 * uji token (rennes ≠ rennais), jadi satu klub tersimpan sebagai dua baris.
 * Alias liga di sini memastikan kedua ejaan selalu bertemu di satu nama.
 */
describe("canonicalTeamName — alias nama panjang/pendek per liga", () => {
  const cases: Array<[string, string, string]> = [
    ["Stade Rennais", "france-ligue-1", "Rennes"],
    ["Rennes", "france-ligue-1", "Rennes"],
    ["Olympique Lyonnais", "france-ligue-1", "Lyon"],
    ["Association Jeunesse Auxerroise", "france-ligue-1", "Auxerre"],
    ["Angers Sporting Club de l'Ouest", "france-ligue-1", "Angers SCO"],
    ["Stade Brestois 29", "france-ligue-1", "Stade Brest 29"],
    ["Olympique de Marseille", "france-ligue-1", "Marseille"],
    ["Internazionale Milano", "italy-serie-a", "Inter"],
    ["Parma Calcio 1913", "italy-serie-a", "Parma"],
    ["SS Lazio", "italy-serie-a", "Lazio"],
    ["Alkmaar Zaanstreek", "netherlands-eredivisie", "AZ"],
    ["Nijmegen Eendracht Combinatie", "netherlands-eredivisie", "NEC"],
    ["Real Club Celta de Vigo", "spain-laliga", "RC Celta de Vigo"],
    ["Celta de Vigo", "spain-laliga", "RC Celta de Vigo"],
    ["Reial Club Deportiu Espanyol", "spain-laliga", "RCD Espanyol"],
    ["Getafe Club de Fútbol", "spain-laliga", "Getafe"],
  ];
  for (const [raw, league, expected] of cases) {
    it(`${raw} → ${expected}`, () => {
      assert.equal(canonicalTeamName(raw, league), expected);
    });
  }

  it("tim berbeda tidak ikut tergabung oleh alias", () => {
    assert.equal(
      teamNamesEquivalent("Olympique de Marseille", "Olympique Lyonnais", "france-ligue-1", [
        "Olympique de Marseille",
        "Olympique Lyonnais",
      ]),
      false,
    );
    assert.equal(canonicalTeamName("Barcelona", "spain-laliga"), "Barcelona");
  });
});
