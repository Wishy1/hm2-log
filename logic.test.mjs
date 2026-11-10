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
  haversineNm,
  passageEstimate,
  scoreEta,
  formatHours,
  blankWeatherFields,
  upsertDraft,
  removeDraft,
  freshState as freshAgain,
  measureOf,
  formatMoney,
  formatVolume,
  weatherUrl,
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

const cove = { lat: 48.291, lon: -122.521 };
const conner = { lat: 48.3833, lon: -122.4831 };
const straight = haversineNm(cove, conner);
assert.ok(straight > 4 && straight < 12, `distance ${straight}`);
const passage = passageEstimate({
  from: cove,
  to: conner,
  factor: 1.3,
  speedKn: 7,
  departedAt: new Date("2026-11-10T15:00:00"),
});
assert.ok(Math.abs(passage.nm - straight * 1.3) < 0.01);
assert.equal(passage.hours, passage.nm / 7);
assert.match(passage.appEta, /^\d{2}:\d{2}$/);
assert.match(formatHours(1.5), /1h 30m/);
const manual = passageEstimate({ manualNm: "10", speedKn: 5, departedAt: new Date("2026-11-10T15:00:00") });
assert.equal(manual.nm, 10);
assert.equal(manual.hours, 2);

const race = scoreEta({
  whenIso: "2026-11-10T18:00:00",
  arrivedIso: "2026-11-10T19:10:00",
  appEta: "19:00",
  captainEta: "20:30",
});
assert.equal(race.winner, "App");
assert.equal(race.appMinutes, 10);
assert.ok(race.captainMinutes > race.appMinutes);
assert.equal(scoreEta({ arrivedIso: "2026-11-10T19:10:00", appEta: "19:00" }), null);

const blankWind = blankWeatherFields();
assert.equal(blankWind.windKn, null);
assert.equal(blankWind.text, "");
assert.deepEqual(blankWind.conditions, []);

let drafts = {};
drafts = upsertDraft(drafts, "hm2|trip-form|trip|new", { form: { title: "first" }, updatedAt: "2026-11-10T01:00:00.000Z" });
drafts = upsertDraft(drafts, "hm2|trip-form|trip|new", { form: { title: "second" }, updatedAt: "2026-11-10T02:00:00.000Z" });
assert.equal(Object.keys(drafts).length, 1);
assert.equal(drafts["hm2|trip-form|trip|new"].form.title, "second");
drafts = upsertDraft(drafts, "hm2|entry-form|note|new", { form: { notes: "dock" } });
assert.equal(Object.keys(drafts).length, 2);
drafts = removeDraft(drafts, "hm2|trip-form|trip|new");
assert.equal(Object.keys(drafts).length, 1);
assert.equal(drafts["hm2|entry-form|note|new"].form.notes, "dock");

const clean = freshAgain();
assert.equal(clean.places.some((place) => /deception/i.test(place.name)), false);
assert.equal(clean.places.some((place) => place.name === "Mariner Cove"), true);

const hm2 = measureOf("hm2");
const zee = measureOf("zeeotter");
assert.deepEqual(hm2, { volume: "gallons", volumeLabel: "gal", currency: "USD", symbol: "$", temperature: "f" });
assert.deepEqual(zee, { volume: "liters", volumeLabel: "L", currency: "EUR", symbol: "€", temperature: "c" });
assert.equal(formatMoney(72, "USD"), "$72.00");
assert.equal(formatMoney(8.5, "EUR"), "€8.50");
assert.equal(formatVolume(40, "liters"), "40 L");
assert.equal(formatVolume(18, "gallons"), "18 gal");
assert.match(weatherUrl(53, 5.8, zee.temperature), /temperature_unit=celsius/);
assert.match(weatherUrl(48.29, -122.64, hm2.temperature), /temperature_unit=fahrenheit/);
assert.match(weatherUrl(53, 5.8, zee.temperature), /wind_speed_unit=kn/);

console.log("logic.test.mjs ok");
