import { describe, expect, it } from 'vitest';

import { choicesWithCurrent, integerChoices, numberPresets, stringChoices } from './field-choices';

describe('finite field choices', () => {
  it('uses choices declared for enum and string fields', () => {
    expect(stringChoices({ type: 'enum', values: ['midi', 'json'] })).toEqual(['midi', 'json']);
    expect(stringChoices({ type: 'string', values: ['draft', 'final', 'draft'] })).toEqual(['draft', 'final']);
    expect(stringChoices({ type: 'string' })).toBeNull();
  });

  it('uses only complete short integer ranges', () => {
    expect(integerChoices({ type: 'integer', minimum: 1, maximum: 8 })).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(integerChoices({ type: 'integer', minimum: 2, maximum: 8, step: 2 })).toEqual([2, 4, 6, 8]);
    expect(integerChoices({ type: 'integer', minimum: 1, maximum: 100000 })).toBeNull();
    expect(integerChoices({ type: 'integer', minimum: 1 })).toBeNull();
  });

  it('retains a choice from an imported workflow', () => {
    expect(choicesWithCurrent(['draft', 'final'], 'legacy')).toEqual(['legacy', 'draft', 'final']);
  });

  it('filters convenience presets through the declared range and step', () => {
    expect(numberPresets({ name: 'fps', type: 'integer', minimum: 24, maximum: 60, step: 6 })).toEqual([24, 30, 48, 60]);
    expect(numberPresets({ name: 'seed', type: 'integer' })).toBeNull();
  });
});
