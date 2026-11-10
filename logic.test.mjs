import assert from "node:assert/strict";
import {
  sunDown,
  describeWeather,
  sentenceFromChips,
  dedupeById,
  mergeById,
  makeTripCode,
  freshState,
  exportPayload,
  importPayload,
  countIds,
  ZONES,
} from "./logic.js";

assert.equal(sunDown(new Date("2026-06-21T20:00:00Z"), 48.29, -122.64), false);
assert.equal(sunDown(new Date("2026-06-21T10:00:00Z"), 48.29, -122.64), true);
assert.equal(sunDown(new Date("2026-11-10T20:00:00Z"), 48.29, -122.64), false);
assert.equal(sunDown(new Date("2026-11-10T08:00:00Z"), 48.29, -122.64), true);
assert.equal(sunDown(new Date("2026-06-21T12:00:00Z"), 53, 5.8), false);
assert.equal(sunDown(new Date("2026-06-21T00:00:00Z"), 53, 5.8), true);

const sunny = describeWeather({ code: 0, temp: 62, tempUnit: "f", windKn: 6, isNight: false });
assert.match(sunny, /Sunny/);
assert.doesNotMatch(sunny, /Clear night/);

const clearNight = describeWeather({ code: 0, isNight: true, windKn: 4 });
assert.match(clearNight, /Clear night/);
assert.doesNotMatch(clearNight, /Sunny/);

const windOnly = describeWeather({ windKn: 18 });
assert.match(windOnly, /Windy/);
assert.match(windOnly, /18 kn/);
assert.doesNotMatch(windOnly, /Sunny|Clear|Cloudy|Rain|Snow|Fog/i);

const rainWind = describeWeather({ code: 63, windKn: 16, isNight: false });
assert.match(rainWind, /Rain/);
assert.match(rainWind, /windy/);
assert.doesNotMatch(rainWind, /Sunny/);

const snow = describeWeather({ snowfall: 1.2, isNight: true });
assert.match(snow, /Snow/);
assert.match(snow, /^Night|Snow/);
assert.doesNotMatch(snow, /Sunny/);

assert.equal(describeWeather({}), "");
assert.equal(sentenceFromChips(["sunny", "windy"], false), "Sunny, Windy");
assert.equal(sentenceFromChips(["sunny"], true), "Clear night");
assert.equal(sentenceFromChips(["rain"], true), "Night, Rain");
assert.equal(sentenceFromChips([], false), "");

const dupes = dedupeById([
  { id: "a", name: "old", updatedAt: "2026-11-01T00:00:00.000Z" },
  { id: "a", name: "new", updatedAt: "2026-11-02T00:00:00.000Z" },
  { id: "b", name: "only", updatedAt: "2026-11-01T00:00:00.000Z" },
]);
assert.equal(dupes.length, 2);
assert.equal(dupes.find((item) => item.id === "a").name, "new");

const merged = mergeById(
  [{ id: "a", name: "keep", updatedAt: "2026-11-03T00:00:00.000Z" }, { id: "b", name: "local", updatedAt: "2026-11-01T00:00:00.000Z" }],
  [
    { id: "a", name: "older", updatedAt: "2026-11-02T00:00:00.000Z" },
    { id: "b", name: "newer", updatedAt: "2026-11-04T00:00:00.000Z" },
    { id: "c", name: "added", updatedAt: "2026-11-04T00:00:00.000Z" },
    { name: "no id" },
  ],
);
assert.equal(merged.items.length, 3);
assert.equal(merged.added, 1);
assert.equal(merged.updated, 1);
assert.equal(merged.skipped, 2);
assert.equal(merged.items.find((item) => item.id === "a").name, "keep");
assert.equal(countIds(merged.items), merged.items.length);

assert.match(makeTripCode("HM2", "2026-11-10T15:00:00.000Z", "Wishy", "abcd1234"), /^HM2-20261110-W1234$/);

const state = freshState();
assert.equal(state.people[0].id, "myself");
assert.equal(state.trips.length, 0);
assert.ok(state.places.some((place) => place.name === "Mariner Cove" && place.favorite));
assert.ok(state.places.some((place) => place.name === "Jirnsum (RFU)" && place.favorite));
assert.equal(ZONES.hm2.length, 3);
assert.equal(ZONES.zeeotter.length, 3);

state.entries.push({ id: "e1", notes: "one", updatedAt: "2026-11-10T00:00:00.000Z" });
const exported = exportPayload(state);
exported.entries.push({ id: "e1", notes: "duplicate older", updatedAt: "2026-11-09T00:00:00.000Z" });
exported.entries.push({ id: "e1", notes: "duplicate newer", updatedAt: "2026-11-11T00:00:00.000Z" });
const imported = importPayload(freshState(), exported);
const ones = imported.state.entries.filter((entry) => entry.id === "e1");
assert.equal(ones.length, 1);
assert.equal(ones[0].notes, "duplicate newer");

assert.throws(() => importPayload(state, { version: 4 }), /v5/);

console.log("logic.test.mjs ok");
