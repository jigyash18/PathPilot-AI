export type OwnedGoalRecord = { id: number; userId: number };

export async function loadOwnedGoal<T extends OwnedGoalRecord>(
  lookup: (goalId: number) => Promise<T | undefined>,
  goalId: number,
  userId: number,
): Promise<T | null> {
  const goal = await lookup(goalId);
  return goal && goal.userId === userId ? goal : null;
}
