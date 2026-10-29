export type FocusTask = {
  id: number;
  goalId: number;
  status: string;
  scheduledDate: string | null;
};

export type FocusStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function focusSelectionKey(userId: string | number, goalId: number) {
  return `pathpilot-focus-v1:${encodeURIComponent(String(userId))}:${goalId}`;
}

export function readFocusTaskId(storage: FocusStorage, key: string): number | null {
  try {
    const stored = storage.getItem(key);
    if (stored === null) return null;
    const parsed: unknown = JSON.parse(stored);
    return typeof parsed === 'number' && Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
  } catch {
    return null;
  }
}

export function writeFocusTaskId(storage: FocusStorage, key: string, taskId: number | null) {
  try {
    if (taskId === null) storage.removeItem(key);
    else storage.setItem(key, JSON.stringify(taskId));
  } catch {
    // Keep the in-memory selection usable when browser storage is unavailable.
  }
}

export function resolveFocusTask<T extends FocusTask>(tasks: readonly T[], taskId: number | null, goalId: number): T | null {
  if (taskId === null) return null;
  return tasks.find((task) => task.id === taskId && task.goalId === goalId && task.status === 'pending') ?? null;
}

export function buildOverviewTasks<T extends FocusTask>(
  tasks: readonly T[],
  today: string,
  taskId: number | null,
  goalId: number,
) {
  const goalTasks = tasks.filter((task) => task.goalId === goalId);
  const todaysTasks = goalTasks.filter((task) => task.scheduledDate && task.scheduledDate.slice(0, 10) === today).slice(0, 4);
  const scheduledTasks = todaysTasks.length
    ? todaysTasks
    : goalTasks.filter((task) => task.status === 'pending' && task.scheduledDate).slice(0, 4);
  const focusedTask = resolveFocusTask(goalTasks, taskId, goalId);
  return {
    tasks: focusedTask
      ? [focusedTask, ...scheduledTasks.filter((task) => task.id !== focusedTask.id)]
      : scheduledTasks,
    invalidSelection: taskId !== null && !focusedTask,
  };
}
