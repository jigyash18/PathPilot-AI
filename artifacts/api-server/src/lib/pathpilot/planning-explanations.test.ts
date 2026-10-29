import assert from "node:assert/strict";
import { buildSchedule } from "./planner-core.ts";
import { compareReplan, explainReplan, previewAlternativePlans } from "./planning-explanations.ts";

const fromDate = new Date("2026-10-16T12:00:00Z");
const tasks = [
  { id: 1, taskName: "Prerequisite", durationHours: 1, priority: "high", difficulty: "medium", status: "pending", scheduledDate: "2026-10-16" },
  { id: 2, taskName: "Dependent", durationHours: 1, priority: "medium", difficulty: "easy", status: "pending", scheduledDate: "2026-10-16" },
  { id: 3, taskName: "Missed review", durationHours: 1, priority: "low", difficulty: "easy", status: "missed", scheduledDate: "2026-10-15" },
];
const dependencies = [{ taskId: 2, dependsOn: 1 }];

{
  const snapshot = structuredClone({ tasks, dependencies });
  const preview = previewAlternativePlans({ dailyHours: 2, deadline: "2026-10-16" }, tasks, dependencies, buildSchedule, fromDate);
  assert.deepEqual({ tasks, dependencies }, snapshot, "preview inputs remain unchanged");
  assert.equal(preview.plans.length, 3);
  assert.ok(preview.plans.every((plan) => plan.dailyWorkload.every((day) => day.hours <= plan.dailyHours)));
  const current = preview.plans.find((plan) => plan.scenario === "current")!;
  assert.equal(current.feasible, false, "recovered missed work exceeding current capacity is infeasible");
  assert.equal(preview.hasFeasibleAlternative, true);
  const feasible = preview.plans.filter((plan) => plan.feasible).sort((a, b) => a.rank! - b.rank!);
  assert.equal(feasible[0]?.scenario, "more_daily_time", "modest capacity increase ranks ahead of an unnecessary deadline trade-off");
  assert.ok(current.unscheduledTasks.length > 0);
  assert.ok(current.infeasibilityExplanation?.includes("deadline_capacity"));
}

{
  const result = buildSchedule(tasks.map((task) => task.status === "missed" ? { ...task, status: "pending" } : task), dependencies, 3, "2026-10-20", new Date("2026-10-17T12:00:00Z"));
  const changes = compareReplan(tasks, result);
  assert.deepEqual(changes.map((item) => item.change), ["moved", "moved", "recovered"]);
  const text = explainReplan(changes, null);
  assert.match(text, /missed task/);
  assert.match(text, /2 tasks moved/);
  assert.match(text, /All pending work fits/);
  assert.doesNotMatch(explainReplan([], null), /All pending work/);
}

{
  const pending = tasks.filter((task) => task.status === "pending");
  const result = buildSchedule(pending, dependencies, 0.5, "2026-10-16", fromDate);
  const changes = compareReplan(pending, result);
  assert.deepEqual(changes.map((item) => item.change), ["newly_unscheduled", "newly_unscheduled"]);
  assert.deepEqual(changes.map((item) => item.reasonCode), ["exceeds_daily_capacity", "dependency_unavailable"]);
}

{
  const impossible = previewAlternativePlans({ dailyHours: 0.5, deadline: "2026-10-16" }, [
    { id: 7, taskName: "Long task", durationHours: 24, priority: "high", difficulty: "hard", status: "pending" },
  ], [], buildSchedule, fromDate);
  assert.equal(impossible.hasFeasibleAlternative, false);
  assert.ok(impossible.plans.every((plan) => !plan.feasible && plan.rank === null));
}

{
  const indivisibleTasks = [
    { id: 20, taskName: "Three hour task", durationHours: 3, priority: "high", difficulty: "medium", status: "pending" },
    { id: 21, taskName: "Four hour task", durationHours: 4, priority: "medium", difficulty: "medium", status: "pending" },
    { id: 22, taskName: "Another three hour task", durationHours: 3, priority: "low", difficulty: "easy", status: "pending" },
  ];
  const preview = previewAlternativePlans({ dailyHours: 2, deadline: "2026-10-26" }, indivisibleTasks, [], buildSchedule, fromDate);
  const current = preview.plans.find((plan) => plan.scenario === "current")!;
  const increased = preview.plans.find((plan) => plan.scenario === "more_daily_time")!;
  const extended = preview.plans.find((plan) => plan.scenario === "extended_deadline")!;
  assert.equal(current.dailyHours, 2);
  assert.equal(current.deadline, "2026-10-26");
  assert.equal(current.feasible, false);
  assert.ok(current.unscheduledTasks.every((task) => task.reasonCode === "exceeds_daily_capacity"));
  assert.equal(increased.dailyHours, 4, "capacity alternative accommodates the longest indivisible task");
  assert.equal(increased.deadline, "2026-10-26");
  assert.equal(increased.feasible, true);
  assert.equal(increased.unscheduledTasks.length, 0);
  assert.equal(extended.dailyHours, 2, "deadline option keeps the saved daily capacity");
  assert.equal(extended.deadline, "2026-11-09");
  assert.equal(extended.feasible, false, "a longer deadline cannot fix indivisible work above daily capacity");
}

{
  const pending = [{ id: 30, taskName: "Unmapped task", durationHours: 1, priority: "medium", difficulty: "medium", status: "pending" }];
  const incompleteBuild = () => ({ scheduledDates: new Map(), infeasibleTasks: [], decisions: [] });
  const preview = previewAlternativePlans({ dailyHours: 2, deadline: "2026-10-26" }, pending, [], incompleteBuild, fromDate);
  assert.ok(preview.plans.every((plan) => !plan.feasible && plan.unscheduledTasks.length === 1), "a missing scheduler assignment is never reported as feasible");
}

{
  const boundary = previewAlternativePlans({ dailyHours: 2, deadline: "2026-10-16" }, [
    { id: 10, taskName: "Before", durationHours: 1, priority: "low", difficulty: "easy", status: "pending" },
    { id: 11, taskName: "After", durationHours: 1, priority: "high", difficulty: "easy", status: "pending" },
  ], [{ taskId: 11, dependsOn: 10 }], buildSchedule, fromDate);
  const plan = boundary.plans[0]!;
  assert.equal(plan.feasible, true, "the deadline day is inclusive");
  assert.deepEqual(plan.scheduledTasks.map((task) => task.taskId), [10, 11]);
  assert.ok(plan.scheduledTasks.every((task) => task.scheduledDate === "2026-10-16"));
}

console.log("Passed 5 alternative preview and replanning explanation cases.");
