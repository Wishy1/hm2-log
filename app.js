/* HM2 Log v5. Fresh store: IndexedDB hm2log-v5 (localStorage only if IndexedDB fails). */
import {
  ALONG_TYPES,
  BEST_TAGS,
  BOATS,
  CONDITIONS,
  DECEPTION_PASS_URL,
  FILM_KINDS,
  FILM_TOOLS,
  PERSON_CATEGORIES,
  PURPOSES,
  SERVICE_TAGS,
  ZONES,
  describeWeather,
  exportPayload,
  freshState,
  importPayload,
  makeTripCode,
  normalizeState,
  nowIso,
  sentenceFromChips,
  uid,
  weatherUrl,
} from "./logic.js";

const KIND_LABEL = {
  note: "Note",
  repair: "Repair",
  wash: "Wash",
  fuel: "Fuel",
  water: "Water fill",
  pumpout: "Pump-out",
  rating: "Narrative rating",
  crab: "Crab catch",
};
const TICKET_STATUS = [
  ["open", "Open"],
  ["progress", "In progress"],
  ["waiting", "Waiting on parts"],
  ["closed", "Closed"],
  ["cancelled", "Cancelled"],
];
const REGION_LABEL = { pnw: "Puget Sound", nl: "Netherlands", uk: "UK", other: "Other" };
const CHECKS = [
  ["spare", "Spare camera in the bag"],
  ["cards", "Cards and a battery packed"],
  ["cloth", "Lens cloth in the helm pocket"],
];

const ui = {
  screen: "home",
  boatId: "hm2",
  tripId: null,
  form: null,
  stash: null,
  picker: null,
  confirm: null,
  flash: "",
  online: navigator.onLine,
  busy: false,
  activityPrompt: false,
  journalScope: "trip",
  maintScope: "open",
  peopleScope: "all",
  serviceTag: null,
  placeScope: "recents",
  placeQuery: "",
  placeShow: 12,
  mediaScope: "planned",
  ticketId: null,
  ticketTab: "details",
};
let state = null;
let saveTimer = 0;
let paintedScreen = "";

const app = document.getElementById("app");

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}

function boat() {
  return BOATS[ui.boatId] || BOATS.hm2;
}

function flash(message) {
  ui.flash = message;
  let node = document.getElementById("flash");
  if (!node) return;
  node.hidden = !message;
  node.textContent = message;
  clearTimeout(flash.timer);
  flash.timer = setTimeout(() => {
    ui.flash = "";
    node = document.getElementById("flash");
    if (node) node.hidden = true;
  }, 2800);
}

function saveLabel() {
  return ui.online ? "Saved on this phone." : "No signal. Saved on this phone.";
}

function updateSaveLabel() {
  const node = document.getElementById("save-state");
  if (node) node.textContent = saveLabel();
}

function fmt(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return String(iso);
  return date.toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
}

function toLocalInput(iso) {
  const date = iso ? new Date(iso) : new Date();
  if (Number.isNaN(date.getTime())) return "";
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}

function fromLocalInput(value) {
  if (!value) return nowIso();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? nowIso() : date.toISOString();
}

function tripById(id) {
  return state.trips.find((trip) => trip.id === id) || null;
}
function ticketById(id) {
  return state.tickets.find((ticket) => ticket.id === id) || null;
}
function personName(id) {
  return state.people.find((person) => person.id === id)?.name || "Someone";
}
function placeById(id) {
  return state.places.find((place) => place.id === id) || null;
}
function placeName(id) {
  return placeById(id)?.name || "Choose place";
}
function businessName(id) {
  return state.businesses.find((business) => business.id === id)?.name || "";
}

function boatTrips() {
  return state.trips
    .filter((trip) => trip.boatId === ui.boatId)
    .sort((a, b) => (b.departedAt || b.createdAt || "").localeCompare(a.departedAt || a.createdAt || ""));
}
function currentTrip() {
  const trips = boatTrips();
  return trips.find((trip) => trip.status === "underway") || trips.find((trip) => trip.status === "planned") || null;
}
function shownTrip() {
  if (ui.tripId) {
    const found = state.trips.find((trip) => trip.id === ui.tripId && trip.boatId === ui.boatId);
    if (found) return found;
  }
  return currentTrip();
}
function boatEntries() {
  return state.entries
    .filter((entry) => entry.boatId === ui.boatId)
    .sort((a, b) => (b.at || "").localeCompare(a.at || ""));
}

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("hm2log-v5", 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains("kv")) request.result.createObjectStore("kv");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
function idbGet(db, key) {
  return new Promise((resolve, reject) => {
    const request = db.transaction("kv", "readonly").objectStore("kv").get(key);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}
function idbSet(db, key, value) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("kv", "readwrite");
    tx.objectStore("kv").put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function loadState() {
  try {
    const db = await openDb();
    const value = await idbGet(db, "state");
    if (value && value.version === 5) return value;
  } catch (error) {
    console.warn(error);
  }
  try {
    const raw = localStorage.getItem("hm2log-v5");
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.version === 5) return parsed;
    }
  } catch (error) {
    console.warn(error);
  }
  return null;
}

async function saveState(next) {
  let saved = false;
  try {
    const db = await openDb();
    await idbSet(db, "state", next);
    saved = true;
  } catch (error) {
    console.warn(error);
  }
  if (!saved) localStorage.setItem("hm2log-v5", JSON.stringify(next));
}

async function persist(options = {}) {
  state = normalizeState(state);
  await saveState(state);
  updateSaveLabel();
  if (options.announce) flash(options.announce);
}

function queueSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    persist().catch(() => flash("Not saved. Export a backup if this keeps happening."));
  }, 250);
}

async function saving(work) {
  if (ui.busy) return;
  ui.busy = true;
  try {
    await work();
  } finally {
    ui.busy = false;
  }
}

function touchPlace(id) {
  const place = placeById(id);
  if (!place) return;
  place.lastUsedAt = nowIso();
  place.updatedAt = place.lastUsedAt;
}

function weatherFromForm(form) {
  const wind = form.wind === "" || form.wind == null ? null : Number(form.wind);
  const text = (form.weatherText || "").trim();
  return {
    text,
    kind: form.weatherKind || (text ? "observed" : ""),
    source: form.weatherSource || (text ? "Manual" : ""),
    at: form.weatherAt || (text ? nowIso() : ""),
    windKn: Number.isFinite(wind) ? wind : null,
    night: !!form.night,
    conditions: form.conditions || [],
    code: form.weatherCode ?? null,
    advisory: !!form.advisory,
  };
}

function writeWeather(announce) {
  const trip = tripById(ui.tripId);
  if (!trip || !ui.form || ui.form._kind !== "weather") return;
  trip.weather = weatherFromForm(ui.form);
  trip.deception = !!ui.form.deception;
  trip.updatedAt = nowIso();
  if (trip.weather.text || trip.weather.night) state.settings.weatherByBoat[trip.boatId] = { ...trip.weather };
  if (announce) persist({ announce });
  else queueSave();
}

function writeFilm() {
  const trip = shownTrip();
  if (!trip || !ui.form || ui.form._kind !== "film") return;
  trip.film = {
    tools: ui.form.filmTools || [],
    kinds: ui.form.filmKinds || [],
    clips: ui.form.clips || "",
    photos: ui.form.photos || "",
    note: ui.form.filmNote || "",
  };
  trip.updatedAt = nowIso();
  queueSave();
}

function leaveScreen() {
  if (ui.form?._kind === "weather") writeWeather(false);
  if (ui.form?._kind === "film") writeFilm();
}

function weatherForm(trip) {
  const weather = trip.weather || {};
  return {
    _kind: "weather",
    weatherText: weather.text || "",
    generated: weather.text || "",
    wind: weather.windKn == null || weather.windKn === "" ? "" : String(weather.windKn),
    advisory: !!weather.advisory,
    night: !!weather.night,
    conditions: weather.conditions || [],
    weatherKind: weather.kind || "",
    weatherSource: weather.source || "",
    weatherAt: weather.at || "",
    weatherCode: weather.code ?? null,
    deception: !!trip.deception,
  };
}

function tripForm(trip) {
  const night = sunIsDown();
  const weather = trip?.weather || {};
  return {
    _kind: "trip",
    id: trip?.id || null,
    title: trip?.title || "",
    fromId: trip?.fromId || "",
    toId: trip?.toId || "",
    purpose: trip?.purpose || "Just a cruise",
    peopleIds: trip?.peopleIds || ["myself"],
    notes: trip?.notes || "",
    meter: trip?.meter || "",
    deception: !!trip?.deception,
    weatherText: weather.text || "",
    generated: weather.text || "",
    wind: weather.windKn == null || weather.windKn === "" ? "" : String(weather.windKn),
    advisory: !!weather.advisory,
    night: trip ? !!weather.night : night,
    conditions: weather.conditions || [],
    weatherKind: weather.kind || "",
    weatherSource: weather.source || "",
    weatherAt: weather.at || "",
    weatherCode: weather.code ?? null,
  };
}

function blankEntry(kind, tripId) {
  const here = boat();
  return {
    _kind: "entry",
    id: null,
    kind,
    link: !!tripId,
    tripId: tripId || "",
    at: toLocalInput(),
    placeId: "",
    title: "",
    notes: "",
    tank: kind === "water" ? "Fresh water" : kind === "fuel" ? (here.id === "hm2" ? "Main diesel" : "Main") : "",
    quantity: "",
    units: here.units,
    cost: "",
    currency: here.currency,
    unitPrice: "",
    engineHours: "",
    parts: "",
    receipt: "",
    catchName: "Dungeness",
    count: "",
    timeOfDay: "",
    narrative: "",
    stars: 0,
    alongType: "Note",
    story: false,
    photo: "",
    openTicket: false,
  };
}

function entryToForm(entry) {
  return {
    _kind: "entry",
    id: entry.id,
    kind: entry.kind,
    link: !!entry.tripId,
    tripId: entry.tripId || "",
    at: toLocalInput(entry.at),
    placeId: entry.placeId || "",
    title: entry.title || "",
    notes: entry.notes || "",
    tank: entry.tank || "",
    quantity: entry.quantity ?? "",
    units: entry.units || boat().units,
    cost: entry.cost ?? "",
    currency: entry.currency || boat().currency,
    unitPrice: entry.unitPrice ?? "",
    engineHours: entry.engineHours ?? "",
    parts: entry.parts || "",
    receipt: entry.receipt || "",
    catchName: entry.catchName || "",
    count: entry.count ?? "",
    timeOfDay: entry.timeOfDay || "",
    narrative: entry.narrative || entry.notes || "",
    stars: entry.stars || 0,
    alongType: entry.alongType || "Note",
    story: !!entry.story,
    photo: entry.photo || "",
    openTicket: false,
  };
}

function filmForm(trip) {
  const film = trip.film || {};
  return {
    _kind: "film",
    filmTools: film.tools || [],
    filmKinds: film.kinds || [],
    clips: film.clips || "",
    photos: film.photos || "",
    filmNote: film.note || "",
  };
}

function blankPerson() {
  return { _kind: "person", id: null, name: "", categories: [], serviceTags: [], businessName: "", phone: "", notes: "", photo: "" };
}
function blankPlace() {
  return { _kind: "place", id: null, name: "", detail: "", tags: "", favorite: false, region: boat().region };
}

function sunIsDown() {
  const here = boat();
  const date = new Date();
  if (Number.isNaN(date.getTime())) return false;
  const r = Math.PI / 180;
  const i = date.getTime() / 864e5 + 2440587.5 - 2451545;
  const l = (280.46 + 0.9856474 * i) % 360;
  const s = ((357.528 + 0.9856003 * i) % 360) * r;
  const a = (l + 1.915 * Math.sin(s) + 0.02 * Math.sin(2 * s)) * r;
  const p = (23.439 - 4e-7 * i) * r;
  const h = Math.asin(Math.sin(p) * Math.sin(a));
  const y = Math.atan2(Math.cos(p) * Math.sin(a), Math.cos(a));
  const hourAngle = ((((18.697374558 + 24.06570982441908 * i) % 24) * 15 + here.lon) * r) - y;
  const alt = Math.asin(Math.sin(here.lat * r) * Math.sin(h) + Math.cos(here.lat * r) * Math.cos(h) * Math.cos(hourAngle)) / r;
  return alt < -0.833;
}

function resizeImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      const scale = Math.min(1, 1280 / Math.max(image.width, image.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/jpeg", 0.72));
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("photo"));
    };
    image.src = url;
  });
}

function field(label, name, value, options = {}) {
  const id = `f-${name}`;
  if (options.area) {
    return `<label class="field" for="${id}"><span>${esc(label)}</span><textarea id="${id}" name="${name}">${esc(value)}</textarea></label>`;
  }
  const type = options.type || "text";
  const extra = [
    options.inputMode ? ` inputmode="${options.inputMode}"` : "",
    options.step ? ` step="${options.step}"` : "",
    options.placeholder ? ` placeholder="${esc(options.placeholder)}"` : "",
    options.readOnly ? " readonly" : "",
  ].join("");
  return `<label class="field" for="${id}"><span>${esc(label)}</span><input id="${id}" name="${name}" type="${type}" value="${esc(value)}"${extra}></label>`;
}

