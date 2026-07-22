import assert from 'node:assert/strict';
import test from 'node:test';

import { complexityProfile, profileRegressions, radonRank } from './complexity.mjs';

test('uses the same A through F bands as Radon', () => {
  assert.deepEqual([1, 5, 6, 10, 11, 20, 21, 30, 31, 40, 41].map(radonRank), [
    'A', 'A', 'B', 'B', 'C', 'C', 'D', 'D', 'E', 'E', 'F',
  ]);
});

test('profiles only hotspots and sorts each file from highest to lowest', () => {
  assert.deepEqual(complexityProfile([
    { filename: 'b.ts', complexity: 11 },
    { filename: 'a.ts', complexity: 8 },
    { filename: 'b.ts', complexity: 24 },
  ]), { 'b.ts': [24, 11] });
});

test('the ratchet rejects new or increased hotspots and permits reductions', () => {
  const baseline = { 'a.ts': [30, 12] };
  assert.deepEqual(profileRegressions({ 'a.ts': [29, 11] }, baseline), []);
  assert.deepEqual(profileRegressions({ 'a.ts': [31, 11], 'new.ts': [12] }, baseline), [
    { filename: 'a.ts', complexity: 31, ceiling: 30 },
    { filename: 'new.ts', complexity: 12, ceiling: 10 },
  ]);
});
