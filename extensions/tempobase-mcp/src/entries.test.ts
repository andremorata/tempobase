import assert from "node:assert/strict";
import { test } from "node:test";
import { buildEntryPayload, idempotencyKeyFor, localToUtc } from "./entries.ts";

const SAO_PAULO = "America/Sao_Paulo";
const NEW_YORK = "America/New_York";

test("local wall-clock time becomes the UTC instant of the configured timezone", () => {
  assert.equal(localToUtc("2026-11-20", "09:00", SAO_PAULO).toISOString(), "2026-11-20T12:00:00.000Z");
  assert.equal(localToUtc("2026-11-20", "09:00", "UTC").toISOString(), "2026-11-20T09:00:00.000Z");
});

test("crosses the day boundary in both directions", () => {
  assert.equal(localToUtc("2026-11-20", "08:00", "Asia/Tokyo").toISOString(), "2026-11-19T23:00:00.000Z");
  assert.equal(localToUtc("2026-11-20", "22:30", SAO_PAULO).toISOString(), "2026-11-21T01:30:00.000Z");
});

test("uses the offset in force on that date, on both sides of a DST change", () => {
  assert.equal(localToUtc("2026-03-07", "09:00", NEW_YORK).toISOString(), "2026-03-07T14:00:00.000Z");
  assert.equal(localToUtc("2026-03-09", "09:00", NEW_YORK).toISOString(), "2026-03-09T13:00:00.000Z");
  assert.equal(localToUtc("2026-11-02", "09:00", NEW_YORK).toISOString(), "2026-11-02T14:00:00.000Z");
});

test("refuses a time skipped or repeated by a clock change instead of guessing", () => {
  assert.throws(() => localToUtc("2026-03-08", "02:30", NEW_YORK), /does not exist/);
  assert.throws(() => localToUtc("2026-11-01", "01:30", NEW_YORK), /happens twice/);
});

test("rejects malformed dates and times", () => {
  assert.throws(() => localToUtc("2026-02-30", "09:00", "UTC"), /YYYY-MM-DD/);
  assert.throws(() => localToUtc("2026-11-20", "9:00", "UTC"), /HH:mm/);
  assert.throws(() => localToUtc("2026-11-20", "24:00", "UTC"), /HH:mm/);
});

const BASE = { date: "2026-11-20", startTime: "09:00", endTime: "10:30" };

test("builds the payload with explicit start and end, trimmed description and billable by default", () => {
  assert.deepEqual(buildEntryPayload({ ...BASE, description: "  Review  " }, SAO_PAULO), {
    startTime: "2026-11-20T12:00:00.000Z",
    endTime: "2026-11-20T13:30:00.000Z",
    description: "Review",
    projectId: null,
    taskId: null,
    isBillable: true,
  });
  assert.equal(buildEntryPayload({ ...BASE, billable: false }, SAO_PAULO).isBillable, false);
});

test("needs endDate for an entry that crosses midnight", () => {
  assert.throws(() => buildEntryPayload({ ...BASE, startTime: "22:00", endTime: "01:00" }, SAO_PAULO), /endDate/);
  const overnight = buildEntryPayload({ ...BASE, startTime: "22:00", endTime: "01:00", endDate: "2026-11-21" }, SAO_PAULO);
  assert.equal(overnight.endTime, "2026-11-21T04:00:00.000Z");
});

test("derives the same idempotency key for the same entry and a different one otherwise", () => {
  const a = buildEntryPayload({ ...BASE, description: "Review" }, SAO_PAULO);
  const b = buildEntryPayload({ ...BASE, description: " Review " }, SAO_PAULO);
  const c = buildEntryPayload({ ...BASE, description: "Review", endTime: "10:45" }, SAO_PAULO);

  assert.equal(idempotencyKeyFor(a), idempotencyKeyFor(b));
  assert.notEqual(idempotencyKeyFor(a), idempotencyKeyFor(c));
  assert.match(idempotencyKeyFor(a), /^mcp-[0-9a-f]{32}$/);
});
