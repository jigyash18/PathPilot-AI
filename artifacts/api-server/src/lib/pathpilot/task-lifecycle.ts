export type LifecycleTask = { id: number; goalId: number; status: string; completedAt: string | null };
export type LifecycleProgress = { userId: number; taskId: number; date: string; status: "completed" | "missed" | "recovered"; completionPercent: number };
export type LifecycleTransaction = {
  findTaskForUpdate(taskId: number, userId?: number): Promise<LifecycleTask | null>;
  findGoalUserId(goalId: number): Promise<number | null>;
  updateTask(taskId: number, patch: { status: "completed" | "missed"; completionPercent: number; completedAt: string | null }): Promise<LifecycleTask>;
  insertProgress(event: LifecycleProgress): Promise<void>;
};
export type LifecycleDatabase = { transaction<T>(work: (tx: LifecycleTransaction) => Promise<T>): Promise<T> };
export type LifecycleResult = { kind: "not_found" | "invalid" } | { kind: "ok"; task: LifecycleTask };

export function recoveredProgressEvents(userId: number, tasks: { id: number }[], date: string): LifecycleProgress[] {
  return tasks.map((task) => ({ userId, taskId: task.id, date, status: "recovered", completionPercent: 0 }));
}

export function transitionTaskStatus(database: LifecycleDatabase, taskId: number, target: "completed" | "missed", date: string, expectedUserId?: number): Promise<LifecycleResult> {
  return database.transaction(async (tx) => {
    const task = await tx.findTaskForUpdate(taskId, expectedUserId);
    if (!task) return { kind: "not_found" };
    const userId = await tx.findGoalUserId(task.goalId);
    if (userId === null) return { kind: "invalid" };
    if (task.status === target) return { kind: "ok", task };
    const allowed = target === "completed"
      ? task.status === "pending" || task.status === "missed"
      : task.status === "pending" || task.status === "completed";
    if (!allowed) return { kind: "invalid" };
    const patch = target === "completed"
      ? { status: "completed" as const, completionPercent: 100, completedAt: date }
      : { status: "missed" as const, completionPercent: 0, completedAt: null };
    const updated = await tx.updateTask(task.id, patch);
    await tx.insertProgress({ userId, taskId: task.id, date, status: target, completionPercent: patch.completionPercent });
    return { kind: "ok", task: updated };
  });
}
