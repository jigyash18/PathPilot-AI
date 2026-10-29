import assert from "node:assert/strict";
import test from "node:test";
import { daysUntil, formatDate, isDateOnly, parseDateOnly } from "./date-utils";

test("invalid dates never reach Intl.DateTimeFormat", () => {
  assert.throws(() => new Intl.DateTimeFormat("en-US").format(new Date("not-a-date")), RangeError);
  assert.doesNotThrow(() => formatDate("not-a-date"));
  assert.equal(formatDate("not-a-date"), "Date unavailable — review goal data");
  assert.equal(formatDate(null), "Date unavailable — review goal data");
});

test("date-only values preserve their UTC calendar day", () => {
  assert.equal(isDateOnly("2026-11-30"), true);
  assert.equal(formatDate("2026-11-30", { timeZone: "UTC", month: "long", day: "numeric", year: "numeric" }), "November 30, 2026");
  assert.equal(parseDateOnly("2026-02-30"), null);
  assert.equal(daysUntil("2026-11-30", new Date("2026-10-27T12:00:00Z")), 34);
  assert.equal(daysUntil("2026-11-30T00:00:00.000Z", new Date("2026-10-27T12:00:00Z")), 34, "API-coerced date-only values arrive as ISO midnight timestamps");
  assert.equal(daysUntil("bad", new Date("2026-10-27T12:00:00Z")), null);
});
