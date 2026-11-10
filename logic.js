/* HM2 Log v5 — data, weather, and backup rules. No browser APIs. */

export const APP_VERSION = 5;
export const STORAGE_KEY = "hm2log-v5";

export const BOATS = {
  hm2: {
    id: "hm2",
    name: "Halve Maan II",
    prefix: "HM2",
    meterLabel: "Hour meter (QUARTZ)",
    meterOffset: 1231,
    lat: 48.29,
    lon: -122.64,
    region: "pnw",
    pnw: true,
    measure: { volume: "gallons", volumeLabel: "gal", currency: "USD", symbol: "$", temperature: "f" },
  },
  zeeotter: {
    id: "zeeotter",
    name: "Zeeotter",
    prefix: "ZO",
    meterLabel: "Hour meter (as read)",
    meterOffset: 0,
    lat: 53,
    lon: 5.8,
    region: "nl",
    pnw: false,
    measure: { volume: "liters", volumeLabel: "L", currency: "EUR", symbol: "€", temperature: "c" },
  },
};

/** Volume, money, and temperature for one boat. Distance and speed stay nm and kn. */
export function measureOf(boatId) {
  return (BOATS[boatId] || BOATS.hm2).measure;
}

export function formatMoney(amount, currency) {
  const value = Number(amount);
  if (amount == null || amount === "" || Number.isNaN(value)) return "";
  const symbol = currency === "EUR" ? "€" : currency === "USD" ? "$" : "";
  const shown = value.toFixed(2);
  return symbol ? `${symbol}${shown}` : `${shown} ${currency || ""}`.trim();
}

export function formatVolume(quantity, volume) {
  if (quantity == null || quantity === "" || Number.isNaN(Number(quantity))) return "";
  const label = volume === "liters" ? "L" : volume === "gallons" ? "gal" : (volume || "");
  return `${quantity} ${label}`.trim();
}

/** NWS coastal zones used by the v4 forecast buttons, plus the Zeeotter links. */
export const ZONES = {
  hm2: [
    { id: "PZZ133", name: "Northern Inland Waters & San Juans", url: "https://forecast.weather.gov/MapClick.php?zoneid=PZZ133" },
    { id: "PZZ134", name: "Admiralty Inlet", url: "https://forecast.weather.gov/MapClick.php?zoneid=PZZ134" },
    { id: "PZZ135", name: "Puget Sound & Hood Canal", url: "https://forecast.weather.gov/MapClick.php?zoneid=PZZ135" },
  ],
  zeeotter: [
    { id: "KNMI", name: "KNMI wind & weather (Netherlands)", url: "https://www.knmi.nl/nederland-nu/weer/verwachtingen" },
    { id: "Windfinder", name: "Windfinder · IJsselmeer", url: "https://www.windfinder.com/forecast/ijsselmeer" },
    { id: "Met Office", name: "UK inshore waters forecast", url: "https://weather.metoffice.gov.uk/specialist-forecasts/coast-and-sea/inshore-waters-forecast" },
  ],
};

export const PURPOSES = ["Crabbing", "Just a cruise", "Fuel stop", "Other"];
export const ALONG_TYPES = ["Note", "Sight", "Bridge or lock", "Person", "Wildlife", "Funny"];
export const FILM_TOOLS = ["iPhone", "GoPro", "Drone", "Insta360", "Camera"];
export const FILM_KINDS = ["Video", "Photos", "Timelapse", "Aerial", "Audio"];
export const BEST_TAGS = ["Wildlife", "Sunset", "Crabbing", "Docking", "Scenery", "Crew", "Funny"];
export const SERVICE_TAGS = ["mechanic", "yard", "marina", "fuel", "pump-out"];
export const PERSON_CATEGORIES = [
  { id: "friend", label: "Friend" },
  { id: "guest", label: "Guest" },
  { id: "visitor", label: "Visitor" },
  { id: "crew", label: "Crew" },
  { id: "service", label: "Service" },
];
export const CONDITIONS = [
  { id: "sunny", label: "Sunny" },
  { id: "cloudy", label: "Cloudy" },
  { id: "windy", label: "Windy" },
  { id: "rain", label: "Rain" },
  { id: "snow", label: "Snow" },
  { id: "fog", label: "Fog" },
];

