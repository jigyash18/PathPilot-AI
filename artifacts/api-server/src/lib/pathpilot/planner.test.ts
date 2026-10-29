import assert from "node:assert/strict";
import { buildSchedule, recoverMissedTasks, taskDependenciesStayInGoal } from "./planner-core.ts";

const task = (id: number, taskName: string, durationHours: number, priority = "medium") => ({
  id, taskName, durationHours, priority, difficulty: "medium", status: "pending",
});
const start = new Date("2026-10-16T12:00:00Z");

assert.equal(taskDependenciesStayInGoal([1, 2], [{ taskId: 2, dependsOn: 1 }]), true);
assert.equal(taskDependenciesStayInGoal([1], [{ taskId: 1, dependsOn: 99 }]), false, "cross-goal prerequisite ids are rejected");
assert.equal(taskDependenciesStayInGoal([1], [{ taskId: 1, dependsOn: 1 }]), false, "self-dependencies are rejected");

{
  const result = buildSchedule([task(1, "Read", 2), task(2, "Practice", 2)], [], 4, "2026-10-16", start);
  assert.equal(result.scheduledDates.get(1), "2026-10-16");
  assert.equal(result.scheduledDates.get(2), "2026-10-16");
  assert.deepEqual(result.infeasibleTasks, []);
}

{
  const result = buildSchedule([task(1, "Already late", 1)], [], 4, "2026-10-15", start);
  assert.equal(result.scheduledDates.size, 0);
  assert.equal(result.infeasibleTasks[0]?.reason, "deadline_capacity");
}

{
  const result = buildSchedule([
    task(1, "Too long", 5, "high"),
    task(2, "First", 2, "high"),
    task(3, "Second", 2, "medium"),
    task(4, "Third", 2, "low"),
  ], [], 4, "2026-10-16", start);
  assert.equal(result.scheduledDates.size, 2);
  assert.deepEqual(result.infeasibleTasks.map((item) => [item.taskName, item.reason]), [
    ["Too long", "exceeds_daily_capacity"],
    ["Third", "deadline_capacity"],
  ]);
}

{
  const result = buildSchedule([
    task(10, "Above daily target", 3),
    task(11, "Fits daily target", 2),
  ], [], 2, "2026-10-17", start);
  assert.equal(result.scheduledDates.has(10), false, "tasks remain indivisible across days");
  assert.equal(result.infeasibleTasks.find((item) => item.taskId === 10)?.reason, "exceeds_daily_capacity");
  assert.equal(result.scheduledDates.get(11), "2026-10-16", "eligible work still receives a date when another task is oversized");
}

{
  const missed = { ...task(1, "Missed prerequisite", 1, "low"), status: "missed" };
  const dependent = task(2, "Dependent", 1, "high");
  const dependencies = [{ taskId: 2, dependsOn: 1 }];
  const beforeRecovery = buildSchedule([missed, dependent], dependencies, 2, "2026-10-16", start);
  assert.equal(beforeRecovery.scheduledDates.has(1), false);
  assert.deepEqual(beforeRecovery.infeasibleTasks.map(({ taskName, reason }) => [taskName, reason]), [
    ["Dependent", "dependency_unavailable"],
  ]);

  const recovery = recoverMissedTasks([missed, dependent]);
  assert.deepEqual(recovery.recoveredTaskNames, ["Missed prerequisite"]);
  assert.equal(recovery.tasks[0]?.status, "pending");
  assert.notEqual(recovery.tasks[0]?.status, "completed");
  const afterRecovery = buildSchedule(recovery.tasks, dependencies, 2, "2026-10-16", start);
  assert.equal(afterRecovery.scheduledDates.get(1), "2026-10-16");
  assert.equal(afterRecovery.scheduledDates.get(2), "2026-10-16");
  assert.deepEqual(afterRecovery.infeasibleTasks, []);
}

{
  const result = buildSchedule([
    task(1, "Prerequisite too long", 5),
    task(2, "Blocked dependent", 1, "high"),
  ], [{ taskId: 2, dependsOn: 1 }], 4, "2026-10-16", start);
  assert.deepEqual(result.infeasibleTasks.map((item) => [item.taskName, item.reason]), [
    ["Prerequisite too long", "exceeds_daily_capacity"],
    ["Blocked dependent", "dependency_unavailable"],
  ]);
}

{
  const result = buildSchedule([
    task(1, "Prerequisite", 1, "low"),
    task(2, "Dependent", 1, "high"),
  ], [{ taskId: 2, dependsOn: 1 }], 2, "2026-10-16", start);
  assert.equal(result.scheduledDates.get(1), "2026-10-16");
  assert.equal(result.scheduledDates.get(2), "2026-10-16");
  assert.deepEqual(result.infeasibleTasks, []);
}

console.log("Passed 6 missed-task and deadline scheduling cases.");
