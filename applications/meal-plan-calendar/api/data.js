import {
  booleanSetting,
  dateKey,
  dateParts,
  fetchCalendarFeed,
  integerSetting,
  normalizeTimeZone,
  parseCalendarFeed,
  stringSetting,
} from "../../_shared/calendar-feed.js";
import { getJson } from "../../_shared/dashboard-api.js";

const OPEN_METEO_FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
const OPEN_METEO_GEOCODING_URL = "https://geocoding-api.open-meteo.com/v1/search";
const WEATHER_TTL_MS = 30 * 60 * 1000;
const FORECAST_DAYS = 16;
// iCloud public feeds keep roughly the last six months; look back a little further
// so other feeds with longer histories can still report "not eaten for X days".
const HISTORY_DAYS = 400;
const MAX_PLAN_DAYS = 14;
const SLOT_ORDER = ["breakfast", "lunch", "dinner", "other"];
const SLOT_SETS = {
  dinner: ["dinner"],
  "lunch-dinner": ["lunch", "dinner"],
  all: ["breakfast", "lunch", "dinner"],
  none: [],
};
const ALL_DAY_SLOTS = new Set(["breakfast", "lunch", "dinner", "other"]);

// Title prefixes that assign an entry to a meal slot, e.g. "Mittag: Pasta" or "🌙 Curry".
const SLOT_PREFIXES = [
  ["breakfast", ["frühstück", "fruehstueck", "breakfast", "brunch", "☕", "🥐", "🍳"]],
  ["lunch", ["mittagessen", "mittags", "mittag", "lunch", "☀️", "☀", "🌞"]],
  ["dinner", ["abendessen", "abendbrot", "abends", "abend", "dinner", "supper", "🌙", "🌜", "🌛"]],
]
  .flatMap(([slot, prefixes]) => prefixes.map((prefix) => ({ slot, prefix })))
  .sort((a, b) => b.prefix.length - a.prefix.length);
const SEPARATOR = /^[\s:|/–—-]+/u;

export function addDays(key, amount) {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + amount)).toISOString().slice(0, 10);
}

export function daysBetween(fromKey, toKey) {
  return Math.round((Date.parse(`${toKey}T00:00:00Z`) - Date.parse(`${fromKey}T00:00:00Z`)) / 86_400_000);
}

function weekdayIndex(key) {
  return new Date(`${key}T00:00:00Z`).getUTCDay();
}

export function normalizeMealTitle(title) {
  return String(title || "")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/ß/g, "ss")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

/** Splits an optional slot prefix from a calendar title. */
export function parseMealTitle(rawTitle) {
  const title = String(rawTitle || "").replace(/\s+/g, " ").trim();
  const lower = title.toLowerCase();
  for (const { slot, prefix } of SLOT_PREFIXES) {
    for (const [open, close] of [["", ""], ["[", "]"], ["(", ")"]]) {
      const token = `${open}${prefix}${close}`;
      if (!lower.startsWith(token)) continue;
      const rest = title.slice(token.length);
      // Words need a separator ("Abendbrot" must not match "Abend"); emoji do not.
      if (/^\p{L}/u.test(prefix) && rest && !SEPARATOR.test(rest)) continue;
      const cleaned = rest.replace(SEPARATOR, "").trim();
      if (cleaned) return { slot, title: cleaned };
    }
  }
  return { slot: "", title };
}

export function slotForTime(hour, minute = 0) {
  const minutes = hour * 60 + minute;
  if (minutes < 11 * 60) return "breakfast";
  if (minutes < 16 * 60) return "lunch";
  return "dinner";
}

/** Maps canonical calendar events to meal entries keyed by civil date. */
export function eventsToMeals(events, { timeZone, allDayMeal = "dinner", rangeEndExclusive }) {
  const meals = [];
  for (const event of Array.isArray(events) ? events : []) {
    const parsed = parseMealTitle(event?.title);
    if (!parsed.title) continue;
    if (event.start?.date) {
      const start = event.start.date;
      const end = event.end?.date && event.end.date > start ? event.end.date : addDays(start, 1);
      const slot = parsed.slot || allDayMeal;
      // Multi-day entries such as "Chili (2 Tage)" repeat on every covered day.
      for (let day = start, guard = 0; day < end && guard < 31; day = addDays(day, 1), guard += 1) {
        if (rangeEndExclusive && day >= rangeEndExclusive) break;
        meals.push({ date: day, slot, title: parsed.title, sort: -1 });
      }
      continue;
    }
    const startMs = Date.parse(event.start?.dateTime || "");
    if (!Number.isFinite(startMs)) continue;
    const parts = dateParts(new Date(startMs), timeZone);
    meals.push({
      date: dateKey(new Date(startMs), timeZone),
      slot: parsed.slot || slotForTime(parts.hour, parts.minute),
      title: parsed.title,
      sort: parts.hour * 60 + parts.minute,
    });
  }
  return meals;
}

