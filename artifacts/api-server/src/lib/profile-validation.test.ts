import assert from "node:assert/strict";
import test from "node:test";
import { validateProfileName, validateStudyPreferences } from "./profile-validation.ts";

test("profile validation trims names and enforces a useful limit", () => {
  assert.deepEqual(validateProfileName("  Ada Lovelace  "), { ok: true, data: "Ada Lovelace" });
  assert.equal(validateProfileName("   ").ok, false);
  assert.equal(validateProfileName("x".repeat(121)).ok, false);
});

test("study preferences validate numeric hours and same-day time windows", () => {
  assert.deepEqual(validateStudyPreferences({ availableHours: 4, preferredStart: "09:00", preferredEnd: "18:00" }), {
    ok: true,
    data: { availableHours: 4, preferredStart: "09:00", preferredEnd: "18:00" },
  });
  assert.equal(validateStudyPreferences({ availableHours: 0, preferredStart: "09:00", preferredEnd: "18:00" }).ok, false);
  assert.equal(validateStudyPreferences({ availableHours: 4, preferredStart: "18:00", preferredEnd: "09:00" }).ok, false);
  assert.equal(validateStudyPreferences({ availableHours: 4, preferredStart: "09:00", preferredEnd: "25:00" }).ok, false);
});
