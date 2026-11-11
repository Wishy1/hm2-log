/* HM2 Log v5. Fresh store: IndexedDB hm2log-v5 (localStorage only if IndexedDB fails). */
import {
  ALONG_TYPES,
  BEST_TAGS,
  BOATS,
  CONDITIONS,
  FILM_KINDS,
  FILM_TOOLS,
  PERSON_CATEGORIES,
  PURPOSES,
  SERVICE_TAGS,
  ZONES,
  describeWeather,
  exportPayload,
  formatHours,
  formatMoney,
  formatVolume,
  freshState,
  measureOf,
  importPayload,
  makeTripCode,
  normalizeState,
  nowIso,
  passageEstimate,
  phoneHref,
  emailHref,
  websiteHref,
  removeDraft,
  scoreEta,
  sentenceFromChips,
  uid,
  upsertDraft,
  weatherUrl,
  DEMO_ENDPOINT_LABEL,
  demoChanges,
  emptyGoogleSync,
  googleConfigured,
  journalFromState,
  markRetry,
  markSynced,
  outboxLabel,
  queueDemo,
  queueSync,
  sheetFromState,
  syncChanges,
  syncDemo,
  syncRequest,
  syncedState,
  spaceSentences,
  undupeWord,
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
  sheetTab: "Trips",
  ticketId: null,
  ticketTab: "details",
  dirty: false,
  showingDraft: false,
  draftKey: "",
  guardStep: "",
  editingWeather: false,
  zonesOpen: false,
};
const FORM_SCREENS = new Set(["trip-form", "entry-form", "media-form", "person-form", "place-form", "ticket-form", "part-form", "wrap", "best"]);
const DRAFT_STORE = "hm2log-v5-drafts";
const PRECHECK = [
  ["engine", "Engine room check"],
  ["oil", "Oil check"],
  ["coolant", "Coolant check"],
];
const navStack = [];
let navReady = false;
let lastSig = "";
let ignorePop = false;
let guardAction = null;
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
  const base = ui.online ? "Saved on this phone." : "No signal. Saved on this phone.";
  const google = readGoogle();
  if (googleConfigured(google)) {
    const waiting = readSyncOutbox().filter((item) => item.status === "waiting").length;
    if (waiting) return `${base} ${waiting} waiting to send.`;
    if (google.lastSyncAt) return `${base} Sent.`;
    return base;
  }
  if (!state?.settings?.demoSync) return base;
  const demo = outboxLabel(readOutbox());
  if (demo === "Nothing waiting") return base;
  return `${base} ${demo}.`;
}

function updateSaveLabel() {
  const node = document.getElementById("save-state");
  if (node) node.textContent = saveLabel();
}

function fmtTime(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function formatClock(hhmm) {
  if (!hhmm || !hhmm.includes(":")) return hhmm || "";
  const [hour, minute] = hhmm.split(":").map(Number);
  if (Number.isNaN(hour) || Number.isNaN(minute)) return hhmm;
  const date = new Date();
  date.setHours(hour, minute, 0, 0);
  return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function formIsOpen() {
  return FORM_SCREENS.has(ui.screen) || (ui.screen === "trip" && ui.editingWeather);
}

function readDraftMap() {
  try {
    return JSON.parse(localStorage.getItem(DRAFT_STORE)) || {};
  } catch {
    return {};
  }
}

function writeDraftMap(map) {
  const slim = {};
  for (const [key, value] of Object.entries(map || {})) {
    const form = { ...(value.form || {}) };
    if (form.photo && String(form.photo).length > 120000) delete form.photo;
    slim[key] = { ...value, form };
  }
  try {
    localStorage.setItem(DRAFT_STORE, JSON.stringify(slim));
  } catch {
    /* The log itself is untouched if a draft is too large. */
  }
}

function draftKeyFor(screen, form) {
  const mode = screen === "trip" && ui.editingWeather ? "conditions" : screen;
  const kind = form?.kind || form?._kind || mode;
  const id = form?.id || (mode === "conditions" ? (ui.tripId || "new") : "new");
  return `${ui.boatId}|${mode}|${kind}|${id}`;
}

function draftLabel() {
  if (ui.editingWeather) return "Conditions";
  if (ui.screen === "trip-form") return "Trip";
  if (ui.screen === "entry-form") return KIND_LABEL[ui.form?.kind] || "Entry";
  if (ui.screen === "person-form") return "Person";
  if (ui.screen === "place-form") return "Place";
  if (ui.screen === "ticket-form" || ui.screen === "part-form") return "Maintenance";
  if (ui.screen === "media-form") return "Media";
  if (ui.screen === "wrap") return "Wrap-up";
  if (ui.screen === "best") return "Best moment";
  return "Entry";
}

function rememberDraft() {
  if (!ui.form || !formIsOpen()) return;
  const key = ui.draftKey || draftKeyFor(ui.screen, ui.form);
  ui.draftKey = key;
  const draft = {
    key,
    boatId: ui.boatId,
    screen: ui.screen,
    editingWeather: !!ui.editingWeather,
    tripId: ui.tripId,
    label: draftLabel(),
    form: ui.form,
    updatedAt: new Date().toISOString(),
  };
  writeDraftMap(upsertDraft(readDraftMap(), key, draft));
  const top = navStack[navStack.length - 1];
  if (top && top.sig === lastSig) {
    top.form = { ...ui.form };
    top.dirty = true;
    top.draftKey = key;
    top.showingDraft = true;
  }
}

function clearDraftKey(key) {
  const id = key || ui.draftKey;
  if (!id) return;
  writeDraftMap(removeDraft(readDraftMap(), id));
}

function latestDraft() {
  return Object.values(readDraftMap())
    .filter((item) => item.boatId === ui.boatId)
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))[0] || null;
}

function markDirty() {
  if (!ui.form || !formIsOpen()) return;
  ui.dirty = true;
  ui.showingDraft = true;
  rememberDraft();
}

function beginForm(screen, fresh) {
  const key = draftKeyFor(screen, fresh);
  const draft = readDraftMap()[key];
  ui.draftKey = key;
  ui.editingWeather = false;
  if (draft?.form) {
    ui.form = draft.form;
    ui.dirty = true;
    ui.showingDraft = true;
  } else {
    ui.form = fresh;
    ui.dirty = false;
    ui.showingDraft = false;
  }
  ui.screen = screen;
  paint();
}

function blankWeatherSlice(night) {
  return {
    weatherText: "",
    generated: "",
    wind: "",
    advisory: false,
    night: !!night,
    conditions: [],
    weatherKind: "",
    weatherSource: "",
    weatherAt: "",
    weatherCode: null,
  };
}

function weatherSlice(trip) {
  const weather = trip?.weather || {};
  return {
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
  };
}

function passagePrefs() {
  return state.settings.passageByBoat?.[ui.boatId] || { speed: "7", factor: "1.3" };
}

function boatMeasure() {
  return measureOf(ui.boatId);
}

function precheckSlice(trip) {
  const saved = trip?.precheck || {};
  const item = (key) => saved[key] || {};
  return {
    fuelOnBoard: saved.fuelOnBoard ?? "",
    waterOnBoard: saved.waterOnBoard ?? "",
    engineStatus: item("engine").status || "",
    engineNote: item("engine").note || "",
    engineTicket: !!item("engine").ticketId,
    engineTicketId: item("engine").ticketId || "",
    oilStatus: item("oil").status || "",
    oilNote: item("oil").note || "",
    oilTicket: !!item("oil").ticketId,
    oilTicketId: item("oil").ticketId || "",
    coolantStatus: item("coolant").status || "",
    coolantNote: item("coolant").note || "",
    coolantTicket: !!item("coolant").ticketId,
    coolantTicketId: item("coolant").ticketId || "",
  };
}

function etaSlice(trip) {
  const prefs = passagePrefs();
  const eta = trip?.eta || {};
  return {
    etaSpeed: eta.speedKn != null ? String(eta.speedKn) : (prefs.speed || "7"),
    etaFactor: eta.factor != null ? String(eta.factor) : (prefs.factor || "1.3"),
    manualNm: eta.manualNm || "",
    captainEta: eta.captainEta || "",
  };
}

function currentEstimate(form, departedAt) {
  return passageEstimate({
    from: placeById(form.fromId),
    to: placeById(form.toId),
    factor: form.etaFactor,
    speedKn: form.etaSpeed,
    manualNm: form.manualNm,
    departedAt: departedAt || new Date(),
  });
}

function etaRecord(form, departedAt, previous) {
  const estimate = currentEstimate(form, departedAt);
  return {
    nm: estimate.nm,
    straightNm: estimate.straightNm,
    hours: estimate.hours,
    speedKn: estimate.speedKn,
    factor: estimate.factor,
    manualNm: form.manualNm || "",
    appEta: estimate.appEta,
    captainEta: form.captainEta || "",
    winner: previous?.winner || "",
    message: previous?.message || "",
    captainMinutes: previous?.captainMinutes ?? null,
    appMinutes: previous?.appMinutes ?? null,
  };
}

