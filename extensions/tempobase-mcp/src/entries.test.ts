import assert from "node:assert/strict";
import { test } from "node:test";
import { buildCorrectionChanges, buildEntryPayload, confirmUrlFor, correctionKeyFor, idempotencyKeyFor, localToUtc, nextStepFor } from "./entries.ts";

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

test("builds the confirm link on the configured host from the operation id only", () => {
  const base = new URL("https://tempobase.example.com");
  assert.equal(
    confirmUrlFor(base, "5bab0318-4d24-443b-877a-6422bdc1ffe5"),
    "https://tempobase.example.com/integrations/operations/5bab0318-4d24-443b-877a-6422bdc1ffe5",
  );
  assert.equal(new URL(confirmUrlFor(base, "//evil.example.com/x")).host, "tempobase.example.com");
});

test("tells the agent a deleted result needs a new idempotencyKey", () => {
  assert.match(nextStepFor({ status: "confirmed", entryDeleted: false }), /entry exists/);
  assert.match(nextStepFor({ status: "confirmed", entryDeleted: true }), /deleted.*new idempotencyKey/);
  assert.match(nextStepFor({ status: "cancelled", entryDeleted: false }), /re-opens/);
});

test("a correction carries only the requested fields, and null clears", () => {
  assert.deepEqual(buildCorrectionChanges({ entryId: "e1", date: "2026-11-20", endTime: "17:00" }, SAO_PAULO), {
    endTime: "2026-11-20T20:00:00.000Z",
  });
  assert.deepEqual(buildCorrectionChanges({ entryId: "e1", description: "  Reviews ", projectId: null, taskId: null, billable: false }, SAO_PAULO), {
    description: "Reviews",
    projectId: null,
    taskId: null,
    isBillable: false,
  });
  assert.deepEqual(buildCorrectionChanges({ entryId: "e1", description: null }, SAO_PAULO), { description: null });
});

test("a correction refuses a time without its date, nothing to change, and an end before the start", () => {
  assert.throws(() => buildCorrectionChanges({ entryId: "e1", endTime: "17:00" }, SAO_PAULO), /date is required/);
  assert.throws(() => buildCorrectionChanges({ entryId: "e1" }, SAO_PAULO), /Nothing to correct/);
  assert.throws(
    () => buildCorrectionChanges({ entryId: "e1", date: "2026-11-20", startTime: "18:00", endTime: "17:00" }, SAO_PAULO),
    /endDate/,
  );
  const overnight = buildCorrectionChanges({ entryId: "e1", date: "2026-11-20", endTime: "01:00", endDate: "2026-11-21" }, SAO_PAULO);
  assert.equal(overnight.endTime, "2026-11-21T04:00:00.000Z");
});

test("the correction key is stable per entry and changes, and tells a cleared field from an unsent one", () => {
  const a = correctionKeyFor("e1", { description: "Reviews" });
  assert.equal(a, correctionKeyFor("e1", { description: "Reviews" }));
  assert.notEqual(a, correctionKeyFor("e2", { description: "Reviews" }));
  assert.notEqual(correctionKeyFor("e1", { description: null }), correctionKeyFor("e1", {}));
  assert.match(a, /^mcp-fix-[0-9a-f]{28}$/);
});

test("next steps for a correction speak of changes, not new entries", () => {
  assert.match(nextStepFor({ kind: "correct_entry", status: "pending", entryDeleted: false }), /Nothing is changed yet/);
  assert.match(nextStepFor({ kind: "correct_entry", status: "cancelled", entryDeleted: false }), /prepare_time_entry_correction/);
});
