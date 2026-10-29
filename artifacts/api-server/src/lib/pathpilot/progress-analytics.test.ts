import assert from "node:assert/strict";
import { confirmedMilestoneState, isMaterialPlanChange, milestoneIsComplete, milestoneTaskIdsBelongToGoal, mondayWeekStart, plannedCompletedTimeline, suggestMilestones, taskCompletionProgress, topicProgress, utcCalendarDate, weeklyProgress } from "./progress-analytics.ts";

const date = (id: number, topic: string, status = "pending", scheduledDate: string | null = null, completedAt: string | null = null) => ({ id, taskName: `Task ${id}`, topic, durationHours: 1.5, status, scheduledDate, completedAt });

assert.equal(taskCompletionProgress([{ completionPercent: 100 }, ...Array.from({ length: 12 }, () => ({ completionPercent: 0 }))]), 8);
assert.equal(taskCompletionProgress([{ completionPercent: "bad" }, { completionPercent: 100 }]), 50);

{
  assert.equal(mondayWeekStart(new Date("2026-10-18T23:59:59Z")), "2026-10-12");
  assert.equal(mondayWeekStart(new Date("2026-10-19T00:00:00Z")), "2026-10-19");
  assert.equal(utcCalendarDate(new Date("2026-10-18T23:59:59Z")), "2026-10-18");
  const events = [
    { taskId: 1, date: "2026-10-11", status: "missed", completionPercent: 0 },
    { taskId: 2, date: "2026-10-12", status: "completed", completionPercent: 100 },
    { taskId: 3, date: "2026-10-18", status: "missed", completionPercent: 0 },
    { taskId: 3, date: "2026-10-18", status: "recovered", completionPercent: 0 },
    { taskId: 3, date: "2026-10-18", status: "completed", completionPercent: 100 },
    { taskId: 3, date: "2026-10-18", status: "completed", completionPercent: 100 },
    { taskId: 4, date: "2026-10-19", status: "completed", completionPercent: 100 },
  ];
  const summaries = weeklyProgress(events, [{
    id: 1, version: 1, createdAt: "2026-10-13T12:00:00Z",
    taskDates: [{ taskId: 2, scheduledDate: "2026-10-12", durationHours: 1.5 }],
  }], new Date("2026-10-16T12:00:00Z"), 2);
  assert.equal(summaries.timeZone, "UTC");
  assert.deepEqual(summaries.weeks.map((week) => [week.weekStart, week.weekEnd]), [["2026-10-05", "2026-10-11"], ["2026-10-12", "2026-10-18"]]);
  assert.equal(summaries.weeks[0]?.missedTasks, 1, "Sunday belongs to the prior Monday-Sunday week");
  assert.equal(summaries.weeks[1]?.completedTasks, 2);
  assert.equal(summaries.weeks[1]?.missedTasks, 1);
  assert.equal(summaries.weeks[1]?.completionPercent, 67);
  assert.equal(summaries.weeks[1]?.plannedHours, 1.5);
  assert.equal(summaries.weeks[1]?.actualStudyHours, null);
  assert.equal(summaries.weeks[0]?.hasPlanHistory, false, "weeks before first snapshot remain unavailable");
  const emptyWeeks = weeklyProgress([], [], new Date("2026-10-16T12:00:00Z"), 2);
  assert.ok(emptyWeeks.weeks.every((week) => week.completedTasks === 0 && week.missedTasks === 0 && week.completionPercent === null && !week.hasProgressHistory && !week.hasPlanHistory));
  assert.ok(emptyWeeks.weeks.every((week) => week.actualStudyHours === null));
  const legacyDuration = weeklyProgress([], [{ id: 2, version: 1, createdAt: "2026-10-13T12:00:00Z", taskDates: [{ taskId: 2, scheduledDate: "2026-10-12", durationHours: null }] }], new Date("2026-10-16T12:00:00Z"), 1);
  assert.equal(legacyDuration.weeks[0]?.plannedHours, null, "legacy snapshots with unknown duration do not claim zero planned hours");
}

