import assert from "node:assert/strict";
import test from "node:test";
import { currentStudyStreak, fillStudyDays, studyInsights, studyRange, validateStudySession } from "./study-analytics.ts";

const now = new Date("2026-10-27T12:00:00Z");
const input = { requestId: "deafbeef-0000-4000-8000-000000000001", goalId: null, startedAt: "2026-10-26T23:30:00Z", endedAt: "2026-10-27T00:30:00Z" };

test("UTC week, previous week, year boundary and DST ranges are calendar based", () => {
  assert.equal(studyRange({}, now).from, "2026-10-26");
  assert.equal(studyRange({ range: "last-week" }, now).to, "2026-10-25");
  assert.equal(studyRange({ range: "week" }, new Date("2027-01-01T01:00:00Z")).from, "2026-12-28");
  const dst = studyRange({ range: "custom", from: "2026-03-07", to: "2026-03-09" }, now);
  assert.equal(dst.end.getTime() - dst.start.getTime(), 3 * 86_400_000);
  assert.equal(studyRange({ range: "30-days" }, now).from, "2026-09-28");
  for (const query of [{ range: "custom", from: "2026-02-30", to: "2026-03-01" }, { range: "custom", from: "2025-01-01", to: "2026-10-27" }, { range: "custom", from: "2026-10-28", to: "2026-10-28" }, { range: ["week"] }, { range: "unknown" }]) assert.throws(() => studyRange(query, now));
});

test("session validation rejects forged ownership, duration, invalid timestamps and future times", () => {
  assert.equal(validateStudySession(input, now).endedAt.toISOString(), "2026-10-27T00:30:00.000Z");
  for (const patch of [{ userId: 42 }, { durationMinutes: 30 }, { goalId: -1 }, { requestId: "bad" }, { startedAt: "2026-02-30T00:00:00Z" }, { endedAt: "2026-10-28T00:00:00Z" }, { endedAt: input.startedAt }, { endedAt: "2026-10-27T12:00:00Z" }, { startedAt: "2026-10-26T23:30:00" }]) assert.throws(() => validateStudySession({ ...input, ...patch }, now));
});

test("daily series zero fills, streak permits yesterday and insights never manufacture time", () => {
  const range = studyRange({}, now);
  const days = fillStudyDays(range, [{ date: "2026-10-26", minutes: 45 }], [{ date: "2026-10-27", completedTasks: 2 }]);
  assert.deepEqual(days, [{ date: "2026-10-26", minutes: 45, completedTasks: 0 }, { date: "2026-10-27", minutes: 0, completedTasks: 2 }]);
  assert.equal(currentStudyStreak(["2026-10-25", "2026-10-26", "2026-10-26"], now), 2);
  assert.equal(currentStudyStreak(["2026-10-25"], now), 0);
  assert.equal(currentStudyStreak(["2026-10-26", "2026-10-27"], now), 2);
  assert.match(studyInsights(fillStudyDays(range, [], []), 8, [], now)[0]!.detail, /No study time was recorded/);
  assert.match(studyInsights(days, 4, [], now)[1]!.detail, /0 days reached/);
});