function chips(group, options, selected, multi) {
  const set = new Set(Array.isArray(selected) ? selected : [selected]);
  return `<div class="chiprow">${options.map((option) => `<button type="button" class="chip${set.has(option.value) ? " on" : ""}" data-action="chip" data-group="${esc(group)}" data-value="${esc(option.value)}" data-multi="${multi ? "1" : "0"}">${esc(option.label)}</button>`).join("")}</div>`;
}

function photoHtml(src) {
  if (!src || !String(src).startsWith("data:image/")) return "";
  return `<img class="thumb" alt="Attached photo" src="${src}">`;
}

function starsHtml(count) {
  return `<div class="stars" role="group" aria-label="Starfish score">${[1, 2, 3, 4, 5].map((n) => `<button type="button" data-action="star" data-value="${n}" aria-label="${n} of 5 starfish"><img src="starfish.png" alt="" width="32" height="32" style="opacity:${n <= count ? 1 : 0.35};filter:${n <= count ? "none" : "grayscale(1)"}"></button>`).join("")}</div>`;
}

function statusLabel(status) {
  if (status === "underway") return "Underway";
  if (status === "arrived") return "Arrived";
  return "Planned";
}

function weatherMeta(weather) {
  if (!weather || (!weather.text && !weather.night)) return "No conditions saved on this phone yet.";
  const kind = weather.kind === "forecast" ? "Forecast" : weather.kind === "observed" ? "What I saw" : "Noted";
  const when = weather.at ? fmt(weather.at) : "";
  return `${kind} · ${weather.source || "Manual"}${when ? ` · ${when}` : ""}. Saved on this phone, not a live warning.`;
}

function zoneLinks() {
  const links = (ZONES[ui.boatId] || []).map((zone) => `<a class="btn block" href="${esc(zone.url)}" target="_blank" rel="noopener">${esc(zone.name)}</a>`);
  if (boat().pnw) links.push(`<a class="btn block" href="${DECEPTION_PASS_URL}" target="_blank" rel="noopener">Deception Pass current · NOAA</a>`);
  return `<div class="stack">${links.join("")}</div>`;
}

function weatherEditor(form) {
  const night = !!form.night;
  const options = CONDITIONS.map((item) => (item.id === "sunny" && night ? { value: "sunny", label: "Clear" } : { value: item.id, label: item.label }));
  return `<section class="card">
    <p class="kicker">Conditions</p>
    <button type="button" class="btn block${night ? " on" : ""}" id="night-toggle" data-action="night">${night ? "Night weather on" : "Night weather off"}</button>
    <p class="hint">${night ? "Sun is down, or you turned Night on. Clear is not called sunny." : "Turn Night on after dark. Sunny is only used when you mean it, or a sky code says so."}</p>
    ${chips("conditions", options, form.conditions || [], true)}
    ${field("Plain-language conditions", "weatherText", form.weatherText || "", { area: true, placeholder: "Cloudy, windy, light rain" })}
    ${field("Wind (kn)", "wind", form.wind || "", { type: "number", inputMode: "decimal", step: "1" })}
    <div class="split">
      <button type="button" class="btn${form.weatherKind === "forecast" ? " on" : ""}" data-action="weatherKind" data-value="forecast">Forecast</button>
      <button type="button" class="btn${form.weatherKind === "observed" ? " on" : ""}" data-action="weatherKind" data-value="observed">What I saw</button>
    </div>
    <p class="meta" id="weather-meta">${esc(weatherMeta(weatherFromForm(form)))}</p>
    <button type="button" class="btn block" data-action="forecast">Read conditions</button>
    <p class="hint">Read conditions needs a signal. It uses the sky, rain, snow, fog, and wind actually returned. Wind alone is not called sunny.</p>
    <button type="button" class="btn block${form.advisory ? " on" : ""}" data-action="flag" data-flag="advisory">${form.advisory ? "Small craft / wind warning posted" : "No advisory"}</button>
    ${boat().pnw ? `<button type="button" class="btn block${form.deception ? " on" : ""}" data-action="flag" data-flag="deception">${form.deception ? "Deception Pass: timing for slack" : "Deception Pass not on this plan"}</button>` : ""}
    <p class="hint">Forecast zones, same pages as before. They open in the browser and need a signal.</p>
    ${zoneLinks()}
  </section>`;
}

function peoplePicker(selected) {
  const ids = new Set(selected || ["myself"]);
  ids.add("myself");
  const buttons = state.people.map((person) => {
    if (person.id === "myself") return `<span class="chip on">Myself</span>`;
    const on = ids.has(person.id);
    return `<button type="button" class="chip${on ? " on" : ""}" data-action="personToggle" data-id="${esc(person.id)}">${esc(person.name)}</button>`;
  });
  return `<div class="field"><span>People aboard</span><p class="hint">Myself stays person 1. Logged by is separate.</p><div class="chiprow">${buttons.join("")}</div>
    <button type="button" class="btn quiet block" data-action="addPerson">Add a person</button></div>`;
}

function placeButton(label, fieldName) {
  const id = ui.form?.[fieldName] || "";
  return `<div class="field"><span>${esc(label)}</span><button type="button" class="btn block" data-action="pickPlace" data-field="${esc(fieldName)}">${esc(id ? placeName(id) : "Choose place")}</button></div>`;
}

function tripSwitch(selectedId) {
  const trips = boatTrips();
  if (!trips.length) return "";
  return `<label class="field"><span>Trip</span><select name="switchTrip">${trips.map((trip) => `<option value="${esc(trip.id)}"${trip.id === selectedId ? " selected" : ""}>${esc(trip.title)} · ${esc(statusLabel(trip.status))}</option>`).join("")}</select></label>`;
}

function aboardLine(trip) {
  const names = [];
  for (const id of trip.peopleIds || ["myself"]) {
    const name = personName(id);
    if (!names.includes(name)) names.push(name);
  }
  return `${names.map((name, index) => `${index + 1}. ${name}`).join(" · ")} · ${names.length} aboard`;
}

function faces(trip) {
  return `<div class="faces">${(trip.peopleIds || []).map((id) => {
    const person = state.people.find((item) => item.id === id);
    const name = person?.name || "Someone";
    const photo = person?.photo && String(person.photo).startsWith("data:image/") ? `<img src="${person.photo}" alt="">` : esc(name.slice(0, 1).toUpperCase());
    return `<span class="face" title="${esc(name)}">${photo}</span>`;
  }).join("")}</div>`;
}

function entryTitle(entry) {
  if (entry.kind === "note" && entry.alongType && entry.alongType !== "Note") return entry.alongType;
  if (entry.title && entry.kind !== "rating") return entry.title;
  if (entry.kind === "note") return entry.tripId ? "Trip note" : "Note";
  return KIND_LABEL[entry.kind] || "Entry";
}

function entrySummary(entry) {
  if (entry.kind === "fuel" || entry.kind === "water") {
    return [entry.tank, entry.quantity != null ? `${entry.quantity} ${entry.units || ""}`.trim() : "", entry.cost != null ? `${entry.cost} ${entry.currency || ""}`.trim() : ""].filter(Boolean).join(" · ");
  }
  if (entry.kind === "pumpout") return [entry.placeId ? placeName(entry.placeId) : "", entry.cost != null ? `${entry.cost} ${entry.currency || ""}`.trim() : "", entry.notes].filter(Boolean).join(" · ");
  if (entry.kind === "crab") return [entry.catchName, entry.count != null ? String(entry.count) : "", entry.timeOfDay, entry.notes].filter(Boolean).join(" · ");
  if (entry.kind === "rating") return entry.narrative || entry.notes || "";
  return entry.notes || "";
}

function entryMeta(entry) {
  const trip = entry.tripId ? tripById(entry.tripId) : null;
  return `${fmt(entry.at)} · ${trip ? `Trip: ${trip.title}` : "Boat activity, no trip"} · Logged by ${entry.loggedBy || state.settings.loggedBy || "Wishy"}`;
}

function placeQueryValue() {
  return ui.picker ? ui.picker.query : ui.placeQuery;
}
function placeScopeValue() {
  return ui.picker ? ui.picker.scope : ui.placeScope;
}
function sortPlaces(list) {
  const region = boat().region;
  return list.slice().sort((a, b) => (a.region === region ? 0 : 1) - (b.region === region ? 0 : 1) || a.name.localeCompare(b.name));
}
function placesToShow() {
  const query = placeQueryValue().trim().toLowerCase();
  if (query) {
    return sortPlaces(state.places.filter((place) => `${place.name} ${place.detail} ${(place.tags || []).join(" ")}`.toLowerCase().includes(query))).slice(0, 30);
  }
  const scope = placeScopeValue();
  if (scope === "recents") {
    return state.places.filter((place) => place.lastUsedAt).sort((a, b) => b.lastUsedAt.localeCompare(a.lastUsedAt)).slice(0, 8);
  }
  if (scope === "favorites") return sortPlaces(state.places.filter((place) => place.favorite));
  return sortPlaces(state.places).slice(0, ui.placeShow);
}
function placeMeta(place) {
  return [place.favorite ? "Favorite" : "", place.lastUsedAt ? "Recent" : "", REGION_LABEL[place.region] || "", (place.tags || []).join(", ")].filter(Boolean).join(" · ");
}
function placeCards(mode) {
  const list = placesToShow();
  if (!list.length) {
    const query = placeQueryValue().trim();
    const empty = query ? "No places match that search." : placeScopeValue() === "recents" ? "No recent places yet. A place lands here after you use it." : "No favorite places yet.";
    return `<p class="empty">${esc(empty)}</p>${query ? `<button type="button" class="btn block" data-action="clearSearch">Clear search</button>` : ""}`;
  }
  return list.map((place) => {
    const body = `<span class="rowtitle">${esc(place.name)}</span><span class="rowdetail">${esc(place.detail || "")}</span><span class="rowmeta">${esc(placeMeta(place))}</span>`;
    if (mode === "picker") return `<button type="button" class="rowmain" data-action="choosePlace" data-id="${esc(place.id)}">${body}</button>`;
    return `<div class="row"><button type="button" class="rowmain" data-action="openPlace" data-id="${esc(place.id)}">${body}</button><button type="button" class="iconbtn" data-action="fav" data-id="${esc(place.id)}" aria-label="Favorite ${esc(place.name)}" aria-pressed="${place.favorite ? "true" : "false"}">${place.favorite ? "★" : "☆"}</button></div>`;
  }).join("");
}

function backBtn() {
  return `<button type="button" class="btn quiet block" data-action="back">Back</button>`;
}

function screenHome() {
  const trips = boatTrips();
  const current = currentTrip();
    const past = trips.filter((trip) => trip.status === "arrived");
    const other = trips.filter((trip) => trip !== current && trip.status !== "arrived");
  const saved = state.settings.weatherByBoat[ui.boatId];
  return `<p class="kicker">Boat</p><h1>${esc(boat().name)}</h1>
    <div class="split">
      <button type="button" class="btn${ui.boatId === "hm2" ? " on" : ""}" data-action="boat" data-id="hm2">Halve Maan II</button>
      <button type="button" class="btn${ui.boatId === "zeeotter" ? " on" : ""}" data-action="boat" data-id="zeeotter">Zeeotter</button>
    </div>
    <section class="card"><h2>Current trip</h2>
      ${current ? `<p><span class="pill${current.status === "underway" ? " warn" : ""}">${esc(statusLabel(current.status))}</span></p><p><strong>${esc(current.title)}</strong></p><p class="meta">${esc(current.tripCode || "")}</p><button type="button" class="btn primary" data-action="openTrip" data-id="${esc(current.id)}">Open trip log</button>` : `<p>No trip underway.</p><button type="button" class="btn primary" data-action="startTrip">Start a trip</button>`}
    </section>
    <section class="card"><h2>Add boat activity</h2><p>Dock work, a tank fill, washing, or a pump-out. No trip required.</p>
      <button type="button" class="btn primary" data-action="activity">Add boat activity</button>
    </section>
    ${other.length ? `<section class="card"><h2>Also planned</h2><div class="stack">${other.map((trip) => `<button type="button" class="rowmain" data-action="openTrip" data-id="${esc(trip.id)}"><span class="rowtitle">${esc(trip.title)}</span><span class="rowmeta">${esc(statusLabel(trip.status))} · ${esc(trip.tripCode || "")}</span></button>`).join("")}</div></section>` : ""}
    ${past.length ? `<section class="card"><h2>Arrived</h2><div class="stack">${past.map((trip) => `<button type="button" class="rowmain" data-action="openTrip" data-id="${esc(trip.id)}"><span class="rowtitle">${esc(trip.title)}</span><span class="rowmeta">${esc(fmt(trip.arrivedAt || trip.departedAt))} · ${esc(trip.tripCode || "")}</span></button>`).join("")}</div></section>` : ""}
    <section class="card"><h2>Forecast</h2><p>${saved?.text ? esc(saved.text) : "No conditions saved yet."}</p><p class="meta">${esc(weatherMeta(saved))}</p>${zoneLinks()}<button type="button" class="btn block" data-action="forecast">Read conditions</button></section>`;
}

