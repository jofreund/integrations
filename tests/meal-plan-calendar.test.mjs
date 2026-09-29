import test from "node:test";
import assert from "node:assert/strict";
import { parseCalendarFeed } from "../applications/_shared/calendar-feed.js";
import handler, {
  buildPlan,
  eventsToMeals,
  normalizeMealTitle,
  parseMealTitle,
  planRange,
  slotForTime,
} from "../applications/meal-plan-calendar/api/data.js";

const ICS = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "X-WR-CALNAME:Essensplan",
  "BEGIN:VEVENT",
  "UID:1",
  "DTSTART;VALUE=DATE:20260929",
  "DTEND;VALUE=DATE:20260930",
  "SUMMARY:Mittag: Spaghetti Bolognese",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:2",
  "DTSTART;VALUE=DATE:20260929",
  "DTEND;VALUE=DATE:20260930",
  "SUMMARY:Würstchen vom Grill\\, Nudelsalat",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:3",
  "DTSTART;TZID=Europe/Berlin:20260930T123000",
  "DTEND;TZID=Europe/Berlin:20260930T133000",
  "SUMMARY:Gyoza- Auflauf",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:4",
  "DTSTART;TZID=Europe/Berlin:20260930T183000",
  "DTEND;TZID=Europe/Berlin:20260930T193000",
  "SUMMARY:Linsensalat",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:5",
  "DTSTART;VALUE=DATE:20260601",
  "DTEND;VALUE=DATE:20260602",
  "SUMMARY:Gyoza-Auflauf",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

test("meal titles accept slot prefixes without eating compound words", () => {
  assert.deepEqual(parseMealTitle("Mittag: Pasta"), { slot: "lunch", title: "Pasta" });
  assert.deepEqual(parseMealTitle("Abendessen – Curry"), { slot: "dinner", title: "Curry" });
  assert.deepEqual(parseMealTitle("[Frühstück] Müsli"), { slot: "breakfast", title: "Müsli" });
  assert.deepEqual(parseMealTitle("🌙 Suppe"), { slot: "dinner", title: "Suppe" });
  assert.deepEqual(parseMealTitle("Lunch - Tacos"), { slot: "lunch", title: "Tacos" });
  assert.deepEqual(parseMealTitle("Abendbrot mit Käse"), { slot: "dinner", title: "mit Käse" });
  assert.deepEqual(parseMealTitle("Abendbrotplatte"), { slot: "", title: "Abendbrotplatte" });
  assert.deepEqual(parseMealTitle("Mittagstisch"), { slot: "", title: "Mittagstisch" });
  assert.deepEqual(parseMealTitle("Mittag:"), { slot: "", title: "Mittag:" });
});

test("titles normalize punctuation, case and diacritics for history matching", () => {
  assert.equal(normalizeMealTitle("Gyoza- Auflauf"), normalizeMealTitle("gyoza-auflauf"));
  assert.equal(normalizeMealTitle("Käse-Spätzle"), "kasespatzle");
  assert.equal(normalizeMealTitle("Grießbrei"), "griessbrei");
});

test("timed entries are assigned by local start time", () => {
  assert.equal(slotForTime(8, 0), "breakfast");
  assert.equal(slotForTime(10, 59), "breakfast");
  assert.equal(slotForTime(11, 0), "lunch");
  assert.equal(slotForTime(15, 59), "lunch");
  assert.equal(slotForTime(16, 0), "dinner");
});

