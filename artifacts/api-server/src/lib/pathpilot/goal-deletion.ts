export interface GoalDeletionTransaction {
  findGoalForUpdate(goalId: number, userId?: number): Promise<{ id: number } | undefined>;
  listTaskIds(goalId: number): Promise<number[]>;
  listMilestoneIds(goalId: number): Promise<number[]>;
  listPlanVersionIds(goalId: number): Promise<number[]>;
  deleteDependencyEdgesForTasks(taskIds: number[]): Promise<void>;
  deleteProgressForTasks(taskIds: number[]): Promise<void>;
  deleteMilestoneTaskLinks(milestoneIds: number[], taskIds: number[]): Promise<void>;
  deletePlanVersionTaskLinks(planVersionIds: number[], taskIds: number[]): Promise<void>;
  deleteMilestones(milestoneIds: number[]): Promise<void>;
  deletePlanVersions(planVersionIds: number[]): Promise<void>;
  deleteTasks(taskIds: number[]): Promise<void>;
  deleteGoal(goalId: number): Promise<boolean>;
}

export interface GoalDeletionDatabase {
  transaction<T>(work: (tx: GoalDeletionTransaction) => Promise<T>): Promise<T>;
}

/** Delete one goal and its owned records atomically. Returns false when absent. */
export function deleteGoalRecords(
  database: GoalDeletionDatabase,
  goalId: number,
  userId?: number,
): Promise<boolean> {
  return database.transaction(async (tx) => {
    const goal = await tx.findGoalForUpdate(goalId, userId);
    if (!goal) return false;

    const taskIds = await tx.listTaskIds(goalId);
    const milestoneIds = await tx.listMilestoneIds(goalId);
    const planVersionIds = await tx.listPlanVersionIds(goalId);

    await tx.deleteDependencyEdgesForTasks(taskIds);
    await tx.deleteProgressForTasks(taskIds);
    await tx.deleteMilestoneTaskLinks(milestoneIds, taskIds);
    await tx.deletePlanVersionTaskLinks(planVersionIds, taskIds);
    await tx.deleteMilestones(milestoneIds);
    await tx.deletePlanVersions(planVersionIds);
    await tx.deleteTasks(taskIds);

    if (!(await tx.deleteGoal(goalId))) {
      throw new Error(`Goal ${goalId} disappeared during deletion.`);
    }
    return true;
  });
}
