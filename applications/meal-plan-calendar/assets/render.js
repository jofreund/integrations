const {
  applyColorTheme,
  escapeHtml,
  getQuerySettings,
  getSettings,
  hyphenateText,
  loadLanguageJson,
  markError,
  markLoading,
  markReady,
  mergeSettings,
  waitForPayload,
} = window.PaperlessOpenIntegration;

const app = document.querySelector("#app");
const defaults = {
  color: "light",
  title: "",
  calendarUrl: "",
  days: 5,
  startDay: "today",
  slots: "lunch-dinner",
  allDayMeal: "dinner",
  showLastEaten: true,
  lastEatenMinDays: 30,
  weatherLocation: "",
  timeZone: "Europe/Berlin",
  showHeader: true,
  sampleData: false,
  now: "",
};
const FIT_SCALES = [1, 0.94, 0.88, 0.82, 0.76, 0.7];
const MAX_TITLE = 120;
const SLOT_ORDER = ["breakfast", "lunch", "dinner", "other"];
// Common dish components; compounds break before them ("Kartoffel-suppe", "Flamm-kuchen").
const DISH_PARTS = [
  "auflauf", "bowl", "braten", "brot", "brötchen", "burger", "chili", "creme", "curry",
  "eintopf", "filet", "fisch", "frikadellen", "gemüse", "gratin", "kartoffeln", "klöße",
  "knödel", "kompott", "kuchen", "lasagne", "nudeln", "omelette", "pfanne", "pizza", "puffer",
  "püree", "quiche", "reis", "risotto", "salat", "sauce", "schnitzel", "soße", "spätzle",
  "spieße", "strudel", "suppe", "taler", "tarte", "würstchen",
];
let revision = 0;

const glyphs = {
  breakfast:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M4 10h12v4.5a5.5 5.5 0 0 1-5.5 5.5h-1A5.5 5.5 0 0 1 4 14.5z"/><path fill="none" stroke="currentColor" stroke-width="2.2" d="M16 11.5h1.5a2.5 2.5 0 0 1 0 5H15.5"/><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M8 3.5c-1 1.2 1 2.3 0 3.5M12 3.5c-1 1.2 1 2.3 0 3.5"/></svg>',
  lunch:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4.6" fill="currentColor"/><g stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 1.8v2.6M12 19.6v2.6M1.8 12h2.6M19.6 12h2.6M4.8 4.8l1.8 1.8M17.4 17.4l1.8 1.8M4.8 19.2l1.8-1.8M17.4 6.6l1.8-1.8"/></g></svg>',
  dinner:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M20.5 14.6A8.6 8.6 0 0 1 9.4 3.5a8.6 8.6 0 1 0 11.1 11.1z"/><path fill="currentColor" d="M17 3l.8 1.8 1.8.8-1.8.8L17 8.2l-.8-1.8-1.8-.8 1.8-.8z"/></svg>',
  other:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M7 3v7a2 2 0 0 0 4 0V3M9 12v9"/><path d="M17 21V3c-2 1-3.2 3.6-3.2 7.2 0 1.6.9 2.8 3.2 2.8"/></g></svg>',
};

function weatherKind(code) {
  if (code <= 1) return "sun";
  if (code === 2) return "partly";
  if (code === 45 || code === 48) return "fog";
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "snow";
  if (code >= 95) return "storm";
  if (code >= 51) return "rain";
  return "cloud";
}

