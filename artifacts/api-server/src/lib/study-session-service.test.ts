import assert from "node:assert/strict";
import test from "node:test";
import { recordStudySession, publicStudySession, type RecordedSession, type StudySessionDatabase } from "./study-session-service.ts";
import { validateStudySession } from "./study-analytics.ts";
import { safeStudyErrorCode } from "../routes/study-analytics.ts";

test("transaction contract checks ownership, overlap, replay and changed request payloads", async () => {
  const sessions: RecordedSession[] = [];
  const input = validateStudySession({ requestId: "deafbeef-0000-4000-8000-000000000001", goalId: 11, startedAt: "2026-10-26T10:00:00Z", endedAt: "2026-10-26T11:00:00Z" }, new Date("2026-10-27T00:00:00Z"));
  const database: StudySessionDatabase = { transaction: async (work) => work({
    lockUser: async (id) => id === 1 || id === 2,
    findRequest: async (userId, requestId) => sessions.find((row) => row.userId === userId && row.requestId === requestId),
    ownsGoal: async (userId, goalId) => userId === 1 && goalId === 11,
    overlaps: async (userId, start, end) => sessions.some((row) => row.userId === userId && row.startedAt < end && row.endedAt > start),
    insert: async (userId, value) => { const row = { ...value, id: sessions.length + 1, userId, createdAt: new Date() }; sessions.push(row); return row; },
  }) };
  await assert.rejects(recordStudySession(database, 2, input), /Goal not found/);
  const first = await recordStudySession(database, 1, input);
  assert.equal(first.created, true);
  assert.equal((await recordStudySession(database, 1, input)).created, false);
  assert.equal(sessions.length, 1);
  assert.equal(publicStudySession(first.session).minutes, 60);
  assert.equal('userId' in publicStudySession(first.session), false);
  await assert.rejects(recordStudySession(database, 1, { ...input, goalId: null }), /submission ID/);
  await assert.rejects(recordStudySession(database, 1, { ...input, requestId: "deafbeef-0000-4000-8000-000000000002" }), /overlaps/);
  assert.equal((await recordStudySession(database, 2, { ...input, goalId: null })).created, true);
  await assert.rejects(recordStudySession(database, 9, input), /Account unavailable/);
});

test("diagnostics extract only a SQLSTATE from wrapped ORM errors", () => {
  assert.equal(safeStudyErrorCode({ message: "sensitive request data", cause: { code: "42P01", detail: "private" } }), "42P01");
  assert.equal(safeStudyErrorCode({ code: "password=private" }), "UNKNOWN");
  const cyclic: { cause?: unknown } = {}; cyclic.cause = cyclic;
  assert.equal(safeStudyErrorCode(cyclic), "UNKNOWN");
});
