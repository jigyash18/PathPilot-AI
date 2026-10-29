export type PlanningTask = {
  id: number;
  taskName: string;
  durationHours: number | string;
  priority: string;
  difficulty: string;
  status: string;
};
export type InfeasibleTask = { taskId: number; taskName: string; reason: "exceeds_daily_capacity" | "deadline_capacity" | "dependency_unavailable" };
export type ScheduleReasonCode = InfeasibleTask["reason"] | "scheduled";
export type ScheduleDecision = { taskId: number; reasonCode: ScheduleReasonCode; scheduledDate: string | null };
export type ScheduleResult = { scheduledDates: Map<number, string>; infeasibleTasks: InfeasibleTask[]; decisions: ScheduleDecision[] };

export function taskDependenciesStayInGoal(taskIds: number[], dependencies: { taskId: number; dependsOn: number }[]) {
  const owned = new Set(taskIds);
  return dependencies.every((dependency) => owned.has(dependency.taskId) && owned.has(dependency.dependsOn) && dependency.taskId !== dependency.dependsOn);
}

export function recoverMissedTasks<T extends PlanningTask>(tasks: T[]) {
  const recoveredTaskNames = tasks.filter((task) => task.status === "missed").map((task) => task.taskName);
  return {
    tasks: tasks.map((task) => task.status === "missed" ? { ...task, status: "pending" } : task),
    recoveredTaskNames,
  };
}

const priorityWeight: Record<string, number> = { high: 3, medium: 2, low: 1 };
const difficultyWeight: Record<string, number> = { hard: 3, medium: 2, easy: 1 };
const score = (task: PlanningTask) => (priorityWeight[task.priority] ?? 1) * 10 + (difficultyWeight[task.difficulty] ?? 1) * 2;
const dateToString = (date: Date) => `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
const addDays = (date: Date, days: number) => { const result = new Date(date); result.setUTCDate(result.getUTCDate() + days); return result; };

/** Pure scheduling core, kept separate from persistence so planning constraints can be tested directly. */
export function buildSchedule(
  tasks: PlanningTask[],
  dependencies: { taskId: number; dependsOn: number }[],
  dailyHours: number,
  deadline: string,
  fromDate = new Date(),
): ScheduleResult {
  const pending = tasks.filter((task) => task.status === "pending").sort((a, b) => score(b) - score(a));
  const placed = new Set(tasks.filter((task) => task.status === "completed").map((task) => task.id));
  const start = new Date(fromDate);
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(`${deadline}T00:00:00Z`);
  const capacity = Math.max(0.5, dailyHours);
  const scheduledDates = new Map<number, string>();
  const infeasibleTasks: InfeasibleTask[] = [];
  let dayOffset = 0;
  let hoursUsed = 0;
  const maxDays = Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1;
  const dependenciesFor = (taskId: number) => dependencies.filter((dependency) => dependency.taskId === taskId).map((dependency) => dependency.dependsOn);

  while (pending.length > 0 && maxDays > 0) {
    const readyIndex = pending.findIndex((task) => dependenciesFor(task.id).every((id) => placed.has(id)));
    if (readyIndex < 0) break;
    const [task] = pending.splice(readyIndex, 1);
    const duration = Number(task.durationHours);
    if (duration > capacity) {
      infeasibleTasks.push({ taskId: task.id, taskName: task.taskName, reason: "exceeds_daily_capacity" });
      continue;
    }
    if (hoursUsed > 0 && hoursUsed + duration > capacity) { dayOffset += 1; hoursUsed = 0; }
    if (dayOffset >= maxDays) {
      infeasibleTasks.push({ taskId: task.id, taskName: task.taskName, reason: "deadline_capacity" });
      continue;
    }
    scheduledDates.set(task.id, dateToString(addDays(start, dayOffset)));
    hoursUsed += duration;
    placed.add(task.id);
    if (hoursUsed >= capacity) { dayOffset += 1; hoursUsed = 0; }
  }

  const alreadyReported = new Set(infeasibleTasks.map((task) => task.taskId));
  for (const task of pending) {
    if (alreadyReported.has(task.id)) continue;
    const blocked = dependenciesFor(task.id).some((id) => !placed.has(id));
    infeasibleTasks.push({ taskId: task.id, taskName: task.taskName, reason: blocked ? "dependency_unavailable" : "deadline_capacity" });
  }
  const infeasibleById = new Map(infeasibleTasks.map((task) => [task.taskId, task.reason]));
  const decisions = tasks
    .filter((task) => task.status === "pending")
    .map((task) => ({
      taskId: task.id,
      reasonCode: scheduledDates.has(task.id) ? "scheduled" as const : (infeasibleById.get(task.id) ?? "deadline_capacity" as const),
      scheduledDate: scheduledDates.get(task.id) ?? null,
    }));
  return { scheduledDates, infeasibleTasks, decisions };
}