export function planRange({ now, timeZone, days, startDay }) {
  const parsed = Date.parse(String(now || ""));
  const current = Number.isFinite(parsed) ? new Date(parsed) : new Date();
  const today = dateKey(current, timeZone);
  const start = startDay === "monday" ? addDays(today, -((weekdayIndex(today) + 6) % 7)) : today;
  return { today, start, endExclusive: addDays(start, days) };
}

/** Groups meals into display days, adds empty slot placeholders and "last eaten" hints. */
export function buildPlan(meals, { today, start, days, slots, showLastEaten = true, lastEatenMinDays = 30 }) {
  const history = new Map();
  for (const meal of meals) {
    if (meal.date >= today) continue;
    const key = normalizeMealTitle(meal.title);
    if (key && (!history.has(key) || history.get(key) < meal.date)) history.set(key, meal.date);
  }
  const plannedSlots = SLOT_SETS[slots] || SLOT_SETS["lunch-dinner"];
  const result = [];
  for (let index = 0; index < days; index += 1) {
    const date = addDays(start, index);
    const entries = meals
      .filter((meal) => meal.date === date)
      .sort(
        (a, b) =>
          SLOT_ORDER.indexOf(a.slot) - SLOT_ORDER.indexOf(b.slot) ||
          a.sort - b.sort ||
          a.title.localeCompare(b.title),
      );
    const seen = new Set();
    const dayMeals = [];
    for (const entry of entries) {
      const dedupeKey = `${entry.slot}:${normalizeMealTitle(entry.title)}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      let lastEatenDays = null;
      const last = history.get(normalizeMealTitle(entry.title));
      if (showLastEaten && date >= today && last) {
        const gap = daysBetween(last, today);
        if (gap >= lastEatenMinDays) lastEatenDays = gap;
      }
      dayMeals.push({ slot: entry.slot, title: entry.title, lastEatenDays });
    }
    for (const slot of plannedSlots) {
      if (!dayMeals.some((meal) => meal.slot === slot)) dayMeals.push({ slot, title: "", empty: true });
    }
    dayMeals.sort((a, b) => SLOT_ORDER.indexOf(a.slot) - SLOT_ORDER.indexOf(b.slot));
    result.push({ date, meals: dayMeals, weather: null });
  }
  return result;
}

function parseCoordinates(value) {
  const match = /^\s*(-?\d{1,2}(?:\.\d+)?)\s*[,;]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/.exec(value);
  if (!match) return null;
  const latitude = Number(match[1]);
  const longitude = Number(match[2]);
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return { latitude, longitude, name: `${latitude.toFixed(2)}, ${longitude.toFixed(2)}` };
}

export async function fetchWeather(location, { timeZone, language, fetchJson = getJson }) {
  let place = parseCoordinates(location);
  if (!place) {
    const search = new URLSearchParams({ name: location, count: "1", language, format: "json" });
    const data = await fetchJson(`${OPEN_METEO_GEOCODING_URL}?${search}`, { ttl: WEATHER_TTL_MS * 48 });
    const hit = Array.isArray(data?.results) ? data.results[0] : null;
    if (!hit || !Number.isFinite(hit.latitude) || !Number.isFinite(hit.longitude)) {
      throw new Error(`Weather location "${location}" was not found`);
    }
    place = { latitude: hit.latitude, longitude: hit.longitude, name: String(hit.name || location) };
  }
  const search = new URLSearchParams({
    latitude: String(place.latitude),
    longitude: String(place.longitude),
    daily: "weather_code,temperature_2m_max,temperature_2m_min",
    timezone: timeZone,
    forecast_days: String(FORECAST_DAYS),
  });
  const data = await fetchJson(`${OPEN_METEO_FORECAST_URL}?${search}`, { ttl: WEATHER_TTL_MS });
  const daily = data?.daily;
  if (!daily || !Array.isArray(daily.time)) throw new Error("Weather forecast is unavailable");
  const byDate = {};
  daily.time.forEach((date, index) => {
    const code = Number(daily.weather_code?.[index]);
    const max = Number(daily.temperature_2m_max?.[index]);
    const min = Number(daily.temperature_2m_min?.[index]);
    if (Number.isFinite(code) && Number.isFinite(max)) {
      byDate[date] = { code, max: Math.round(max), min: Number.isFinite(min) ? Math.round(min) : null };
    }
  });
  return { location: place.name, byDate };
}

const SAMPLE_MEALS = {
  de: [
    ["Spaghetti Bolognese", "Würstchen vom Grill, Nudelsalat, griechischer Salat"],
    ["Gyoza-Auflauf", "Linsensalat, gebackener Camembert"],
    ["Pilzomelette mit Tomatensalat", "Veggie-Chili mit Reis"],
    ["Falafel, Ofengemüse & Tzatziki", "Risotto mit Kürbis und Salbei"],
    ["Kartoffelsuppe", "Flammkuchen mit Feldsalat"],
    ["Pfannkuchen mit Apfelmus", "Gemüse-Lasagne"],
    ["Linseneintopf", "Pizza vom Blech"],
  ],
  en: [
    ["Spaghetti bolognese", "Grilled sausages, pasta salad, Greek salad"],
    ["Gyoza bake", "Lentil salad, baked camembert"],
    ["Mushroom omelette with tomato salad", "Veggie chili with rice"],
    ["Falafel, roast vegetables & tzatziki", "Pumpkin and sage risotto"],
    ["Potato soup", "Tarte flambée with lamb's lettuce"],
    ["Pancakes with apple sauce", "Vegetable lasagne"],
    ["Lentil stew", "Sheet-pan pizza"],
  ],
};
const SAMPLE_WEATHER = [
  [0, 27, 15],
  [1, 27, 16],
  [3, 21, 13],
  [3, 20, 12],
  [61, 18, 11],
  [2, 19, 10],
  [80, 17, 9],
];

export function sampleEvents(start, language, slots = "lunch-dinner") {
  const dishes = SAMPLE_MEALS[language] || SAMPLE_MEALS.en;
  const withLunch = slots !== "dinner";
  const events = [];
  for (let index = 0; index < MAX_PLAN_DAYS; index += 1) {
    const [lunch, dinner] = dishes[index % dishes.length];
    const date = addDays(start, index);
    // Leave one lunch open so the sample also shows the "not planned yet" state.
    if (withLunch && index !== 2) {
      const prefix = language === "de" ? "Mittag" : "Lunch";
      events.push({ id: `sample-l-${index}`, title: `${prefix}: ${lunch}`, start: { date }, end: { date: addDays(date, 1) } });
    }
    events.push({ id: `sample-d-${index}`, title: dinner, start: { date }, end: { date: addDays(date, 1) } });
  }
  // Past entries let the sample show the "not eaten for X days" hint.
  for (const [offset, dish] of [[-94, dishes[3][withLunch ? 0 : 1]], [-41, dishes[1][1]]]) {
    const past = addDays(start, offset);
    events.push({ id: `sample-history${offset}`, title: dish, start: { date: past }, end: { date: addDays(past, 1) } });
  }
  return events;
}

function sampleWeather(start, location) {
  const byDate = {};
  for (let index = 0; index < MAX_PLAN_DAYS; index += 1) {
    const [code, max, min] = SAMPLE_WEATHER[index % SAMPLE_WEATHER.length];
    byDate[addDays(start, index)] = { code, max, min };
  }
  return { location, byDate };
}

export default async function handler({ query = {} }) {
  const calendarUrl = stringSetting(query, "calendarUrl", "");
  const sample = booleanSetting(query, "sampleData", false) || !calendarUrl;
  const timeZone = normalizeTimeZone(stringSetting(query, "timeZone", "Europe/Berlin"), "Europe/Berlin");
  const language = String(stringSetting(query, "language", "de")).toLowerCase().startsWith("de") ? "de" : "en";
  const days = integerSetting(query, "days", 5, 1, MAX_PLAN_DAYS);
  const startDay = stringSetting(query, "startDay", "today") === "monday" ? "monday" : "today";
  const slotsSetting = stringSetting(query, "slots", "lunch-dinner");
  const slots = SLOT_SETS[slotsSetting] ? slotsSetting : "lunch-dinner";
  const allDaySetting = stringSetting(query, "allDayMeal", "dinner");
  const allDayMeal = ALL_DAY_SLOTS.has(allDaySetting) ? allDaySetting : "dinner";
  const showLastEaten = booleanSetting(query, "showLastEaten", true);
  const lastEatenMinDays = integerSetting(query, "lastEatenMinDays", 30, 1, 3650);
  const weatherLocation = stringSetting(query, "weatherLocation", "");
  const range = planRange({ now: stringSetting(query, "now", ""), timeZone, days, startDay });
  const historyStart = addDays(range.today, -HISTORY_DAYS);
  const fetchFrom = historyStart < range.start ? historyStart : range.start;

  let events;
  let calendarName = "";
  if (sample) {
    events = sampleEvents(range.start, language, slots);
  } else {
    const ics = await fetchCalendarFeed({ feedUrl: calendarUrl });
    const parsed = parseCalendarFeed(ics, {
      from: fetchFrom,
      to: range.endExclusive,
      timeZone,
      maxEvents: 5000,
    });
    events = parsed.events;
    calendarName = parsed.calendarName;
  }

  const meals = eventsToMeals(events, { timeZone, allDayMeal, rangeEndExclusive: range.endExclusive });
  const plan = buildPlan(meals, { ...range, days, slots, showLastEaten, lastEatenMinDays });

  let weather = null;
  let weatherError = "";
  if (sample && weatherLocation) {
    weather = sampleWeather(range.start, weatherLocation);
  } else if (weatherLocation) {
    try {
      weather = await fetchWeather(weatherLocation, { timeZone, language });
    } catch (error) {
      weatherError = error instanceof Error ? error.message : String(error);
    }
  }
  if (weather) {
    for (const day of plan) day.weather = weather.byDate[day.date] || null;
  }

  return {
    sample,
    source: sample ? "Sample data" : "iCloud calendar",
    calendarName,
    timeZone,
    today: range.today,
    slots: SLOT_SETS[slots],
    weatherLocation: weather?.location || "",
    weatherError,
    days: plan,
  };
}
