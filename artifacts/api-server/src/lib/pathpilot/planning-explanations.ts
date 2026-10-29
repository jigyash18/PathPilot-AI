import { recoverMissedTasks, type PlanningTask, type ScheduleResult } from "./planner-core.ts";

export type ReplanTaskChange = {
  taskId: number;
  taskName: string;
  change: "unchanged" | "moved" | "recovered" | "newly_unscheduled" | "newly_scheduled";
  reasonCode: string;
  previousDate: string | null;
  scheduledDate: string | null;
};

export function compareReplan(
  beforeTasks: (PlanningTask & { scheduledDate?: string | null })[],
  schedule: ScheduleResult,
) {
  const recoveredIds = new Set(beforeTasks.filter((task) => task.status === "missed").map((task) => task.id));
  const decisionById = new Map(schedule.decisions.map((decision) => [decision.taskId, decision]));
  const infeasibleById = new Map(schedule.infeasibleTasks.map((task) => [task.taskId, task]));
  return beforeTasks.filter((task) => task.status === "pending" || recoveredIds.has(task.id)).map((task): ReplanTaskChange => {
    const previousDate = task.scheduledDate ?? null;
    const scheduledDate = schedule.scheduledDates.get(task.id) ?? null;
    const infeasible = infeasibleById.get(task.id);
    const decision = decisionById.get(task.id);
    let change: ReplanTaskChange["change"] = "unchanged";
    if (recoveredIds.has(task.id)) change = "recovered";
    else if (previousDate && !scheduledDate) change = "newly_unscheduled";
    else if (!previousDate && scheduledDate) change = "newly_scheduled";
    else if (previousDate !== scheduledDate) change = "moved";
    return {
      taskId: task.id,
      taskName: task.taskName,
      change,
      reasonCode: infeasible?.reason ?? (recoveredIds.has(task.id) ? "missed_task_recovered" : change === "moved" ? "moved" : change === "newly_scheduled" ? "newly_scheduled" : decision?.reasonCode ?? "scheduled"),
      previousDate,
      scheduledDate,
    };
  });
}

export function explainReplan(changes: ReplanTaskChange[], infeasibility: string | null) {
  if (changes.length === 0) return "There was no pending work to replan.";
  const recovered = changes.filter((change) => change.change === "recovered").length;
  const moved = changes.filter((change) => change.change === "moved").length;
  const newlyUnscheduled = changes.filter((change) => change.change === "newly_unscheduled").length;
  const newlyScheduled = changes.filter((change) => change.change === "newly_scheduled").length;
  const parts = [
    recovered ? `${recovered} missed task${recovered === 1 ? " was" : "s were"} returned to the pending schedule.` : null,
    moved ? `${moved} task${moved === 1 ? " moved" : "s moved"} to a different date.` : null,
    newlyScheduled ? `${newlyScheduled} previously unscheduled task${newlyScheduled === 1 ? " was" : "s were"} placed.` : null,
    newlyUnscheduled ? `${newlyUnscheduled} task${newlyUnscheduled === 1 ? " became" : "s became"} unscheduled.` : null,
    !recovered && !moved && !newlyScheduled && !newlyUnscheduled ? "No pending task dates changed." : null,
    infeasibility,
    !infeasibility && changes.length > 0 ? "All pending work fits within the current deadline and daily capacity." : null,
  ].filter((part): part is string => Boolean(part));
  return parts.join(" ");
}

export type PreviewTask = { id: number; taskName: string; durationHours: number | string; priority: string; difficulty: string; status: string; scheduledDate?: string | null };
export type PreviewGoal = { dailyHours: number; deadline: string };
export type AlternativeScenario = "current" | "more_daily_time" | "extended_deadline";

const MAX_DAILY_HOURS = 8;
const DAILY_INCREASE = 1;
const DEADLINE_EXTENSION_DAYS = 14;
export function increasedDailyCapacity(dailyHours: number, tasks: Pick<PreviewTask, "durationHours" | "status">[]) {
  const longestPendingTask = tasks
    .filter((task) => task.status === "pending" || task.status === "missed")
    .reduce((longest, task) => Math.max(longest, Number(task.durationHours)), 0);
  return Math.min(MAX_DAILY_HOURS, Math.max(dailyHours + DAILY_INCREASE, longestPendingTask));
}
const parseIsoDate = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : date;
};
const addDays = (date: Date, days: number) => { const value = new Date(date); value.setUTCDate(value.getUTCDate() + days); return value.toISOString().slice(0, 10); };

