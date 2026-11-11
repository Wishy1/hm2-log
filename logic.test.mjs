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
  DEMO_ENDPOINT_LABEL,
  TRIP_FIELD_MAP,
  demoChanges,
  queueDemo,
  syncDemo,
  outboxLabel,
  syncedState,
  sheetFromState,
  journalFromState,
  tripSheetRow,
  emptyGoogleSync,
  googleConfigured,
  syncRequest,
  queueSync,
  markSynced,
  markRetry,
  syncChange,
  syncChanges,
  spaceSentences,
  undupeWord,
  normalizeState,
  phoneHref,
  emailHref,
  websiteHref,
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

assert.equal(freshState().settings.demoSync, false);
assert.equal(DEMO_ENDPOINT_LABEL, "demo endpoint");
assert.equal(TRIP_FIELD_MAP.some((row) => row.join(" ").toLowerCase().includes("token")), false);

const sample = freshState();
sample.people.push({ id: "sam", name: "Sam", categories: ["crew"], serviceTags: [], updatedAt: "2026-11-10T12:00:00.000Z" });
sample.trips.push({
  id: "t1",
  boatId: "hm2",
  tripCode: "HM2-20261110-WDEMO",
  title: "Mariner Cove → La Conner",
  status: "arrived",
  fromId: "mariner-cove",
  toId: "la-conner",
  peopleIds: ["myself", "sam"],
  meter: "10",
  eta: { captainEta: "09:30", appEta: "09:12", message: "App wins by 18 min" },
  weather: { text: "Mostly clear, light wind" },
  bestMoment: { text: "Quiet water past the point." },
  rating: { stars: 4, narrative: "Calm water." },
  departedAt: "2026-11-10T16:00:00.000Z",
  arrivedAt: "2026-11-10T18:00:00.000Z",
  updatedAt: "2026-11-10T18:00:00.000Z",
});
sample.entries.push(
  { id: "n1", boatId: "hm2", tripId: "t1", kind: "note", notes: "Left the dock.", at: "2026-11-10T16:05:00.000Z", updatedAt: "2026-11-10T16:05:00.000Z", loggedBy: "Wishy" },
  { id: "f1", boatId: "hm2", tripId: "t1", kind: "fuel", quantity: 10, units: "gallons", cost: 40, currency: "USD", tank: "Main diesel", notes: "", at: "2026-11-10T15:00:00.000Z", updatedAt: "2026-11-10T15:00:00.000Z" },
);
sample.tickets.push({ id: "k1", boatId: "hm2", tripId: "t1", title: "Chart light flicker", detail: "Flicker at the helm.", status: "open", updatedAt: "2026-11-10T17:00:00.000Z" });

const row = tripSheetRow(sample, sample.trips[0]);
assert.equal(row.Title, "Mariner Cove → La Conner");
assert.equal(row["Trip ID"], "HM2-20261110-WDEMO");
assert.equal(row.Departure, "Mariner Cove");
assert.equal(row.Crew.includes("Sam"), true);
assert.equal(row["Your guess"], "09:30");
assert.equal(row.Starfish, "4");

let box = queueDemo([], demoChanges(sample, "2026-11-10T18:00:00.000Z"));
assert.equal(outboxLabel(box), "1 waiting");
box = queueDemo(box, demoChanges(sample, ""));
assert.equal(outboxLabel(box), "4 waiting");
assert.equal(box.length, 4);
box = syncDemo(box);
assert.equal(outboxLabel(box), "All synced");
const preview = syncedState(sample, box);
const tabs = sheetFromState(preview);
assert.equal(tabs.Trips.length, 1);
assert.equal(tabs["Boat Activities"][0].Quantity, "10");
assert.equal(tabs["Boat Activities"][0].Unit, "gallons");
assert.equal(tabs["Boat Activities"][0].Currency, "USD");
assert.equal(tabs["Notes & Journal"][0].Text, "Left the dock.");
assert.equal(tabs["Maintenance Tickets"][0].Title, "Chart light flicker");
assert.equal(tabs.People.some((person) => person.Name === "Sam"), true);
const doc = journalFromState(preview);
assert.match(doc[0].lines.join(" "), /Trip ID HM2-20261110-WDEMO/);
assert.equal(doc[0].notes[0], "Left the dock.");
const again = queueDemo(box, demoChanges(sample, ""));
assert.equal(outboxLabel(again), "All synced");
sample.entries[0].updatedAt = "2026-11-10T19:00:00.000Z";
const edited = queueDemo(again, demoChanges(sample, "2026-11-10T19:00:00.000Z"));
assert.equal(outboxLabel(edited), "1 waiting");
const packed = JSON.stringify({ tabs, doc, box: edited, endpoint: DEMO_ENDPOINT_LABEL });
assert.equal(/token|secret|@|apps\.script|http/i.test(packed), false);