function screenTrip() {
  const trip = shownTrip();
  if (!trip) {
    return `<p class="kicker">Trip</p><h1>No trip yet</h1><p>The trip is the log. Notes, crab, photos, and the rating hang off it.</p><button type="button" class="btn primary" data-action="startTrip">Start a trip</button>`;
  }
  const weather = trip.weather || {};
  return `<p class="kicker">Trip</p>${tripSwitch(trip.id)}
    <h1>${esc(trip.title)}</h1>
    <p><span class="pill${trip.status === "underway" ? " warn" : trip.status === "arrived" ? " ok" : ""}">${esc(statusLabel(trip.status))}</span></p>
    <p class="meta">Trip ID <strong>${esc(trip.tripCode || "")}</strong></p>
    <section class="card"><p>${esc(placeName(trip.fromId))} → ${esc(placeName(trip.toId))}</p><p>${esc(trip.purpose || "")}</p>${faces(trip)}<p>${esc(aboardLine(trip))}</p>
      ${trip.meter ? `<p class="meta">${esc(boat().meterLabel)}: ${esc(trip.meter)}${boat().meterOffset ? ` · true hours ≈ ${Number(trip.meter) + boat().meterOffset}` : ""}</p>` : ""}
      <button type="button" class="btn quiet block" data-action="editTrip">Edit trip</button>
    </section>
    ${trip.status === "underway" ? `<button type="button" class="btn alert" data-action="addNote" data-id="${esc(trip.id)}">Add note underway</button>` : ""}
    ${weatherEditor(ui.form && ui.form._kind === "weather" ? ui.form : weatherForm(trip))}
    <div class="stack">
      <button type="button" class="btn primary" data-action="journal" data-scope="trip">Journal</button>
      <button type="button" class="btn" data-action="newEntry" data-kind="rating" data-link="1">Narrative rating</button>
      <button type="button" class="btn" data-action="newEntry" data-kind="crab" data-link="1">Crab catch</button>
      <button type="button" class="btn" data-action="nav" data-screen="media">Media</button>
      <button type="button" class="btn" data-action="newEntry" data-kind="repair" data-link="1">Repair</button>
      <button type="button" class="btn" data-action="newEntry" data-kind="note" data-link="1">Trip note</button>
      <button type="button" class="btn" data-action="best">Best moment</button>
      <button type="button" class="btn" data-action="newTicket" data-link="1">Maintenance ticket</button>
    </div>
    ${trip.bestMoment?.text ? `<section class="card"><h2>Best moment</h2><p>${esc(trip.bestMoment.text)}</p><p class="meta">${esc((trip.bestMoment.tags || []).join(" · "))}</p></section>` : ""}
    ${trip.rating?.narrative ? `<section class="card"><h2>Narrative</h2>${starsHtml(trip.rating.stars || 0)}<p>${esc(trip.rating.narrative)}</p></section>` : ""}
    ${trip.status === "underway" ? `<button type="button" class="btn primary" data-action="arrive">Arrived — wrap up</button>` : `<button type="button" class="btn" data-action="arrive">Edit wrap-up</button>`}
    <p class="hint">${weather.advisory ? "Small craft / wind warning was marked on this trip. " : ""}${trip.deception ? "Deception Pass is on this plan." : ""}</p>`;
}

function screenTripForm() {
  const form = ui.form;
    const editing = !!form.id;
  const existingStatus = editing ? tripById(form.id)?.status : "";
  const showDepart = !editing || existingStatus === "planned";
  return `<p class="kicker">${editing ? "Edit trip" : "Start a trip"}</p><h1>${editing ? "Trip details" : "Depart"}</h1>
    ${field("Title", "title", form.title, { placeholder: "Filled in from the places if you leave it blank" })}
    ${placeButton("Departure", "fromId")}
    ${placeButton("Destination", "toId")}
    <div class="field"><span>Purpose</span>${chips("purpose", PURPOSES.map((item) => ({ value: item, label: item })), form.purpose, false)}</div>
    ${peoplePicker(form.peopleIds)}
    ${field(boat().meterLabel, "meter", form.meter, { type: "number", inputMode: "decimal", step: "0.1" })}
    <p class="hint" id="meter-hint">${esc(meterHint(form.meter))}</p>
    ${field("Trip note", "notes", form.notes, { area: true })}
    ${weatherEditor(form)}
    ${showDepart ? `<button type="button" class="btn primary" data-action="saveTrip" data-mode="depart">Depart</button>` : ""}
    <button type="button" class="btn block" data-action="saveTrip" data-mode="${editing ? "save" : "plan"}">${editing ? "Save changes" : "Save as planned"}</button>
    ${editing ? `<button type="button" class="btn danger block" data-action="deleteTrip">Delete trip</button>` : ""}
    ${backBtn()}`;
}

function meterHint(value) {
  const reading = Number(value);
  if (!boat().meterOffset || !value || !Number.isFinite(reading)) return boat().id === "hm2" ? "Optional. True hours are the reading plus 1231." : "Optional.";
  return `True hours ≈ ${reading + boat().meterOffset} (reading + ${boat().meterOffset}).`;
}

function journalKinds() {
  const trip = shownTrip();
  const linked = ui.journalScope === "trip" && !!trip;
  const kinds = [["note", "Note"], ["repair", "Repair"], ["wash", "Wash"], ["fuel", "Fuel"], ["water", "Water"], ["pumpout", "Pump-out"]];
  if (trip) kinds.push(["rating", "Rating"], ["crab", "Crab"]);
  return `<div class="chiprow">${kinds.map(([kind, label]) => `<button type="button" class="chip" data-action="newEntry" data-kind="${kind}" data-link="${linked || kind === "rating" || kind === "crab" ? "1" : "0"}">${label}</button>`).join("")}</div>`;
}

function screenJournal() {
  const trip = shownTrip();
  const scope = ui.journalScope === "trip" && trip ? "trip" : "all";
  const entries = boatEntries().filter((entry) => (scope === "all" ? true : entry.tripId === trip.id));
  return `<p class="kicker">Journal</p><h1>${ui.activityPrompt ? "Add boat activity" : "Journal"}</h1>
    ${ui.activityPrompt ? `<p>No trip required. You can link one later.</p>` : ""}
    <div class="split">
      <button type="button" class="btn${scope === "trip" ? " on" : ""}" data-action="journalScope" data-value="trip">This trip</button>
      <button type="button" class="btn${scope === "all" ? " on" : ""}" data-action="journalScope" data-value="all">All boat</button>
    </div>
    ${scope === "trip" && trip ? `<p class="meta">${esc(trip.title)}</p>` : `<p class="meta">Everything logged on ${esc(boat().name)}, with or without a trip.</p>`}
    ${journalKinds()}
    <div class="stack">${entries.length ? entries.map((entry) => `<button type="button" class="rowmain" data-action="openEntry" data-id="${esc(entry.id)}"><span class="rowtitle">${esc(entryTitle(entry))}${entry.story ? " · story" : ""}</span><span class="rowdetail">${esc(entrySummary(entry))}</span><span class="rowmeta">${esc(entryMeta(entry))}</span></button>`).join("") : `<p class="empty">Nothing here yet.</p>`}</div>`;
}

function screenEntry() {
  const form = ui.form;
  const label = form.kind === "note" && form.link ? "Trip note" : KIND_LABEL[form.kind] || "Entry";
  const trip = form.tripId ? tripById(form.tripId) : null;
  const heading = form.link && trip ? `${trip.title} · ${label}` : form.link ? label : `Boat activity · ${label}`;
  const locked = form.kind === "rating" || form.kind === "crab";
  let extra = "";
  if (form.kind === "note") {
    extra += `<div class="field"><span>Type</span>${chips("alongType", ALONG_TYPES.map((item) => ({ value: item, label: item })), form.alongType, false)}</div>`;
    extra += `<button type="button" class="btn block${form.story ? " on" : ""}" data-action="flag" data-flag="story">${form.story ? "Story-worthy" : "Mark story-worthy"}</button>`;
  }
  if (form.kind === "repair") {
    extra += field("Engine hours", "engineHours", form.engineHours, { type: "number", inputMode: "decimal", step: "0.1" });
    extra += field("Parts", "parts", form.parts, { placeholder: "What you know. Don't guess a part number." });
    extra += field("Receipt", "receipt", form.receipt);
    extra += `<button type="button" class="btn block${form.openTicket ? " on" : ""}" data-action="flag" data-flag="openTicket">${form.openTicket ? "Will also open a maintenance ticket" : "Also open a maintenance ticket"}</button>`;
  }
  if (form.kind === "fuel" || form.kind === "water") {
    extra += field("Tank", "tank", form.tank);
    extra += field("Quantity added", "quantity", form.quantity, { type: "number", inputMode: "decimal", step: "0.1" });
    extra += `<label class="field"><span>Units</span><select name="units">${["gallons", "liters"].map((unit) => `<option${form.units === unit ? " selected" : ""}>${esc(unit)}</option>`).join("")}</select></label>`;
    extra += field("Total cost", "cost", form.cost, { type: "number", inputMode: "decimal", step: "0.01" });
    extra += `<label class="field"><span>Currency</span><select name="currency">${["USD", "EUR", "GBP", "CAD"].map((currency) => `<option${form.currency === currency ? " selected" : ""}>${currency}</option>`).join("")}</select></label>`;
    extra += field("Unit price (optional)", "unitPrice", form.unitPrice, { type: "number", inputMode: "decimal", step: "0.01" });
    extra += `<p class="hint">${esc(priceHint(form))}</p>`;
  }
  if (form.kind === "pumpout") {
    extra += field("Cost", "cost", form.cost, { type: "number", inputMode: "decimal", step: "0.01" });
    extra += `<label class="field"><span>Currency</span><select name="currency">${["USD", "EUR", "GBP", "CAD"].map((currency) => `<option${form.currency === currency ? " selected" : ""}>${currency}</option>`).join("")}</select></label>`;
    extra += `<p class="hint">Quantity only if you know it.</p>`;
    extra += field("Quantity (optional)", "quantity", form.quantity, { type: "number", inputMode: "decimal", step: "0.1" });
  }
  if (form.kind === "crab") {
    extra += field("Catch", "catchName", form.catchName);
    extra += field("Count", "count", form.count, { type: "number", inputMode: "numeric", step: "1" });
    extra += field("Time", "timeOfDay", form.timeOfDay, { placeholder: "Late afternoon" });
  }
  if (form.kind === "rating") {
    extra += `<div class="field"><span>Starfish, optional</span>${starsHtml(form.stars || 0)}</div>`;
    extra += field("How the trip went", "narrative", form.narrative, { area: true });
  }
  const notes = form.kind === "rating" ? "" : field("Notes", "notes", form.notes, { area: true });
  const link = locked
    ? `<p class="meta">Attached to ${esc(trip ? trip.title : "this trip")}.</p>`
    : `<button type="button" class="btn block${form.link ? " on" : ""}" data-action="toggleLink">${form.link ? `Linked to this trip${trip ? `: ${trip.title}` : ""}` : "No trip — boat activity only"}</button>${form.link ? tripChoices(form.tripId) : ""}`;
  return `<p class="kicker">${form.id ? "Edit" : "Add"}</p><h1>${esc(heading)}</h1>
    ${field("When", "at", form.at, { type: "datetime-local" })}
    ${placeButton("Location", "placeId")}
    ${extra}
    ${notes}
    <label class="field"><span>Photo</span><input type="file" accept="image/*" id="photo-file"></label>
    ${photoHtml(form.photo)}
    ${link}
    <p class="hint">Logged by ${esc(state.settings.loggedBy || "Wishy")}. That is who writes it down, not who is aboard.</p>
    <button type="button" class="btn primary" data-action="saveEntry">${form.id ? "Save changes" : "Save"}</button>
    ${form.id ? `<button type="button" class="btn danger block" data-action="deleteEntry">Delete entry</button>` : ""}
    ${backBtn()}`;
}

function priceHint(form) {
  const quantity = Number(form.quantity);
  const cost = Number(form.cost);
  if (!(quantity > 0) || form.cost === "" || Number.isNaN(cost)) return "";
  return `About ${(cost / quantity).toFixed(2)} ${form.currency || ""} per ${form.units || "unit"}.`;
}

function tripChoices(selected) {
  const trips = boatTrips();
  if (!trips.length) return "";
  return `<label class="field"><span>Which trip</span><select name="tripId">${trips.map((trip) => `<option value="${esc(trip.id)}"${trip.id === selected ? " selected" : ""}>${esc(trip.title)}</option>`).join("")}</select></label>`;
}

