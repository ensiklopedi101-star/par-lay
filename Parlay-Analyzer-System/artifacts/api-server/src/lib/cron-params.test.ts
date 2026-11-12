import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_EVENTS_PER_LEAGUE_CALL, parseMaxEvents } from "./cron-params";

test("?max= dibaca sebagai bilangan bulat positif", () => {
  assert.equal(parseMaxEvents("10"), 10);
  assert.equal(parseMaxEvents(["12", "99"]), 12);
});

test("parameter kosong/rusak menghasilkan undefined agar default internal dipakai", () => {
  assert.equal(parseMaxEvents(undefined), undefined);
  assert.equal(parseMaxEvents(""), undefined);
  assert.equal(parseMaxEvents("   "), undefined);
  assert.equal(parseMaxEvents("abc"), undefined);
  assert.equal(parseMaxEvents("0"), undefined);
  assert.equal(parseMaxEvents("-5"), undefined);
  assert.equal(parseMaxEvents("3.5"), undefined);
  assert.equal(parseMaxEvents({}), undefined);
});

test("nilai terlalu besar dipotong ke plafon per liga", () => {
  assert.equal(parseMaxEvents("1000"), MAX_EVENTS_PER_LEAGUE_CALL);
  assert.equal(parseMaxEvents(String(MAX_EVENTS_PER_LEAGUE_CALL + 1)), MAX_EVENTS_PER_LEAGUE_CALL);
});