assert.deepEqual(emptyGoogleSync(), { url: "", token: "", auto: false, lastSyncAt: "", sheetUrl: "", docUrl: "", lastError: "" });
assert.equal(googleConfigured(emptyGoogleSync()), false);
assert.equal(googleConfigured({ url: "https://example.com/exec", token: "secret" }), false);
assert.equal(googleConfigured({ url: "https://script.google.com/macros/s/ABC/exec", token: "chosen-by-owner" }), true);

const fuelChange = syncChange(sample, "entry", sample.entries[1]);
assert.equal(fuelChange.kind, "activity");
assert.equal(fuelChange.row.Quantity, "10");
assert.equal(fuelChange.row.Unit, "gallons");
assert.equal(fuelChange.row.Cost, "40");
assert.equal(fuelChange.row.Currency, "USD");
assert.equal(fuelChange.row.Boat, "Halve Maan II");
const tripChange = syncChange(sample, "trip", sample.trips[0]);
assert.equal(tripChange.journal.lines.some((line) => line.includes("Ref t1")), true);
assert.equal(tripChange.journal.notes[0], "Left the dock.");
assert.equal(syncChange(sample, "trip", { ...sample.trips[0], status: "underway" }).journal, null);

let googleBox = queueSync([], syncChanges(sample, "2026-11-10T18:00:00.000Z"));
assert.equal(googleBox.some((item) => item.id === "trip:t1"), true);
assert.equal(googleBox.some((item) => item.id === "entry:f1"), false);
googleBox = queueSync(googleBox, [tripChange]);
assert.equal(googleBox.filter((item) => item.id === "trip:t1").length, 1);
const request = syncRequest({ token: "chosen-by-owner" }, googleBox);
assert.equal(request.token, "chosen-by-owner");
assert.equal(request.changes.every((item) => item.row && item.id), true);
assert.equal(JSON.stringify(request).includes("https://"), false);
googleBox = markRetry(googleBox, googleBox.map((item) => item.id), "No signal");
assert.equal(googleBox.every((item) => item.status === "waiting" && item.attempts === 1), true);
googleBox = markSynced(googleBox, ["trip:t1"]);
assert.equal(googleBox.find((item) => item.id === "trip:t1").status, "synced");
const resent = syncRequest({ token: "chosen-by-owner" }, googleBox);
assert.equal(resent.changes.some((item) => item.id === "t1"), false);

assert.equal(spaceSentences("Calm water and an easy landing.Tied up."), "Calm water and an easy landing. Tied up.");
assert.equal(spaceSentences("Still on the phone, not saved.Logged while offline."), "Still on the phone, not saved. Logged while offline.");
assert.equal(spaceSentences("49°F"), "49°F");
assert.equal(undupeWord("DungenessDungeness"), "Dungeness");
assert.equal(undupeWord("Dungeness"), "Dungeness");
assert.equal(undupeWord("Dungeness · 3"), "Dungeness · 3");

const kept = normalizeState({
  people: [{ id: "old", name: "Harbor Shop", categories: ["service"], phone: "360-555-0100", notes: "Ask for Dana", updatedAt: "2026-11-01T00:00:00.000Z" }],
  trips: [{ id: "t-old", peopleIds: ["old"], eta: { factor: 1.5, speedKn: 6, appEta: "09:00" }, updatedAt: "2026-11-01T00:00:00.000Z" }],
});
const oldPerson = kept.people.find((person) => person.id === "old");
assert.equal(oldPerson.name, "Harbor Shop");
assert.equal(oldPerson.phone, "360-555-0100");
assert.equal(oldPerson.notes, "Ask for Dana");
assert.equal(oldPerson.email, "");
assert.equal(oldPerson.address, "");
assert.equal(oldPerson.website, "");
assert.equal(kept.trips.find((trip) => trip.id === "t-old").eta.factor, 1.5);