/** WMO weather codes from Open-Meteo. Sky words come only from these codes. */
const WMO = {
  0: ["Sunny", "Clear night"],
  1: ["Mostly sunny", "Mostly clear"],
  2: ["Partly cloudy", "Partly cloudy"],
  3: ["Cloudy", "Cloudy"],
  45: ["Fog", "Fog"],
  48: ["Fog", "Fog"],
  51: ["Light drizzle", "Light drizzle"],
  53: ["Drizzle", "Drizzle"],
  55: ["Heavy drizzle", "Heavy drizzle"],
  56: ["Freezing drizzle", "Freezing drizzle"],
  57: ["Freezing drizzle", "Freezing drizzle"],
  61: ["Light rain", "Light rain"],
  63: ["Rain", "Rain"],
  65: ["Heavy rain", "Heavy rain"],
  66: ["Freezing rain", "Freezing rain"],
  67: ["Freezing rain", "Freezing rain"],
  71: ["Light snow", "Light snow"],
  73: ["Snow", "Snow"],
  75: ["Heavy snow", "Heavy snow"],
  77: ["Snow grains", "Snow grains"],
  80: ["Rain showers", "Rain showers"],
  81: ["Rain showers", "Rain showers"],
  82: ["Heavy rain showers", "Heavy rain showers"],
  85: ["Snow showers", "Snow showers"],
  86: ["Heavy snow showers", "Heavy snow showers"],
  95: ["Thunderstorm", "Thunderstorm"],
  96: ["Thunderstorm with hail", "Thunderstorm with hail"],
  99: ["Thunderstorm with hail", "Thunderstorm with hail"],
};

export function uid() {
  return Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
}

export function nowIso() {
  return new Date().toISOString();
}

export function initials(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  return parts.map((part) => part[0]).join("").toUpperCase().slice(0, 3) || "X";
}

export function makeTripCode(prefix, whenIso, loggedBy, id) {
  const day = String(whenIso || nowIso()).slice(0, 10).replace(/-/g, "");
  return `${prefix}-${day}-${initials(loggedBy)}${String(id || "xxxx").slice(-4).toUpperCase()}`;
}

/**
 * Solar altitude below -0.833° means the sun is down.
 * Same approximation the v4 app used for the Night weather option.
 */
export function sunDown(date, lat, lon) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return false;
  const r = Math.PI / 180;
  const i = date.getTime() / 864e5 + 2440587.5 - 2451545;
  const l = (280.46 + 0.9856474 * i) % 360;
  const s = ((357.528 + 0.9856003 * i) % 360) * r;
  const a = (l + 1.915 * Math.sin(s) + 0.02 * Math.sin(2 * s)) * r;
  const p = (23.439 - 4e-7 * i) * r;
  const h = Math.asin(Math.sin(p) * Math.sin(a));
  const y = Math.atan2(Math.cos(p) * Math.sin(a), Math.cos(a));
  const hourAngle = ((((18.697374558 + 24.06570982441908 * i) % 24) * 15 + lon) * r) - y;
  const alt = Math.asin(Math.sin(lat * r) * Math.sin(h) + Math.cos(lat * r) * Math.cos(h) * Math.cos(hourAngle)) / r;
  return alt < -0.833;
}

export function weatherUrl(lat, lon, tempUnit) {
  const temperature = tempUnit === "c" ? "celsius" : "fahrenheit";
  const q = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    current: "temperature_2m,weather_code,wind_speed_10m,precipitation,snowfall,visibility",
    wind_speed_unit: "kn",
    temperature_unit: temperature,
    timezone: "auto",
  });
  return `https://api.open-meteo.com/v1/forecast?${q.toString()}`;
}

function windWord(windKn) {
  if (typeof windKn !== "number" || Number.isNaN(windKn)) return "";
  if (windKn >= 22) return "strong wind";
  if (windKn >= 15) return "windy";
  if (windKn >= 10) return "breezy";
  return "";
}

