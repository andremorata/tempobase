import assert from "node:assert/strict";
import { test } from "node:test";
import { formatLocal, localDate, resolvePeriod } from "./period.ts";

const SAO_PAULO = "America/Sao_Paulo";
// Friday 2026-11-20 23:30 in Sao Paulo (UTC-3) is already Saturday 02:30 in UTC.
const FRIDAY_LATE = new Date("2026-11-21T02:30:00.000Z");

test("today follows the configured timezone, not UTC, across the day boundary", () => {
  assert.equal(localDate(FRIDAY_LATE, SAO_PAULO), "2026-11-20");
  assert.equal(localDate(FRIDAY_LATE, "UTC"), "2026-11-21");
  assert.deepEqual(resolvePeriod({ preset: "today" }, FRIDAY_LATE, SAO_PAULO), { from: "2026-11-20", to: "2026-11-20" });
  assert.deepEqual(resolvePeriod({ preset: "today" }, FRIDAY_LATE, "UTC"), { from: "2026-11-21", to: "2026-11-21" });
});

test("ahead-of-UTC zones move to the next day before UTC does", () => {
  // 2026-11-20 23:30 UTC is already 2026-11-21 08:30 in Tokyo.
  assert.deepEqual(resolvePeriod({ preset: "today" }, new Date("2026-11-20T23:30:00.000Z"), "Asia/Tokyo"), {
    from: "2026-11-21",
    to: "2026-11-21",
  });
});

test("yesterday", () => {
  assert.deepEqual(resolvePeriod({ preset: "yesterday" }, FRIDAY_LATE, SAO_PAULO), { from: "2026-11-19", to: "2026-11-19" });
});

test("weeks start on Monday", () => {
  assert.deepEqual(resolvePeriod({ preset: "this_week" }, FRIDAY_LATE, SAO_PAULO), { from: "2026-11-16", to: "2026-11-22" });
  assert.deepEqual(resolvePeriod({ preset: "last_week" }, FRIDAY_LATE, SAO_PAULO), { from: "2026-11-09", to: "2026-11-15" });
  // In UTC it is already Saturday; still the same Monday-start week.
  assert.deepEqual(resolvePeriod({ preset: "this_week" }, FRIDAY_LATE, "UTC"), { from: "2026-11-16", to: "2026-11-22" });

  const sundayLate = new Date("2026-11-23T02:30:00.000Z"); // Sunday 23:30 in Sao Paulo, Monday in UTC
  assert.deepEqual(resolvePeriod({ preset: "this_week" }, sundayLate, SAO_PAULO), { from: "2026-11-16", to: "2026-11-22" });
  assert.deepEqual(resolvePeriod({ preset: "this_week" }, sundayLate, "UTC"), { from: "2026-11-23", to: "2026-11-29" });
});

test("months, including the year boundary", () => {
  assert.deepEqual(resolvePeriod({ preset: "this_month" }, FRIDAY_LATE, SAO_PAULO), { from: "2026-11-01", to: "2026-11-30" });
  assert.deepEqual(resolvePeriod({ preset: "last_month" }, FRIDAY_LATE, SAO_PAULO), { from: "2026-10-01", to: "2026-10-31" });

  const newYearsEve = new Date("2027-01-01T02:00:00.000Z"); // still 2026-12-31 in Sao Paulo
  assert.deepEqual(resolvePeriod({ preset: "this_month" }, newYearsEve, SAO_PAULO), { from: "2026-12-01", to: "2026-12-31" });
  assert.deepEqual(resolvePeriod({ preset: "last_month" }, new Date("2027-01-15T12:00:00.000Z"), SAO_PAULO), {
    from: "2026-12-01",
    to: "2026-12-31",
  });
});

test("explicit dates pass through; a single from means that day", () => {
  assert.deepEqual(resolvePeriod({ from: "2026-11-01", to: "2026-11-15" }, FRIDAY_LATE, SAO_PAULO), { from: "2026-11-01", to: "2026-11-15" });
  assert.deepEqual(resolvePeriod({ from: "2026-11-03" }, FRIDAY_LATE, SAO_PAULO), { from: "2026-11-03", to: "2026-11-03" });
});

test("rejects ambiguous or invalid periods", () => {
  assert.throws(() => resolvePeriod({}, FRIDAY_LATE, SAO_PAULO), /preset or from/);
  assert.throws(() => resolvePeriod({ preset: "today", from: "2026-11-01" }, FRIDAY_LATE, SAO_PAULO), /not both/);
  assert.throws(() => resolvePeriod({ from: "2026-11-15", to: "2026-11-01" }, FRIDAY_LATE, SAO_PAULO), /on or before/);
  assert.throws(() => resolvePeriod({ from: "2026-02-30" }, FRIDAY_LATE, SAO_PAULO), /YYYY-MM-DD/);
  assert.throws(() => localDate(FRIDAY_LATE, "Mars/Olympus"), RangeError);
});

test("formats instants as local wall time in the configured timezone", () => {
  assert.equal(formatLocal("2026-11-21T02:30:00.000Z", SAO_PAULO), "2026-11-20 23:30");
  assert.equal(formatLocal("2026-11-21T02:30:00.000Z", "UTC"), "2026-11-21 02:30");
  assert.equal(formatLocal("2026-11-20T15:00:00.000Z", "Asia/Tokyo"), "2026-11-21 00:00");
  assert.equal(formatLocal(null, SAO_PAULO), null);
});