const richState = freshState();
richState.people.push({
  id: "yard",
  name: "Yard",
  categories: ["service"],
  phone: "360-555-0199",
  email: "desk@yard.example",
  address: "12 Dock St\nAnacortes",
  website: "http://yard.example/parts",
  notes: "Parts",
  updatedAt: "2026-11-12T00:00:00.000Z",
});
const yardOut = exportPayload(richState).people.find((person) => person.id === "yard");
assert.equal(yardOut.phone, "360-555-0199");
assert.equal(yardOut.email, "desk@yard.example");
assert.equal(yardOut.address, "12 Dock St\nAnacortes");
assert.equal(yardOut.website, "http://yard.example/parts");
assert.equal(yardOut.notes, "Parts");
const round = importPayload(freshState(), exportPayload(richState)).state.people.find((person) => person.id === "yard");
assert.equal(round.email, "desk@yard.example");
assert.equal(round.address, "12 Dock St\nAnacortes");
assert.equal(round.website, "http://yard.example/parts");
const oldFile = exportPayload(freshState());
oldFile.people.push({ id: "legacy", name: "Harbor Shop", categories: ["service"], phone: "360-555-0100", notes: "Ask for Dana", updatedAt: "2026-11-02T00:00:00.000Z" });
const legacy = importPayload(freshState(), oldFile).state.people.find((person) => person.id === "legacy");
assert.equal(legacy.name, "Harbor Shop");
assert.equal(legacy.phone, "360-555-0100");
assert.equal(legacy.notes, "Ask for Dana");
assert.equal(legacy.email, "");
assert.equal(legacy.address, "");
assert.equal(legacy.website, "");

const peopleTab = sheetFromState(richState).People.find((person) => person.Name === "Yard");
assert.equal(peopleTab.Phone, "360-555-0199");
assert.equal(peopleTab.Email, "desk@yard.example");
assert.equal(peopleTab.Address, "12 Dock St\nAnacortes");
assert.equal(peopleTab.Website, "http://yard.example/parts");
const personChange = syncChange(richState, "person", richState.people.find((person) => person.id === "yard"));
assert.equal(personChange.row.Phone, "360-555-0199");
assert.equal(personChange.row.Email, "desk@yard.example");
assert.equal(personChange.row.Address, "12 Dock St\nAnacortes");
assert.equal(personChange.row.Website, "http://yard.example/parts");

assert.equal(phoneHref("360-555-0100"), "tel:3605550100");
assert.equal(phoneHref("+1 (360) 555-0100"), "tel:+13605550100");
assert.equal(phoneHref(""), "");
assert.equal(phoneHref("ask Dana"), "");
assert.equal(emailHref("desk@yard.example"), "mailto:desk@yard.example");
assert.equal(emailHref(""), "");
assert.equal(emailHref("not an email"), "");
assert.equal(websiteHref("yard.example"), "https://yard.example/");
assert.equal(websiteHref("http://yard.example/parts"), "https://yard.example/parts");
assert.equal(websiteHref("https://yard.example/parts"), "https://yard.example/parts");
assert.equal(websiteHref("javascript:alert(1)"), "");
assert.equal(websiteHref(""), "");

const assumed = passageEstimate({ from: cove, to: conner, speedKn: 7, departedAt: new Date("2026-11-10T15:00:00") });
assert.equal(assumed.factor, 1.3);
assert.ok(Math.abs(assumed.nm - straight * 1.3) < 0.01);
const customFactor = passageEstimate({ from: cove, to: conner, factor: "1.5", speedKn: 7, departedAt: new Date("2026-11-10T15:00:00") });
assert.equal(customFactor.factor, 1.5);

console.log("logic.test.mjs ok");
