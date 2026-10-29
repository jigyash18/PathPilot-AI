import { createHash } from "node:crypto";

export type FingerprintGoal = { id: number; dailyHours: number | string; deadline: string };
export type FingerprintTask = { id: number; status: string; scheduledDate: string | null; completionPercent: number | string; completedAt: string | null };
export type FingerprintDependency = { taskId: number; dependsOn: number };

export function planFingerprint(goal: FingerprintGoal, tasks: FingerprintTask[], dependencies: FingerprintDependency[]): string {
  const snapshot = {
    goal: { id: goal.id, dailyHours: Number(goal.dailyHours), deadline: goal.deadline },
    tasks: [...tasks].sort((a, b) => a.id - b.id).map((task) => ({ id: task.id, status: task.status, scheduledDate: task.scheduledDate, completionPercent: Number(task.completionPercent), completedAt: task.completedAt })),
    dependencies: [...dependencies].sort((a, b) => a.taskId - b.taskId || a.dependsOn - b.dependsOn),
  };
  return createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
}