function scoreTrip(trip) {
  if (!trip?.eta?.appEta || !trip.eta.captainEta || !trip.arrivedAt) return;
  const scored = scoreEta({
    whenIso: trip.departedAt || trip.arrivedAt,
    arrivedIso: trip.arrivedAt,
    appEta: trip.eta.appEta,
    captainEta: trip.eta.captainEta,
  });
  if (!scored) return;
  trip.eta = { ...trip.eta, ...scored };
}

function applyPrecheck(trip, form) {
  const unit = boatMeasure().volumeLabel;
  const labels = Object.fromEntries(PRECHECK);
  const stamp = nowIso();
  const items = {};
  for (const [key, label] of PRECHECK) {
    const status = form[`${key}Status`] || "";
    const note = (form[`${key}Note`] || "").trim();
    let ticketId = form[`${key}TicketId`] || "";
    if (status === "attention" && form[`${key}Ticket`] && !ticketId) {
      ticketId = uid();
      state.tickets.push({
        id: ticketId,
        boatId: ui.boatId,
        tripId: trip.id,
        entryId: "",
        title: `${label} needs attention`,
        detail: note,
        status: "open",
        reference: "",
        createdAt: stamp,
        updatedAt: stamp,
        closedAt: "",
      });
    }
    items[key] = { status, note, ticketId };
  }
  trip.precheck = {
    fuelOnBoard: form.fuelOnBoard === "" || form.fuelOnBoard == null ? null : Number(form.fuelOnBoard),
    waterOnBoard: form.waterOnBoard === "" || form.waterOnBoard == null ? null : Number(form.waterOnBoard),
    unit,
    ...items,
  };
}

function failSave(message) {
  ui.afterLeave = null;
  ui.leaveViaHistory = false;
  ui.guardStep = "";
  guardAction = null;
  flash(message);
  paint();
}

function sealHistory() {
  const top = navStack[navStack.length - 1];
  if (!top || top.sig !== lastSig) return;
  top.dirty = false;
  top.showingDraft = false;
  top.draftKey = "";
}

function syncFormFromDom() {
  if (!ui.form) return;
  document.querySelectorAll("input[name], textarea[name], select[name]").forEach((el) => {
    if (["placeQuery", "pickerQuery", "loggedBy", "switchTrip", "reference"].includes(el.name)) return;
    ui.form[el.name] = el.type === "checkbox" ? el.checked : el.value;
  });
}

function retireFrame(then) {
  const top = navStack[navStack.length - 1];
  if (!top || top.sig !== lastSig || navStack.length < 2) {
    then();
    return;
  }
  navStack.pop();
  lastSig = navStack[navStack.length - 1]?.sig || "";
  ignorePop = true;
  const done = () => {
    window.removeEventListener("popstate", done);
    ignorePop = false;
    then();
  };
  window.addEventListener("popstate", done);
  history.back();
}

function finishSave(fallback) {
  clearDraftKey(ui.draftKey);
  ui.dirty = false;
  ui.showingDraft = false;
  ui.draftKey = "";
  const next = ui.afterLeave;
  const viaHistory = ui.leaveViaHistory;
  ui.afterLeave = null;
  ui.leaveViaHistory = false;
  ui.guardStep = "";
  guardAction = null;
  const go = () => {
    if (next) next();
    else fallback();
  };
  if (viaHistory) {
    if (navStack.length > 1 && navStack[navStack.length - 1]?.sig === lastSig) {
      navStack.pop();
      lastSig = navStack[navStack.length - 1]?.sig || "";
    }
    go();
    return;
  }
  retireFrame(go);
}

function navSig() {
  return [ui.screen, ui.editingWeather ? "1" : "0", ui.tripId || "", ui.ticketId || "", ui.form?.id || "", ui.form?.kind || ui.form?._kind || ""].join("~");
}

function pushHistory() {
  if (!navReady) return;
  const sig = navSig();
  if (sig === lastSig) return;
  lastSig = sig;
  navStack.push({
    sig,
    screen: ui.screen,
    tripId: ui.tripId,
    ticketId: ui.ticketId,
    journalScope: ui.journalScope,
    maintScope: ui.maintScope,
    mediaScope: ui.mediaScope,
    editingWeather: !!ui.editingWeather,
    zonesOpen: !!ui.zonesOpen,
    form: ui.form ? { ...ui.form } : null,
    dirty: !!ui.dirty,
    draftKey: ui.draftKey || "",
    showingDraft: !!ui.showingDraft,
  });
  history.pushState({ i: navStack.length - 1 }, "");
}

function applyNav(entry) {
  if (!entry) return;
  ui.screen = entry.screen;
  ui.tripId = entry.tripId;
  ui.ticketId = entry.ticketId;
  ui.journalScope = entry.journalScope || ui.journalScope;
  ui.maintScope = entry.maintScope || ui.maintScope;
  ui.mediaScope = entry.mediaScope || ui.mediaScope;
  ui.editingWeather = !!entry.editingWeather;
  ui.zonesOpen = !!entry.zonesOpen;
  ui.draftKey = entry.draftKey || "";
  const draft = ui.draftKey ? readDraftMap()[ui.draftKey] : null;
  ui.form = draft?.form || entry.form || null;
  ui.dirty = !!draft;
  ui.showingDraft = !!draft;
  lastSig = entry.sig;
  paint();
}

