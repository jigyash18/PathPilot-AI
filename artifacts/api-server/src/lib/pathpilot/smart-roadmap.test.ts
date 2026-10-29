import assert from "node:assert/strict";
import test from "node:test";
import { analyzeWorkloadRisk, buildSmartRoadmap, prioritizeTasks, roadmapTaskState } from "./smart-roadmap.ts";

const now = new Date("2026-10-27T12:00:00Z");
const tasks = [
  { id: 1, taskName: "Foundations", durationHours: 1, priority: "medium", difficulty: "easy", status: "pending", scheduledDate: "2026-10-27", completionPercent: 0, completedAt: null },
  { id: 2, taskName: "Capstone", durationHours: 2, priority: "high", difficulty: "hard", status: "pending", scheduledDate: "2026-10-28", completionPercent: 0, completedAt: null },
  { id: 3, taskName: "Done", durationHours: 2, priority: "high", difficulty: "hard", status: "completed", scheduledDate: "2026-10-26", completionPercent: 100, completedAt: "2026-10-26" },
];
const dependencies = [{ taskId: 2, dependsOn: 1 }];

test("prioritization only recommends actionable work and explains true facts", () => {
  const ranked = prioritizeTasks(tasks, dependencies, { dailyHours: 3, deadline: "2026-10-30" }, now);
  assert.equal(ranked[0]?.task.id, 1, "the prerequisite is actionable before its downstream task");
  assert.match(ranked[0]!.explanation, /unlocks 1 downstream task/);
  assert.equal(ranked.some((item) => item.task.id === 3), false);
  assert.equal(roadmapTaskState(tasks[1]!, tasks, dependencies, now), "blocked");
  assert.equal(ranked.every((item) => item.state !== "blocked"), true);
});

test("equal scores use stable duration then id ordering", () => {
  const equal = tasks.filter((task) => task.id !== 2).map((task) => ({ ...task, id: task.id + 10, taskName: `T${task.id}`, priority: "low", durationHours: 1, scheduledDate: null, status: "pending" }));
  const first = prioritizeTasks(equal, [], { dailyHours: 2, deadline: "2026-12-01" }, now).map((item) => item.task.id);
  const second = prioritizeTasks([...equal].reverse(), [], { dailyHours: 2, deadline: "2026-12-01" }, now).map((item) => item.task.id);
  assert.deepEqual(first, second);
});

test("explanations use schedule and capacity facts instead of repeating fit language", () => {
  const scheduled = tasks.filter((task) => task.id !== 3).map((task, index) => ({ ...task, id: index + 20, priority: "medium", scheduledDate: index === 0 ? "2026-10-27" : "2026-10-28" }));
  const ranked = prioritizeTasks([...scheduled, { ...scheduled[0]!, id: 30, taskName: "Long task", durationHours: 4, scheduledDate: null }], [], { dailyHours: 2, deadline: "2026-11-30" }, now);
  assert.match(ranked.find((item) => item.task.id === 20)!.explanation, /scheduled for today/);
  assert.match(ranked.find((item) => item.task.id === 21)!.explanation, /scheduled for 2026-10-28/);
  assert.match(ranked.find((item) => item.task.id === 30)!.explanation, /needs more than your 2h daily target/);
});

test("risk distinguishes on-track, at-risk, infeasible and insufficient data", () => {
  assert.equal(analyzeWorkloadRisk(tasks, dependencies, { dailyHours: 3, deadline: "2026-10-30" }, now).status, "on_track");
  const atRiskTasks = tasks.slice(0, 2).map((task) => ({ ...task, durationHours: 2, scheduledDate: "2026-10-27" }));
  assert.equal(analyzeWorkloadRisk(atRiskTasks, [], { dailyHours: 2, deadline: "2026-10-28" }, now).status, "at_risk");
  assert.equal(analyzeWorkloadRisk(tasks, dependencies, { dailyHours: 1, deadline: "2026-10-27" }, now).status, "infeasible");
  assert.equal(analyzeWorkloadRisk([{ ...tasks[0]!, durationHours: Number.NaN }], [], { dailyHours: 1, deadline: "2026-10-30" }, now).status, "insufficient_data");
});

test("smart roadmap retains dependency edges and creates date stages", () => {
  const roadmap = buildSmartRoadmap(tasks, dependencies, { dailyHours: 3, deadline: "2026-10-30" }, now);
  assert.deepEqual(roadmap.dependencyEdges, dependencies);
  assert.ok(roadmap.stages.some((stage) => stage.key === "2026-10-27"));
  assert.equal(roadmap.taskStates.find((item) => item.task.id === 2)?.blockedBy[0], "Foundations");
});