function screenMedia() {
  const trip = shownTrip();
  if (!trip) return `<p class="kicker">Media</p><h1>Media</h1><p>Cameras, shots, and reminders belong to a trip.</p><button type="button" class="btn primary" data-action="startTrip">Start a trip</button>`;
  const items = state.media.filter((item) => item.tripId === trip.id && item.boatId === ui.boatId && item.status === ui.mediaScope);
  const checks = trip.checks || {};
  const form = ui.form && ui.form._kind === "film" ? ui.form : filmForm(trip);
  return `<p class="kicker">Media</p><h1>${esc(trip.title)}</h1>
    <section class="card"><h2>Preflight</h2><p class="hint">A reminder, not a view count. Saved on this phone.</p>
      <div class="stack">${CHECKS.map(([id, label]) => `<button type="button" class="btn block${checks[id] ? " on" : ""}" data-action="check" data-id="${id}" aria-pressed="${checks[id] ? "true" : "false"}">${checks[id] ? "Packed · " : ""}${esc(label)}</button>`).join("")}</div>
    </section>
    <section class="card"><h2>What did you film?</h2>
      <div class="field"><span>Shot on</span>${chips("filmTools", FILM_TOOLS.map((item) => ({ value: item, label: item })), form.filmTools, true)}</div>
      <div class="field"><span>What kind</span>${chips("filmKinds", FILM_KINDS.map((item) => ({ value: item, label: item })), form.filmKinds, true)}</div>
      ${field("Video clips", "clips", form.clips, { type: "number", inputMode: "numeric" })}
      ${field("Photos", "photos", form.photos, { type: "number", inputMode: "numeric" })}
      ${field("Film note", "filmNote", form.filmNote, { area: true })}
      <p class="hint">Video files stay in the camera roll. The log keeps the counts and the note.</p>
    </section>
    <div class="split">
      <button type="button" class="btn${ui.mediaScope === "planned" ? " on" : ""}" data-action="mediaScope" data-value="planned">Planned</button>
      <button type="button" class="btn${ui.mediaScope === "captured" ? " on" : ""}" data-action="mediaScope" data-value="captured">Captured</button>
    </div>
    <div class="stack">
      <button type="button" class="btn" data-action="newMedia" data-status="planned" data-type="reminder">Add camera reminder</button>
      <button type="button" class="btn" data-action="newMedia" data-status="planned" data-type="shot">Add planned shot</button>
      <button type="button" class="btn" data-action="newMedia" data-status="captured" data-type="file">Add captured photo</button>
    </div>
    <div class="stack">${items.length ? items.map((item) => `<button type="button" class="rowmain" data-action="openMedia" data-id="${esc(item.id)}"><span class="rowtitle">${esc(item.title || "Untitled")}</span><span class="rowdetail">${esc(item.detail || "")}</span><span class="rowmeta">${esc(item.type)} · ${esc(item.status)}${item.videoName ? ` · ${item.videoName}` : ""}</span></button>`).join("") : `<p class="empty">Nothing in this list yet.</p>`}</div>`;
}

function screenMediaForm() {
  const form = ui.form;
  return `<p class="kicker">Media</p><h1>${form.id ? "Edit" : "Add"}</h1>
    ${field("Title", "title", form.title, { placeholder: form.type === "reminder" ? "Spare camera in the bag" : "Wide departure" })}
    ${field("Notes", "detail", form.detail, { area: true, placeholder: "Viewpoint, lens, or why this shot" })}
    <label class="field"><span>Photo or video name</span><input type="file" accept="image/*,video/*" id="photo-file"></label>
    ${form.videoName ? `<p class="meta">Video stays in the camera roll: ${esc(form.videoName)}</p>` : ""}
    ${photoHtml(form.photo)}
    <button type="button" class="btn primary" data-action="saveMedia">Save</button>
    ${form.id ? `<button type="button" class="btn danger block" data-action="deleteMedia">Delete</button>` : ""}
    ${backBtn()}`;
}

function screenBest() {
  const form = ui.form;
  return `<p class="kicker">Best moment</p><h1>Best moment</h1>
    ${field("What stayed with you", "bestText", form.bestText, { area: true })}
    <div class="field"><span>Tags</span>${chips("bestTags", BEST_TAGS.map((item) => ({ value: item, label: item })), form.bestTags, true)}</div>
    <button type="button" class="btn primary" data-action="saveBest">Save best moment</button>
    ${backBtn()}`;
}

function screenWrap() {
  const trip = shownTrip();
  const form = ui.form;
  const arrived = trip?.status === "arrived";
  return `<p class="kicker">${esc(trip?.tripCode || "")}</p><h1>${arrived ? "Wrap-up" : "Arrived"}</h1>
    <p>${esc(trip?.title || "")}</p>
    <section class="card"><h2>Narrative rating</h2><p class="hint">Starfish is optional.</p>${starsHtml(form.stars || 0)}
      ${field("How the trip went", "narrative", form.narrative, { area: true })}
    </section>
    <section class="card"><h2>Best moment</h2>
      ${field("Best moment", "bestText", form.bestText, { area: true })}
      ${chips("bestTags", BEST_TAGS.map((item) => ({ value: item, label: item })), form.bestTags, true)}
    </section>
    <section class="card"><h2>What did you film?</h2>
      ${chips("filmTools", FILM_TOOLS.map((item) => ({ value: item, label: item })), form.filmTools, true)}
      ${chips("filmKinds", FILM_KINDS.map((item) => ({ value: item, label: item })), form.filmKinds, true)}
      ${field("Video clips", "clips", form.clips, { type: "number", inputMode: "numeric" })}
      ${field("Photos", "photos", form.photos, { type: "number", inputMode: "numeric" })}
      ${field("Film note", "filmNote", form.filmNote)}
    </section>
    <button type="button" class="btn primary" data-action="saveWrap">${arrived ? "Save wrap-up" : "Save and mark arrived"}</button>
    ${arrived ? "" : `<button type="button" class="btn block" data-action="skipWrap">Arrive without the story</button>`}
    ${backBtn()}`;
}

function filteredTickets() {
  const open = new Set(["open", "progress", "waiting"]);
  return state.tickets
    .filter((ticket) => ticket.boatId === ui.boatId && (ui.maintScope === "open" ? open.has(ticket.status) : !open.has(ticket.status)))
    .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
}

function screenMaint() {
  const tickets = filteredTickets();
  const parts = state.parts.filter((part) => part.boatId === ui.boatId).sort((a, b) => (b.at || "").localeCompare(a.at || ""));
  return `<p class="kicker">Maintenance</p><h1>${esc(boat().name)}</h1>
    <p>Tickets are work still to manage. A closed ticket does not mean a part was replaced.</p>
    <div class="split">
      <button type="button" class="btn${ui.maintScope === "open" ? " on" : ""}" data-action="maintScope" data-value="open">Open</button>
      <button type="button" class="btn${ui.maintScope === "closed" ? " on" : ""}" data-action="maintScope" data-value="closed">Closed</button>
    </div>
    <button type="button" class="btn primary" data-action="newTicket">Add ticket</button>
    <div class="stack">${tickets.length ? tickets.map((ticket) => `<button type="button" class="rowmain" data-action="openTicket" data-id="${esc(ticket.id)}"><span class="rowtitle">${esc(ticket.title)}</span><span class="rowdetail">${esc(ticket.detail || "")}</span><span class="rowmeta">${esc(TICKET_STATUS.find((item) => item[0] === ticket.status)?.[1] || ticket.status)}</span></button>`).join("") : `<p class="empty">No ${ui.maintScope} tickets.</p>`}</div>
    <section class="card"><h2>Parts ledger</h2><p class="hint">A part is recorded only when you add it. Closing a ticket does not add one.</p>
      <button type="button" class="btn block" data-action="newPart">Add part</button>
      <div class="stack">${parts.length ? parts.map((part) => `<button type="button" class="rowmain" data-action="openPart" data-id="${esc(part.id)}"><span class="rowtitle">${esc(part.name)}</span><span class="rowmeta">${esc([part.partNumber ? `No. ${part.partNumber}` : "", part.verified ? "Number checked" : "Number not checked", part.at ? fmt(part.at) : ""].filter(Boolean).join(" · "))}</span></button>`).join("") : `<p class="empty">No parts recorded.</p>`}</div>
    </section>`;
}

function screenTicket() {
  const ticket = ticketById(ui.ticketId);
  if (!ticket) return `<h1>Ticket</h1><p>That ticket is gone.</p>${backBtn()}`;
  const label = TICKET_STATUS.find((item) => item[0] === ticket.status)?.[1] || ticket.status;
  const parts = state.parts.filter((part) => part.ticketId === ticket.id);
  let body = "";
  if (ui.ticketTab === "parts") {
    body = `<p class="hint">Parts for this ticket. The boat ledger is on the Maintenance screen.</p><div class="stack">${parts.length ? parts.map((part) => `<p><strong>${esc(part.name)}</strong><br><span class="meta">${esc(part.partNumber || "No part number")} · ${part.verified ? "Number checked" : "Number not checked"}</span></p>`).join("") : `<p class="empty">No part is attached. Closed does not mean one was replaced.</p>`}</div><button type="button" class="btn block" data-action="newPart" data-ticket="${esc(ticket.id)}">Add part to this ticket</button>`;
  } else if (ui.ticketTab === "reference") {
    body = field("Reference", "reference", ticket.reference || "", { area: true, placeholder: "Manual page, hose diagram, supplier note" });
  } else {
    body = `<p>${esc(ticket.detail || "No detail yet.")}</p><p class="meta">${ticket.tripId && tripById(ticket.tripId) ? `Linked to ${esc(tripById(ticket.tripId).title)}` : "No trip link"}</p><button type="button" class="btn quiet block" data-action="editTicket">Edit title and detail</button>`;
  }
  const closed = ticket.status === "closed" || ticket.status === "cancelled";
  return `<p class="kicker">Ticket</p><h1>${esc(ticket.title)}</h1>
    <p><span class="pill${closed ? "" : " warn"}">${esc(label)}</span></p>
    <div class="chiprow">
      <button type="button" class="chip${ui.ticketTab === "details" ? " on" : ""}" data-action="ticketTab" data-value="details">Details</button>
      <button type="button" class="chip${ui.ticketTab === "parts" ? " on" : ""}" data-action="ticketTab" data-value="parts">Parts history</button>
      <button type="button" class="chip${ui.ticketTab === "reference" ? " on" : ""}" data-action="ticketTab" data-value="reference">Reference</button>
    </div>
    <section class="card">${body}</section>
    <div class="chiprow">${TICKET_STATUS.map(([value, text]) => `<button type="button" class="chip${ticket.status === value ? " on" : ""}" data-action="ticketStatus" data-value="${value}">${text}</button>`).join("")}</div>
    ${closed ? `<p>This ticket is ${esc(label.toLowerCase())}. That is not proof a part was replaced.</p>` : ""}
    ${backBtn()}`;
}

function screenTicketForm() {
  const form = ui.form;
  const trips = boatTrips();
  return `<p class="kicker">Ticket</p><h1>${form.id ? "Edit ticket" : "New ticket"}</h1>
    ${field("Title", "title", form.title)}
    ${field("Detail", "detail", form.detail, { area: true })}
    ${field("Reference", "reference", form.reference || "", { area: true })}
    <button type="button" class="btn block${form.link ? " on" : ""}" data-action="flag" data-flag="link">${form.link ? "Linked to a trip" : "No trip"}</button>
    ${form.link && trips.length ? `<label class="field"><span>Trip</span><select name="tripId">${trips.map((trip) => `<option value="${esc(trip.id)}"${trip.id === form.tripId ? " selected" : ""}>${esc(trip.title)}</option>`).join("")}</select></label>` : ""}
    <button type="button" class="btn primary" data-action="saveTicket">Save ticket</button>
    ${backBtn()}`;
}

function screenPart() {
  const form = ui.form;
  const tickets = state.tickets.filter((ticket) => ticket.boatId === ui.boatId);
  return `<p class="kicker">Part</p><h1>${form.id ? "Edit part" : "Add part"}</h1>
    ${field("Part", "name", form.name)}
    ${field("Part number", "partNumber", form.partNumber, { placeholder: "Leave blank if you have not checked it" })}
    <button type="button" class="btn block${form.verified ? " on" : ""}" data-action="flag" data-flag="verified">${form.verified ? "Part number checked" : "Part number not checked"}</button>
    ${field("Date", "at", form.at, { type: "datetime-local" })}
    ${field("Engine hours", "hours", form.hours, { type: "number", inputMode: "decimal", step: "0.1" })}
    ${field("Quantity", "quantity", form.quantity, { type: "number", inputMode: "decimal", step: "1" })}
    ${field("Source", "source", form.source)}
    ${field("Warranty", "warranty", form.warranty)}
    ${field("Receipt", "receipt", form.receipt)}
    ${field("Notes", "notes", form.notes, { area: true })}
    ${tickets.length ? `<label class="field"><span>Ticket</span><select name="ticketId"><option value="">No ticket</option>${tickets.map((ticket) => `<option value="${esc(ticket.id)}"${ticket.id === form.ticketId ? " selected" : ""}>${esc(ticket.title)}</option>`).join("")}</select></label>` : ""}
    <button type="button" class="btn primary" data-action="savePart">Save part</button>
    ${form.id ? `<button type="button" class="btn danger block" data-action="deletePart">Delete part</button>` : ""}
    ${backBtn()}`;
}