function onPopState(event) {
  if (!navReady || ignorePop) return;
  if (!event.state || typeof event.state.i !== "number") {
    ignorePop = true;
    history.pushState({ i: Math.max(0, navStack.length - 1) }, "");
    ignorePop = false;
    return;
  }
  if (ui.dirty && formIsOpen()) {
    ignorePop = true;
    history.pushState({ i: Math.max(0, navStack.length - 1) }, "");
    ignorePop = false;
    guardAction = () => history.back();
    ui.leaveViaHistory = true;
    ui.guardStep = "ask";
    paint();
    return;
  }
  const entry = navStack[event.state.i];
  navStack.length = event.state.i + 1;
  applyNav(entry);
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

const DEMO_OUTBOX_KEY = "hm2log-v5-demo-outbox";
const GOOGLE_KEY = "hm2log-v5-google";
const SYNC_OUTBOX_KEY = "hm2log-v5-outbox";

function readOutbox() {
  try {
    const parsed = JSON.parse(localStorage.getItem(DEMO_OUTBOX_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
}

function writeOutbox(items) {
  localStorage.setItem(DEMO_OUTBOX_KEY, JSON.stringify(items));
}

function rememberDemo(since = state.settings.demoSince || "") {
  if (!state.settings.demoSync) return;
  writeOutbox(queueDemo(readOutbox(), demoChanges(state, since)));
}

function readGoogle() {
  try {
    const parsed = JSON.parse(localStorage.getItem(GOOGLE_KEY) || "{}");
    return { ...emptyGoogleSync(), ...parsed };
  } catch (error) {
    return emptyGoogleSync();
  }
}

function writeGoogle(config) {
  localStorage.setItem(GOOGLE_KEY, JSON.stringify({ ...emptyGoogleSync(), ...config }));
}

function readSyncOutbox() {
  try {
    const parsed = JSON.parse(localStorage.getItem(SYNC_OUTBOX_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
}

function writeSyncOutbox(items) {
  localStorage.setItem(SYNC_OUTBOX_KEY, JSON.stringify(items));
}

let syncing = false;
async function flushSync(options = {}) {
  const config = readGoogle();
  if (!googleConfigured(config) || syncing) return;
  const waiting = readSyncOutbox().filter((item) => item.status === "waiting");
  if (!options.test && !waiting.length) {
    if (!options.quiet) flash("Nothing is waiting.");
    return;
  }
  if (!ui.online) {
    const message = "No signal. Waiting items stay on this phone.";
    writeGoogle({ ...readGoogle(), lastError: message });
    flash(message);
    if (ui.screen === "sync") paint();
    return;
  }
  syncing = true;
  try {
    const response = await fetch(config.url, {
      method: "POST",
      redirect: "follow",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(syncRequest(config, options.test ? [] : waiting, !!options.test)),
    });
    const data = await response.json();
    if (!data || data.ok !== true) throw new Error((data && data.error) || "Google did not accept the sync.");
    if (!options.test) writeSyncOutbox(markSynced(readSyncOutbox(), waiting.map((item) => item.id)));
    const next = readGoogle();
    next.lastSyncAt = nowIso();
    next.lastError = "";
    if (data.sheetUrl) next.sheetUrl = data.sheetUrl;
    if (data.docUrl) next.docUrl = data.docUrl;
    writeGoogle(next);
    flash(options.test ? "Connection works." : "Sent.");
  } catch (error) {
    const message = error?.message || "The sync did not go through. Waiting items stay on this phone.";
    if (!options.test && waiting.length) writeSyncOutbox(markRetry(readSyncOutbox(), waiting.map((item) => item.id), message));
    writeGoogle({ ...readGoogle(), lastError: message });
    flash(message);
  } finally {
    syncing = false;
    updateSaveLabel();
    if (ui.screen === "sync") paint();
  }
}

function rememberGoogle() {
  const config = readGoogle();
  if (!googleConfigured(config) || !config.since) return;
  writeSyncOutbox(queueSync(readSyncOutbox(), syncChanges(state, config.since)));
}

async function persist(options = {}) {
  state = normalizeState(state);
  await saveState(state);
  rememberDemo();
  rememberGoogle();
  updateSaveLabel();
  if (options.announce) flash(options.announce);
  const config = readGoogle();
  if (googleConfigured(config) && config.auto && ui.online) flushSync({ quiet: true });
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
  trip.updatedAt = nowIso();
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
  return { _kind: "weather", ...weatherSlice(trip) };
}

function tripForm(trip) {
  const night = sunIsDown();
  const weather = trip ? weatherSlice(trip) : blankWeatherSlice(night);
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
    ...weather,
    ...precheckSlice(trip),
    ...etaSlice(trip),
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
    units: here.measure.volume,
    cost: "",
    currency: here.measure.currency,
    unitPrice: "",
    engineHours: "",
    parts: "",
    receipt: "",
    catchName: "",
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
    units: entry.units || boat().measure.volume,
    cost: entry.cost ?? "",
    currency: entry.currency || boat().measure.currency,
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
  return { _kind: "person", id: null, name: "", categories: [], serviceTags: [], businessName: "", phone: "", email: "", address: "", website: "", notes: "", photo: "" };
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

function conditionsLine(weather) {
  if (!weather) return "No conditions yet";
  const parts = [];
  if (weather.text) parts.push(weather.text);
  if (weather.windKn != null && weather.windKn !== "" && !/wind/i.test(weather.text || "")) parts.push(`wind ${weather.windKn} kn`);
  const kind = weather.kind === "forecast" ? "Forecast" : weather.kind === "observed" ? "What I saw" : "";
  const when = weather.at ? fmtTime(weather.at) : "";
  const tail = [kind, when].filter(Boolean).join(" ");
  if (tail) parts.push(tail);
  return parts.join(" · ") || "No conditions yet";
}

function meteoNote(form) {
  if (!form || form.weatherSource !== "Open-Meteo" || !form.weatherAt) return "";
  if (!form.wind && !(form.weatherText || "").trim()) return "";
  return `From Open-Meteo, ${fmtTime(form.weatherAt)}`;
}

function zoneLinks() {
  const links = (ZONES[ui.boatId] || []).map((zone) => `<a class="btn block" href="${esc(zone.url)}" target="_blank" rel="noopener">${esc(zone.name)}</a>`);
  return `<div class="stack">${links.join("")}</div>`;
}

function zoneFolder() {
  return `<button type="button" class="btn block" data-action="toggleZones">${ui.zonesOpen ? "Hide forecast zones" : "Forecast zones"}</button>${ui.zonesOpen ? zoneLinks() : ""}`;
}

function weatherEditor(form) {
  const night = !!form.night;
  const options = CONDITIONS.map((item) => (item.id === "sunny" && night ? { value: "sunny", label: "Clear" } : { value: item.id, label: item.label }));
  return `<section class="card">
    <p class="kicker">Conditions</p>
    <button type="button" class="btn block${night ? " on" : ""}" id="night-toggle" data-action="night">${night ? "Night weather on" : "Night weather off"}</button>
    ${chips("conditions", options, form.conditions || [], true)}
    ${field("Plain-language conditions", "weatherText", form.weatherText || "", { area: true, placeholder: "Cloudy, windy, light rain" })}
    ${field("Wind (kn)", "wind", form.wind || "", { type: "number", inputMode: "decimal", step: "1" })}
    ${meteoNote(form) ? `<p class="hint">${esc(meteoNote(form))}</p>` : ""}
    <div class="split">
      <button type="button" class="btn${form.weatherKind === "forecast" ? " on" : ""}" data-action="weatherKind" data-value="forecast">Forecast</button>
      <button type="button" class="btn${form.weatherKind === "observed" ? " on" : ""}" data-action="weatherKind" data-value="observed">What I saw</button>
    </div>
    <button type="button" class="btn block" data-action="forecast">Read conditions</button>
    <button type="button" class="btn block${form.advisory ? " on" : ""}" data-action="flag" data-flag="advisory">${form.advisory ? "Small craft / wind warning posted" : "No advisory"}</button>
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
    return [entry.tank, formatVolume(entry.quantity, entry.units), formatMoney(entry.cost, entry.currency)].filter(Boolean).join(" · ");
  }
  if (entry.kind === "pumpout") return [entry.placeId ? placeName(entry.placeId) : "", formatMoney(entry.cost, entry.currency), formatVolume(entry.quantity, entry.units), entry.notes].filter(Boolean).join(" · ");
  if (entry.kind === "crab") return [undupeWord(entry.catchName), entry.count != null ? String(entry.count) : "", entry.timeOfDay, spaceSentences(entry.notes)].filter(Boolean).join(" · ");
  if (entry.kind === "rating") return spaceSentences(entry.narrative || entry.notes || "");
  return spaceSentences(entry.notes || "");
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
    <section class="card tester-card">
      <p class="kicker">For testers</p>
      <a class="btn block tester-download" href="hm2-log-v5-tester-instructions.html" download="HM2-Log-v5-tester-instructions.html" data-tester-instructions>Download tester instructions</a>
    </section>
    <section class="card"><h2>Add boat activity</h2><p>Dock work, a tank fill, washing, or a pump-out. No trip required.</p>
      <button type="button" class="btn primary" data-action="activity">Add boat activity</button>
    </section>
    ${other.length ? `<section class="card"><h2>Also planned</h2><div class="stack">${other.map((trip) => `<button type="button" class="rowmain" data-action="openTrip" data-id="${esc(trip.id)}"><span class="rowtitle">${esc(trip.title)}</span><span class="rowmeta">${esc(statusLabel(trip.status))} · ${esc(trip.tripCode || "")}</span></button>`).join("")}</div></section>` : ""}
    ${past.length ? `<section class="card"><h2>Arrived</h2><div class="stack">${past.map((trip) => `<button type="button" class="rowmain" data-action="openTrip" data-id="${esc(trip.id)}"><span class="rowtitle">${esc(trip.title)}</span><span class="rowmeta">${esc(fmt(trip.arrivedAt || trip.departedAt))} · ${esc(trip.tripCode || "")}</span></button>`).join("")}</div></section>` : ""}
    <section class="card"><h2>Forecast</h2><p>${esc(saved && (saved.text || saved.windKn != null) ? conditionsLine(saved) : "No conditions saved yet.")}</p>${zoneFolder()}<button type="button" class="btn block" data-action="forecast">Read conditions</button></section>`;
}

function etaSummary(trip) {
  const eta = trip.eta;
  if (!eta || (!eta.appEta && !eta.captainEta && eta.nm == null)) return "";
  let tally = "First ETA race is up for grabs.";
  let captain = 0;
  let appWins = 0;
  for (const item of boatTrips()) {
    if (item.eta?.winner === "Captain") captain += 1;
    else if (item.eta?.winner === "App") appWins += 1;
  }
  if (captain || appWins) {
    tally = captain > appWins
      ? `The Captain knows these waters. ${captain}–${appWins}`
      : captain === appWins
        ? `Dead even, ${captain}–${appWins}.`
        : `The app is ahead, ${appWins}–${captain}.`;
  }
  return `<p class="meta">App ${esc(formatClock(eta.appEta) || "—")} · You ${esc(formatClock(eta.captainEta) || "—")}${eta.nm != null ? ` · ${esc(eta.nm.toFixed(1))} nm` : ""}</p>${eta.message ? `<p>${esc(eta.message)}</p>` : ""}<p class="hint">${esc(tally)}</p>`;
}

function precheckSummary(trip) {
  const saved = trip.precheck;
  if (!saved) return "";
  const unit = saved.unit || boatMeasure().volumeLabel;
  const lines = [];
  if (saved.fuelOnBoard != null && saved.fuelOnBoard !== "") lines.push(`Fuel on board: ${saved.fuelOnBoard} ${unit}`);
  if (saved.waterOnBoard != null && saved.waterOnBoard !== "") lines.push(`Water on board: ${saved.waterOnBoard} ${unit}`);
  for (const [key, label] of PRECHECK) {
    const item = saved[key];
    if (!item?.status) continue;
    lines.push(`${label}: ${item.status === "ok" ? "OK" : "Needs attention"}${item.note ? ` — ${item.note}` : ""}`);
  }
  if (!lines.length) return "";
  return `<h2>Before departure</h2>${lines.map((line) => `<p>${esc(line)}</p>`).join("")}`;
}

function screenTrip() {
  const trip = shownTrip();
  if (!trip) {
    return `<p class="kicker">Trip</p><h1>No trip yet</h1><p>The trip is the log. Notes, crab, photos, and the rating hang off it.</p><button type="button" class="btn primary" data-action="startTrip">Start a trip</button>`;
  }
  const weather = trip.weather || {};
  const actions = [
    `<button type="button" class="btn primary" data-action="journal" data-scope="trip">Journal</button>`,
    `<button type="button" class="btn" data-action="newEntry" data-kind="rating" data-link="1">Narrative rating</button>`,
    `<button type="button" class="btn" data-action="newEntry" data-kind="crab" data-link="1">Crab catch</button>`,
    `<button type="button" class="btn" data-action="nav" data-screen="media">Media</button>`,
    `<button type="button" class="btn" data-action="newEntry" data-kind="repair" data-link="1">Repair</button>`,
  ];
  if (trip.status !== "underway") actions.push(`<button type="button" class="btn" data-action="newEntry" data-kind="note" data-link="1">Trip note</button>`);
  actions.push(
    `<button type="button" class="btn" data-action="best">Best moment</button>`,
    `<button type="button" class="btn" data-action="newTicket" data-link="1">Maintenance ticket</button>`,
    `<button type="button" class="btn arrived" data-action="arrive">${trip.status === "underway" ? "Arrived — wrap up" : "Edit wrap-up"}</button>`,
  );
  const conditions = ui.editingWeather && ui.form?._kind === "weather"
    ? `${weatherEditor(ui.form)}<button type="button" class="btn primary" data-action="saveConditions">Save conditions</button><button type="button" class="btn quiet block" data-action="cancelConditions">Cancel</button>`
    : `<section class="card"><p>${esc(conditionsLine(weather))}</p><button type="button" class="btn block" data-action="updateConditions">Update conditions</button></section>`;
  return `<p class="kicker">Trip</p>${tripSwitch(trip.id)}
    <section class="card">
      <h1>${esc(trip.title)}</h1>
      <p><span class="pill${trip.status === "underway" ? " warn" : trip.status === "arrived" ? " ok" : ""}">${esc(statusLabel(trip.status))}</span>${weather.advisory ? ` <span class="pill warn">Small craft / wind warning</span>` : ""}</p>
      <p class="meta">Trip ID <strong>${esc(trip.tripCode || "")}</strong></p>
      <p>${esc(placeName(trip.fromId))} → ${esc(placeName(trip.toId))}</p>
      <p>${esc(trip.purpose || "")}</p>
      ${faces(trip)}
      <p>${esc(aboardLine(trip))}</p>
      ${trip.meter ? `<p class="meta">${esc(boat().meterLabel)}: ${esc(trip.meter)}${boat().meterOffset ? ` · true hours ≈ ${Number(trip.meter) + boat().meterOffset}` : ""}</p>` : ""}
      ${etaSummary(trip)}
      ${precheckSummary(trip)}
      ${trip.bestMoment?.text ? `<p><strong>Best moment.</strong> ${esc(spaceSentences(trip.bestMoment.text))}</p>` : ""}
      ${trip.rating?.narrative ? `<p>${starsHtml(trip.rating.stars || 0)}</p><p>${esc(spaceSentences(trip.rating.narrative))}</p>` : ""}
      <button type="button" class="btn block" data-action="editTrip">Edit trip details</button>
    </section>
    <div class="stack">${actions.join("")}</div>
    ${conditions}
    ${zoneFolder()}`;
}

function screenTripForm() {
  const form = ui.form;
    const editing = !!form.id;
  const existingStatus = editing ? tripById(form.id)?.status : "";
  const showDepart = !editing || existingStatus === "planned";
  return `<p class="kicker">${editing ? "Edit trip" : "Start a trip"}</p><h1>${editing ? "Trip details" : "Depart"}</h1>
    ${placeButton("Departure", "fromId")}
    ${placeButton("Destination", "toId")}
    ${field("Trip name (optional)", "title", form.title, { placeholder: "Leave blank to use the places" })}
    <div class="field"><span>Purpose</span>${chips("purpose", PURPOSES.map((item) => ({ value: item, label: item })), form.purpose, false)}</div>
    ${peoplePicker(form.peopleIds)}
    ${field(boat().meterLabel, "meter", form.meter, { type: "number", inputMode: "decimal", step: "0.1" })}
    <p class="hint" id="meter-hint">${esc(meterHint(form.meter))}</p>
    ${field("Trip note", "notes", form.notes, { area: true })}
    ${etaEditor(form)}
    ${precheckEditor(form)}
    ${weatherEditor(form)}
    ${zoneFolder()}
    ${showDepart ? `<button type="button" class="btn primary" data-action="saveTrip" data-mode="depart">Depart</button>` : ""}
    <button type="button" class="btn block" data-action="saveTrip" data-mode="${editing ? "save" : "plan"}">${editing ? "Save changes" : "Save as planned"}</button>
    <button type="button" class="btn quiet block" data-action="cancelForm">Cancel</button>
    ${editing ? `<button type="button" class="btn danger block" data-action="deleteTrip">Delete trip</button>` : ""}`;
}

function etaEditor(form) {
  const departed = form.id && tripById(form.id)?.departedAt ? new Date(tripById(form.id).departedAt) : new Date();
  const estimate = currentEstimate(form, departed);
  const distance = estimate.nm == null
    ? "No chart distance for these places."
    : `≈ ${estimate.nm.toFixed(1)} nm · straight line × ${estimate.factor}`;
  const time = estimate.hours == null ? "" : `≈ ${formatHours(estimate.hours)} at ${estimate.speedKn} kn`;
  const guess = estimate.appEta ? formatClock(estimate.appEta) : "—";
  return `<section class="card" id="eta-card">
    <h2>ETA game</h2>
    <p id="eta-distance">${esc(distance)}</p>
    ${estimate.straightNm == null ? field("Distance (nm)", "manualNm", form.manualNm || "", { type: "number", inputMode: "decimal", step: "0.1" }) : ""}
    ${field("Speed (kn)", "etaSpeed", form.etaSpeed || "7", { type: "number", inputMode: "decimal", step: "0.1" })}
    <p class="meta" id="eta-readout">${esc(time)}</p>
    <p id="eta-guess"><strong>App's guess: ${esc(guess)}</strong></p>
    ${field("Your guess", "captainEta", form.captainEta || "", { type: "time" })}
    <p class="hint">Optional. Closest guess wins when you mark Arrived.</p>
  </section>`;
}

function precheckEditor(form) {
  const unit = boatMeasure().volumeLabel;
  const row = (key, label) => {
    const status = form[`${key}Status`] || "";
    return `<div class="field"><span>${esc(label)}</span>
      <div class="split">
        <button type="button" class="btn${status === "ok" ? " ok" : ""}" data-action="setCheck" data-check="${key}" data-value="ok">OK</button>
        <button type="button" class="btn${status === "attention" ? " attention" : ""}" data-action="setCheck" data-check="${key}" data-value="attention">Needs attention</button>
      </div>
      ${status === "attention" ? `${field("Note", `${key}Note`, form[`${key}Note`] || "", { placeholder: "Optional" })}
        <button type="button" class="btn block${form[`${key}Ticket`] ? " on" : ""}" data-action="markTicket" data-check="${key}">${form[`${key}Ticket`] ? "Ticket will open when you save" : "Open a maintenance ticket"}</button>` : ""}
    </div>`;
  };
  return `<section class="card">
    <h2>Before you go</h2>
    <p class="hint">Optional. These do not block departing.</p>
    ${field(`Fuel on board (${unit})`, "fuelOnBoard", form.fuelOnBoard ?? "", { type: "number", inputMode: "decimal", step: "0.1" })}
    ${field(`Water on board (${unit})`, "waterOnBoard", form.waterOnBoard ?? "", { type: "number", inputMode: "decimal", step: "0.1" })}
    ${PRECHECK.map(([key, label]) => row(key, label)).join("")}
  </section>`;
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
  const measure = boatMeasure();
  if (form.kind === "fuel" || form.kind === "water") {
    extra += field("Tank", "tank", form.tank);
    extra += field(`Quantity added (${measure.volumeLabel})`, "quantity", form.quantity, { type: "number", inputMode: "decimal", step: "0.1" });
    extra += field(`Total cost (${measure.symbol})`, "cost", form.cost, { type: "number", inputMode: "decimal", step: "0.01" });
    extra += field(`Unit price (optional, ${measure.symbol} per ${measure.volumeLabel})`, "unitPrice", form.unitPrice, { type: "number", inputMode: "decimal", step: "0.01" });
    extra += `<p class="hint" id="price-hint">${esc(priceHint(form))}</p>`;
  }
  if (form.kind === "pumpout") {
    extra += field(`Cost (${measure.symbol})`, "cost", form.cost, { type: "number", inputMode: "decimal", step: "0.01" });
    extra += field(`Quantity (${measure.volumeLabel}, optional)`, "quantity", form.quantity, { type: "number", inputMode: "decimal", step: "0.1" });
  }
  if (form.kind === "crab") {
    extra += field("Catch", "catchName", form.catchName, { placeholder: "Dungeness" });
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
  const measure = boatMeasure();
  return `About ${formatMoney(cost / quantity, measure.currency)} per ${measure.volumeLabel}.`;
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
    <div class="stack">${people.map((person) => personRow(person)).join("")}</div>
    ${state.businesses.length ? `<section class="card"><h2>Companies</h2><div class="stack">${state.businesses.map((business) => `<p><strong>${esc(business.name)}</strong><br><span class="meta">${esc((business.serviceTags || []).join(" · "))}</span></p>`).join("")}</div></section>` : ""}
    ${backBtn()}`;
}

function contactAnchorHtml(kind, value) {
  const href = kind === "phone" ? phoneHref(value) : kind === "email" ? emailHref(value) : websiteHref(value);
  const label = String(value || "").trim();
  if (!href || !label) return "";
  const external = kind === "website" ? ` target="_blank" rel="noopener"` : "";
  return `<a href="${esc(href)}"${external}>${esc(label)}</a>`;
}

function contactLinksHtml(person) {
  return ["phone", "email", "website"].map((kind) => contactAnchorHtml(kind, person?.[kind])).filter(Boolean).join("");
}

function personRow(person) {
  const address = String(person.address || "").trim();
  const links = contactLinksHtml(person);
  const meta = [...(person.categories || []).map((id) => PERSON_CATEGORIES.find((item) => item.id === id)?.label || id), businessName(person.businessId), ...(person.serviceTags || [])].filter(Boolean).join(" · ");
  return `<div class="contact"><button type="button" class="rowmain" data-action="openPerson" data-id="${esc(person.id)}"><span class="rowtitle">${esc(person.name)}</span><span class="rowdetail">${esc(person.notes || "")}</span><span class="rowmeta">${esc(meta)}</span>${address ? `<span class="rowmeta contact-address">${esc(address)}</span>` : ""}</button>${links ? `<p class="contact-links">${links}</p>` : ""}</div>`;
}

function screenPerson() {
  const form = ui.form;
  const myself = form.id === "myself";
  return `<p class="kicker">Contact</p><h1>${myself ? "Myself" : form.id ? "Edit person" : "New person"}</h1>
    ${myself ? `<p class="hint">Myself stays person 1 on every new trip.</p>` : field("Name", "name", form.name)}
    <div class="field"><span>Categories</span>${chips("categories", PERSON_CATEGORIES.map((item) => ({ value: item.id, label: item.label })), form.categories, true)}</div>
    <div class="field"><span>Service tags</span>${chips("serviceTags", SERVICE_TAGS.map((tag) => ({ value: tag, label: tag })), form.serviceTags, true)}</div>
    ${field("Company", "businessName", form.businessName, { placeholder: "Sample Marine Shop" })}
    ${field("Phone", "phone", form.phone || "", { type: "tel" })}
    <p class="contact-links" id="link-phone">${contactAnchorHtml("phone", form.phone)}</p>
    ${field("Email", "email", form.email || "", { type: "email" })}
    <p class="contact-links" id="link-email">${contactAnchorHtml("email", form.email)}</p>
    ${field("Address", "address", form.address || "", { area: true })}
    ${field("Website", "website", form.website || "", { type: "url" })}
    <p class="contact-links" id="link-website">${contactAnchorHtml("website", form.website)}</p>
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
      <button type="button" class="btn" data-action="nav" data-screen="sync">Google sync</button>
    </div>`;
}

function demoBanner() {
  return `<p class="demo-banner">Sample demo. Not your Google account. Nothing is shared and nothing leaves this phone.</p>`;
}

function screenSync() {
  const google = readGoogle();
  const configured = googleConfigured(google);
  const waiting = readSyncOutbox().filter((item) => item.status === "waiting").length;
  const count = waiting ? `${waiting} waiting` : google.lastSyncAt ? "All synced" : "Nothing waiting";
  const links = [
    google.sheetUrl ? `<a class="btn block" href="${esc(google.sheetUrl)}" target="_blank" rel="noopener">Open my Sheet</a>` : "",
    google.docUrl ? `<a class="btn block" href="${esc(google.docUrl)}" target="_blank" rel="noopener">Open my Doc</a>` : "",
  ].filter(Boolean).join("");
  const demoOn = !!state.settings.demoSync;
  const demoLabel = outboxLabel(readOutbox());
  return `<p class="kicker">Google sync</p><h1>${configured ? "Connected" : "Not connected"}</h1>
    <p>${configured ? "New saves can go to your Google Sheet and trip journal." : "The log stays on this phone until you add the web app address and token."}</p>
    ${field("Web app address", "googleUrl", google.url, { placeholder: "https://script.google.com/macros/s/…/exec" })}
    ${field("Token", "googleToken", "", { type: "password", placeholder: google.token ? "Saved on this phone. Type to replace it." : "The token from the script" })}
    <button type="button" class="btn primary" data-action="saveGoogle">Save connection</button>
    <button type="button" class="btn block" data-action="testGoogle">Test connection</button>
    <button type="button" class="btn block${google.auto ? " on" : ""}" data-action="toggleAuto">${google.auto ? "Sending new saves automatically" : "Send new saves automatically"}</button>
    <p class="outbox-count">${esc(count)}</p>
    ${google.lastSyncAt ? `<p class="hint">Last sent ${esc(fmt(google.lastSyncAt))}.</p>` : ""}
    ${google.lastError ? `<p>${esc(google.lastError)}</p>` : `<p class="hint">${configured ? "Sync now sends whatever is still waiting." : "Nothing is sent until a connection is saved."}</p>`}
    <button type="button" class="btn block" data-action="syncNow">Sync now</button>
    <button type="button" class="btn quiet block" data-action="sendLog">Send the log on this phone</button>
    ${links}
    <h2>Practice on this phone</h2>
    ${demoOn ? `${demoBanner()}<p class="endpoint">${esc(DEMO_ENDPOINT_LABEL)}</p><p class="outbox-count">${esc(demoLabel)}</p>
      <button type="button" class="btn block" data-action="syncDemoNow">Sync the sample</button>
      <button type="button" class="btn block" data-action="openSampleSheet">Sample Sheet</button>
      <button type="button" class="btn block" data-action="openSampleDoc">Sample journal</button>
      <button type="button" class="btn quiet block" data-action="queueLog">Queue the sample log</button>
      <button type="button" class="btn quiet block" data-action="disableDemo">Turn sample demo off</button>`
      : `<p class="hint">The sample demo draws a pretend Sheet and journal on this phone. It does not talk to Google.</p>
      <button type="button" class="btn quiet block" data-action="enableDemo">Turn on sample demo</button>`}`;
}

function screenSampleSheet() {
  const preview = sheetFromState(syncedState(state, readOutbox()));
  const names = Object.keys(preview);
  const tab = names.includes(ui.sheetTab) ? ui.sheetTab : names[0];
  const rows = preview[tab] || [];
  const columns = rows[0] ? Object.keys(rows[0]) : [];
  const head = columns.map((column) => `<th>${esc(column)}</th>`).join("");
  const body = rows.map((row) => `<tr>${columns.map((column) => `<td>${esc(row[column] ?? "")}</td>`).join("")}</tr>`).join("");
  return `<p class="kicker">Sample Sheet</p><h1>HM2 Log</h1>
    ${demoBanner()}
    <div class="chiprow">${names.map((name) => `<button type="button" class="chip${name === tab ? " on" : ""}" data-action="sheetTab" data-value="${esc(name)}">${esc(name)}</button>`).join("")}</div>
    ${rows.length ? `<div class="sheet-scroll"><table class="sheet-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>` : `<p class="empty">Nothing synced yet.</p>`}`;
}

function screenSampleDoc() {
  const sections = journalFromState(syncedState(state, readOutbox()));
  const body = sections.length
    ? sections.map((section) => `<section class="doc-section"><h2>${esc(section.title)}</h2>${section.lines.map((line) => `<p>${esc(line)}</p>`).join("")}${section.notes.length ? `<h3>Notes</h3>${section.notes.map((line) => `<p>${esc(line)}</p>`).join("")}` : ""}${section.catches.length ? `<h3>Catches</h3>${section.catches.map((line) => `<p>${esc(line)}</p>`).join("")}` : ""}${section.repairs.length ? `<h3>Repairs</h3>${section.repairs.map((line) => `<p>${esc(line)}</p>`).join("")}` : ""}</section>`).join("")
    : `<p class="empty">Nothing synced yet.</p>`;
  return `<p class="kicker">Sample journal</p><article class="doc"><h1>HM2 Log - Trip Journal</h1>
    ${demoBanner()}
    ${body}</article>`;
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
    return ["more", "maint", "ticket", "ticket-form", "part-form", "people", "person-form", "places", "place-form", "backup", "sync", "sample-sheet", "sample-doc"].includes(ui.screen);
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
    sync: screenSync,
    "sample-sheet": screenSampleSheet,
    "sample-doc": screenSampleDoc,
  };
  return (screens[ui.screen] || screenHome)();
}

function backButton() {
  if (navStack.length < 2) return "";
  return `<button type="button" class="back" data-action="goBack">‹ Back</button>`;
}

function draftBanner() {
  if (formIsOpen()) return "";
  const draft = latestDraft();
  if (!draft) return "";
  return `<button type="button" class="banner" data-action="resumeDraft">Unfinished entry: Finish it</button>`;
}

function guardHtml() {
  if (!ui.guardStep) return "";
  if (ui.guardStep === "confirm") {
    return `<div class="sheet" role="dialog"><h1>Discard this unfinished entry?</h1><p>The draft on this phone will be deleted.</p><button type="button" class="btn primary" data-action="guardKeep">Keep working</button><button type="button" class="btn danger block" data-action="guardDiscardYes">Discard</button></div>`;
  }
  return `<div class="sheet" role="dialog"><h1>You have an unfinished entry</h1><p>A draft is kept on this phone until you save or discard it.</p><button type="button" class="btn primary" data-action="guardKeep">Keep working</button><button type="button" class="btn block" data-action="guardSave">Save it</button><button type="button" class="btn danger block" data-action="guardDiscard">Discard</button></div>`;
}

function draftNoteHtml() {
  if (!formIsOpen() || !ui.draftKey || !readDraftMap()[ui.draftKey]) return "";
  return `<p class="hint">Draft kept on this phone.</p><button type="button" class="btn quiet block" data-action="discardDraft">Discard draft</button>`;
}

function paint() {
  const changed = paintedScreen !== `${ui.screen}:${ui.editingWeather}`;
  paintedScreen = `${ui.screen}:${ui.editingWeather}`;
  pushHistory();
  app.innerHTML = `${header()}${underwayBar()}${draftBanner()}<div id="flash" class="flash"${ui.flash ? "" : " hidden"}>${esc(ui.flash)}</div><main class="main">${backButton()}${draftNoteHtml()}${confirmHtml()}${screenHtml()}</main>${navHtml()}${pickerHtml()}${guardHtml()}`;
  document.title = `HM2 Log v5 · ${boat().name}`;
  if (changed) window.scrollTo(0, 0);
}

function openScreen(screen, opts = {}) {
  if (!opts.force && ui.dirty && formIsOpen() && screen !== ui.screen) {
    guardAction = () => openScreen(screen, { force: true });
    ui.guardStep = "ask";
    paint();
    return;
  }
  leaveScreen();
  ui.picker = null;
  ui.confirm = null;
  ui.screen = screen;
  ui.editingWeather = false;
  if (["home", "more", "people", "places", "maint", "backup", "journal", "trip"].includes(screen)) {
    ui.form = null;
    ui.dirty = false;
  }
  if (screen === "trip") {
    const trip = shownTrip();
    ui.tripId = trip ? trip.id : null;
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
      notes: spaceSentences(form.kind === "rating" ? narrative : notes),
      tank: form.tank || "",
      quantity: form.quantity === "" ? null : Number(form.quantity),
      units: form.kind === "fuel" || form.kind === "water" || form.kind === "pumpout" ? boatMeasure().volume : (form.units || ""),
      cost: form.cost === "" ? null : Number(form.cost),
      currency: form.kind === "fuel" || form.kind === "water" || form.kind === "pumpout" ? boatMeasure().currency : (form.currency || ""),
      unitPrice: form.unitPrice === "" ? null : Number(form.unitPrice),
      engineHours: form.engineHours === "" ? null : Number(form.engineHours),
      parts: form.parts || "",
      receipt: form.receipt || "",
      catchName: undupeWord(form.catchName || ""),
      count: form.count === "" ? null : Number(form.count),
      timeOfDay: form.timeOfDay || "",
      narrative: spaceSentences(narrative),
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
    beginForm("trip-form", tripForm(null));
  },
  openTrip(btn) {
    ui.tripId = btn.dataset.id;
    openScreen("trip");
  },
  editTrip() {
    const trip = shownTrip();
    if (!trip) return;
    beginForm("trip-form", tripForm(trip));
  },
  saveTrip(btn) {
    return saving(async () => {
      syncFormFromDom();
      const form = ui.form;
      if (!form.fromId || !form.toId) {
        failSave("Choose a departure and a destination.");
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
      trip.weather = weatherFromForm(form);
      const departedForEta = btn.dataset.mode === "depart" ? new Date() : (trip.departedAt ? new Date(trip.departedAt) : new Date());
      trip.eta = etaRecord(form, departedForEta, trip.eta);
      applyPrecheck(trip, form);
      state.settings.passageByBoat = state.settings.passageByBoat || {};
      state.settings.passageByBoat[ui.boatId] = { speed: form.etaSpeed || "7", factor: form.etaFactor || "1.3" };
      trip.updatedAt = stamp;
      if (btn.dataset.mode === "depart") {
        trip.status = trip.status === "arrived" ? "arrived" : "underway";
        if (!trip.departedAt) trip.departedAt = stamp;
      }
      touchPlace(form.fromId);
      touchPlace(form.toId);
      ui.tripId = trip.id;
      ui.editingWeather = false;
      await persist({ announce: btn.dataset.mode === "depart" && trip.status === "underway" ? "Underway. Saved on this phone." : "Trip saved on this phone." });
      finishSave(() => {
        ui.form = null;
        ui.screen = "trip";
        paint();
      });
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
      syncFormFromDom();
      const trip = shownTrip();
      if (!trip) return;
      trip.status = "arrived";
      if (!trip.arrivedAt) trip.arrivedAt = nowIso();
      trip.bestMoment = { text: spaceSentences((ui.form.bestText || "").trim()), tags: ui.form.bestTags || [] };
      trip.film = {
        tools: ui.form.filmTools || [],
        kinds: ui.form.filmKinds || [],
        clips: ui.form.clips || "",
        photos: ui.form.photos || "",
        note: spaceSentences(ui.form.filmNote || ""),
      };
      trip.updatedAt = nowIso();
      saveRating(trip, spaceSentences(ui.form.narrative), ui.form.stars);
      scoreTrip(trip);
      ui.editingWeather = false;
      await persist({ announce: "Arrived. Saved on this phone." });
      finishSave(() => {
        ui.form = null;
        ui.screen = "trip";
        paint();
      });
    });
  },
  skipWrap() {
    return saving(async () => {
      const trip = shownTrip();
      trip.status = "arrived";
      if (!trip.arrivedAt) trip.arrivedAt = nowIso();
      trip.updatedAt = nowIso();
      scoreTrip(trip);
      ui.editingWeather = false;
      await persist({ announce: "Arrived. Saved on this phone." });
      finishSave(() => {
        ui.form = null;
        ui.screen = "trip";
        paint();
      });
    });
  },
  addNote(btn) {
    const trip = tripById(btn.dataset.id) || boatTrips().find((item) => item.status === "underway");
    if (!trip) return;
    ui.tripId = trip.id;
    const fresh = blankEntry("note", trip.id);
    fresh.link = true;
    beginForm("entry-form", fresh);
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
    let fresh;
    if (kind === "rating" && trip) {
      const existing = state.entries.find((entry) => entry.id === `rating-${trip.id}`);
      fresh = existing ? entryToForm(existing) : blankEntry("rating", trip.id);
      fresh.link = true;
      fresh.tripId = trip.id;
    } else {
      fresh = blankEntry(kind, link ? trip.id : "");
      fresh.link = link || kind === "crab";
      if (fresh.link && trip) fresh.tripId = trip.id;
    }
    beginForm("entry-form", fresh);
  },
  openEntry(btn) {
    const entry = state.entries.find((item) => item.id === btn.dataset.id);
    if (!entry) return;
    beginForm("entry-form", entryToForm(entry));
  },
  saveEntry() {
    return saving(async () => {
      syncFormFromDom();
      const built = buildEntry(ui.form);
      if (built.error) {
        failSave(built.error);
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
      await persist({ announce: "Saved on this phone." });
      finishSave(() => {
        ui.form = null;
        ui.screen = "journal";
        paint();
      });
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
    if (ui.form._kind === "weather" && name === "advisory") writeWeather(false);
    markDirty();
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
      if (ui.form._kind === "weather") writeWeather(false);
    }
    if (group === "filmTools" || group === "filmKinds") writeFilm();
    markDirty();
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
    markDirty();
    paint();
  },
  weatherKind(btn) {
    ui.form.weatherKind = btn.dataset.value;
    if (!ui.form.weatherSource || ui.form.weatherSource === "Open-Meteo") ui.form.weatherSource = btn.dataset.value === "observed" ? "Manual" : ui.form.weatherSource || "Manual";
    if (btn.dataset.value === "forecast" && !ui.form.weatherSource) ui.form.weatherSource = "Manual";
    ui.form.weatherAt = ui.form.weatherAt || nowIso();
    if (ui.form._kind === "weather") writeWeather(false);
    markDirty();
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
      const response = await fetch(weatherUrl(here.lat, here.lon, here.measure.temperature));
      if (!response.ok) throw new Error(String(response.status));
      const data = await response.json();
      const current = data.current || {};
      const night = ui.form ? !!ui.form.night : sunIsDown();
      const text = describeWeather({
        code: current.weather_code,
        windKn: current.wind_speed_10m,
        temp: current.temperature_2m,
        tempUnit: here.measure.temperature,
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
        markDirty();
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
    markDirty();
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
      syncFormFromDom();
      const name = (ui.form.name || "").trim();
      if (!name) {
        failSave("Name the place.");
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
      const backToForm = !!ui.stash;
      await persist({ announce: "Place saved" });
      finishSave(() => {
        if (backToForm) {
          restoreStash();
          paint();
        } else {
          ui.placeQuery = "";
          openScreen("places", { force: true });
        }
      });
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
      syncFormFromDom();
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
        detail: spaceSentences((form.detail || "").trim()),
        status: form.status,
        type: form.type,
        photo: form.photo || "",
        videoName: form.videoName || "",
        updatedAt: stamp,
      });
      ui.mediaScope = item.status;
      await persist({ announce: "Saved on this phone." });
      finishSave(() => openScreen("media", { force: true }));
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
      syncFormFromDom();
      const trip = shownTrip();
      trip.bestMoment = { text: spaceSentences((ui.form.bestText || "").trim()), tags: ui.form.bestTags || [] };
      trip.updatedAt = nowIso();
      await persist({ announce: "Best moment saved" });
      finishSave(() => openScreen("trip", { force: true }));
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
      syncFormFromDom();
      const form = ui.form;
      if (!(form.title || "").trim()) {
        failSave("Give the ticket a title.");
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
        detail: spaceSentences((form.detail || "").trim()),
        reference: form.reference || "",
        tripId: form.link ? form.tripId || "" : "",
        updatedAt: stamp,
        status: ticket.status || "open",
      });
      ui.ticketId = ticket.id;
      ui.ticketTab = "details";
      await persist({ announce: "Ticket saved" });
      finishSave(() => {
        ui.form = null;
        ui.screen = "ticket";
        paint();
      });
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
      syncFormFromDom();
      if (!(ui.form.name || "").trim()) {
        failSave("Name the part.");
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
      finishSave(() => openScreen("maint", { force: true }));
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
      email: person.email || "",
      address: person.address || "",
      website: person.website || "",
      notes: person.notes || "",
      photo: person.photo || "",
    };
    ui.screen = "person-form";
    paint();
  },
  savePerson() {
    return saving(async () => {
      syncFormFromDom();
      const myself = ui.form.id === "myself";
      const name = myself ? "Myself" : (ui.form.name || "").trim();
      if (!name) {
        failSave("Name the person.");
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
      Object.assign(person, {
        name,
        categories,
        serviceTags,
        businessId,
        phone: String(ui.form.phone || "").trim(),
        email: String(ui.form.email || "").trim(),
        address: String(ui.form.address || "").trim(),
        website: String(ui.form.website || "").trim(),
        notes: ui.form.notes || "",
        photo: ui.form.photo || "",
        updatedAt: stamp,
      });
      if (ui.stash?.form?.peopleIds) ui.stash.form.peopleIds = Array.from(new Set([...(ui.stash.form.peopleIds || []), person.id, "myself"]));
      const backToTrip = !!ui.stash;
      await persist({ announce: "Contact saved" });
      finishSave(() => {
        if (backToTrip) {
          restoreStash();
          paint();
        } else {
          ui.form = null;
          ui.screen = "people";
          paint();
        }
      });
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
    if (navStack.length > 1) {
      history.back();
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
  enableDemo() {
    state.settings.demoSync = true;
    state.settings.demoSince = nowIso();
    writeOutbox([]);
    return persist({ announce: "Sample demo on. Nothing leaves this phone." }).then(() => paint());
  },
  disableDemo() {
    state.settings.demoSync = false;
    state.settings.demoSince = "";
    localStorage.removeItem(DEMO_OUTBOX_KEY);
    return persist({ announce: "Sample demo off." }).then(() => paint());
  },
  queueLog() {
    if (!state.settings.demoSync) return;
    rememberDemo("");
    flash(outboxLabel(readOutbox()));
    paint();
  },
  saveGoogle() {
    const current = readGoogle();
    const url = (document.querySelector('[name="googleUrl"]')?.value || "").trim();
    const typed = document.querySelector('[name="googleToken"]')?.value || "";
    const token = typed.trim() || current.token;
    const next = { ...current, url, token };
    if (!googleConfigured(next)) {
      flash(url.startsWith("https://script.google.com/") ? "Add the token from the script." : "Use the web app link that ends in /exec.");
      return;
    }
    if (!current.since) next.since = nowIso();
    next.lastError = "";
    writeGoogle(next);
    flash("Connection saved on this phone.");
    paint();
  },
  testGoogle() {
    actions.saveGoogle();
    if (!googleConfigured(readGoogle())) return;
    return flushSync({ test: true });
  },
  toggleAuto() {
    const config = readGoogle();
    if (!googleConfigured(config)) {
      flash("Save the connection first.");
      return;
    }
    config.auto = !config.auto;
    writeGoogle(config);
    paint();
    if (config.auto && ui.online) return flushSync();
  },
  syncNow() {
    if (!googleConfigured(readGoogle())) {
      flash("Save the connection first.");
      return;
    }
    return flushSync();
  },
  sendLog() {
    if (!googleConfigured(readGoogle())) {
      flash("Save the connection first.");
      return;
    }
    writeSyncOutbox(queueSync(readSyncOutbox(), syncChanges(state, "")));
    updateSaveLabel();
    paint();
    if (ui.online) return flushSync();
    flash("Queued on this phone. It sends when you have a signal.");
  },
  syncDemoNow() {
    if (!state.settings.demoSync) return;
    writeOutbox(syncDemo(readOutbox()));
    flash("Sample synced on this phone.");
    updateSaveLabel();
    paint();
  },
  openSampleSheet() {
    ui.screen = "sample-sheet";
    paint();
  },
  openSampleDoc() {
    ui.screen = "sample-doc";
    paint();
  },
  sheetTab(btn) {
    ui.sheetTab = btn.dataset.value || "Trips";
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
  goBack() {
    if (navStack.length < 2) return;
    history.back();
  },
  toggleZones() {
    ui.zonesOpen = !ui.zonesOpen;
    paint();
  },
  updateConditions() {
    const trip = shownTrip();
    if (!trip) return;
    ui.tripId = trip.id;
    ui.editingWeather = true;
    const fresh = weatherForm(trip);
    const key = draftKeyFor("trip", fresh);
    const draft = readDraftMap()[key];
    ui.draftKey = key;
    ui.screen = "trip";
    if (draft?.form) {
      ui.form = draft.form;
      ui.dirty = true;
      ui.showingDraft = true;
    } else {
      ui.form = fresh;
      ui.dirty = false;
      ui.showingDraft = false;
    }
    paint();
  },
  saveConditions() {
    return saving(async () => {
      syncFormFromDom();
      writeWeather(false);
      await persist({ announce: "Conditions saved" });
      ui.editingWeather = false;
      finishSave(() => {
        ui.form = null;
        ui.screen = "trip";
        paint();
      });
    });
  },
  cancelConditions() {
    ui.editingWeather = false;
    ui.form = null;
    ui.dirty = false;
    clearDraftKey(ui.draftKey);
    ui.showingDraft = false;
    paint();
  },
  cancelForm() {
    const dest = ui.screen === "trip-form" && ui.form?.id ? "trip" : "home";
    ui.dirty = false;
    clearDraftKey(ui.draftKey);
    ui.showingDraft = false;
    openScreen(dest, { force: true });
  },
  setCheck(btn) {
    const key = btn.dataset.check;
    const value = btn.dataset.value;
    ui.form[`${key}Status`] = ui.form[`${key}Status`] === value ? "" : value;
    if (ui.form[`${key}Status`] !== "attention") ui.form[`${key}Ticket`] = false;
    markDirty();
    paint();
  },
  markTicket(btn) {
    const key = btn.dataset.check;
    if (ui.form[`${key}TicketId`]) return;
    ui.form[`${key}Ticket`] = !ui.form[`${key}Ticket`];
    markDirty();
    paint();
  },
  guardKeep() {
    guardAction = null;
    ui.guardStep = "";
    ui.afterLeave = null;
    ui.leaveViaHistory = false;
    paint();
  },
  guardSave() {
    const next = guardAction;
    guardAction = null;
    ui.guardStep = "";
    ui.afterLeave = next;
    const screen = ui.editingWeather ? "conditions" : ui.screen;
    if (screen === "conditions") return actions.saveConditions();
    if (screen === "trip-form") return actions.saveTrip({ dataset: { mode: ui.form?.id ? "save" : "plan" } });
    if (screen === "entry-form") return actions.saveEntry();
    if (screen === "media-form") return actions.saveMedia();
    if (screen === "ticket-form") return actions.saveTicket();
    if (screen === "part-form") return actions.savePart();
    if (screen === "person-form") return actions.savePerson();
    if (screen === "place-form") return actions.savePlace();
    if (screen === "wrap") return actions.saveWrap();
    if (screen === "best") return actions.saveBest();
    ui.afterLeave = null;
    flash("Save this from the form, then leave.");
  },
  guardDiscard() {
    ui.guardStep = "confirm";
    paint();
  },
  guardDiscardYes() {
    const next = guardAction;
    guardAction = null;
    ui.guardStep = "";
    ui.leaveViaHistory = false;
    clearDraftKey(ui.draftKey);
    ui.dirty = false;
    ui.showingDraft = false;
    ui.form = null;
    ui.editingWeather = false;
    if (next) next();
    else paint();
  },
  discardDraft() {
    guardAction = () => {
      clearDraftKey(ui.draftKey);
      ui.dirty = false;
      ui.showingDraft = false;
      ui.draftKey = "";
      sealHistory();
      if (ui.screen === "trip-form") ui.form = ui.form?.id ? tripForm(tripById(ui.form.id)) : tripForm(null);
      else if (ui.editingWeather) ui.form = weatherForm(shownTrip());
      else if (ui.screen === "entry-form") ui.form = ui.form?.id ? entryToForm(state.entries.find((entry) => entry.id === ui.form.id) || blankEntry(ui.form.kind, ui.form.tripId)) : blankEntry(ui.form?.kind || "note", ui.form?.tripId || "");
      paint();
    };
    ui.guardStep = "confirm";
    paint();
  },
  resumeDraft() {
    const draft = latestDraft();
    if (!draft) return;
    ui.boatId = draft.boatId || ui.boatId;
    ui.tripId = draft.tripId || ui.tripId;
    ui.editingWeather = !!draft.editingWeather;
    ui.form = draft.form;
    ui.draftKey = draft.key;
    ui.dirty = true;
    ui.showingDraft = true;
    ui.screen = draft.screen || "home";
    paint();
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
    ui.editingWeather = false;
    ui.form = null;
    ui.dirty = false;
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
  if (ui.form._kind === "person" && ["phone", "email", "website"].includes(el.name)) {
    const slot = document.getElementById(`link-${el.name}`);
    if (slot) slot.innerHTML = contactAnchorHtml(el.name, ui.form[el.name]);
  }
  if (typeof ui.form[el.name] === "string" && (el.name === "catchName" || el.name === "notes" || el.name === "narrative" || el.name === "bestText" || el.name === "detail" || el.name === "filmNote" || /Note$/.test(el.name))) {
    const cleaned = el.name === "catchName" ? undupeWord(ui.form[el.name]) : spaceSentences(ui.form[el.name]);
    if (cleaned !== el.value) {
      const atEnd = el.selectionStart === el.value.length;
      el.value = cleaned;
      if (atEnd) el.setSelectionRange(cleaned.length, cleaned.length);
    }
    ui.form[el.name] = el.name === "catchName" ? undupeWord(cleaned) : cleaned;
  }
  if (!["loggedBy", "placeQuery", "pickerQuery", "switchTrip"].includes(el.name)) markDirty();
  if (["quantity", "cost"].includes(el.name)) {
    const hint = document.getElementById("price-hint");
    if (hint) hint.textContent = priceHint(ui.form);
  }
  if (["etaSpeed", "etaFactor", "manualNm", "fromId", "toId"].includes(el.name)) {
    const departed = ui.form.id && tripById(ui.form.id)?.departedAt ? new Date(tripById(ui.form.id).departedAt) : new Date();
    const estimate = currentEstimate(ui.form, departed);
    const readout = document.getElementById("eta-readout");
    const guess = document.getElementById("eta-guess");
    if (readout) readout.textContent = estimate.hours == null ? "" : `≈ ${formatHours(estimate.hours)} at ${estimate.speedKn} kn`;
    if (guess) guess.innerHTML = `<strong>App's guess: ${esc(estimate.appEta ? formatClock(estimate.appEta) : "—")}</strong>`;
  }
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
    markDirty();
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

const LEAVE_ACTIONS = new Set(["nav", "goHome", "goBack", "back", "boat", "editTrip", "updateConditions", "addNote", "newEntry", "openEntry", "journal", "activity", "startTrip", "openTrip", "arrive", "best", "newMedia", "openMedia", "newTicket", "openTicket", "editTicket", "newPart", "openPart", "newPlace", "openPlace", "addPerson", "openPerson", "resumeDraft", "cancelForm", "cancelConditions"]);

const TESTER_GUIDE = "hm2-log-v5-tester-instructions.html";
let testerGuideText = "";

function prefetchTesterGuide() {
  fetch(TESTER_GUIDE)
    .then((response) => (response.ok ? response.text() : ""))
    .then((text) => {
      if (text.includes("hm2-tester-instructions")) testerGuideText = text;
    })
    .catch(() => {});
}

function saveTesterGuide(event) {
  const target = event.target instanceof Element ? event.target : event.target?.parentElement;
  const link = target?.closest?.("[data-tester-instructions]");
  if (!link || !testerGuideText) return;
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  const blob = new Blob([testerGuideText], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const saver = document.createElement("a");
  saver.href = url;
  saver.download = link.getAttribute("download") || "HM2-Log-v5-tester-instructions.html";
  document.body.appendChild(saver);
  saver.click();
  saver.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

app.addEventListener("click", (event) => {
  const target = event.target instanceof Element ? event.target : event.target?.parentElement;
  if (target?.closest?.("[data-tester-instructions]")) saveTesterGuide(event);
});

app.addEventListener("click", (event) => {
  const btn = event.target.closest("[data-action]");
  if (!btn || !app.contains(btn)) return;
  const name = btn.dataset.action;
  const run = actions[name];
  if (!run) return;
  if (ui.guardStep && !name.startsWith("guard") && name !== "discardDraft") return;
  if (!ui.guardStep && LEAVE_ACTIONS.has(name) && ui.dirty && formIsOpen()) {
    guardAction = () => run(btn);
    ui.guardStep = "ask";
    paint();
    return;
  }
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
  navStack.push({
    sig: navSig(),
    screen: "home",
    tripId: null,
    ticketId: null,
    journalScope: "trip",
    maintScope: "open",
    mediaScope: "planned",
    editingWeather: false,
    zonesOpen: false,
    form: null,
    dirty: false,
    draftKey: "",
    showingDraft: false,
  });
  lastSig = navSig();
  history.replaceState({ i: 0 }, "");
  navReady = true;
  paint();
  window.addEventListener("popstate", onPopState);
  window.addEventListener("online", () => {
    ui.online = true;
    updateSaveLabel();
    const config = readGoogle();
    if (googleConfigured(config) && config.auto) flushSync({ quiet: true });
  });
  window.addEventListener("offline", () => {
    ui.online = false;
    updateSaveLabel();
  });
  if (!location.search.includes("nosw=1") && "serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
}

prefetchTesterGuide();
boot().catch((error) => {
  console.error(error);
  app.textContent = `HM2 Log v5 could not start. ${error.message || ""}`;
});
