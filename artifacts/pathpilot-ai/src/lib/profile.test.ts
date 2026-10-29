import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultGoalDailyHours } from './profile';

test('saved study target becomes the default daily capacity for new goals', () => {
  assert.equal(defaultGoalDailyHours({ availableHours: 6, preferredStart: '08:00', preferredEnd: '18:00' }), 6);
  assert.equal(defaultGoalDailyHours(undefined), 4);
});
