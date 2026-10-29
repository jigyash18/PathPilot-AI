import assert from "node:assert/strict";
import { recoveredProgressEvents, transitionTaskStatus, type LifecycleDatabase, type LifecycleProgress, type LifecycleTask } from "./task-lifecycle.ts";

function fakeDatabase(initial: LifecycleTask, failInsert = false) {
  let task = structuredClone(initial);
  const events: LifecycleProgress[] = [];
  const database: LifecycleDatabase = {
    transaction: async (work) => {
      const workingTask = structuredClone(task);
      const workingEvents = [...events];
      const result = await work({
        findTaskForUpdate: async (id) => workingTask.id === id ? workingTask : null,
        findGoalUserId: async (goalId) => goalId === workingTask.goalId ? 1 : null,
        updateTask: async (_id, patch) => { Object.assign(workingTask, patch); return workingTask; },
        insertProgress: async (event) => { if (failInsert) throw new Error("simulated insert failure"); workingEvents.push(event); },
      });
      task = workingTask;
      events.splice(0, events.length, ...workingEvents);
      return result;
    },
  };
  return { database, get task() { return task; }, events };
}

{
  const store = fakeDatabase({ id: 1, goalId: 10, status: "pending", completedAt: null });
  assert.equal((await transitionTaskStatus(store.database, 1, "completed", "2026-10-16")).kind, "ok");
  assert.equal(store.events.length, 1);
  await transitionTaskStatus(store.database, 1, "completed", "2026-10-17");
  assert.equal(store.events.length, 1, "repeated completion is idempotent and keeps the first completion date");
  assert.equal(store.task.completedAt, "2026-10-16");
}

{
  const store = fakeDatabase({ id: 2, goalId: 10, status: "completed", completedAt: "2026-10-15" });
  await transitionTaskStatus(store.database, 2, "missed", "2026-10-16");
  assert.equal(store.task.status, "missed");
  assert.equal(store.task.completedAt, null);
  assert.deepEqual(store.events.map((event) => event.status), ["missed"]);
}

{
  const store = fakeDatabase({ id: 3, goalId: 10, status: "missed", completedAt: null });
  await transitionTaskStatus(store.database, 3, "completed", "2026-10-16");
  assert.equal(store.task.status, "completed", "a recovered missed task can later be completed");
  assert.equal(store.events[0]?.status, "completed");
  assert.deepEqual(recoveredProgressEvents(1, [{ id: 3 }], "2026-10-16"), [{ userId: 1, taskId: 3, date: "2026-10-16", status: "recovered", completionPercent: 0 }]);
}

{
  const store = fakeDatabase({ id: 4, goalId: 10, status: "pending", completedAt: null }, true);
  await assert.rejects(transitionTaskStatus(store.database, 4, "completed", "2026-10-16"), /simulated insert failure/);
  assert.equal(store.task.status, "pending", "transaction rollback preserves original status");
  assert.equal(store.events.length, 0);
}

{
  const task: LifecycleTask = { id: 5, goalId: 10, status: "pending", completedAt: null };
  const database: LifecycleDatabase = {
    transaction: async (work) => work({
      findTaskForUpdate: async (taskId, userId) => taskId === task.id && userId === 7 ? task : null,
      findGoalUserId: async () => 7,
      updateTask: async (_id, patch) => Object.assign(task, patch),
      insertProgress: async () => undefined,
    }),
  };
  assert.equal((await transitionTaskStatus(database, 5, "completed", "2026-10-16", 8)).kind, "not_found", "a different user cannot complete the task");
  assert.equal(task.status, "pending");
}

console.log("Passed 5 task-lifecycle transaction contract cases using a rollback-capable fake transaction.");
