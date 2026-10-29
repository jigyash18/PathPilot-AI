import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildOverviewTasks,
  focusSelectionKey,
  readFocusTaskId,
  resolveFocusTask,
  writeFocusTaskId,
  type FocusStorage,
  type FocusTask,
} from './focus-selection.ts';

class MemoryStorage implements FocusStorage {
  private values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

const tasks: FocusTask[] = [
  { id: 1, goalId: 7, status: 'pending', scheduledDate: '2026-10-28' },
  { id: 2, goalId: 7, status: 'pending', scheduledDate: '2026-10-29' },
  { id: 3, goalId: 7, status: 'completed', scheduledDate: '2026-10-28' },
  { id: 4, goalId: 8, status: 'pending', scheduledDate: '2026-10-28' },
  { id: 5, goalId: 7, status: 'missed', scheduledDate: '2026-10-28' },
];

test('persists and clears a focus selection', () => {
  const storage = new MemoryStorage();
  const key = focusSelectionKey('user/name', 7);
  writeFocusTaskId(storage, key, 2);
  assert.equal(readFocusTaskId(storage, key), 2);
  writeFocusTaskId(storage, key, null);
  assert.equal(readFocusTaskId(storage, key), null);
});

test('uses distinct storage keys for each user and selected goal', () => {
  assert.notEqual(focusSelectionKey('alice', 7), focusSelectionKey('bob', 7));
  assert.notEqual(focusSelectionKey('alice', 7), focusSelectionKey('alice', 8));
  const storage = new MemoryStorage();
  writeFocusTaskId(storage, focusSelectionKey('alice', 7), 1);
  assert.equal(readFocusTaskId(storage, focusSelectionKey('bob', 7)), null);
  assert.equal(readFocusTaskId(storage, focusSelectionKey('alice', 8)), null);
});

test('rejects missing, cross-goal, completed, and missed focus tasks', () => {
  assert.equal(resolveFocusTask(tasks, 2, 7)?.id, 2);
  for (const staleId of [99, 3, 4, 5]) assert.equal(resolveFocusTask(tasks, staleId, 7), null);
  assert.equal(readFocusTaskId({ getItem: () => 'not-json', setItem() {}, removeItem() {} }, 'key'), null);
});

test('Overview puts a valid focus task first and keeps scheduled work; invalid focus falls back to schedule', () => {
  const focused = buildOverviewTasks(tasks, '2026-10-28', 2, 7);
  assert.deepEqual(focused.tasks.map((task) => task.id), [2, 1, 3, 5]);
  assert.equal(focused.invalidSelection, false);

  const stale = buildOverviewTasks(tasks, '2026-10-28', 5, 7);
  assert.deepEqual(stale.tasks.map((task) => task.id), [1, 3, 5]);
  assert.equal(stale.invalidSelection, true);
});
