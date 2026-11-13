import assert from "node:assert/strict";
import test from "node:test";
import { applySlugAlias, normalizeLeagueSlug } from "./league-slug";

/*
 * Regression guard for the bug that put 20 La Liga clubs under
 * england-premier-league: the extension sent only `parts[1]` of the FootyStats
 * URL, and the server accepted whatever it received.
 */

test("normalizeLeagueSlug joins country and competition", () => {
  assert.equal(normalizeLeagueSlug("spain/la-liga"), "spain-la-liga");
  assert.equal(normalizeLeagueSlug("england/premier-league"), "england-premier-league");
  assert.equal(normalizeLeagueSlug("italy/serie-a"), "italy-serie-a");
  assert.equal(normalizeLeagueSlug("germany/bundesliga"), "germany-bundesliga");
});

test("normalizeLeagueSlug accepts a full FootyStats URL", () => {
  assert.equal(
    normalizeLeagueSlug("https://footystats.org/spain/la-liga"),
    "spain-la-liga",
  );
  assert.equal(
    normalizeLeagueSlug("https://www.footystats.org/spain/la-liga/xg-table"),
    "spain-la-liga",
  );
});

test("normalizeLeagueSlug strips season and stats-page segments", () => {
  assert.equal(normalizeLeagueSlug("spain/la-liga/2025-2026"), "spain-la-liga");
  assert.equal(normalizeLeagueSlug("england/premier-league/over-25-table"), "england-premier-league");
  assert.equal(normalizeLeagueSlug("england/premier-league/stats"), "england-premier-league");
});

test("normalizeLeagueSlug leaves an already-correct slug alone", () => {
  assert.equal(normalizeLeagueSlug("spain-la-liga"), "spain-la-liga");
  assert.equal(normalizeLeagueSlug("england-premier-league"), "england-premier-league");
});

test("normalizeLeagueSlug handles query strings and trailing slashes", () => {
  assert.equal(normalizeLeagueSlug("spain/la-liga/?season=2026"), "spain-la-liga");
  assert.equal(normalizeLeagueSlug("  Spain/La-Liga/  "), "spain-la-liga");
});

test("the broken form the extension used is repaired", () => {
  /* parts[1] alone — this is what produced "la-liga" and broke the import. */
  assert.equal(applySlugAlias(normalizeLeagueSlug("la-liga")), "spain-laliga");
  assert.equal(applySlugAlias(normalizeLeagueSlug("serie-a")), "italy-serie-a");
  assert.equal(applySlugAlias(normalizeLeagueSlug("bundesliga")), "germany-bundesliga");
  assert.equal(applySlugAlias(normalizeLeagueSlug("premier-league")), "england-premier-league");
});

test("unknown slugs pass through unchanged so the caller is told about them", () => {
  assert.equal(applySlugAlias("atlantis-super-league"), "atlantis-super-league");
});

test("La Liga: ejaan FootyStats dipetakan ke slug resmi tabel leagues (regresi 422)", () => {
  /* Error produksi: league_slug "spain-la-liga" tidak ada di tabel leagues,
     slug mirip "spain-laliga". Alias harus menunjuk slug yang benar-benar
     terdaftar, bukan ejaan lain yang sama-sama tidak terdaftar. */
  assert.equal(applySlugAlias(normalizeLeagueSlug("spain/la-liga")), "spain-laliga");
  assert.equal(applySlugAlias(normalizeLeagueSlug("https://footystats.org/spain/la-liga")), "spain-laliga");
  assert.equal(applySlugAlias("spain-laliga"), "spain-laliga");
  assert.equal(applySlugAlias("spain-la-liga"), "spain-laliga");
});
