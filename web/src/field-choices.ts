import type { CatalogField, GraphInputDefinition } from './types';

type ChoiceField = Pick<CatalogField | GraphInputDefinition, 'type' | 'values' | 'minimum' | 'maximum' | 'step'>;

/** Choices declared by the runtime or workflow, including string fields with values. */
export function stringChoices(field: ChoiceField): string[] | null {
  if (field.type !== 'enum' && field.type !== 'string') return null;
  return field.values?.length ? [...new Set(field.values)] : null;
}

/** A short, complete integer range is easier to choose than to type. */
export function integerChoices(field: ChoiceField): number[] | null {
  if (field.type !== 'integer') return null;
  const { minimum, maximum } = field;
  const step = field.step ?? 1;
  if (minimum === undefined || maximum === undefined || !validIntegerRange(minimum, maximum, step)) return null;
  const count = Math.floor((maximum - minimum) / step) + 1;
  if (count < 2 || count > 12) return null;
  return Array.from({ length: count }, (_, index) => minimum + index * step);
}

function validIntegerRange(minimum: number, maximum: number, step: number): boolean {
  return Number.isSafeInteger(minimum) && Number.isSafeInteger(maximum)
    && Number.isSafeInteger(step) && step > 0 && maximum >= minimum;
}

export function fieldChoices(field: ChoiceField): (string | number)[] | null {
  if (field.type === 'enum') return stringChoices(field) ?? [];
  return stringChoices(field) ?? integerChoices(field);
}

/** Keep imported or now-unavailable choices visible until the user replaces them. */
export function choicesWithCurrent<T extends string | number>(choices: T[], current: T | undefined): T[] {
  return current === undefined || choices.includes(current) ? choices : [current, ...choices];
}

const commonNumberPresets: Record<string, number[]> = {
  width: [256, 512, 768, 1024, 1280, 1536, 1920, 2048],
  height: [256, 512, 720, 768, 1024, 1080, 1280, 1536, 1920, 2048],
  fps: [12, 15, 24, 25, 30, 48, 50, 60],
  duration: [2, 4, 5, 8, 10, 15, 30, 60],
  steps: [4, 8, 12, 20, 30, 40, 50],
  max_tokens: [128, 256, 512, 1024, 2048, 4096, 8192],
  rank: [4, 8, 16, 32, 64, 128],
};

/** Convenience presets, not runtime constraints. Every field keeps custom entry. */
export function numberPresets(field: ChoiceField & { name: string }): number[] | null {
  if (field.type !== 'integer' && field.type !== 'number') return null;
  const presets = commonNumberPresets[field.name]?.filter((value) =>
    (field.minimum === undefined || value >= field.minimum)
    && (field.maximum === undefined || value <= field.maximum)
    && (field.step === undefined || field.step <= 0 || Number.isInteger((value - (field.minimum ?? 0)) / field.step)));
  return presets?.length ? presets : null;
}