function finishSentence(parts, temp, tempUnit, windKn) {
  let text = parts.filter(Boolean).join(", ");
  if (typeof temp === "number" && !Number.isNaN(temp)) {
    const unit = tempUnit === "c" ? "C" : "F";
    const shown = `${Math.round(temp)}°${unit}`;
    text = text ? `${text}, ${shown}` : shown;
  }
  if (typeof windKn === "number" && !Number.isNaN(windKn)) {
    const wind = `wind ${Math.round(windKn)} kn`;
    text = text ? `${text} · ${wind}` : `Wind ${Math.round(windKn)} kn`;
  }
  if (!text) return "";
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Plain-language line. Sky words are used only when a weather code is known.
 * Wind alone never becomes "sunny".
 */
export function describeWeather({ code, windKn, temp, tempUnit, isNight, visibilityM, snowfall, precipitation } = {}) {
  const parts = [];
  const known = code == null || code === "" ? null : WMO[Number(code)];
  if (known) parts.push(isNight ? known[1] : known[0]);
  if (!known && typeof snowfall === "number" && snowfall > 0) parts.push(isNight ? "Snow" : "Snow");
  else if (!known && typeof precipitation === "number" && precipitation > 0) parts.push("Rain");
  if (!known && typeof visibilityM === "number" && visibilityM < 1000) parts.push("Fog");
  const wind = windWord(typeof windKn === "string" ? Number(windKn) : windKn);
  if (wind) parts.push(wind);
  return finishSentence(parts, temp, tempUnit, typeof windKn === "string" ? Number(windKn) : windKn);
}

export function sentenceFromChips(ids, isNight) {
  const set = new Set(ids || []);
  const parts = [];
  if (set.has("sunny")) parts.push(isNight ? "Clear night" : "Sunny");
  if (set.has("cloudy")) parts.push("Cloudy");
  if (set.has("windy")) parts.push("Windy");
  if (set.has("rain")) parts.push("Rain");
  if (set.has("snow")) parts.push("Snow");
  if (set.has("fog")) parts.push("Fog");
  if (isNight && !set.has("sunny")) parts.unshift("Night");
  const unique = [];
  for (const part of parts) if (!unique.includes(part)) unique.push(part);
  if (!unique.length) return "";
  const text = unique.join(", ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function dedupeById(list) {
  const map = new Map();
  for (const item of list || []) {
    if (!item || item.id == null || item.id === "") continue;
    const prev = map.get(item.id);
    if (!prev || String(item.updatedAt || "") >= String(prev.updatedAt || "")) map.set(item.id, item);
  }
  return [...map.values()];
}

export function mergeById(local, incoming) {
  const map = new Map();
  for (const item of local || []) {
    if (item && item.id != null && item.id !== "") map.set(item.id, item);
  }
  const stats = { added: 0, updated: 0, skipped: 0 };
  for (const item of incoming || []) {
    if (!item || item.id == null || item.id === "") {
      stats.skipped += 1;
      continue;
    }
    const prev = map.get(item.id);
    if (!prev) {
      map.set(item.id, item);
      stats.added += 1;
    } else if (String(item.updatedAt || "") > String(prev.updatedAt || "")) {
      map.set(item.id, item);
      stats.updated += 1;
    } else {
      stats.skipped += 1;
    }
  }
  return { items: [...map.values()], ...stats };
}

/** Straight-line nautical miles. Same haversine the v4 ETA game used. */
export function haversineNm(from, to) {
  if (from?.lat == null || from?.lon == null || to?.lat == null || to?.lon == null) return null;
  const n = Math.PI / 180;
  const dLat = (Number(to.lat) - Number(from.lat)) * n;
  const dLon = (Number(to.lon) - Number(from.lon)) * n;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(Number(from.lat) * n) * Math.cos(Number(to.lat) * n) * Math.sin(dLon / 2) ** 2;
  return 3440.065 * 2 * Math.asin(Math.sqrt(a));
}

export function formatHours(hours) {
  if (hours == null || Number.isNaN(Number(hours))) return "";
  const minutes = Math.round(Number(hours) * 60);
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export function clockHHMM(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

/**
 * App ETA from the v4 game: straight-line nm × factor, divided by speed.
 * manualNm is used when the places have no coordinates.
 */
export function passageEstimate({ from, to, factor = 1.3, speedKn = 7, manualNm = "", departedAt = new Date() } = {}) {
  const speed = Number(speedKn) > 0 ? Number(speedKn) : 7;
  const water = Number(factor) > 0 ? Number(factor) : 1.3;
  const straightNm = haversineNm(from, to);
  let nm = null;
  if (straightNm != null) nm = straightNm * water;
  else if (manualNm !== "" && manualNm != null && !Number.isNaN(Number(manualNm))) nm = Number(manualNm);
  const start = departedAt instanceof Date ? departedAt : new Date(departedAt || Date.now());
  if (nm == null || Number.isNaN(start.getTime())) {
    return { straightNm, nm, hours: null, appEta: "", speedKn: speed, factor: water };
  }
  const hours = nm / speed;
  const eta = new Date(start.getTime() + hours * 3600000);
  return { straightNm, nm, hours, appEta: clockHHMM(eta), speedKn: speed, factor: water };
}

/** Closest guess wins, same comparison the v4 Arrived step used. */
export function scoreEta({ whenIso, arrivedIso, appEta, captainEta } = {}) {
  if (!arrivedIso || !appEta || !captainEta) return null;
  const day = String(whenIso || arrivedIso).slice(0, 10);
  const arrivedMin = new Date(arrivedIso).getTime() / 60000;
  const captainMin = new Date(`${day}T${captainEta}`).getTime() / 60000;
  const appMin = new Date(`${day}T${appEta}`).getTime() / 60000;
  if ([arrivedMin, captainMin, appMin].some((value) => Number.isNaN(value))) return null;
  const captainOff = Math.abs(captainMin - arrivedMin);
  const appOff = Math.abs(appMin - arrivedMin);
  const winner = captainOff <= appOff ? "Captain" : "App";
  return {
    winner,
    captainMinutes: Math.round(captainOff),
    appMinutes: Math.round(appOff),
    message: winner === "Captain"
      ? `Captain wins. Off by ${Math.round(captainOff)} min, the app by ${Math.round(appOff)}.`
      : `App wins this one. Off by ${Math.round(appOff)} min, you by ${Math.round(captainOff)}.`,
  };
}

export function blankWeatherFields() {
  return { text: "", windKn: null, conditions: [], source: "", at: "", kind: "", code: null, advisory: false, night: false };
}

export function upsertDraft(store, key, draft) {
  return { ...(store || {}), [key]: draft };
}

export function removeDraft(store, key) {
  const next = { ...(store || {}) };
  delete next[key];
  return next;
}

export function emptyCollections() {
  return { people: [], businesses: [], places: [], trips: [], entries: [], media: [], tickets: [], parts: [] };
}

const COLLECTIONS = ["people", "businesses", "places", "trips", "entries", "media", "tickets", "parts"];

export function collectionNames() {
  return COLLECTIONS.slice();
}

export function normalizeState(state) {
  const next = state && typeof state === "object" ? state : {};
  next.version = APP_VERSION;
  next.settings = next.settings || {};
  if (!next.settings.loggedBy) next.settings.loggedBy = "Wishy";
  next.settings.demoSync = next.settings.demoSync === true;
  if (!BOATS[next.settings.activeBoatId]) next.settings.activeBoatId = "hm2";
  next.settings.weatherByBoat = next.settings.weatherByBoat || {};
  next.settings.passageByBoat = next.settings.passageByBoat || {};
  for (const name of COLLECTIONS) next[name] = dedupeById(next[name]);
  const deceptionIds = new Set(
    next.places
      .filter((place) => place.id === "deception-bridge" || /deception pass/i.test(place.name || ""))
      .map((place) => place.id),
  );
  const deceptionUsed = new Set();
  for (const trip of next.trips) {
    delete trip.deception;
    if (deceptionIds.has(trip.fromId)) deceptionUsed.add(trip.fromId);
    if (deceptionIds.has(trip.toId)) deceptionUsed.add(trip.toId);
  }
  for (const entry of next.entries) {
    if (deceptionIds.has(entry.placeId)) deceptionUsed.add(entry.placeId);
  }
  if (deceptionIds.size) {
    next.places = next.places.filter((place) => !deceptionIds.has(place.id) || deceptionUsed.has(place.id));
  }
  if (!next.people.some((person) => person.id === "myself")) {
    next.people.unshift(myselfPerson());
  } else {
    const me = next.people.find((person) => person.id === "myself");
    if (!me.categories.includes("crew")) me.categories = [...me.categories, "crew"];
  }
  for (const trip of next.trips) {
    const ids = new Set(["myself", ...(trip.peopleIds || [])]);
    trip.peopleIds = [...ids];
  }
  return next;
}

export function myselfPerson() {
  const stamp = nowIso();
  return {
    id: "myself",
    name: "Myself",
    categories: ["crew"],
    serviceTags: [],
    businessId: "",
    phone: "",
    notes: "Person 1 on every trip.",
    photo: "",
    createdAt: stamp,
    updatedAt: stamp,
  };
}

function place(id, name, detail, region, extra = {}) {
  const stamp = "2026-11-10T00:00:00.000Z";
  return {
    id,
    name,
    detail,
    region,
    tags: extra.tags || [],
    favorite: !!extra.favorite,
    lastUsedAt: "",
    lat: extra.lat ?? null,
    lon: extra.lon ?? null,
    createdAt: stamp,
    updatedAt: stamp,
  };
}

/** Harbor library carried from the v4 destination lists. Not trip history. */
export function seedPlaces() {
  return [
    place("mariner-cove", "Mariner Cove", "Home dock, Halve Maan II.", "pnw", { favorite: true, lat: 48.291, lon: -122.521 }),
    place("la-conner", "La Conner", "Swinomish Channel.", "pnw", { lat: 48.3833, lon: -122.4831 }),
    place("oak-harbor", "Oak Harbor", "Whidbey Island.", "pnw", { lat: 48.28647, lon: -122.63683 }),
    place("coupeville", "Coupeville", "Penn Cove.", "pnw", { lat: 48.22281, lon: -122.68821 }),
    place("langley", "Langley", "South Whidbey.", "pnw", { lat: 48.0384, lon: -122.40308 }),
    place("anacortes", "Anacortes", "Fidalgo Island.", "pnw", { lat: 48.51305, lon: -122.60579 }),
    place("seattle", "Seattle", "Elliott Bay.", "pnw", { lat: 47.61056, lon: -122.34889 }),
    place("fremont-bridge", "Fremont Bridge", "Seattle bridge.", "pnw", { tags: ["bridge"] }),
    place("ballard-bridge", "Ballard Bridge", "Seattle bridge.", "pnw", { tags: ["bridge"] }),
    place("montlake-bridge", "Montlake Bridge", "Seattle bridge.", "pnw", { tags: ["bridge"] }),
    place("university-bridge", "University Bridge", "Seattle bridge.", "pnw", { tags: ["bridge"] }),
    place("chittenden", "Hiram M. Chittenden Locks", "Ballard locks.", "pnw", { tags: ["lock"] }),
    place("jirnsum", "Jirnsum (RFU)", "Home dock, Zeeotter.", "nl", { favorite: true, lat: 53.0786, lon: 5.79 }),
    place("sneek", "Sneek", "Friesland.", "nl", { lat: 53.0326, lon: 5.659 }),
    place("grou", "Grou", "Friesland.", "nl", { lat: 53.0949, lon: 5.837 }),
    place("leeuwarden", "Leeuwarden", "Friesland.", "nl", { lat: 53.2012, lon: 5.7999 }),
    place("lemmer", "Lemmer", "Friesland.", "nl", { lat: 52.844, lon: 5.711 }),
    place("harlingen", "Harlingen", "Wadden coast.", "nl", { lat: 53.175, lon: 5.414 }),
    place("stavoren", "Stavoren", "IJsselmeer.", "nl", { lat: 52.885, lon: 5.36 }),
    place("enkhuizen", "Enkhuizen", "IJsselmeer.", "nl", { lat: 52.704, lon: 5.294 }),
    place("volendam", "Volendam", "Markermeer.", "nl", { lat: 52.495, lon: 5.071 }),
    place("muiden", "Muiden", "IJmeer.", "nl", { lat: 52.332, lon: 5.07 }),
    place("amsterdam", "Amsterdam", "IJ.", "nl", { lat: 52.378, lon: 4.91 }),
    place("vlissingen", "Vlissingen", "Westerschelde.", "nl", { lat: 51.443, lon: 3.596 }),
    place("oulton", "Oulton Broad (UK)", "Suffolk broads.", "uk", { lat: 52.476, lon: 1.713 }),
    place("houtwiel", "Houtwiel bridge (Sneek)", "Bridge.", "nl", { tags: ["bridge"] }),
    place("margriet", "Prinses Margrietkanaal bridges", "Canal bridges.", "nl", { tags: ["bridge"] }),
    place("lemmer-lock", "Lemmer lock", "Lock.", "nl", { tags: ["lock"] }),
    place("houtrib", "Houtribsluizen (Lelystad)", "Lock.", "nl", { tags: ["lock"] }),
    place("krabbersgat", "Krabbersgatsluizen (Enkhuizen)", "Lock.", "nl", { tags: ["lock"] }),
    place("oranje", "Oranjesluizen (Amsterdam)", "Lock.", "nl", { tags: ["lock"] }),
  ];
}

export function freshState() {
  return normalizeState({
    version: APP_VERSION,
    settings: { loggedBy: "Wishy", activeBoatId: "hm2", weatherByBoat: {} },
    people: [myselfPerson()],
    businesses: [],
    places: seedPlaces(),
    trips: [],
    entries: [],
    media: [],
    tickets: [],
    parts: [],
  });
}

export function exportPayload(state) {
  const clean = normalizeState(structuredClone(state));
  return {
    app: "HM2 Log",
    version: APP_VERSION,
    exportedAt: nowIso(),
    settings: clean.settings,
    people: clean.people,
    businesses: clean.businesses,
    places: clean.places,
    trips: clean.trips,
    entries: clean.entries,
    media: clean.media,
    tickets: clean.tickets,
    parts: clean.parts,
  };
}

export function importPayload(state, payload) {
  if (!payload || payload.version !== APP_VERSION) {
    throw new Error("That file is not an HM2 Log v5 backup.");
  }
  const base = normalizeState(structuredClone(state));
  const stats = {};
  for (const name of COLLECTIONS) {
    const merged = mergeById(base[name], payload[name] || []);
    base[name] = merged.items;
    stats[name] = merged;
  }
  if (payload.settings && typeof payload.settings === "object") {
    base.settings = {
      ...base.settings,
      ...payload.settings,
      weatherByBoat: { ...base.settings.weatherByBoat, ...(payload.settings.weatherByBoat || {}) },
    };
  }
  return { state: normalizeState(base), stats };
}

export function countIds(list) {
  return new Set((list || []).map((item) => item && item.id).filter(Boolean)).size;
}

/** Shown in the sample demo. Not a real address and not a secret. */
export const DEMO_ENDPOINT_LABEL = "demo endpoint";

export const TRIP_FIELD_MAP = [
  ["Trip name", "title", "Title"],
  ["Trip ID", "tripCode", "Trip ID"],
  ["Boat", "boatId", "Boat"],
  ["Status", "status", "Status"],
  ["Departure", "fromId", "Departure"],
  ["Destination", "toId", "Destination"],
  ["Crew", "peopleIds", "Crew"],
  ["Hour meter", "meter", "Hour meter"],
  ["Your guess", "eta.captainEta", "Your guess"],
  ["App's guess", "eta.appEta", "App guess"],
  ["ETA result", "eta.message", "ETA result"],
  ["Conditions", "weather.text", "Conditions"],
  ["Best moment", "bestMoment.text", "Best moment"],
  ["Starfish", "rating.stars", "Starfish"],
  ["Departed", "departedAt", "Departed"],
  ["Arrived", "arrivedAt", "Arrived"],
];

function byId(list, id) {
  return (list || []).find((item) => item.id === id) || null;
}

function boatName(id) {
  return BOATS[id]?.name || id || "";
}

function crewNames(state, ids) {
  return (ids || []).map((id) => byId(state.people, id)?.name || "").filter(Boolean).join(", ");
}

export function tripSheetRow(state, trip) {
  return {
    "Trip ID": trip.tripCode || "",
    Boat: boatName(trip.boatId),
    Title: trip.title || "",
    Status: trip.status || "",
    Departure: byId(state.places, trip.fromId)?.name || "",
    Destination: byId(state.places, trip.toId)?.name || "",
    Crew: crewNames(state, trip.peopleIds),
    "Hour meter": trip.meter || "",
    "Your guess": trip.eta?.captainEta || "",
    "App guess": trip.eta?.appEta || "",
    "ETA result": trip.eta?.message || "",
    Conditions: trip.weather?.text || "",
    "Best moment": trip.bestMoment?.text || "",
    Starfish: trip.rating?.stars ? String(trip.rating.stars) : "",
    Departed: trip.departedAt || "",
    Arrived: trip.arrivedAt || "",
  };
}

function tripTitle(state, tripId) {
  return byId(state.trips, tripId)?.title || "";
}

export function sheetFromState(state) {
  const notes = [];
  const activities = [];
  for (const entry of state.entries || []) {
    const trip = tripTitle(state, entry.tripId);
    const boat = boatName(entry.boatId);
    if (entry.kind === "fuel" || entry.kind === "water" || entry.kind === "wash" || entry.kind === "pumpout") {
      activities.push({
        When: entry.at || "",
        Kind: entry.kind,
        Quantity: entry.quantity == null ? "" : String(entry.quantity),
        Unit: entry.units || "",
        Cost: entry.cost == null ? "" : String(entry.cost),
        Currency: entry.currency || "",
        Tank: entry.tank || "",
        Notes: entry.notes || "",
        Trip: trip,
        Boat: boat,
      });
    } else {
      const text = entry.kind === "crab"
        ? [entry.catchName, entry.count, entry.notes].filter((part) => part != null && part !== "").join(", ")
        : (entry.narrative || entry.notes || "");
      notes.push({
        When: entry.at || "",
        Kind: entry.kind || "",
        Text: text,
        Trip: trip,
        Boat: boat,
        "Logged by": entry.loggedBy || "",
      });
    }
  }
  return {
    Trips: (state.trips || []).map((trip) => tripSheetRow(state, trip)),
    "Notes & Journal": notes,
    "Boat Activities": activities,
    "Maintenance Tickets": (state.tickets || []).map((ticket) => ({
      Title: ticket.title || "",
      Detail: ticket.detail || "",
      Status: ticket.status || "",
      Boat: boatName(ticket.boatId),
      Trip: tripTitle(state, ticket.tripId),
    })),
    Parts: (state.parts || []).map((part) => ({
      Name: part.name || "",
      "Part number": part.partNumber || "",
      Boat: boatName(part.boatId),
      Checked: part.verified ? "Number checked" : "Number not checked",
    })),
    People: (state.people || []).map((person) => ({
      Name: person.name || "",
      Categories: (person.categories || []).join(", "),
    })),
    Places: (state.places || []).map((place) => ({
      Name: place.name || "",
      Notes: place.detail || "",
    })),
  };
}

export function journalFromState(state) {
  return (state.trips || []).map((trip) => {
    const onTrip = (kind) => (state.entries || []).filter((entry) => entry.tripId === trip.id && entry.kind === kind);
    const lines = [
      `${boatName(trip.boatId)} · ${trip.status || "planned"}`,
      trip.tripCode ? `Trip ID ${trip.tripCode}` : "",
      `${byId(state.places, trip.fromId)?.name || "Departure"} → ${byId(state.places, trip.toId)?.name || "Destination"}`,
      crewNames(state, trip.peopleIds) ? `Crew: ${crewNames(state, trip.peopleIds)}` : "",
      trip.weather?.text ? `Conditions: ${trip.weather.text}` : "",
      trip.eta?.captainEta || trip.eta?.appEta
        ? `ETA game: app ${trip.eta?.appEta || "—"}, you ${trip.eta?.captainEta || "—"}${trip.eta?.message ? `. ${trip.eta.message}` : ""}`
        : "",
      trip.rating?.stars ? `Starfish: ${trip.rating.stars}` : "",
      trip.bestMoment?.text ? `Best moment: ${trip.bestMoment.text}` : "",
    ].filter(Boolean);
    const notes = onTrip("note").map((entry) => entry.notes).filter(Boolean);
    const catches = onTrip("crab").map((entry) => [entry.catchName, entry.count].filter((part) => part != null && part !== "").join(", ")).filter(Boolean);
    const repairs = onTrip("repair").map((entry) => entry.notes || entry.parts).filter(Boolean);
    return { title: trip.title || "Trip", lines, notes, catches, repairs };
  });
}

function changeItem(kind, record, label) {
  return {
    id: `${kind}:${record.id}`,
    kind,
    recordId: record.id,
    label,
    updatedAt: record.updatedAt || record.createdAt || "",
    status: "waiting",
  };
}

export function demoChanges(state, since = "") {
  const ready = (record) => !since || String(record.updatedAt || record.createdAt || "") >= String(since);
  const changes = [];
  for (const trip of state.trips || []) {
    if (ready(trip)) changes.push(changeItem("trip", trip, trip.title || trip.tripCode || "Trip"));
  }
  for (const entry of state.entries || []) {
    if (!ready(entry)) continue;
    const label = entry.kind === "fuel" ? "Fuel fill" : entry.kind === "note" ? (entry.notes || "Note") : (entry.title || entry.kind || "Entry");
    changes.push(changeItem("entry", entry, label));
  }
  for (const ticket of state.tickets || []) {
    if (ready(ticket)) changes.push(changeItem("ticket", ticket, ticket.title || "Ticket"));
  }
  for (const part of state.parts || []) {
    if (ready(part)) changes.push(changeItem("part", part, part.name || "Part"));
  }
  return changes;
}

export function queueDemo(outbox, changes) {
  const next = (outbox || []).map((item) => ({ ...item }));
  const byId = new Map(next.map((item) => [item.id, item]));
  for (const change of changes || []) {
    const prev = byId.get(change.id);
    if (!prev) {
      next.push({ ...change, status: "waiting" });
      byId.set(change.id, next[next.length - 1]);
    } else if (prev.status === "synced" && String(change.updatedAt || "") > String(prev.updatedAt || "")) {
      prev.status = "waiting";
      prev.label = change.label;
      prev.updatedAt = change.updatedAt;
    } else if (prev.status === "waiting") {
      prev.label = change.label;
      prev.updatedAt = change.updatedAt || prev.updatedAt;
    }
  }
  return next;
}

export function syncDemo(outbox) {
  return (outbox || []).map((item) => ({ ...item, status: "synced" }));
}

export function outboxLabel(outbox) {
  const waiting = (outbox || []).filter((item) => item.status === "waiting").length;
  if (waiting > 0) return `${waiting} waiting`;
  if ((outbox || []).some((item) => item.status === "synced")) return "All synced";
  return "Nothing waiting";
}

export function syncedState(state, outbox) {
  const synced = new Set((outbox || []).filter((item) => item.status === "synced").map((item) => item.id));
  const keep = (kind, list) => (list || []).filter((item) => synced.has(`${kind}:${item.id}`));
  const trips = keep("trip", state.trips);
  const entries = keep("entry", state.entries);
  const tickets = keep("ticket", state.tickets);
  const parts = keep("part", state.parts);
  const peopleIds = new Set(["myself"]);
  const placeIds = new Set();
  for (const trip of trips) {
    for (const id of trip.peopleIds || []) peopleIds.add(id);
    if (trip.fromId) placeIds.add(trip.fromId);
    if (trip.toId) placeIds.add(trip.toId);
  }
  for (const entry of entries) if (entry.placeId) placeIds.add(entry.placeId);
  return {
    ...state,
    trips,
    entries,
    tickets,
    parts,
    people: (state.people || []).filter((person) => peopleIds.has(person.id)),
    places: (state.places || []).filter((place) => placeIds.has(place.id)),
  };
}