{
  const tasks = [date(1, "Algebra", "completed"), date(2, "Algebra", "missed"), date(3, "Uncategorized", "pending")];
  assert.deepEqual(topicProgress(tasks), [
    { topic: "Algebra", taskCount: 2, completedTasks: 1, missedTasks: 1, completionPercent: 50 },
    { topic: "Uncategorized", taskCount: 1, completedTasks: 0, missedTasks: 0, completionPercent: 0 },
  ]);
  const suggestions = suggestMilestones(tasks);
  assert.equal(suggestions.length, 2);
  assert.equal(suggestions[0]?.title, "Complete Algebra");
  assert.equal(milestoneIsComplete([1, 2], tasks), false);
  assert.equal(milestoneIsComplete([1], tasks), true);
  assert.equal(milestoneIsComplete([], tasks), false);
  assert.equal(milestoneTaskIdsBelongToGoal([1, 2], [1, 2, 3]), true);
  assert.equal(milestoneTaskIdsBelongToGoal([1, 99], [1, 2, 3]), false, "milestones cannot include another goal's task");
  assert.equal(milestoneTaskIdsBelongToGoal([1, 1], [1, 2, 3]), false, "duplicate links are rejected");
  assert.deepEqual(confirmedMilestoneState([1], tasks, false), { confirmed: false, completed: false, completedTaskCount: 0, taskCount: 1 });
  assert.deepEqual(confirmedMilestoneState([1], tasks, true), { confirmed: true, completed: true, completedTaskCount: 1, taskCount: 1 });
}

{
  const initial = { dailyHours: 2, deadline: "2026-12-01", taskDates: [{ taskId: 1, scheduledDate: "2026-11-01" }] };
  assert.equal(isMaterialPlanChange(null, initial), true, "first snapshot establishes history start");
  assert.equal(isMaterialPlanChange(initial, structuredClone(initial)), false, "duplicate replans do not create versions");
  assert.equal(isMaterialPlanChange(initial, { ...initial, taskDates: [{ taskId: 1, scheduledDate: "2026-11-02" }] }), true);
  assert.equal(isMaterialPlanChange({ ...initial, taskDates: [{ taskId: 1, scheduledDate: "2026-11-01", durationHours: 1 }] }, { ...initial, taskDates: [{ taskId: 1, scheduledDate: "2026-11-01", durationHours: 2 }] }), true, "duration changes require a new historical plan version");
  const timeline = plannedCompletedTimeline([{ id: 2, version: 2, createdAt: "2026-10-15T00:00:00Z", taskDates: [{ taskId: 1, scheduledDate: "2026-11-02", taskName: "Saved name", topic: "Saved topic", durationHours: 1.5 }, { taskId: 8, scheduledDate: null, taskName: "Unscheduled task", topic: "Algebra", durationHours: 2 }] }], [{ ...date(1, "Algebra", "completed", "2026-11-01", "2026-11-03"), durationHours: 9 }, date(8, "Algebra", "pending", null)], [{ taskId: 1, date: "2026-11-03", status: "completed", completionPercent: 100 }]);
  assert.equal(timeline[0]?.tasks[0]?.plannedDate, "2026-11-02");
  assert.equal(timeline[0]?.tasks[0]?.taskName, "Saved name");
  assert.equal(timeline[0]?.tasks[0]?.topic, "Saved topic");
  assert.equal(timeline[0]?.tasks[0]?.completedDate, "2026-11-03");
  assert.equal(timeline[0]?.tasks[0]?.estimatedHours, 1.5, "timeline duration comes from the snapshot, not current task duration");
  assert.equal(timeline[0]?.tasks[1]?.plannedDate, null, "unscheduled tasks remain in historical snapshots");
  const noCompletion = plannedCompletedTimeline([{ id: 3, version: 1, createdAt: "2026-10-15T00:00:00Z", taskDates: [{ taskId: 9, scheduledDate: "2026-11-04", durationHours: null }] }], [], []);
  assert.equal(noCompletion[0]?.tasks[0]?.completedDate, null);
  assert.equal(noCompletion[0]?.tasks[0]?.completionRecordAvailable, false, "no history is not represented as proof of non-completion");
  assert.equal(noCompletion[0]?.tasks[0]?.estimatedHours, null, "unknown legacy duration is not replaced with zero");
}

console.log("Passed 3 progress, milestone, snapshot, and completion-date cases.");