function filteredPeople() {
  return state.people.filter((person) => {
    if (ui.peopleScope === "all") return ui.serviceTag ? (person.serviceTags || []).includes(ui.serviceTag) : true;
    if (ui.peopleScope === "guest") return person.categories.includes("guest") || person.categories.includes("visitor");
    if (ui.peopleScope === "service") return person.categories.includes("service") && (!ui.serviceTag || (person.serviceTags || []).includes(ui.serviceTag));
    return person.categories.includes(ui.peopleScope);
  });
}

function screenPeople() {
  const people = filteredPeople();
  return `<p class="kicker">People & Services</p><h1>Contacts</h1>
    <p>One person can be in several categories and still appears once. Shared by both boats.</p>
    <div class="chiprow">
      ${[["all", "All"], ["friend", "Friends"], ["guest", "Visitors / guests"], ["crew", "Crew"], ["service", "Service"]].map(([id, label]) => `<button type="button" class="chip${ui.peopleScope === id ? " on" : ""}" data-action="peopleScope" data-value="${id}">${label}</button>`).join("")}
    </div>
    <p class="hint">Service tags</p>
    <div class="chiprow">${SERVICE_TAGS.map((tag) => `<button type="button" class="chip${ui.serviceTag === tag ? " on" : ""}" data-action="serviceTag" data-value="${tag}">${esc(tag)}</button>`).join("")}</div>
    <button type="button" class="btn primary" data-action="addPerson">Add a person</button>
    <div class="stack">${people.map((person) => `<button type="button" class="rowmain" data-action="openPerson" data-id="${esc(person.id)}"><span class="rowtitle">${esc(person.name)}</span><span class="rowdetail">${esc(person.notes || "")}</span><span class="rowmeta">${esc([...(person.categories || []).map((id) => PERSON_CATEGORIES.find((item) => item.id === id)?.label || id), businessName(person.businessId), ...(person.serviceTags || [])].filter(Boolean).join(" · "))}</span></button>`).join("")}</div>
    ${state.businesses.length ? `<section class="card"><h2>Companies</h2><div class="stack">${state.businesses.map((business) => `<p><strong>${esc(business.name)}</strong><br><span class="meta">${esc((business.serviceTags || []).join(" · "))}</span></p>`).join("")}</div></section>` : ""}
    ${backBtn()}`;
}

function screenPerson() {
  const form = ui.form;
  const myself = form.id === "myself";
  return `<p class="kicker">Contact</p><h1>${myself ? "Myself" : form.id ? "Edit person" : "New person"}</h1>
    ${myself ? `<p class="hint">Myself stays person 1 on every new trip.</p>` : field("Name", "name", form.name)}
    <div class="field"><span>Categories</span>${chips("categories", PERSON_CATEGORIES.map((item) => ({ value: item.id, label: item.label })), form.categories, true)}</div>
    <div class="field"><span>Service tags</span>${chips("serviceTags", SERVICE_TAGS.map((tag) => ({ value: tag, label: tag })), form.serviceTags, true)}</div>
    ${field("Company", "businessName", form.businessName, { placeholder: "Sample Marine Shop" })}
    ${field("Phone", "phone", form.phone, { type: "tel" })}
    ${field("Notes", "notes", form.notes, { area: true })}
    <label class="field"><span>Photo</span><input type="file" accept="image/*" id="photo-file"></label>
    ${photoHtml(form.photo)}
    <button type="button" class="btn primary" data-action="savePerson">Save contact</button>
    ${form.id && !myself ? `<button type="button" class="btn danger block" data-action="deletePerson">Delete contact</button>` : ""}
    ${backBtn()}`;
}

function screenPlaces() {
  const more = !placeQueryValue().trim() && ui.placeScope === "all" && state.places.length > ui.placeShow;
  return `<p class="kicker">Places</p><h1>Places</h1>
    <p>Shared library for both boats. Recent and favorite stay short. Search the rest.</p>
    ${field("Search places", "placeQuery", ui.placeQuery, { type: "search", placeholder: "Harbor, lock, fuel" })}
    <div class="chiprow">
      ${[["recents", "Recents"], ["favorites", "Favorites"], ["all", "All"]].map(([id, label]) => `<button type="button" class="chip${ui.placeScope === id ? " on" : ""}" data-action="placeScope" data-value="${id}">${label}</button>`).join("")}
    </div>
    <div class="stack" id="place-list">${placeCards("library")}</div>
    ${more ? `<button type="button" class="btn block" data-action="morePlaces">Show more</button>` : ""}
    <button type="button" class="btn primary" data-action="newPlace">Add a place</button>
    ${backBtn()}`;
}

function screenPlace() {
  const form = ui.form;
  const used = form.id ? placeRefs(form.id) : 0;
  return `<p class="kicker">Place</p><h1>${form.id ? "Edit place" : "New place"}</h1>
    ${field("Name", "name", form.name)}
    ${field("Notes", "detail", form.detail, { area: true })}
    ${field("Tags", "tags", form.tags, { placeholder: "fuel, pump-out, lock" })}
    <label class="field"><span>Region</span><select name="region">${Object.entries(REGION_LABEL).map(([value, label]) => `<option value="${value}"${form.region === value ? " selected" : ""}>${esc(label)}</option>`).join("")}</select></label>
    <button type="button" class="btn block${form.favorite ? " on" : ""}" data-action="flag" data-flag="favorite">${form.favorite ? "Favorite" : "Not a favorite"}</button>
    <button type="button" class="btn primary" data-action="savePlace">Save place</button>
    ${form.id ? `<button type="button" class="btn danger block" data-action="deletePlace">${used ? "Used by a log — keep it" : "Delete place"}</button>` : ""}
    ${backBtn()}`;
}

function screenMore() {
  return `<p class="kicker">More</p><h1>HM2 Log v5</h1>
    <div class="stack">
      <button type="button" class="btn" data-action="nav" data-screen="maint">Maintenance</button>
      <button type="button" class="btn" data-action="nav" data-screen="people">People & Services</button>
      <button type="button" class="btn" data-action="nav" data-screen="places">Places</button>
      <button type="button" class="btn" data-action="nav" data-screen="backup">Backup</button>
    </div>`;
}

function screenBackup() {
  return `<p class="kicker">Backup</p><h1>On this phone</h1>
    <p>HM2 Log v5 keeps this log in this browser under <code>hm2log-v5</code>. The previous log is not copied and is not changed.</p>
    ${field("Your name (logged by)", "loggedBy", state.settings.loggedBy || "Wishy")}
    <p class="hint">Logged by is who writes the entry. Myself is still person 1 aboard.</p>
    <button type="button" class="btn primary" data-action="exportJson">Export backup</button>
    <button type="button" class="btn block" data-action="importPick">Import backup</button>
    <input id="import-file" type="file" accept="application/json,.json" hidden>
    <p class="hint">Import merges by id. The same entry is not added twice. A newer copy replaces an older one. An older copy is skipped.</p>
    <p class="hint">Photos live in this phone's browser storage. Export a backup before you clear the browser. Video files are not stored, only the name and the counts.</p>
    ${backBtn()}`;
}

function confirmHtml() {
  if (!ui.confirm) return "";
  return `<section class="card warncard"><p>${esc(ui.confirm.text)}</p>
    <button type="button" class="btn danger block" data-action="confirmYes">${esc(ui.confirm.yes || "Delete")}</button>
    <button type="button" class="btn quiet block" data-action="confirmNo">Cancel</button></section>`;
}

function pickerHtml() {
  if (!ui.picker) return "";
  return `<div class="sheet" role="dialog" aria-label="Choose a place">
    <h1>Place</h1>
    ${field("Search", "pickerQuery", ui.picker.query, { type: "search" })}
    <div class="chiprow">
      ${[["recents", "Recents"], ["favorites", "Favorites"], ["all", "All"]].map(([id, label]) => `<button type="button" class="chip${ui.picker.scope === id ? " on" : ""}" data-action="pickerScope" data-value="${id}">${label}</button>`).join("")}
    </div>
    <div class="stack" id="picker-list">${placeCards("picker")}</div>
    <button type="button" class="btn primary" data-action="newPlace">Add a new place</button>
    <button type="button" class="btn quiet block" data-action="closePicker">Cancel</button>
  </div>`;
}

function header() {
  return `<header class="topbar"><button class="brand" type="button" data-action="goHome"><span class="brandname">HM2 Log <span id="version" class="ver">v5</span></span><span class="boatline">${esc(boat().name)}</span></button><p id="save-state" class="saveline">${esc(saveLabel())}</p></header>`;
}

function underwayBar() {
  const trip = boatTrips().find((item) => item.status === "underway");
  const forms = new Set(["trip-form", "entry-form", "media-form", "person-form", "place-form", "ticket-form", "part-form", "wrap", "best"]);
  if (!trip || forms.has(ui.screen) || ui.picker) return "";
  return `<div class="underway"><div class="underway-copy"><strong>Underway</strong> · ${esc(trip.title)}</div><button type="button" class="btn alert" data-action="addNote" data-id="${esc(trip.id)}">Add note</button></div>`;
}

function navHtml() {
  const items = [["home", "Boat"], ["trip", "Trip"], ["journal", "Journal"], ["media", "Media"], ["more", "More"]];
  const active = (name) => {
    if (name === "home") return ui.screen === "home";
    if (name === "trip") return ["trip", "trip-form", "wrap", "best"].includes(ui.screen);
    if (name === "journal") return ["journal", "entry-form"].includes(ui.screen);
    if (name === "media") return ["media", "media-form"].includes(ui.screen);
    return ["more", "maint", "ticket", "ticket-form", "part-form", "people", "person-form", "places", "place-form", "backup"].includes(ui.screen);
  };
  return `<nav class="nav">${items.map(([id, label]) => `<button type="button" data-action="nav" data-screen="${id}" class="${active(id) ? "on" : ""}">${label}</button>`).join("")}</nav>`;
}

function screenHtml() {
  const screens = {
    home: screenHome,
    trip: screenTrip,
    "trip-form": screenTripForm,
    journal: screenJournal,
    "entry-form": screenEntry,
    media: screenMedia,
    "media-form": screenMediaForm,
    best: screenBest,
    wrap: screenWrap,
    maint: screenMaint,
    ticket: screenTicket,
    "ticket-form": screenTicketForm,
    "part-form": screenPart,
    people: screenPeople,
    "person-form": screenPerson,
    places: screenPlaces,
    "place-form": screenPlace,
    more: screenMore,
    backup: screenBackup,
  };
  return (screens[ui.screen] || screenHome)();
}

function paint() {
  const changed = paintedScreen !== ui.screen;
  paintedScreen = ui.screen;
  app.innerHTML = `${header()}${underwayBar()}<div id="flash" class="flash"${ui.flash ? "" : " hidden"}>${esc(ui.flash)}</div><main class="main">${confirmHtml()}${screenHtml()}</main>${navHtml()}${pickerHtml()}`;
  document.title = `HM2 Log v5 · ${boat().name}`;
  if (changed) window.scrollTo(0, 0);
}

function openScreen(screen) {
  leaveScreen();
  ui.picker = null;
  ui.confirm = null;
  ui.screen = screen;
  if (["home", "more", "people", "places", "maint", "backup", "journal"].includes(screen)) ui.form = null;
  if (screen === "trip") {
    const trip = shownTrip();
    ui.tripId = trip ? trip.id : null;
    ui.form = trip ? weatherForm(trip) : null;
  }
  if (screen === "media") {
    const trip = shownTrip();
    ui.tripId = trip ? trip.id : null;
    ui.form = trip ? filmForm(trip) : null;
  }
  if (screen === "journal" && ui.journalScope === "trip" && !shownTrip()) ui.journalScope = "all";
  paint();
}

function placeRefs(id) {
  return state.trips.filter((trip) => trip.fromId === id || trip.toId === id).length + state.entries.filter((entry) => entry.placeId === id).length;
}

function personRefs(id) {
  return state.trips.filter((trip) => (trip.peopleIds || []).includes(id)).length;
}

