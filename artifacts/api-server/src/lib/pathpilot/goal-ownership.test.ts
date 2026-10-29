import assert from "node:assert/strict";
import test from "node:test";
import { loadOwnedGoal } from "./goal-ownership.ts";

const goals = new Map([
  [101, { id: 101, userId: 7, goalName: "Owner goal" }],
  [202, { id: 202, userId: 8, goalName: "Other user's goal" }],
]);

const nestedGoalRoutes = [
  "/goals/:goalId/generate-roadmap",
  "/goals/:goalId/roadmap",
  "/goals/:goalId/preview-alternatives",
  "/goals/:goalId/replan",
  "/goals/:goalId/progress",
  "/goals/:goalId/progress-dashboard",
  "/goals/:goalId/milestones",
  "/goals/:goalId/recommendations",
  "/goals/:goalId (DELETE)",
];

test("nested goal routes resolve only goals owned by the authenticated user", async () => {
  for (const route of nestedGoalRoutes) {
    const owned = await loadOwnedGoal((goalId) => Promise.resolve(goals.get(goalId)), 101, 7);
    const foreign = await loadOwnedGoal((goalId) => Promise.resolve(goals.get(goalId)), 202, 7);
    assert.equal(owned?.userId, 7, `${route} should resolve the owner goal`);
    assert.equal(foreign, null, `${route} should hide a different user's goal`);
  }
});

test("missing goals and cross-user goals both produce an unavailable resource", async () => {
  assert.equal(await loadOwnedGoal((goalId) => Promise.resolve(goals.get(goalId)), 999, 7), null);
  assert.equal(await loadOwnedGoal((goalId) => Promise.resolve(goals.get(goalId)), 202, 7), null);
});
