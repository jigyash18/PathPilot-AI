import { buildSchedule, type PlanningTask } from "./planner-core";

export type SmartTask = PlanningTask & { scheduledDate: string | null; completionPercent: number; topic?: string | null };
export type TaskDependency = { taskId: number; dependsOn: number };
export type RoadmapState = "completed" | "available" | "scheduled" | "blocked" | "overdue" | "at_risk";
export type PrioritizedTask = {
  task: SmartTask;
  score: number;
  explanation: string;
  unlockCount: number;
  state: RoadmapState;
};

const priorityWeight: Record<string, number> = { high: 30, medium: 20, low: 10 };
const DAY_MS = 86_400_000;

function validDate(value: string | null | undefined): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : date;
}

export function calendarDate(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

function daysUntil(deadline: string, now: Date): number | null {
  const date = validDate(deadline);
  if (!date) return null;
  return Math.ceil((date.getTime() - Date.parse(`${calendarDate(now)}T00:00:00Z`)) / DAY_MS);
}

function prerequisiteIds(taskId: number, dependencies: TaskDependency[]) {
  return dependencies.filter((dependency) => dependency.taskId === taskId).map((dependency) => dependency.dependsOn);
}

export function taskUnlockCounts(tasks: SmartTask[], dependencies: TaskDependency[]) {
  const counts = new Map<number, number>(tasks.map((task) => [task.id, 0]));
  for (const dependency of dependencies) counts.set(dependency.dependsOn, (counts.get(dependency.dependsOn) ?? 0) + 1);
  return counts;
}

export function roadmapTaskState(task: SmartTask, tasks: SmartTask[], dependencies: TaskDependency[], now = new Date(), riskStatus: RiskStatus = "insufficient_data"): RoadmapState {
  if (task.status === "completed") return "completed";
  const byId = new Map(tasks.map((value) => [value.id, value]));
  const blocked = prerequisiteIds(task.id, dependencies).some((id) => byId.get(id)?.status !== "completed");
  if (blocked) return "blocked";
  const today = calendarDate(now);
  if (task.scheduledDate && task.scheduledDate < today) return "overdue";
  if (riskStatus === "infeasible" || riskStatus === "at_risk") return "at_risk";
  if (!task.scheduledDate) return "available";
  if (task.scheduledDate <= today) return "available";
  return "scheduled";
}

export function prioritizeTasks(tasks: SmartTask[], dependencies: TaskDependency[], input: { dailyHours: number; deadline: string }, now = new Date()): PrioritizedTask[] {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const unlocks = taskUnlockCounts(tasks, dependencies);
  const remainingDays = daysUntil(input.deadline, now);
  const today = calendarDate(now);
  const scheduledHours = new Map<string, number>();
  for (const task of tasks) {
    if (task.status === "completed" || !task.scheduledDate) continue;
    const duration = Number(task.durationHours);
    if (Number.isFinite(duration) && duration > 0) scheduledHours.set(task.scheduledDate, (scheduledHours.get(task.scheduledDate) ?? 0) + duration);
  }
  return tasks.filter((task) => task.status !== "completed").map((task) => {
    const prerequisiteNames = prerequisiteIds(task.id, dependencies).map((id) => byId.get(id)).filter((value): value is SmartTask => Boolean(value));
    const blocked = prerequisiteNames.some((value) => value.status !== "completed");
    const overdue = Boolean(task.scheduledDate && task.scheduledDate < today);
    const urgency = remainingDays === null ? 0 : remainingDays <= 0 ? 42 : remainingDays <= 3 ? 34 : remainingDays <= 7 ? 24 : remainingDays <= 14 ? 14 : 0;
    const unlockCount = unlocks.get(task.id) ?? 0;
    const duration = Number(task.durationHours);
    const fitsTarget = Number.isFinite(duration) && duration <= Math.max(0.5, input.dailyHours);
    const dailyScheduledHours = task.scheduledDate ? scheduledHours.get(task.scheduledDate) ?? 0 : 0;
    const overloaded = Boolean(task.scheduledDate && Number.isFinite(input.dailyHours) && dailyScheduledHours > input.dailyHours);
    const scheduledToday = task.scheduledDate === today;
    const score = (priorityWeight[task.priority] ?? 10) + urgency + (overdue ? 28 : 0) + unlockCount * 9 + (fitsTarget ? 4 : 0) + (overloaded ? 12 : 0) + (scheduledToday ? 8 : 0) - (blocked ? 1000 : 0);
    const facts = blocked
      ? [`it waits for ${prerequisiteNames.filter((value) => value.status !== "completed").map((value) => value.taskName).join(", ")}`]
      : overdue
        ? ["it is past its scheduled date"]
        : unlockCount > 0
          ? [`it unlocks ${unlockCount} downstream task${unlockCount === 1 ? "" : "s"}`]
          : overloaded
            ? [`its scheduled day has ${dailyScheduledHours}h planned against your ${input.dailyHours}h daily target`]
            : remainingDays !== null && remainingDays <= 14
              ? `the deadline is ${remainingDays < 0 ? "past" : `in ${remainingDays} day${remainingDays === 1 ? "" : "s"}`}`
              : task.priority === "high"
                ? ["it has high priority"]
                : scheduledToday
                  ? ["it is scheduled for today"]
                  : task.scheduledDate
                    ? [`it is scheduled for ${task.scheduledDate}`]
                    : fitsTarget
                      ? [`its ${duration}h estimate fits your ${input.dailyHours}h daily target`]
                      : [`its ${Number.isFinite(duration) ? `${duration}h` : "unknown"} estimate needs more than your ${input.dailyHours}h daily target`];
    const state = roadmapTaskState(task, tasks, dependencies, now);
    const explanation = blocked ? `Keep it in view, but do not start it yet: ${facts[0]}.` : `Prioritize ${task.taskName} because ${facts[0]}.`;
    return { task, score, explanation, unlockCount, state };
  }).filter((item) => item.state !== "blocked").sort((left, right) => right.score - left.score || Number(left.task.durationHours) - Number(right.task.durationHours) || left.task.id - right.task.id);
}

export type RiskStatus = "on_track" | "at_risk" | "infeasible" | "insufficient_data";
export type WorkloadRisk = {
  status: RiskStatus;
  title: string;
  explanation: string;
  remainingHours: number | null;
  remainingDays: number | null;
  availableHours: number | null;
  factors: string[];
};

export function analyzeWorkloadRisk(tasks: SmartTask[], dependencies: TaskDependency[], input: { dailyHours: number; deadline: string }, now = new Date()): WorkloadRisk {
  const remaining = tasks.filter((task) => task.status !== "completed");
  const invalidDuration = remaining.some((task) => !Number.isFinite(Number(task.durationHours)) || Number(task.durationHours) <= 0);
  const remainingDays = daysUntil(input.deadline, now);
  if (invalidDuration || !Number.isFinite(input.dailyHours) || input.dailyHours <= 0 || remainingDays === null) {
    return { status: "insufficient_data", title: "Not enough data to assess", explanation: "The route needs valid task durations, a daily target, and a valid deadline before workload risk can be assessed.", remainingHours: null, remainingDays, availableHours: null, factors: ["missing or invalid planning data"] };
  }
  const remainingHours = Number(remaining.reduce((sum, task) => sum + Number(task.durationHours), 0).toFixed(2));
  const availableHours = Math.max(0, remainingDays + 1) * input.dailyHours;
  const schedule = buildSchedule(tasks.map((task) => ({ ...task, status: task.status === "completed" ? "completed" : "pending" })) as PlanningTask[], dependencies, input.dailyHours, input.deadline, now);
  const factors = [
    `${remainingHours}h remaining across ${remaining.length} unfinished task${remaining.length === 1 ? "" : "s"}`,
    `${Number(availableHours.toFixed(2))}h theoretical capacity through the deadline`,
    schedule.infeasibleTasks.length ? `${schedule.infeasibleTasks.length} task${schedule.infeasibleTasks.length === 1 ? " is" : "s are"} not schedulable under current dependencies/capacity` : null,
    remainingDays < 0 ? "the deadline has passed" : null,
  ].filter((value): value is string => Boolean(value));
  const ratio = availableHours === 0 ? Infinity : remainingHours / availableHours;
  const status: RiskStatus = remainingDays < 0 || schedule.infeasibleTasks.length > 0 || remainingHours > availableHours ? "infeasible" : ratio >= 0.8 ? "at_risk" : "on_track";
  const title = status === "on_track" ? "On track" : status === "at_risk" ? "Worth reviewing early" : status === "infeasible" ? "Needs a planning adjustment" : "Not enough data to assess";
  const explanation = status === "on_track"
    ? `The remaining ${remainingHours}h fits within the estimated ${Number(availableHours.toFixed(2))}h capacity if the current assumptions hold.`
    : status === "at_risk"
      ? `The route uses about ${Math.round(ratio * 100)}% of the available capacity, so missed sessions may put the deadline under pressure.`
      : status === "infeasible"
        ? "The current deadline and daily target cannot fit all known remaining work under the scheduler's dependency rules. No deadline or preference was changed."
        : "The route needs valid planning data before workload risk can be assessed.";
  return { status, title, explanation, remainingHours, remainingDays, availableHours: Number(availableHours.toFixed(2)), factors };
}

export function buildSmartRoadmap(tasks: SmartTask[], dependencies: TaskDependency[], input: { dailyHours: number; deadline: string }, now = new Date()) {
  const risk = analyzeWorkloadRisk(tasks, dependencies, input, now);
  const prioritized = prioritizeTasks(tasks, dependencies, input, now);
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const taskStates = tasks.map((task) => {
    const recommendation = prioritized.find((item) => item.task.id === task.id);
    const blockedBy = prerequisiteIds(task.id, dependencies).flatMap((id) => { const value = byId.get(id); return value && value.status !== "completed" ? [value.taskName] : []; });
    return { task, state: roadmapTaskState(task, tasks, dependencies, now, risk.status), blockedBy, unlockCount: recommendation?.unlockCount ?? 0, explanation: recommendation?.explanation ?? null };
  });
  const stages = [...new Set(taskStates.map((item) => item.task.scheduledDate ?? "unscheduled"))].sort().map((key) => ({ key, label: key === "unscheduled" ? "Needs a place" : key, taskIds: taskStates.filter((item) => (item.task.scheduledDate ?? "unscheduled") === key).map((item) => item.task.id) }));
  const next = prioritized.find((item) => !["blocked", "completed"].includes(item.state)) ?? null;
  return { risk, next, taskStates, stages, dependencyEdges: dependencies.map((dependency) => ({ ...dependency })) };
}