function buildEntry(form) {
  const notes = (form.notes || "").trim();
  const narrative = (form.narrative || "").trim();
  if (form.kind === "note" && !notes) return { error: "Write the note first." };
  if (form.kind === "wash" && !notes) return { error: "Write what you washed." };
  if (form.kind === "repair" && !notes && !(form.parts || "").trim()) return { error: "Write the repair, or the parts." };
  if (form.kind === "fuel" || form.kind === "water") {
    if (!(form.tank || "").trim()) return { error: "Name the tank." };
    if (!(Number(form.quantity) > 0)) return { error: "Enter the quantity added." };
    if (form.cost === "" || Number.isNaN(Number(form.cost))) return { error: "Enter the total cost. Zero is fine." };
  }
  if (form.kind === "pumpout" && !form.placeId && !notes) return { error: "Add a location or a note." };
  if (form.kind === "crab") {
    if (!(form.catchName || "").trim()) return { error: "What did you keep?" };
    if (form.count === "" || Number.isNaN(Number(form.count))) return { error: "Enter the count." };
  }
  if (form.kind === "rating" && !narrative) return { error: "Write how the trip went." };
  let tripId = form.link && form.tripId ? form.tripId : "";
  if ((form.kind === "rating" || form.kind === "crab") && !tripId) {
    const trip = shownTrip();
    if (!trip) return { error: "Open a trip first." };
    tripId = trip.id;
  }
  const stamp = nowIso();
  const id = form.id || (form.kind === "rating" ? `rating-${tripId}` : uid());
  const existing = state.entries.find((entry) => entry.id === id);
  return {
    entry: {
      id,
      boatId: ui.boatId,
      tripId,
      kind: form.kind,
      at: fromLocalInput(form.at),
      placeId: form.placeId || "",
      loggedBy: state.settings.loggedBy || "Wishy",
      title: (form.title || "").trim(),
      notes: form.kind === "rating" ? narrative : notes,
      tank: form.tank || "",
      quantity: form.quantity === "" ? null : Number(form.quantity),
      units: form.units || "",
      cost: form.cost === "" ? null : Number(form.cost),
      currency: form.currency || "",
      unitPrice: form.unitPrice === "" ? null : Number(form.unitPrice),
      engineHours: form.engineHours === "" ? null : Number(form.engineHours),
      parts: form.parts || "",
      receipt: form.receipt || "",
      catchName: form.catchName || "",
      count: form.count === "" ? null : Number(form.count),
      timeOfDay: form.timeOfDay || "",
      narrative,
      stars: Number(form.stars) || 0,
      alongType: form.alongType || "",
      story: !!form.story,
      photo: form.photo || "",
      createdAt: existing?.createdAt || stamp,
      updatedAt: stamp,
    },
  };
}

function saveRating(trip, narrative, stars) {
  const text = (narrative || "").trim();
  const score = Number(stars) || 0;
  if (!text && !score) return;
  const id = `rating-${trip.id}`;
  const existing = state.entries.find((entry) => entry.id === id);
  const stamp = nowIso();
  const entry = {
    id,
    boatId: trip.boatId,
    tripId: trip.id,
    kind: "rating",
    at: existing?.at || stamp,
    placeId: "",
    loggedBy: state.settings.loggedBy || "Wishy",
    title: "Narrative rating",
    notes: text,
    narrative: text,
    stars: score,
    story: false,
    photo: existing?.photo || "",
    createdAt: existing?.createdAt || stamp,
    updatedAt: stamp,
  };
  if (existing) Object.assign(existing, entry);
  else state.entries.push(entry);
  trip.rating = { narrative: text, stars: score, entryId: id };
}

function restoreStash(extra) {
  const stash = ui.stash;
  ui.stash = null;
  if (!stash) {
    ui.screen = "home";
    ui.form = null;
    return;
  }
  ui.screen = stash.screen;
  ui.form = stash.form;
  ui.tripId = stash.tripId || ui.tripId;
  if (extra) extra(stash);
}

