import assert from "node:assert/strict";
import { deleteGoalRecords, type GoalDeletionDatabase, type GoalDeletionTransaction } from "./goal-deletion.ts";

type State = {
  users: number[];
  goals: number[];
  goalOwners: Record<number, number>;
  tasks: { id: number; goalId: number }[];
  dependencies: { taskId: number; dependsOn: number }[];
  progress: { taskId: number; userId: number }[];
  milestones: { id: number; goalId: number }[];
  milestoneTasks: { milestoneId: number; taskId: number }[];
  versions: { id: number; goalId: number }[];
  versionTasks: { versionId: number; taskId: number }[];
};

function fakeDatabase(initial: State, failAt?: string) {
  let state = structuredClone(initial);
  let transactionCount = 0;
  const database: GoalDeletionDatabase = {
    transaction: async (work) => {
      transactionCount += 1;
      const working = structuredClone(state);
      const step = (name: string) => {
        if (name === failAt) throw new Error(`simulated ${name} failure`);
      };
      const tx: GoalDeletionTransaction = {
        findGoalForUpdate: async (goalId, userId) => working.goals.includes(goalId) && (userId === undefined || working.goalOwners[goalId] === userId) ? { id: goalId } : undefined,
        listTaskIds: async (goalId) => working.tasks.filter((task) => task.goalId === goalId).map((task) => task.id),
        listMilestoneIds: async (goalId) => working.milestones.filter((milestone) => milestone.goalId === goalId).map((milestone) => milestone.id),
        listPlanVersionIds: async (goalId) => working.versions.filter((version) => version.goalId === goalId).map((version) => version.id),
        deleteDependencyEdgesForTasks: async (ids) => { step("dependencies"); const set = new Set(ids); working.dependencies = working.dependencies.filter((edge) => !set.has(edge.taskId) && !set.has(edge.dependsOn)); },
        deleteProgressForTasks: async (ids) => { step("progress"); const set = new Set(ids); working.progress = working.progress.filter((event) => !set.has(event.taskId)); },
        deleteMilestoneTaskLinks: async (milestoneIds, taskIds) => { step("milestone links"); const milestones = new Set(milestoneIds); const tasks = new Set(taskIds); working.milestoneTasks = working.milestoneTasks.filter((link) => !milestones.has(link.milestoneId) && !tasks.has(link.taskId)); },
        deletePlanVersionTaskLinks: async (versionIds, taskIds) => { step("plan links"); const versions = new Set(versionIds); const tasks = new Set(taskIds); working.versionTasks = working.versionTasks.filter((link) => !versions.has(link.versionId) && !tasks.has(link.taskId)); },
        deleteMilestones: async (ids) => {
          step("milestones");
          const set = new Set(ids);
          assert.ok(working.milestoneTasks.every((link) => !set.has(link.milestoneId)), "milestone joins must be deleted before milestones");
          working.milestones = working.milestones.filter((item) => !set.has(item.id));
        },
        deletePlanVersions: async (ids) => {
          step("versions");
          const set = new Set(ids);
          assert.ok(working.versionTasks.every((link) => !set.has(link.versionId)), "plan joins must be deleted before versions");
          working.versions = working.versions.filter((item) => !set.has(item.id));
        },
        deleteTasks: async (ids) => {
          step("tasks");
          const set = new Set(ids);
          assert.ok(working.dependencies.every((edge) => !set.has(edge.taskId) && !set.has(edge.dependsOn)), "dependency edges must be deleted before tasks");
          assert.ok(working.progress.every((event) => !set.has(event.taskId)), "progress rows must be deleted before tasks");
          assert.ok(working.milestoneTasks.every((link) => !set.has(link.taskId)), "milestone task joins must be deleted before tasks");
          assert.ok(working.versionTasks.every((link) => !set.has(link.taskId)), "plan task joins must be deleted before tasks");
          working.tasks = working.tasks.filter((item) => !set.has(item.id));
        },
        deleteGoal: async (goalId) => {
          step("goal");
          assert.ok(working.tasks.every((task) => task.goalId !== goalId), "tasks must be deleted before the goal");
          assert.ok(working.milestones.every((milestone) => milestone.goalId !== goalId), "milestones must be deleted before the goal");
          assert.ok(working.versions.every((version) => version.goalId !== goalId), "plan versions must be deleted before the goal");
          const before = working.goals.length;
          working.goals = working.goals.filter((id) => id !== goalId);
          return working.goals.length !== before;
        },
      };
      const result = await work(tx);
      state = working;
      return result;
    },
  };
  return { database, get state() { return state; }, get transactionCount() { return transactionCount; } };
}

const seed: State = {
  users: [7],
  goals: [1, 2],
  goalOwners: { 1: 7, 2: 8 },
  tasks: [{ id: 11, goalId: 1 }, { id: 12, goalId: 1 }, { id: 21, goalId: 2 }, { id: 22, goalId: 2 }],
  dependencies: [
    { taskId: 12, dependsOn: 11 },
    { taskId: 21, dependsOn: 11 },
    { taskId: 21, dependsOn: 22 },
  ],
  progress: [{ taskId: 11, userId: 7 }, { taskId: 21, userId: 7 }],
  milestones: [{ id: 101, goalId: 1 }, { id: 201, goalId: 2 }],
  milestoneTasks: [{ milestoneId: 101, taskId: 11 }, { milestoneId: 201, taskId: 21 }, { milestoneId: 201, taskId: 11 }],
  versions: [{ id: 1001, goalId: 1 }, { id: 2001, goalId: 2 }],
  versionTasks: [{ versionId: 1001, taskId: 11 }, { versionId: 2001, taskId: 21 }, { versionId: 2001, taskId: 11 }],
};

{
  const store = fakeDatabase(seed);
  assert.equal(await deleteGoalRecords(store.database, 1), true);
  assert.deepEqual(store.state.users, [7], "the shared user record remains");
  assert.deepEqual(store.state.goals, [2]);
  assert.deepEqual(store.state.tasks, [{ id: 21, goalId: 2 }, { id: 22, goalId: 2 }]);
  assert.deepEqual(store.state.dependencies, [{ taskId: 21, dependsOn: 22 }]);
  assert.deepEqual(store.state.progress, [{ taskId: 21, userId: 7 }]);
  assert.deepEqual(store.state.milestones, [{ id: 201, goalId: 2 }]);
  assert.deepEqual(store.state.milestoneTasks, [{ milestoneId: 201, taskId: 21 }]);
  assert.deepEqual(store.state.versions, [{ id: 2001, goalId: 2 }]);
  assert.deepEqual(store.state.versionTasks, [{ versionId: 2001, taskId: 21 }]);
  assert.equal(await deleteGoalRecords(store.database, 1), false, "a repeated deletion reports the now-missing goal");
}

{
  const store = fakeDatabase(seed);
  assert.equal(await deleteGoalRecords(store.database, 1, 8), false, "a different user cannot delete the goal");
  assert.deepEqual(store.state, seed, "cross-user deletion leaves all records untouched");
}

{
  const store = fakeDatabase(seed);
  assert.equal(await deleteGoalRecords(store.database, 99), false);
  assert.equal(store.transactionCount, 1);
  assert.deepEqual(store.state, seed, "a missing goal does not alter any records");
}

{
  const store = fakeDatabase(seed, "tasks");
  await assert.rejects(deleteGoalRecords(store.database, 1), /simulated tasks failure/);
  assert.deepEqual(store.state, seed, "the transaction rolls back all preceding dependent-record deletes");
}

console.log("Passed goal deletion cleanup, preservation, missing-goal, and rollback cases.");
