import { asc, desc, eq, inArray } from "drizzle-orm";
import {
  db,
  dependenciesTable,
  goalsTable,
  planVersionTasksTable,
  planVersionsTable,
  progressTable,
  tasksTable,
  type Goal,
  type Task,
} from "@workspace/db";
import { buildSchedule, taskDependenciesStayInGoal, type ScheduleResult } from "./planner-core";
import { isMaterialPlanChange, taskCompletionProgress } from "./progress-analytics";
import { recoveredProgressEvents } from "./task-lifecycle";
import { planFingerprint } from "./plan-fingerprint";
export { buildSchedule } from "./planner-core";
export { recoverMissedTasks } from "./planner-core";
export type { InfeasibleTask, PlanningTask, ScheduleDecision, ScheduleReasonCode, ScheduleResult } from "./planner-core";

const priorityWeight: Record<string, number> = {
  high: 3,
  medium: 2,
  low: 1,
};

export const dateToString = (date: Date): string => {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

export async function scheduleGoal(
  goalId: number,
  fromDate = new Date(),
  options: { recoverMissed?: boolean; expectedPlanFingerprint?: string; goalPatch?: { dailyHours?: number; deadline?: string } } = {},
): Promise<ScheduleResult> {
  return db.transaction(async (tx) => {
    // Serializes schedule changes and version allocation for this goal.
    const [goal] = await tx.select().from(goalsTable).where(eq(goalsTable.id, goalId)).for("update");
    if (!goal) return { scheduledDates: new Map(), infeasibleTasks: [], decisions: [] };

    let tasks = await tx.select().from(tasksTable).where(eq(tasksTable.goalId, goalId)).orderBy(asc(tasksTable.id));
    const currentTaskIds = tasks.map((task) => task.id);
    const currentDependencies = currentTaskIds.length ? await tx.select().from(dependenciesTable).where(inArray(dependenciesTable.taskId, currentTaskIds)) : [];
    if (options.expectedPlanFingerprint && planFingerprint(goal, tasks, currentDependencies) !== options.expectedPlanFingerprint) {
      throw new Error("STALE_PLAN_PREVIEW");
    }
    if (options.goalPatch && (options.goalPatch.dailyHours !== undefined || options.goalPatch.deadline !== undefined)) {
      await tx.update(goalsTable).set(options.goalPatch).where(eq(goalsTable.id, goalId));
      Object.assign(goal, options.goalPatch);
    }
    const missed = options.recoverMissed ? tasks.filter((task) => task.status === "missed") : [];
    if (missed.length) {
      const recoveredDate = dateToString(fromDate);
      for (const task of missed) {
        await tx.update(tasksTable).set({ status: "pending", completionPercent: 0, completedAt: null }).where(eq(tasksTable.id, task.id));
      }
      await tx.insert(progressTable).values(recoveredProgressEvents(goal.userId, missed, recoveredDate));
      const recoveredIds = new Set(missed.map((task) => task.id));
      tasks = tasks.map((task) => recoveredIds.has(task.id) ? { ...task, status: "pending", completionPercent: 0, completedAt: null } : task);
    }

    const taskIds = tasks.map((task) => task.id);
    const dependencies = taskIds.length === 0 ? [] : await tx.select().from(dependenciesTable).where(inArray(dependenciesTable.taskId, taskIds));
    if (!taskDependenciesStayInGoal(taskIds, dependencies)) throw new Error(`Goal ${goalId} has a dependency that crosses goal boundaries.`);
    const result = buildSchedule(tasks, dependencies, Number(goal.dailyHours), goal.deadline, fromDate);
    for (const task of tasks.filter((item) => item.status === "pending")) {
      const scheduledDate = result.scheduledDates.get(task.id) ?? null;
      await tx.update(tasksTable).set({ scheduledDate }).where(eq(tasksTable.id, task.id));
      task.scheduledDate = scheduledDate;
    }

    const [latest] = await tx.select().from(planVersionsTable)
      .where(eq(planVersionsTable.goalId, goalId))
      .orderBy(desc(planVersionsTable.version)).limit(1);
    const current = {
      dailyHours: Number(goal.dailyHours),
      deadline: goal.deadline,
      taskDates: tasks.map((task) => ({ taskId: task.id, scheduledDate: task.scheduledDate, taskName: task.taskName, topic: task.topic, durationHours: task.durationHours })),
    };
    let changed = true;
    if (latest) {
      const previousRows = await tx.select().from(planVersionTasksTable).where(eq(planVersionTasksTable.planVersionId, latest.id));
      changed = isMaterialPlanChange({
        dailyHours: Number(latest.dailyHours),
        deadline: latest.deadline,
        taskDates: previousRows.map((row) => ({ taskId: row.taskId, scheduledDate: row.scheduledDate, taskName: row.taskName, topic: row.topic, durationHours: row.durationHours })),
      }, current);
    }
    if (changed) {
      const [version] = await tx.insert(planVersionsTable).values({
        goalId,
        version: (latest?.version ?? 0) + 1,
        dailyHours: current.dailyHours,
        deadline: current.deadline,
      }).returning();
      if (tasks.length) await tx.insert(planVersionTasksTable).values(tasks.map((task) => ({
        planVersionId: version!.id,
        taskId: task.id,
        scheduledDate: task.scheduledDate,
        taskName: task.taskName,
        topic: task.topic || "Uncategorized",
        durationHours: Number(task.durationHours),
      })));
    }
    return result;
  });
}

export async function getGoalTasks(goalId: number): Promise<Task[]> {
  return db.select().from(tasksTable).where(eq(tasksTable.goalId, goalId));
}

export async function getGoalDependencies(
  goalId: number,
): Promise<{ taskId: number; dependsOn: number }[]> {
  const tasks = await getGoalTasks(goalId);
  const taskIds = tasks.map((task) => task.id);
  const dependencies = taskIds.length === 0
    ? []
    : await db
        .select()
        .from(dependenciesTable)
        .where(inArray(dependenciesTable.taskId, taskIds));
  if (!taskDependenciesStayInGoal(taskIds, dependencies)) {
    throw new Error(`Goal ${goalId} has a dependency that crosses goal boundaries.`);
  }
  return dependencies;
}

export function recommendationScore(
  task: Task,
  dependencyCount: number,
  daysUntilDeadline: number,
): number {
  const urgency = daysUntilDeadline <= 14 ? 4 : daysUntilDeadline <= 30 ? 2 : 0;
  const progress = Math.max(0, 3 - Math.floor(Number(task.completionPercent) / 34));
  return (priorityWeight[task.priority] ?? 1) * 10 + urgency + progress + dependencyCount * 2;
}

export const goalSummary = (goal: Goal, tasks: Task[]) => {
  const total = tasks.length;
  const completed = tasks.filter((task) => task.status === "completed").length;
  const missed = tasks.filter((task) => task.status === "missed").length;
  const progress = taskCompletionProgress(tasks);

  return {
    id: goal.id,
    goalName: goal.goalName,
    goalType: goal.goalType,
    deadline: goal.deadline,
    dailyHours: Number(goal.dailyHours),
    priority: goal.priority,
    description: goal.description,
    skills: goal.skills,
    overallProgress: progress,
    taskCount: total,
    completedCount: completed,
    missedCount: missed,
  };
};

export const dependencyNamesFor = (
  taskId: number,
  tasks: Task[],
  dependencies: { taskId: number; dependsOn: number }[],
): string[] => {
  const taskMap = new Map(tasks.map((task) => [task.id, task.taskName]));
  return dependencies
    .filter((dependency) => dependency.taskId === taskId)
    .map((dependency) => taskMap.get(dependency.dependsOn))
    .filter((name): name is string => Boolean(name));
};

export const taskView = (
  task: Task,
  tasks: Task[],
  dependencies: { taskId: number; dependsOn: number }[],
) => ({
  id: task.id,
  goalId: task.goalId,
  taskName: task.taskName,
  topic: task.topic || "Uncategorized",
  durationHours: Number(task.durationHours),
  priority: task.priority,
  difficulty: task.difficulty,
  status: task.status,
  scheduledDate: task.scheduledDate,
  completedAt: task.completedAt,
  dependencyNames: dependencyNamesFor(task.id, tasks, dependencies),
  completionPercent: Number(task.completionPercent),
});

export const parseDate = (value: string): Date => {
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? new Date() : date;
};
