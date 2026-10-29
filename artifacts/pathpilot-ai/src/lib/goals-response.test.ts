import assert from 'node:assert/strict';
import test from 'node:test';
import { assertGoalsArray } from './goals-response.ts';

test('accepts an array response from /api/goals', () => {
  const goals = [{ id: 1 }];
  assert.equal(assertGoalsArray(goals), goals);
});

test('rejects a non-array response from /api/goals', () => {
  assert.throws(
    () => assertGoalsArray({ error: 'API unavailable' }),
    { name: 'TypeError', message: 'Expected /api/goals to return an array.' },
  );
});