test("iCloud feed events become a meal plan with placeholders and last-eaten hints", () => {
  const timeZone = "Europe/Berlin";
  const range = planRange({ now: "2026-09-29T15:28:00Z", timeZone, days: 3, startDay: "today" });
  assert.deepEqual(range, { today: "2026-09-29", start: "2026-09-29", endExclusive: "2026-10-02" });
  const { events, calendarName } = parseCalendarFeed(ICS, {
    from: "2025-08-25",
    to: range.endExclusive,
    timeZone,
  });
  assert.equal(calendarName, "Essensplan");
  const meals = eventsToMeals(events, { timeZone, allDayMeal: "dinner" });
  const plan = buildPlan(meals, { ...range, days: 3, slots: "lunch-dinner", lastEatenMinDays: 30 });

  assert.deepEqual(
    plan[0].meals.map(({ slot, title }) => [slot, title]),
    [
      ["lunch", "Spaghetti Bolognese"],
      ["dinner", "Würstchen vom Grill, Nudelsalat"],
    ],
  );
  assert.deepEqual(
    plan[1].meals.map(({ slot, title, lastEatenDays }) => [slot, title, lastEatenDays]),
    [
      ["lunch", "Gyoza- Auflauf", 120],
      ["dinner", "Linsensalat", null],
    ],
  );
  assert.deepEqual(plan[2].meals, [
    { slot: "lunch", title: "", empty: true },
    { slot: "dinner", title: "", empty: true },
  ]);
});

test("last-eaten hints respect the threshold and ignore future repeats", () => {
  const meals = [
    { date: "2026-09-20", slot: "dinner", title: "Pizza", sort: -1 },
    { date: "2026-09-29", slot: "dinner", title: "Pizza", sort: -1 },
    { date: "2026-10-01", slot: "dinner", title: "Pizza", sort: -1 },
    { date: "2026-10-01", slot: "dinner", title: "pizza", sort: -1 },
  ];
  const base = { today: "2026-09-29", start: "2026-09-29", days: 3, slots: "none" };
  let plan = buildPlan(meals, { ...base, lastEatenMinDays: 30 });
  assert.equal(plan[0].meals[0].lastEatenDays, null);
  plan = buildPlan(meals, { ...base, lastEatenMinDays: 7 });
  assert.equal(plan[0].meals[0].lastEatenDays, 9);
  assert.equal(plan[2].meals.length, 1, "duplicate entries in one slot are merged");
  assert.equal(plan[2].meals[0].lastEatenDays, 9);
  plan = buildPlan(meals, { ...base, lastEatenMinDays: 7, showLastEaten: false });
  assert.equal(plan[0].meals[0].lastEatenDays, null);
});

test("multi-day all-day entries repeat and week mode starts on Monday", () => {
  const meals = eventsToMeals(
    [{ title: "Chili", start: { date: "2026-09-28" }, end: { date: "2026-09-30" } }],
    { timeZone: "Europe/Berlin", allDayMeal: "other" },
  );
  assert.deepEqual(
    meals.map(({ date, slot }) => [date, slot]),
    [
      ["2026-09-28", "other"],
      ["2026-09-29", "other"],
    ],
  );
  const range = planRange({ now: "2026-09-29T15:28:00Z", timeZone: "Europe/Berlin", days: 7, startDay: "monday" });
  assert.equal(range.start, "2026-09-28");
  assert.equal(range.endExclusive, "2026-10-05");
});

test("sample mode is labelled, deterministic and respects meal settings", async () => {
  const data = await handler({
    query: { now: "2026-09-29T15:28:00Z", language: "de", days: "5" },
  });
  assert.equal(data.sample, true);
  assert.equal(data.today, "2026-09-29");
  assert.equal(data.days.length, 5);
  assert.deepEqual(data.slots, ["lunch", "dinner"]);
  assert.equal(data.days[0].meals[0].title, "Spaghetti Bolognese");
  assert.equal(data.days[2].meals[0].empty, true);
  assert.ok(data.days.some((day) => day.meals.some((meal) => meal.lastEatenDays === 94)));

  const dinnerOnly = await handler({
    query: { now: "2026-09-29T15:28:00Z", language: "en", slots: "dinner", days: "20" },
  });
  assert.equal(dinnerOnly.days.length, 14, "day count is bounded");
  assert.ok(dinnerOnly.days.every((day) => day.meals.every((meal) => meal.slot === "dinner")));
});

test("private or non-HTTPS calendar links are rejected before fetching", async () => {
  await assert.rejects(handler({ query: { calendarUrl: "http://example.org/cal.ics" } }), /https/);
  await assert.rejects(handler({ query: { calendarUrl: "https://127.0.0.1/cal.ics" } }));
});
