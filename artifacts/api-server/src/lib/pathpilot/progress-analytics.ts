export const PROGRESS_TIME_ZONE = "UTC";

/** Shared with goal summaries; task estimates and recorded study time never affect this. */
export function taskCompletionProgress(tasks: { completionPercent: number | string }[]) {
  if (!tasks.length) return 0;
  const total = tasks.reduce((sum, task) => {
    const value = Number(task.completionPercent);
    return sum + (Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0);
  }, 0);
  return Math.round(total / tasks.length);
}

export type ProgressEvent = { taskId: number; date: string; status: string; completionPercent: number };
export type ProgressTask = { id: number; taskName: string; topic: string; durationHours: number | string; status: string; scheduledDate: string | null; completedAt?: string | null };
export type PlanSnapshot = { id: number; version: number; createdAt: Date | string; taskDates: { taskId: number; scheduledDate: string | null; taskName?: string | null; topic?: string | null; durationHours: number | string | null }[] };

const parseDate = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : date;
};
const dateString = (date: Date) => date.toISOString().slice(0, 10);
export const utcCalendarDate = (date: Date) => dateString(date);
const addDays = (date: Date, days: number) => { const next = new Date(date); next.setUTCDate(next.getUTCDate() + days); return next; };

export function mondayWeekStart(date: Date) {
  const utc = new Date(date);
  utc.setUTCHours(0, 0, 0, 0);
  const sinceMonday = (utc.getUTCDay() + 6) % 7;
  utc.setUTCDate(utc.getUTCDate() - sinceMonday);
  return dateString(utc);
}

export function weeklyProgress(events: ProgressEvent[], snapshots: PlanSnapshot[], now = new Date(), weekCount = 8) {
  const currentMonday = parseDate(mondayWeekStart(now))!;
  const weeks = Array.from({ length: weekCount }, (_, index) => {
    const start = addDays(currentMonday, (index - weekCount + 1) * 7);
    const end = addDays(start, 6);
    const startDate = dateString(start);
    const endDate = dateString(end);
    const matching = events.filter((event) => event.date >= startDate && event.date <= endDate && (event.status === "completed" || event.status === "missed"));
    const completedIds = new Set(matching.filter((event) => event.status === "completed").map((event) => event.taskId));
    const missedIds = new Set(matching.filter((event) => event.status === "missed").map((event) => event.taskId));
    const plan = snapshots
      .filter((snapshot) => new Date(snapshot.createdAt).getTime() <= addDays(end, 1).getTime())
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
    const taskDates = new Map(plan?.taskDates.map((task) => [task.taskId, task.scheduledDate]) ?? []);
    const plannedTaskIds = [...taskDates.entries()].filter(([, date]) => date !== null && date >= startDate && date <= endDate).map(([id]) => id);
    const scheduledRows = plan?.taskDates.filter((task) => task.scheduledDate !== null && task.scheduledDate >= startDate && task.scheduledDate <= endDate) ?? [];
    const plannedHours = plan && scheduledRows.every((task) => task.durationHours !== null)
      ? scheduledRows.reduce((sum, task) => sum + Number(task.durationHours), 0)
      : null;
    // A task with both a missed and completed event contributes two outcomes in the weekly completion rate.
    const outcomeCount = completedIds.size + missedIds.size;
    return {
      weekStart: startDate,
      weekEnd: endDate,
      completedTasks: completedIds.size,
      missedTasks: missedIds.size,
      completionPercent: outcomeCount ? Math.round((completedIds.size / outcomeCount) * 100) : null,
      plannedTaskCount: plan ? plannedTaskIds.length : null,
      plannedHours: plannedHours === null ? null : Number(plannedHours.toFixed(2)),
      actualStudyHours: null as number | null,
      hasProgressHistory: matching.length > 0,
      hasPlanHistory: Boolean(plan),
    };
  });
  return { timeZone: PROGRESS_TIME_ZONE, weekStartsOn: "Monday" as const, weeks };
}

export function topicProgress(tasks: ProgressTask[]) {
  const topics = new Map<string, ProgressTask[]>();
  for (const task of tasks) {
    const topic = task.topic?.trim() || "Uncategorized";
    topics.set(topic, [...(topics.get(topic) ?? []), task]);
  }
  return [...topics.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([topic, values]) => {
    const completed = values.filter((task) => task.status === "completed").length;
    return { topic, taskCount: values.length, completedTasks: completed, missedTasks: values.filter((task) => task.status === "missed").length, completionPercent: values.length ? Math.round(completed / values.length * 100) : 0 };
  });
}