const actions = {
  nav(btn) {
    ui.activityPrompt = false;
    openScreen(btn.dataset.screen);
  },
  goHome() {
    ui.activityPrompt = false;
    openScreen("home");
  },
  boat(btn) {
    leaveScreen();
    ui.boatId = btn.dataset.id;
    ui.tripId = null;
    ui.form = null;
    ui.screen = "home";
    state.settings.activeBoatId = ui.boatId;
    persist().then(() => paint());
  },
  startTrip() {
    ui.form = tripForm(null);
    ui.screen = "trip-form";
    paint();
  },
  openTrip(btn) {
    ui.tripId = btn.dataset.id;
    openScreen("trip");
  },
  editTrip() {
    const trip = shownTrip();
    if (!trip) return;
    ui.form = tripForm(trip);
    ui.screen = "trip-form";
    paint();
  },
  saveTrip(btn) {
    return saving(async () => {
      const form = ui.form;
      if (!form.fromId || !form.toId) {
        flash("Choose a departure and a destination.");
        return;
      }
      const stamp = nowIso();
      let trip = form.id ? tripById(form.id) : null;
      if (!trip) {
        const id = uid();
        trip = {
          id,
          boatId: ui.boatId,
          tripCode: makeTripCode(boat().prefix, stamp, state.settings.loggedBy, id),
          createdAt: stamp,
          status: "planned",
          peopleIds: ["myself"],
          film: { tools: [], kinds: [], clips: "", photos: "", note: "" },
          checks: {},
        };
        state.trips.push(trip);
      }
      trip.title = (form.title || "").trim() || `${placeName(form.fromId)} → ${placeName(form.toId)}`;
      trip.fromId = form.fromId;
      trip.toId = form.toId;
      trip.purpose = form.purpose || "Just a cruise";
      trip.peopleIds = Array.from(new Set(["myself", ...(form.peopleIds || [])]));
      trip.notes = form.notes || "";
      trip.meter = form.meter || "";
      trip.deception = !!form.deception;
      trip.weather = weatherFromForm(form);
      trip.updatedAt = stamp;
      if (btn.dataset.mode === "depart") {
        trip.status = trip.status === "arrived" ? "arrived" : "underway";
        if (!trip.departedAt) trip.departedAt = stamp;
      }
      touchPlace(form.fromId);
      touchPlace(form.toId);
      if (trip.weather.text) state.settings.weatherByBoat[ui.boatId] = { ...trip.weather };
      ui.tripId = trip.id;
      ui.form = weatherForm(trip);
      ui.screen = "trip";
      await persist({ announce: btn.dataset.mode === "depart" && trip.status === "underway" ? "Underway. Saved on this phone." : "Trip saved on this phone." });
      paint();
    });
  },
  deleteTrip() {
    const trip = tripById(ui.form?.id);
    if (!trip) return;
    const notes = state.entries.filter((entry) => entry.tripId === trip.id).length;
    ui.confirm = {
      text: `Delete ${trip.tripCode || trip.title}? ${notes} journal entries on it go too. Parts stay in the ledger.`,
      run: async () => {
        state.trips = state.trips.filter((item) => item.id !== trip.id);
        state.entries = state.entries.filter((entry) => entry.tripId !== trip.id);
        state.media = state.media.filter((item) => item.tripId !== trip.id);
        state.tickets.forEach((ticket) => {
          if (ticket.tripId === trip.id) ticket.tripId = "";
        });
        ui.confirm = null;
        ui.tripId = null;
        ui.form = null;
        ui.screen = "home";
        await persist({ announce: "Trip deleted" });
        paint();
      },
    };
    paint();
  },
  arrive() {
    const trip = shownTrip();
    if (!trip) return;
    leaveScreen();
    ui.tripId = trip.id;
    const rating = state.entries.find((entry) => entry.id === `rating-${trip.id}`);
    ui.form = {
      _kind: "wrap",
      narrative: trip.rating?.narrative || rating?.narrative || "",
      stars: trip.rating?.stars || rating?.stars || 0,
      bestText: trip.bestMoment?.text || "",
      bestTags: trip.bestMoment?.tags || [],
      filmTools: trip.film?.tools || [],
      filmKinds: trip.film?.kinds || [],
      clips: trip.film?.clips || "",
      photos: trip.film?.photos || "",
      filmNote: trip.film?.note || "",
    };
    ui.screen = "wrap";
    paint();
  },
  saveWrap() {
    return saving(async () => {
      const trip = shownTrip();
      if (!trip) return;
      trip.status = "arrived";
      if (!trip.arrivedAt) trip.arrivedAt = nowIso();
      trip.bestMoment = { text: (ui.form.bestText || "").trim(), tags: ui.form.bestTags || [] };
      trip.film = {
        tools: ui.form.filmTools || [],
        kinds: ui.form.filmKinds || [],
        clips: ui.form.clips || "",
        photos: ui.form.photos || "",
        note: ui.form.filmNote || "",
      };
      trip.updatedAt = nowIso();
      saveRating(trip, ui.form.narrative, ui.form.stars);
      ui.form = weatherForm(trip);
      ui.screen = "trip";
      await persist({ announce: "Arrived. Saved on this phone." });
      paint();
    });
  },
  skipWrap() {
    return saving(async () => {
      const trip = shownTrip();
      trip.status = "arrived";
      if (!trip.arrivedAt) trip.arrivedAt = nowIso();
      trip.updatedAt = nowIso();
      ui.form = weatherForm(trip);
      ui.screen = "trip";
      await persist({ announce: "Arrived. Saved on this phone." });
      paint();
    });
  },
  addNote(btn) {
    const trip = tripById(btn.dataset.id) || boatTrips().find((item) => item.status === "underway");
    if (!trip) return;
    ui.tripId = trip.id;
    ui.form = blankEntry("note", trip.id);
    ui.screen = "entry-form";
    paint();
  },
  journal(btn) {
    ui.activityPrompt = false;
    ui.journalScope = btn.dataset.scope || "trip";
    openScreen("journal");
  },
  activity() {
    ui.activityPrompt = true;
    ui.journalScope = "all";
    openScreen("journal");
  },
  journalScope(btn) {
    ui.journalScope = btn.dataset.value;
    if (ui.journalScope === "trip" && !shownTrip()) {
      flash("Start a trip, or use All boat.");
      ui.journalScope = "all";
    }
    paint();
  },
  newEntry(btn) {
    const kind = btn.dataset.kind;
    const trip = shownTrip();
    if ((kind === "rating" || kind === "crab") && !trip) {
      flash("Open a trip first. The rating and the crab catch belong to a trip.");
      return;
    }
    const link = btn.dataset.link === "1" && !!trip;
    if (kind === "rating" && trip) {
      const existing = state.entries.find((entry) => entry.id === `rating-${trip.id}`);
      ui.form = existing ? entryToForm(existing) : blankEntry("rating", trip.id);
      ui.form.link = true;
      ui.form.tripId = trip.id;
    } else {
      ui.form = blankEntry(kind, link ? trip.id : "");
      ui.form.link = link || kind === "crab";
      if (ui.form.link && trip) ui.form.tripId = trip.id;
    }
    ui.screen = "entry-form";
    paint();
  },
  openEntry(btn) {
    const entry = state.entries.find((item) => item.id === btn.dataset.id);
    if (!entry) return;
    ui.form = entryToForm(entry);
    ui.screen = "entry-form";
    paint();
  },
  saveEntry() {
    return saving(async () => {
      const built = buildEntry(ui.form);
      if (built.error) {
        flash(built.error);
        return;
      }
      const { entry } = built;
      if (entry.kind === "rating") saveRating(tripById(entry.tripId), entry.narrative, entry.stars);
      else {
        const existing = state.entries.find((item) => item.id === entry.id);
        if (existing) Object.assign(existing, entry);
        else state.entries.push(entry);
      }
      if (entry.placeId) touchPlace(entry.placeId);
      if (ui.form.openTicket && entry.kind === "repair" && !state.tickets.some((ticket) => ticket.entryId === entry.id)) {
        const stamp = nowIso();
        state.tickets.push({
          id: uid(),
          boatId: ui.boatId,
          tripId: entry.tripId || "",
          entryId: entry.id,
          title: (entry.notes || entry.parts || "Repair").slice(0, 80),
          detail: entry.notes || "",
          status: "open",
          reference: "",
          createdAt: stamp,
          updatedAt: stamp,
          closedAt: "",
        });
      }
      ui.journalScope = entry.tripId ? "trip" : "all";
      if (entry.tripId) ui.tripId = entry.tripId;
      ui.form = null;
      ui.screen = "journal";
      await persist({ announce: "Saved on this phone." });
      paint();
    });
  },
  deleteEntry() {
    const id = ui.form?.id;
    if (!id) return;
    ui.confirm = {
      text: "Delete this entry from the phone? A backup you already exported still has the old copy.",
      run: async () => {
        state.entries = state.entries.filter((entry) => entry.id !== id);
        ui.confirm = null;
        ui.form = null;
        ui.screen = "journal";
        await persist({ announce: "Entry deleted" });
        paint();
      },
    };
    paint();
  },
  toggleLink() {
    if (!ui.form || ui.form.kind === "rating" || ui.form.kind === "crab") return;
    ui.form.link = !ui.form.link;
    if (ui.form.link && !ui.form.tripId) {
      const trip = shownTrip() || boatTrips()[0];
      if (!trip) {
        ui.form.link = false;
        flash("Start a trip first, or leave this as a boat activity.");
        return;
      }
      ui.form.tripId = trip.id;
    }
    paint();
  },
  flag(btn) {
    const name = btn.dataset.flag;
    ui.form[name] = !ui.form[name];
    if (ui.form._kind === "weather" && (name === "advisory" || name === "deception")) writeWeather(false);
    paint();
  },
  chip(btn) {
    const group = btn.dataset.group;
    const value = btn.dataset.value;
    const multi = btn.dataset.multi === "1";
    if (multi) {
      const set = new Set(ui.form[group] || []);
      if (set.has(value)) set.delete(value);
      else set.add(value);
      if (group === "categories" && ui.form.id === "myself") set.add("crew");
      ui.form[group] = [...set];
    } else ui.form[group] = value;
    const wrap = btn.closest(".chiprow");
    wrap.querySelectorAll(".chip").forEach((chip) => {
      const on = multi ? (ui.form[group] || []).includes(chip.dataset.value) : ui.form[group] === chip.dataset.value;
      chip.classList.toggle("on", on);
    });
    if (group === "conditions") {
      const next = sentenceFromChips(ui.form.conditions, !!ui.form.night);
      ui.form.weatherText = next;
      ui.form.generated = next;
      if (!ui.form.weatherSource) ui.form.weatherSource = "Manual";
      ui.form.weatherKind = ui.form.weatherKind || "observed";
      ui.form.weatherAt = ui.form.weatherAt || nowIso();
      const input = document.querySelector('[name="weatherText"]');
      if (input) input.value = next;
      const meta = document.getElementById("weather-meta");
      if (meta) meta.textContent = weatherMeta(weatherFromForm(ui.form));
      if (ui.form._kind === "weather") writeWeather(false);
    }
    if (group === "filmTools" || group === "filmKinds") writeFilm();
  },
  personToggle(btn) {
    const id = btn.dataset.id;
    if (id === "myself") return;
    const set = new Set(ui.form.peopleIds || ["myself"]);
    if (set.has(id)) set.delete(id);
    else set.add(id);
    set.add("myself");
    ui.form.peopleIds = [...set];
    btn.classList.toggle("on", set.has(id));
  },
  night() {
    ui.form.night = !ui.form.night;
    const next = sentenceFromChips(ui.form.conditions || [], !!ui.form.night);
    if (!ui.form.weatherText || ui.form.weatherText === ui.form.generated) {
      ui.form.weatherText = next;
      ui.form.generated = next;
    }
    if (ui.form._kind === "weather") writeWeather(false);
    paint();
  },
  weatherKind(btn) {
    ui.form.weatherKind = btn.dataset.value;
    if (!ui.form.weatherSource || ui.form.weatherSource === "Open-Meteo") ui.form.weatherSource = btn.dataset.value === "observed" ? "Manual" : ui.form.weatherSource || "Manual";
    if (btn.dataset.value === "forecast" && !ui.form.weatherSource) ui.form.weatherSource = "Manual";
    ui.form.weatherAt = ui.form.weatherAt || nowIso();
    if (ui.form._kind === "weather") writeWeather(false);
    paint();
  },
  async forecast() {
    if (!navigator.onLine) {
      flash("No signal. Type the conditions. The zone pages need a signal too.");
      return;
    }
    const here = boat();
    flash("Reading conditions…");
    try {
      const response = await fetch(weatherUrl(here.lat, here.lon, here.tempUnit));
      if (!response.ok) throw new Error(String(response.status));
      const data = await response.json();
      const current = data.current || {};
      const night = ui.form ? !!ui.form.night : sunIsDown();
      const text = describeWeather({
        code: current.weather_code,
        windKn: current.wind_speed_10m,
        temp: current.temperature_2m,
        tempUnit: here.tempUnit,
        isNight: night,
        visibilityM: current.visibility,
        snowfall: current.snowfall,
        precipitation: current.precipitation,
      });
      if (!text) {
        flash("No sky condition came back. Nothing was invented. Type the line, or open a zone page.");
        return;
      }
      const weather = {
        text,
        kind: "forecast",
        source: "Open-Meteo",
        at: nowIso(),
        windKn: current.wind_speed_10m == null ? null : Math.round(current.wind_speed_10m),
        night,
        conditions: [],
        code: current.weather_code ?? null,
        advisory: ui.form?.advisory || false,
      };
      state.settings.weatherByBoat[ui.boatId] = weather;
      if (ui.form && (ui.form._kind === "weather" || ui.form._kind === "trip")) {
        ui.form.weatherText = text;
        ui.form.generated = text;
        ui.form.weatherKind = "forecast";
        ui.form.weatherSource = "Open-Meteo";
        ui.form.weatherAt = weather.at;
        ui.form.weatherCode = weather.code;
        ui.form.wind = weather.windKn == null ? "" : String(weather.windKn);
        ui.form.night = night;
        if (ui.form._kind === "weather") writeWeather(false);
      }
      await persist({ announce: "Forecast saved on this phone." });
      paint();
    } catch (error) {
      console.warn(error);
      flash("Could not read the forecast. The zone links are unchanged.");
    }
  },
  pickPlace(btn) {
    ui.picker = { field: btn.dataset.field, query: "", scope: "recents" };
    paint();
  },
  choosePlace(btn) {
    if (!ui.form || !ui.picker) return;
    ui.form[ui.picker.field] = btn.dataset.id;
    touchPlace(btn.dataset.id);
    ui.picker = null;
    queueSave();
    paint();
  },
  closePicker() {
    ui.picker = null;
    paint();
  },
  pickerScope(btn) {
    ui.picker.scope = btn.dataset.value;
    paint();
  },
  newPlace() {
    ui.stash = { screen: ui.screen, form: ui.form, tripId: ui.tripId, pickerField: ui.picker?.field || null };
    ui.picker = null;
    ui.form = blankPlace();
    ui.screen = "place-form";
    paint();
  },
  openPlace(btn) {
    const place = placeById(btn.dataset.id);
    if (!place) return;
    ui.form = { _kind: "place", id: place.id, name: place.name, detail: place.detail || "", tags: (place.tags || []).join(", "), favorite: !!place.favorite, region: place.region || "other" };
    ui.screen = "place-form";
    paint();
  },
  savePlace() {
    return saving(async () => {
      const name = (ui.form.name || "").trim();
      if (!name) {
        flash("Name the place.");
        return;
      }
      const duplicate = state.places.find((place) => place.name.toLowerCase() === name.toLowerCase() && place.id !== ui.form.id);
      if (duplicate) {
        flash("That place is already in the library.");
        if (ui.stash?.pickerField) ui.stash.form[ui.stash.pickerField] = duplicate.id;
        if (ui.stash) {
          restoreStash();
          paint();
        }
        return;
      }
      const stamp = nowIso();
      const tags = (ui.form.tags || "").split(",").map((tag) => tag.trim()).filter(Boolean);
      let place = ui.form.id ? placeById(ui.form.id) : null;
      if (!place) {
        place = { id: uid(), createdAt: stamp, lastUsedAt: "" };
        state.places.push(place);
      }
      Object.assign(place, { name, detail: (ui.form.detail || "").trim(), tags, favorite: !!ui.form.favorite, region: ui.form.region || "other", updatedAt: stamp });
      const fieldName = ui.stash?.pickerField;
      if (fieldName) {
        ui.stash.form[fieldName] = place.id;
        place.lastUsedAt = stamp;
      }
      const back = !!ui.stash;
      if (back) restoreStash();
      else openScreen("places");
      await persist({ announce: "Place saved" });
      if (back) paint();
    });
  },
  deletePlace() {
    const id = ui.form?.id;
    if (!id) return;
    if (placeRefs(id)) {
      flash("That place is on a trip or a journal entry, so it stays in the library.");
      return;
    }
    ui.confirm = {
      text: "Delete this place from the library?",
      run: async () => {
        state.places = state.places.filter((place) => place.id !== id);
        ui.confirm = null;
        ui.form = null;
        ui.screen = "places";
        await persist({ announce: "Place deleted" });
        paint();
      },
    };
    paint();
  },
  fav(btn) {
    const place = placeById(btn.dataset.id);
    if (!place) return;
    place.favorite = !place.favorite;
    place.updatedAt = nowIso();
    btn.textContent = place.favorite ? "★" : "☆";
    btn.setAttribute("aria-pressed", place.favorite ? "true" : "false");
    queueSave();
  },
  clearSearch() {
    if (ui.picker) ui.picker.query = "";
    else ui.placeQuery = "";
    paint();
  },
  morePlaces() {
    ui.placeShow += 20;
    paint();
  },
  placeScope(btn) {
    ui.placeScope = btn.dataset.value;
    paint();
  },
  newMedia(btn) {
    const trip = shownTrip();
    if (!trip) {
      flash("Open a trip first. Shots and reminders hang off the trip.");
      return;
    }
    writeFilm();
    ui.tripId = trip.id;
    ui.form = { _kind: "media", id: null, status: btn.dataset.status || "planned", type: btn.dataset.type || "shot", title: "", detail: "", photo: "", videoName: "" };
    ui.mediaScope = ui.form.status;
    ui.screen = "media-form";
    paint();
  },
  openMedia(btn) {
    const item = state.media.find((media) => media.id === btn.dataset.id);
    if (!item) return;
    writeFilm();
    ui.form = { _kind: "media", ...item };
    ui.screen = "media-form";
    paint();
  },
  saveMedia() {
    return saving(async () => {
      const form = ui.form;
      if (!(form.title || "").trim() && !(form.detail || "").trim() && !form.photo) {
        flash("Add a title, a note, or a photo.");
        return;
      }
      const trip = shownTrip();
      const stamp = nowIso();
      let item = form.id ? state.media.find((media) => media.id === form.id) : null;
      if (!item) {
        item = { id: uid(), createdAt: stamp, tripId: trip.id, boatId: ui.boatId };
        state.media.push(item);
      }
      Object.assign(item, {
        title: (form.title || "").trim(),
        detail: (form.detail || "").trim(),
        status: form.status,
        type: form.type,
        photo: form.photo || "",
        videoName: form.videoName || "",
        updatedAt: stamp,
      });
      ui.mediaScope = item.status;
      await persist({ announce: "Saved on this phone." });
      openScreen("media");
    });
  },
  deleteMedia() {
    const id = ui.form?.id;
    if (!id) return;
    ui.confirm = {
      text: "Delete this media note?",
      run: async () => {
        state.media = state.media.filter((item) => item.id !== id);
        ui.confirm = null;
        await persist({ announce: "Deleted" });
        openScreen("media");
      },
    };
    paint();
  },
  mediaScope(btn) {
    ui.mediaScope = btn.dataset.value;
    paint();
  },
  check(btn) {
    const trip = shownTrip();
    if (!trip) return;
    trip.checks = trip.checks || {};
    trip.checks[btn.dataset.id] = !trip.checks[btn.dataset.id];
    trip.updatedAt = nowIso();
    queueSave();
    btn.classList.toggle("on", !!trip.checks[btn.dataset.id]);
    btn.setAttribute("aria-pressed", trip.checks[btn.dataset.id] ? "true" : "false");
    btn.textContent = `${trip.checks[btn.dataset.id] ? "Packed · " : ""}${CHECKS.find((item) => item[0] === btn.dataset.id)?.[1] || ""}`;
  },
  best() {
    const trip = shownTrip();
    if (!trip) return;
    leaveScreen();
    ui.form = { _kind: "best", bestText: trip.bestMoment?.text || "", bestTags: trip.bestMoment?.tags || [] };
    ui.screen = "best";
    paint();
  },
  saveBest() {
    return saving(async () => {
      const trip = shownTrip();
      trip.bestMoment = { text: (ui.form.bestText || "").trim(), tags: ui.form.bestTags || [] };
      trip.updatedAt = nowIso();
      await persist({ announce: "Best moment saved" });
      openScreen("trip");
    });
  },
  newTicket(btn) {
    const trip = shownTrip();
    const link = btn?.dataset?.link === "1" && !!trip;
    ui.form = { _kind: "ticket", id: null, title: "", detail: "", status: "open", reference: "", tripId: link ? trip.id : "", link: !!link };
    ui.screen = "ticket-form";
    paint();
  },
  openTicket(btn) {
    leaveScreen();
    ui.ticketId = btn.dataset.id;
    ui.ticketTab = "details";
    ui.form = null;
    ui.screen = "ticket";
    paint();
  },
  editTicket() {
    const ticket = ticketById(ui.ticketId);
    if (!ticket) return;
    ui.form = { _kind: "ticket", id: ticket.id, title: ticket.title, detail: ticket.detail || "", reference: ticket.reference || "", status: ticket.status, tripId: ticket.tripId || "", link: !!ticket.tripId };
    ui.screen = "ticket-form";
    paint();
  },
  saveTicket() {
    return saving(async () => {
      const form = ui.form;
      if (!(form.title || "").trim()) {
        flash("Give the ticket a title.");
        return;
      }
      const stamp = nowIso();
      let ticket = form.id ? ticketById(form.id) : null;
      if (!ticket) {
        ticket = { id: uid(), boatId: ui.boatId, createdAt: stamp, closedAt: "", entryId: "" };
        state.tickets.push(ticket);
      }
      Object.assign(ticket, {
        title: form.title.trim(),
        detail: (form.detail || "").trim(),
        reference: form.reference || "",
        tripId: form.link ? form.tripId || "" : "",
        updatedAt: stamp,
        status: ticket.status || "open",
      });
      ui.ticketId = ticket.id;
      ui.ticketTab = "details";
      ui.form = null;
      ui.screen = "ticket";
      await persist({ announce: "Ticket saved" });
      paint();
    });
  },
  ticketStatus(btn) {
    const ticket = ticketById(ui.ticketId);
    if (!ticket) return;
    ticket.status = btn.dataset.value;
    ticket.updatedAt = nowIso();
    ticket.closedAt = ticket.status === "closed" || ticket.status === "cancelled" ? nowIso() : "";
    persist({ announce: "Ticket updated" }).then(() => paint());
  },
  ticketTab(btn) {
    ui.ticketTab = btn.dataset.value;
    paint();
  },
  maintScope(btn) {
    ui.maintScope = btn.dataset.value;
    paint();
  },
  newPart(btn) {
    ui.form = {
      _kind: "part",
      id: null,
      ticketId: btn?.dataset?.ticket || "",
      name: "",
      partNumber: "",
      verified: false,
      at: toLocalInput(),
      hours: "",
      quantity: "",
      source: "",
      warranty: "",
      receipt: "",
      notes: "",
    };
    ui.screen = "part-form";
    paint();
  },
  openPart(btn) {
    const part = state.parts.find((item) => item.id === btn.dataset.id);
    if (!part) return;
    ui.form = {
      _kind: "part",
      id: part.id,
      ticketId: part.ticketId || "",
      name: part.name || "",
      partNumber: part.partNumber || "",
      verified: !!part.verified,
      at: toLocalInput(part.at),
      hours: part.hours ?? "",
      quantity: part.quantity ?? "",
      source: part.source || "",
      warranty: part.warranty || "",
      receipt: part.receipt || "",
      notes: part.notes || "",
    };
    ui.screen = "part-form";
    paint();
  },
  savePart() {
    return saving(async () => {
      if (!(ui.form.name || "").trim()) {
        flash("Name the part.");
        return;
      }
      const stamp = nowIso();
      let part = ui.form.id ? state.parts.find((item) => item.id === ui.form.id) : null;
      if (!part) {
        part = { id: uid(), boatId: ui.boatId, createdAt: stamp };
        state.parts.push(part);
      }
      Object.assign(part, {
        name: ui.form.name.trim(),
        partNumber: (ui.form.partNumber || "").trim(),
        verified: !!ui.form.verified,
        at: fromLocalInput(ui.form.at),
        hours: ui.form.hours === "" ? null : Number(ui.form.hours),
        quantity: ui.form.quantity === "" ? null : Number(ui.form.quantity),
        source: ui.form.source || "",
        warranty: ui.form.warranty || "",
        receipt: ui.form.receipt || "",
        notes: ui.form.notes || "",
        ticketId: ui.form.ticketId || "",
        updatedAt: stamp,
      });
      await persist({ announce: "Part saved" });
      openScreen("maint");
    });
  },
  deletePart() {
    const id = ui.form?.id;
    if (!id) return;
    ui.confirm = {
      text: "Delete this part from the ledger?",
      run: async () => {
        state.parts = state.parts.filter((part) => part.id !== id);
        ui.confirm = null;
        await persist({ announce: "Part deleted" });
        openScreen("maint");
      },
    };
    paint();
  },
  peopleScope(btn) {
    ui.peopleScope = btn.dataset.value;
    if (ui.peopleScope !== "service" && ui.peopleScope !== "all") ui.serviceTag = null;
    paint();
  },
  serviceTag(btn) {
    const tag = btn.dataset.value;
    ui.peopleScope = "service";
    ui.serviceTag = ui.serviceTag === tag ? null : tag;
    paint();
  },
  addPerson() {
    ui.stash = ui.screen === "trip-form" ? { screen: ui.screen, form: ui.form, tripId: ui.tripId } : null;
    ui.form = blankPerson();
    ui.screen = "person-form";
    paint();
  },
  openPerson(btn) {
    const person = state.people.find((item) => item.id === btn.dataset.id);
    if (!person) return;
    ui.form = {
      _kind: "person",
      id: person.id,
      name: person.name,
      categories: person.categories || [],
      serviceTags: person.serviceTags || [],
      businessName: businessName(person.businessId),
      phone: person.phone || "",
      notes: person.notes || "",
      photo: person.photo || "",
    };
    ui.screen = "person-form";
    paint();
  },
  savePerson() {
    return saving(async () => {
      const myself = ui.form.id === "myself";
      const name = myself ? "Myself" : (ui.form.name || "").trim();
      if (!name) {
        flash("Name the person.");
        return;
      }
      const stamp = nowIso();
      let categories = ui.form.categories || [];
      const serviceTags = ui.form.serviceTags || [];
      if (serviceTags.length && !categories.includes("service")) categories = [...categories, "service"];
      if (myself && !categories.includes("crew")) categories = [...categories, "crew"];
      let businessId = "";
      const company = (ui.form.businessName || "").trim();
      if (company) {
        let business = state.businesses.find((item) => item.name.toLowerCase() === company.toLowerCase());
        if (!business) {
          business = { id: uid(), name: company, serviceTags: [], notes: "", createdAt: stamp, updatedAt: stamp };
          state.businesses.push(business);
        }
        business.serviceTags = Array.from(new Set([...(business.serviceTags || []), ...serviceTags]));
        business.updatedAt = stamp;
        businessId = business.id;
      }
      let person = ui.form.id ? state.people.find((item) => item.id === ui.form.id) : null;
      if (!person) {
        person = { id: uid(), createdAt: stamp };
        state.people.push(person);
      }
      Object.assign(person, { name, categories, serviceTags, businessId, phone: ui.form.phone || "", notes: ui.form.notes || "", photo: ui.form.photo || "", updatedAt: stamp });
      if (ui.stash?.form?.peopleIds) ui.stash.form.peopleIds = Array.from(new Set([...(ui.stash.form.peopleIds || []), person.id, "myself"]));
      const back = !!ui.stash;
      if (back) restoreStash();
      else {
        ui.form = null;
        ui.screen = "people";
      }
      await persist({ announce: "Contact saved" });
      paint();
    });
  },
  deletePerson() {
    const id = ui.form?.id;
    if (!id || id === "myself") return;
    if (personRefs(id)) {
      flash("This person is on a trip, so the contact stays.");
      return;
    }
    ui.confirm = {
      text: "Delete this contact? They are removed from the shared list only.",
      run: async () => {
        state.people = state.people.filter((person) => person.id !== id);
        ui.confirm = null;
        ui.form = null;
        ui.screen = "people";
        await persist({ announce: "Contact deleted" });
        paint();
      },
    };
    paint();
  },
  back() {
    if (ui.picker) {
      ui.picker = null;
      paint();
      return;
    }
    if (ui.stash) {
      restoreStash();
      paint();
      return;
    }
    const map = {
      "trip-form": "trip",
      "entry-form": "journal",
      "media-form": "media",
      ticket: "maint",
      "ticket-form": "maint",
      "part-form": "maint",
      "person-form": "people",
      "place-form": "places",
      wrap: "trip",
      best: "trip",
      backup: "more",
      people: "more",
      places: "more",
      maint: "more",
    };
    openScreen(map[ui.screen] || "home");
  },
  star(btn) {
    const count = Number(btn.dataset.value);
    ui.form.stars = ui.form.stars === count ? 0 : count;
    paint();
  },
  exportJson() {
    const payload = exportPayload(state);
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.href = url;
    link.download = `hm2-log-v5-${payload.exportedAt.slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    flash("Backup downloaded. Each entry is in there once.");
  },
  importPick() {
    document.getElementById("import-file")?.click();
  },
  confirmYes() {
    const run = ui.confirm?.run;
    if (run) run();
  },
  confirmNo() {
    ui.confirm = null;
    paint();
  },
};

function refreshList(id, html) {
  const node = document.getElementById(id);
  if (node) node.innerHTML = html;
}

function onField(el) {
  if (!el || !el.name) return;
  if (el.name === "loggedBy") {
    state.settings.loggedBy = el.value.trim() || "Wishy";
    queueSave();
    return;
  }
  if (el.name === "placeQuery") {
    ui.placeQuery = el.value;
    refreshList("place-list", placeCards("library"));
    return;
  }
  if (el.name === "pickerQuery") {
    if (ui.picker) ui.picker.query = el.value;
    refreshList("picker-list", placeCards("picker"));
    return;
  }
  if (el.name === "switchTrip") {
    ui.tripId = el.value;
    const trip = shownTrip();
    ui.form = trip ? weatherForm(trip) : null;
    paint();
    return;
  }
  if (el.name === "reference" && ui.screen === "ticket") {
    const ticket = ticketById(ui.ticketId);
    if (!ticket) return;
    ticket.reference = el.value;
    ticket.updatedAt = nowIso();
    queueSave();
    return;
  }
  if (!ui.form) return;
  ui.form[el.name] = el.type === "checkbox" ? el.checked : el.value;
  if (el.name === "meter") {
    const hint = document.getElementById("meter-hint");
    if (hint) hint.textContent = meterHint(el.value);
  }
  if (ui.form._kind === "weather" && (el.name === "weatherText" || el.name === "wind")) {
    if (el.name === "weatherText" && el.value.trim()) {
      ui.form.weatherKind = ui.form.weatherKind || "observed";
      ui.form.weatherSource = ui.form.weatherSource || "Manual";
      ui.form.weatherAt = ui.form.weatherAt || nowIso();
    }
    writeWeather(false);
    const meta = document.getElementById("weather-meta");
    if (meta) meta.textContent = weatherMeta(weatherFromForm(ui.form));
  }
  if (ui.form._kind === "film" && ["clips", "photos", "filmNote"].includes(el.name)) writeFilm();
  if ((ui.form._kind === "trip" || ui.form._kind === "entry" || ui.form._kind === "wrap") && el.name === "weatherText") {
    ui.form.weatherKind = ui.form.weatherKind || "observed";
    ui.form.weatherSource = ui.form.weatherSource || "Manual";
    ui.form.weatherAt = ui.form.weatherAt || nowIso();
  }
}

async function onFile(input) {
  const file = input.files && input.files[0];
  if (!file || !ui.form) return;
  if (file.type.startsWith("video/")) {
    ui.form.videoName = file.name;
    flash("Video stays in the camera roll. The log keeps the file name only.");
    paint();
    return;
  }
  if (!file.type.startsWith("image/")) {
    flash("Choose a photo. Video stays in the camera roll.");
    return;
  }
  try {
    ui.form.photo = await resizeImage(file);
    flash("Photo attached");
    paint();
  } catch (error) {
    console.warn(error);
    flash("That photo could not be read.");
  }
}

app.addEventListener("click", (event) => {
  const btn = event.target.closest("[data-action]");
  if (!btn || !app.contains(btn)) return;
  const run = actions[btn.dataset.action];
  if (!run) return;
  Promise.resolve(run(btn)).catch((error) => {
    console.error(error);
    flash("Something went wrong. The last successful save is still on this phone.");
  });
});
app.addEventListener("input", (event) => onField(event.target));
async function importFile(input) {
  const file = input.files && input.files[0];
  input.value = "";
  if (!file) return;
  try {
    const payload = JSON.parse(await file.text());
    const merged = importPayload(state, payload);
    state = merged.state;
    ui.boatId = state.settings.activeBoatId || ui.boatId;
    await persist({ announce: importSummary(merged.stats) });
    paint();
  } catch (error) {
    flash(error.message || "That backup could not be read.");
  }
}

function importSummary(stats) {
  const totals = Object.values(stats).reduce((sum, item) => ({
    added: sum.added + item.added,
    updated: sum.updated + item.updated,
    skipped: sum.skipped + item.skipped,
  }), { added: 0, updated: 0, skipped: 0 });
  return `Backup merged. ${totals.added} added, ${totals.updated} updated, ${totals.skipped} already on this phone.`;
}

app.addEventListener("change", (event) => {
  if (event.target?.id === "import-file") {
    importFile(event.target);
    return;
  }
  if (event.target?.type === "file") {
    onFile(event.target);
    return;
  }
  onField(event.target);
});

async function boot() {
  const loaded = await loadState();
  state = normalizeState(loaded || freshState());
  ui.boatId = state.settings.activeBoatId || "hm2";
  if (!loaded) await saveState(state);
  paint();
  window.addEventListener("online", () => {
    ui.online = true;
    updateSaveLabel();
  });
  window.addEventListener("offline", () => {
    ui.online = false;
    updateSaveLabel();
  });
  if (!location.search.includes("nosw=1") && "serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
}

boot().catch((error) => {
  console.error(error);
  app.textContent = `HM2 Log v5 could not start. ${error.message || ""}`;
});
