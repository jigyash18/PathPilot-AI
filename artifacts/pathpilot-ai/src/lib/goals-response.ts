import type { Goal } from '@workspace/api-client-react';

export function assertGoalsArray(value: unknown): Goal[] {
  if (!Array.isArray(value)) {
    throw new TypeError('Expected /api/goals to return an array.');
  }

  return value as Goal[];
}