/** Each scenario is validated and independently evaluated by the authoritative pure scheduler. */
export function previewAlternativePlans(
  goal: PreviewGoal,
  sourceTasks: PreviewTask[],
  dependencies: { taskId: number; dependsOn: number }[],
  build: (tasks: PreviewTask[], dependencies: { taskId: number; dependsOn: number }[], dailyHours: number, deadline: string, fromDate: Date) => ScheduleResult,
  fromDate = new Date(),
) {
  const deadline = parseIsoDate(goal.deadline);
  if (!deadline || !Number.isFinite(goal.dailyHours) || goal.dailyHours < 0.5 || goal.dailyHours > 24) throw new Error("Saved goal constraints are invalid for preview.");
  const byId = new Map(sourceTasks.map((task) => [task.id, task]));
  for (const task of sourceTasks) {
    const duration = Number(task.durationHours);
    if (!Number.isFinite(duration) || duration <= 0 || duration > 24) throw new Error(`Task ${task.id} has an invalid duration.`);
  }
  if (dependencies.some((dependency) => !byId.has(dependency.taskId) || !byId.has(dependency.dependsOn) || dependency.taskId === dependency.dependsOn)) throw new Error("Saved task dependencies are invalid for preview.");
  const recovered = recoverMissedTasks(sourceTasks);
  const scenarios: { scenario: AlternativeScenario; dailyHours: number; deadline: string; deadlineExtensionDays: number }[] = [
    { scenario: "current", dailyHours: goal.dailyHours, deadline: goal.deadline, deadlineExtensionDays: 0 },
  ];
  if (goal.dailyHours < MAX_DAILY_HOURS) scenarios.push({
    scenario: "more_daily_time",
    // Tasks are indivisible. Make the capacity alternative useful for an oversized
    // task when possible, while retaining the established 8-hour/day upper bound.
    dailyHours: increasedDailyCapacity(goal.dailyHours, recovered.tasks),
    deadline: goal.deadline,
    deadlineExtensionDays: 0,
  });
  scenarios.push({ scenario: "extended_deadline", dailyHours: goal.dailyHours, deadline: addDays(deadline, DEADLINE_EXTENSION_DAYS), deadlineExtensionDays: DEADLINE_EXTENSION_DAYS });

  const evaluated = scenarios.map((candidate) => {
    if (candidate.dailyHours < 0.5 || candidate.dailyHours > MAX_DAILY_HOURS && candidate.scenario !== "current" || !parseIsoDate(candidate.deadline)) throw new Error("A proposed preview constraint is outside the allowed range.");
    const result = build(recovered.tasks, dependencies, candidate.dailyHours, candidate.deadline, fromDate);
    const pending = recovered.tasks.filter((task) => task.status === "pending");
    const tasks = pending.map((task) => ({
      taskId: task.id,
      taskName: task.taskName,
      durationHours: Number(task.durationHours),
      scheduledDate: result.scheduledDates.get(task.id) ?? null,
      reasonCode: result.infeasibleTasks.find((item) => item.taskId === task.id)?.reason
        ?? result.decisions.find((item) => item.taskId === task.id)?.reasonCode
        ?? (result.scheduledDates.has(task.id) ? "scheduled" : "deadline_capacity"),
    }));
    const currentChanges = compareReplan(sourceTasks, result);
    const changed = currentChanges.filter((item) => item.change !== "unchanged");
    const feasible = result.infeasibleTasks.length === 0
      && tasks.length === pending.length
      && tasks.every((task) => task.scheduledDate !== null);
    const scheduleDays = new Map<string, number>();
    for (const item of tasks) if (item.scheduledDate) scheduleDays.set(item.scheduledDate, (scheduleDays.get(item.scheduledDate) ?? 0) + item.durationHours);
    // Lower scores rank first: constraint change (capacity + 10/hour, deadline + 2/day), schedule churn (+1/task, +0.25/day moved), and a realism cost above 4h/day (+3/hour).
    const score = (candidate.dailyHours !== goal.dailyHours ? 10 + 10 * Math.max(0, candidate.dailyHours - goal.dailyHours) : 0)
      + candidate.deadlineExtensionDays * 2 + changed.length
      + changed.reduce((sum, item) => sum + (item.previousDate && item.scheduledDate ? Math.abs((parseIsoDate(item.scheduledDate)!.getTime() - parseIsoDate(item.previousDate)!.getTime()) / 86_400_000) * 0.25 : 0), 0)
      + Math.max(0, candidate.dailyHours - 4) * 3;
    return {
      scenario: candidate.scenario,
      feasible,
      dailyHours: candidate.dailyHours,
      deadline: candidate.deadline,
      deadlineExtensionDays: candidate.deadlineExtensionDays,
      totalWorkloadHours: Number(pending.reduce((sum, task) => sum + Number(task.durationHours), 0).toFixed(2)),
      scheduledTasks: tasks.filter((item) => item.scheduledDate),
      unscheduledTasks: tasks.filter((item) => !item.scheduledDate),
      dailyWorkload: [...scheduleDays.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, hours]) => ({ date, hours: Number(hours.toFixed(2)) })),
      changes: currentChanges,
      infeasibilityExplanation: result.infeasibleTasks.length ? `The scheduler could not fit ${result.infeasibleTasks.length} pending task${result.infeasibleTasks.length === 1 ? "" : "s"}: ${result.infeasibleTasks.map((item) => `${item.taskName} (${item.reason})`).join(", ")}.` : null,
      score,
    };
  });
  const feasiblePlans = evaluated.filter((plan) => plan.feasible).sort((a, b) => a.score - b.score || a.scenario.localeCompare(b.scenario));
  const ranks = new Map(feasiblePlans.map((plan, index) => [plan.scenario, index + 1]));
  return {
      rankingMethod: "The capacity option adds at least 1 study hour/day and, when needed, raises capacity to fit the longest individual pending task, capped at 8 hours/day; tasks are not split across days. The deadline option adds 14 days. Feasible plans rank by lowest score: constraint changes, plan churn and date movement, plus a realism cost above 4 study hours/day. Deadline extensions cost 2 points/day; capacity increases cost 10 points plus 10 per added hour.",
    hasFeasibleAlternative: feasiblePlans.some((plan) => plan.scenario !== "current"),
    plans: evaluated.map(({ score, ...plan }) => ({ ...plan, rank: ranks.get(plan.scenario) ?? null })),
  };
}