function weatherIcon(code) {
  const sun =
    '<circle cx="12" cy="12" r="5" fill="var(--pp-yellow)" stroke="var(--pp-black)" stroke-width="1.8"/><g stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 2v2.4M12 19.6V22M2 12h2.4M19.6 12H22M4.9 4.9l1.7 1.7M17.4 17.4l1.7 1.7M4.9 19.1l1.7-1.7M17.4 6.6l1.7-1.7"/></g>';
  const cloud =
    '<path d="M7 19h10.5a4 4 0 0 0 .4-8A5.5 5.5 0 0 0 7.3 10 4.5 4.5 0 0 0 7 19z" fill="var(--pp-bg)" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>';
  const shapes = {
    sun,
    partly:
      '<circle cx="9" cy="8.5" r="4.4" fill="var(--pp-yellow)" stroke="var(--pp-black)" stroke-width="1.8"/><g stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M9 1.5v1.6M2 8.5h1.6M4 3.5l1.1 1.1M14 3.5l-1.1 1.1"/></g><path d="M8.5 21h9a3.6 3.6 0 0 0 .3-7.2 4.8 4.8 0 0 0-9.2-.6A4 4 0 0 0 8.5 21z" fill="var(--pp-bg)" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
    cloud,
    fog: `${cloud.replace("M7 19", "M7 15").replace("a4 4 0 0 0 .4-8", "a3.5 3.5 0 0 0 .3-7").replace("4.5 4.5 0 0 0 7 19", "4 4 0 0 0 7 15")}<g stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 18.5h16M6 21.5h12"/></g>`,
    rain: `<g transform="translate(0 -3)">${cloud}</g><g stroke="var(--pp-blue)" stroke-width="2.4" stroke-linecap="round"><path d="M8.5 19l-1 3M12.5 19l-1 3M16.5 19l-1 3"/></g>`,
    snow: `<g transform="translate(0 -3)">${cloud}</g><g fill="currentColor"><circle cx="8" cy="20.5" r="1.4"/><circle cx="12" cy="22" r="1.4"/><circle cx="16" cy="20.5" r="1.4"/></g>`,
    storm: `<g transform="translate(0 -3)">${cloud}</g><path d="M12.5 15.5l-3 4.5h3l-1.5 3.8 4.5-5.3h-3l1.5-3z" fill="var(--pp-red)" stroke="currentColor" stroke-width="1" stroke-linejoin="round"/>`,
  };
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${shapes[weatherKind(code)]}</svg>`;
}

function fill(template, values) {
  return String(template || "").replace(/\{(\w+)\}/g, (_match, key) => values[key] ?? "");
}

function dayFromKey(key) {
  return new Date(`${key}T12:00:00Z`);
}

function formatter(locale, options) {
  return new Intl.DateTimeFormat(locale, { timeZone: "UTC", ...options });
}

function addDays(key, amount) {
  const date = dayFromKey(key);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function dishBreaks(word) {
  const lower = word.toLowerCase();
  const breaks = new Set();
  for (const part of DISH_PARTS) {
    for (let at = lower.indexOf(part, 3); at > 0; at = lower.indexOf(part, at + 1)) {
      if (word.length - at >= 3) breaks.add(at);
    }
  }
  let result = "";
  let from = 0;
  for (const at of [...breaks].sort((x, y) => x - y)) {
    if (at - from < 3) continue;
    result += `${word.slice(from, at)}\u00ad`;
    from = at;
  }
  return result + word.slice(from);
}

const measure = document.createElement("canvas").getContext("2d");

// Compounds break before known dish components; other words are only split by the shared
// heuristic when they are wider than the line, otherwise they simply wrap as a whole.
function hyphenateTitles() {
  for (const title of app.querySelectorAll(".mp-title")) {
    title.dataset.raw ??= title.textContent;
    measure.font = getComputedStyle(title).font;
    // Landscape titles are inline and flow around a floated badge, so words must also fit
    // on the shortened first line. The margin absorbs small canvas-vs-layout differences.
    const badge = title.closest(".mp-meal")?.querySelector(".mp-slot");
    const badgeWidth =
      badge && getComputedStyle(badge).float === "left" ? badge.getBoundingClientRect().width * 1.4 : 0;
    const width = (title.closest(".mp-text").clientWidth - badgeWidth) * 0.96;
    title.textContent = title.dataset.raw.replace(/\p{L}{6,}/gu, (word) => {
      const withParts = dishBreaks(word);
      if (withParts !== word || measure.measureText(word).width <= width) return withParts;
      return hyphenateText(word, { minWordLength: 6, minSegmentLength: 2 });
    });
  }
}

function slotBadge(slot, label) {
  return `<span class="mp-slot" role="img" aria-label="${escapeHtml(label)}">${glyphs[slot] || glyphs.other}</span>`;
}

function renderMeal(meal, previousSlot, messages) {
  const slotLabel = messages.slots?.[meal.slot] || meal.slot;
  const classes = ["mp-meal"];
  if (meal.empty) classes.push("is-empty");
  if (meal.slot === previousSlot) classes.push("is-repeat");
  let note = "";
  if (Number.isFinite(meal.lastEatenDays)) {
    const text =
      meal.lastEatenDays === 1
        ? messages.lastEatenOne
        : fill(messages.lastEaten, { days: meal.lastEatenDays });
    note = `<span class="mp-note">${escapeHtml(text)}</span>`;
  }
  // Bound pathological calendar titles; the layout fit handles everything shorter.
  const raw = meal.empty ? messages.notPlanned : meal.title;
  const title = raw.length > MAX_TITLE ? `${raw.slice(0, MAX_TITLE).replace(/\s+\S*$/, "")}…` : raw;
  return `<li class="${classes.join(" ")}" data-slot="${escapeHtml(meal.slot)}">
    ${slotBadge(meal.slot, slotLabel)}
    <span class="mp-text"><span class="mp-title">${escapeHtml(title)}</span>${note}</span>
  </li>`;
}

function renderDay(day, data, locale, messages) {
  const date = dayFromKey(day.date);
  const isToday = day.date === data.today;
  const isTomorrow = day.date === addDays(data.today, 1);
  const tag = isToday ? messages.today : isTomorrow ? messages.tomorrow : "";
  const weekday = formatter(locale, { weekday: "long" }).format(date);
  const month = formatter(locale, { month: "long" }).format(date);
  const weather = day.weather
    ? `<span class="mp-wx">${weatherIcon(day.weather.code)}<span>${escapeHtml(day.weather.max)}°</span></span>`
    : "";
  let previousSlot = "";
  const meals = day.meals
    .map((meal) => {
      const html = renderMeal(meal, previousSlot, messages);
      previousSlot = meal.slot;
      return html;
    })
    .join("");
  return `<section class="mp-day${isToday ? " is-today" : ""}${day.date < data.today ? " is-past" : ""}">
    <header class="mp-date">
      <span class="mp-num">${date.getUTCDate()}</span>
      <span class="mp-dt">
        <span class="mp-wd">${escapeHtml(weekday)}${tag ? `<em class="mp-tag mp-tag--inline">${escapeHtml(tag)}</em>` : ""}</span>
        <span class="mp-mo"><span class="mp-mo-text">${escapeHtml(month)}</span>${tag ? `<em class="mp-tag mp-tag--below">${escapeHtml(tag)}</em>` : ""}</span>
      </span>
      ${weather}
    </header>
    ${meals ? `<ul class="mp-meals">${meals}</ul>` : `<p class="mp-nothing">${escapeHtml(messages.nothingPlanned)}</p>`}
  </section>`;
}

function rangeLabel(days, locale) {
  if (!days.length) return "";
  const first = dayFromKey(days[0].date);
  const last = dayFromKey(days.at(-1).date);
  const short = formatter(locale, { day: "numeric", month: "short" });
  return days.length === 1 ? short.format(first) : `${short.format(first)} – ${short.format(last)}`;
}

function usedSlots(days, data) {
  const slots = new Set(data.slots || []);
  for (const day of days) for (const meal of day.meals) slots.add(meal.slot);
  return SLOT_ORDER.filter((slot) => slots.has(slot));
}

function renderPlan(data, settings, messages, visibleCount) {
  const locale = messages.locale || "de-DE";
  const days = data.days.slice(0, visibleCount);
  const hidden = data.days.length - days.length;
  const title = String(settings.title || "").trim() || messages.title;
  const head = settings.showHeader
    ? `<header class="mp-head">
        <div>
          <h1>${escapeHtml(title)}</h1>
          <p class="mp-range">${escapeHtml(rangeLabel(days, locale))}</p>
        </div>
        ${data.sample ? `<span class="mp-kicker">${escapeHtml(messages.sampleSource)}</span>` : ""}
      </header>`
    : "";
  const legend = usedSlots(days, data)
    .map((slot) => {
      const label = messages.slots?.[slot] || slot;
      return `<span data-slot="${slot}">${slotBadge(slot, label)}${escapeHtml(label)}</span>`;
    })
    .join("");
  const meta = [];
  if (hidden > 0) meta.push(hidden === 1 ? messages.moreDaysOne : fill(messages.moreDays, { count: hidden }));
  if (data.weatherLocation) meta.push(fill(messages.weatherFor, { location: data.weatherLocation }));
  else if (data.weatherError) meta.push(messages.weatherUnavailable);
  if (data.sample && !settings.showHeader) meta.push(messages.sampleSource);
  app.innerHTML = `${head}
    <div class="mp-days" style="--mp-count:${days.length}">
      ${days.map((day) => renderDay(day, data, locale, messages)).join("")}
    </div>
    <footer class="mp-foot">
      <span class="mp-legend">${legend}</span>
      <span class="mp-meta">${meta.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}</span>
    </footer>`;
}

function layoutOverflows() {
  const container = app.querySelector(".mp-days");
  if (!container) return false;
  if (app.scrollHeight > app.clientHeight + 1) return true;
  if (container.scrollHeight > container.clientHeight + 1) return true;
  for (const day of container.querySelectorAll(".mp-day")) {
    if (day.scrollHeight > day.clientHeight + 1 || day.scrollWidth > day.clientWidth + 1) return true;
  }
  for (const row of container.querySelectorAll(".mp-date")) {
    if (row.scrollWidth > row.clientWidth + 1) return true;
  }
  return false;
}

function clampedTitles() {
  return [...app.querySelectorAll(".mp-title")].filter(
    (title) => title.scrollHeight > title.clientHeight + 1,
  ).length;
}

function fitPlan(data, settings, messages) {
  for (let count = data.days.length; count >= 1; count -= 1) {
    renderPlan(data, settings, messages, count);
    let best = null;
    for (const scale of FIT_SCALES) {
      app.style.setProperty("--s", String(scale));
      hyphenateTitles();
      if (layoutOverflows()) continue;
      const clamped = clampedTitles();
      if (!clamped) return;
      if (!best || clamped < best.clamped) best = { scale, clamped };
    }
    // Prefer showing every day with a clamped long title over dropping a whole day.
    if (best) {
      app.style.setProperty("--s", String(best.scale));
      hyphenateTitles();
      return;
    }
  }
  // Keep a single day at the smallest scale; line clamping bounds the remaining text.
  renderPlan(data, settings, messages, 1);
  app.style.setProperty("--s", String(FIT_SCALES.at(-1)));
  hyphenateTitles();
}

async function loadPlan(settings, language) {
  const response = await fetch(new URL("./api/data", window.location.href), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      calendarUrl: settings.calendarUrl,
      days: settings.days,
      startDay: settings.startDay,
      slots: settings.slots,
      allDayMeal: settings.allDayMeal,
      showLastEaten: settings.showLastEaten,
      lastEatenMinDays: settings.lastEatenMinDays,
      weatherLocation: settings.weatherLocation,
      timeZone: settings.timeZone,
      sampleData: settings.sampleData,
      now: settings.now,
      language,
    }),
  });
  const body = await response.text();
  let data = {};
  try {
    data = JSON.parse(body);
  } catch {
    // Some hosts answer failures as plain text; keep only the first message line.
    data = { error: body.split("\n")[0].replace(/^Error:\s*/, "").slice(0, 240) };
  }
  if (!response.ok || data?.error) {
    throw new Error(data?.error || `Meal plan request failed with ${response.status}`);
  }
  if (!Array.isArray(data.days)) throw new Error("Meal plan response is invalid");
  return data;
}

function toBoolean(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "string") return !["false", "0", "off", "no"].includes(value.toLowerCase());
  return Boolean(value);
}

async function renderPayload(payload) {
  const current = ++revision;
  let messages = {};
  markLoading();
  try {
    const language = await loadLanguageJson(payload);
    messages = language.messages || {};
    document.documentElement.lang = language.language || "de";
    const settings = mergeSettings(defaults, getSettings(payload), getQuerySettings());
    settings.showHeader = toBoolean(settings.showHeader, true);
    settings.sampleData = toBoolean(settings.sampleData, false);
    applyColorTheme(settings.color, { defaultTheme: defaults.color });
    app.classList.remove("mp-error");
    // One unit is 1px on the 800x480 / 480x800 reference frames and scales with larger ones.
    const landscape = window.innerWidth >= window.innerHeight;
    const unit = landscape
      ? Math.min(window.innerWidth / 800, window.innerHeight / 480)
      : Math.min(window.innerWidth / 480, window.innerHeight / 800);
    app.style.setProperty("--u", `${unit}px`);

    const data = await loadPlan(settings, language.language || "de");
    if (current !== revision) return;
    await document.fonts?.ready;
    fitPlan(data, settings, messages);
    markReady();
  } catch (error) {
    if (current !== revision) return;
    app.classList.add("mp-error");
    app.style.setProperty("--s", "1");
    app.innerHTML = `<h1>${escapeHtml(messages.errorTitle || "Meal plan unavailable")}</h1>
      <p>${escapeHtml(error instanceof Error ? error.message : String(error))}</p>
      <p>${escapeHtml(messages.errorHint || "")}</p>`;
    markError(error);
  }
}

const payload = await waitForPayload({ timeoutMs: 500, onUpdate: renderPayload });
await renderPayload(payload);