export function suggestMilestones(tasks: ProgressTask[]) {
  const groups = new Map<string, ProgressTask[]>();
  for (const task of tasks) {
    const topic = task.topic?.trim() || "Uncategorized";
    groups.set(topic, [...(groups.get(topic) ?? []), task]);
  }
  return [...groups.entries()].map(([topic, values]) => ({
    key: `topic:${topic}`,
    title: topic === "Uncategorized" ? "Complete general study tasks" : `Complete ${topic}`,
    targetDate: values.map((task) => task.scheduledDate).filter((value): value is string => Boolean(value)).sort().at(-1) ?? null,
    taskIds: values.map((task) => task.id),
  }));
}

export function milestoneIsComplete(taskIds: number[], tasks: ProgressTask[]) {
  if (taskIds.length === 0) return false;
  const byId = new Map(tasks.map((task) => [task.id, task]));
  return taskIds.every((id) => byId.get(id)?.status === "completed");
}

export function milestoneTaskIdsBelongToGoal(taskIds: number[], goalTaskIds: number[]) {
  const owned = new Set(goalTaskIds);
  return new Set(taskIds).size === taskIds.length && taskIds.every((id) => owned.has(id));
}

export function confirmedMilestoneState(taskIds: number[], tasks: ProgressTask[], confirmed: boolean) {
  const completedTaskCount = confirmed ? taskIds.filter((id) => tasks.find((task) => task.id === id)?.status === "completed").length : 0;
  return {
    confirmed,
    completed: confirmed && milestoneIsComplete(taskIds, tasks),
    completedTaskCount,
    taskCount: taskIds.length,
  };
}

export function isMaterialPlanChange(previous: { dailyHours: number; deadline: string; taskDates: { taskId: number; scheduledDate: string | null; taskName?: string | null; topic?: string | null; durationHours?: number | string | null }[] } | null, next: { dailyHours: number; deadline: string; taskDates: { taskId: number; scheduledDate: string | null; taskName?: string | null; topic?: string | null; durationHours?: number | string | null }[] }) {
  if (!previous) return true;
  if (previous.dailyHours !== next.dailyHours || previous.deadline !== next.deadline || previous.taskDates.length !== next.taskDates.length) return true;
  const oldTasks = new Map(previous.taskDates.map((task) => [task.taskId, task]));
  return next.taskDates.some((task) => {
    const old = oldTasks.get(task.taskId);
    const oldDuration = old?.durationHours == null ? null : Number(old.durationHours);
    const nextDuration = task.durationHours == null ? null : Number(task.durationHours);
    return !old || old.scheduledDate !== task.scheduledDate || (old.taskName ?? null) !== (task.taskName ?? null) || (old.topic ?? null) !== (task.topic ?? null) || oldDuration !== nextDuration;
  });
}

export function plannedCompletedTimeline(snapshots: PlanSnapshot[], tasks: ProgressTask[], events: ProgressEvent[]) {
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  return snapshots.map((snapshot) => {
    const planned = snapshot.taskDates.map((item) => ({
      taskId: item.taskId,
      taskName: item.taskName ?? taskById.get(item.taskId)?.taskName ?? `Task ${item.taskId}`,
      topic: item.topic ?? taskById.get(item.taskId)?.topic ?? "Uncategorized",
      plannedDate: item.scheduledDate,
      estimatedHours: item.durationHours === null ? null : Number(item.durationHours),
      completedDate: taskById.get(item.taskId)?.completedAt ?? events.filter((event) => event.taskId === item.taskId && event.status === "completed").map((event) => event.date).sort().at(-1) ?? null,
      completionRecordAvailable: Boolean(taskById.get(item.taskId)?.completedAt || events.some((event) => event.taskId === item.taskId && event.status === "completed")),
    }));
    return { planVersionId: snapshot.id, version: snapshot.version, createdAt: new Date(snapshot.createdAt).toISOString(), tasks: planned };
  });
}

export function isIsoDate(value: string) { return parseDate(value) !== null; }
