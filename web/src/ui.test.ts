import { describe, expect, it } from 'vitest';

import {
  argumentSummaries,
  categoryKey,
  coerceViewForMode,
  describeReference,
  formatDuration,
  formatRelativeTime,
  friendlyLabel,
  isEssentialField,
  isSliderField,
  portTypeKey,
  splitFieldsForMode,
  summarizeValue,
  viewAvailableInMode,
} from './ui';
import type { CatalogEntry, WorkflowNode } from './types';

const entry: CatalogEntry = {
  kind: 'image.generate',
  title: 'Generate image',
  category: 'image',
  inputs: [
    { name: 'prompt', type: 'string', required: true, multiline: true },
    { name: 'seed', type: 'integer', required: false, default: 0 },
    { name: 'guidance_scale', type: 'number', minimum: 0, maximum: 20, default: 7.5 },
    { name: 'api_key', type: 'string', secret: true },
  ],
  outputs: [{ name: 'image', type: 'asset' }],
};

describe('mode field partitioning', () => {
  it('keeps required fields primary and defaults advanced in easy mode', () => {
    const { primary, advanced } = splitFieldsForMode(entry.inputs, 'easy');
    expect(primary.map((field) => field.name)).toEqual(['prompt']);
    expect(advanced.map((field) => field.name)).toEqual(['seed', 'guidance_scale', 'api_key']);
  });

  it('shows everything in pro mode', () => {
    const { primary, advanced } = splitFieldsForMode(entry.inputs, 'pro');
    expect(primary).toHaveLength(4);
    expect(advanced).toHaveLength(0);
  });

  it('treats undeclared fields without defaults as essential', () => {
    expect(isEssentialField({ name: 'source', type: 'asset' })).toBe(true);
    expect(isEssentialField({ name: 'steps', type: 'integer', default: 30 })).toBe(false);
  });
});

describe('labels and summaries', () => {
  it('humanizes argument names', () => {
    expect(friendlyLabel('guidance_scale')).toBe('Guidance scale');
    expect(friendlyLabel('cfg')).toBe('CFG');
    expect(friendlyLabel('negative-prompt')).toBe('Negative prompt');
  });

  it('summarizes values compactly', () => {
    expect(summarizeValue(true)).toBe('on');
    expect(summarizeValue({ $ref: 'nodes.generate.outputs.image' })).toBe('→ generate · image');
    expect(summarizeValue({ $secret: 'hf-token' })).toBe('secret · hf-token');
    expect(summarizeValue('a very long cinematic prompt about mountains', 12)).toBe('a very long…');
    expect(summarizeValue([1, 2, 3])).toBe('3 items');
  });

  it('describes references for both nodes and inputs', () => {
    expect(describeReference('inputs.subject')).toBe('input · subject');
    expect(describeReference('nodes.upscale.outputs.image')).toBe('upscale · image');
  });

  it('builds constant argument chips, essentials first, skipping references', () => {
    const node: WorkflowNode = {
      id: 'generate',
      kind: 'image.generate',
      arguments: {
        prompt: 'sunset over water',
        seed: 42,
        guidance_scale: { $ref: 'inputs.guidance' },
      },
    };
    const summaries = argumentSummaries(node, entry, 3);
    expect(summaries.map((item) => item.name)).toEqual(['prompt', 'seed']);
    expect(summaries[0].label).toBe('Prompt');
  });
});

describe('presentation helpers', () => {
  it('keeps operational views available while gating expert authoring surfaces', () => {
    expect(viewAvailableInMode('canvas', 'easy')).toBe(true);
    expect(viewAvailableInMode('runs', 'easy')).toBe(true);
    expect(viewAvailableInMode('catalog', 'easy')).toBe(true);
    expect(viewAvailableInMode('program', 'easy')).toBe(false);
    expect(viewAvailableInMode('prepare', 'pro')).toBe(true);
  });

  it('returns users to the canvas when a Pro-only view is hidden', () => {
    expect(coerceViewForMode('prepare', 'easy')).toBe('canvas');
    expect(coerceViewForMode('runs', 'easy')).toBe('runs');
    expect(coerceViewForMode('json', 'pro')).toBe('json');
  });

  it('classifies port types and categories', () => {
    expect(portTypeKey('asset_directory')).toBe('asset');
    expect(portTypeKey('enum')).toBe('text');
    expect(portTypeKey('integer')).toBe('number');
    expect(categoryKey('video')).toBe('video');
    expect(categoryKey('unknown')).toBe('other');
  });

  it('detects slider-capable fields', () => {
    expect(isSliderField({ name: 'scale', type: 'number', minimum: 0, maximum: 10 })).toBe(true);
    expect(isSliderField({ name: 'seed', type: 'integer' })).toBe(false);
  });

  it('formats relative time and durations', () => {
    const now = new Date('2026-07-18T12:00:00Z').getTime();
    expect(formatRelativeTime('2026-07-18T11:59:58Z', now)).toBe('just now');
    expect(formatRelativeTime('2026-07-18T11:59:15Z', now)).toBe('45s ago');
    expect(formatRelativeTime('2026-07-18T09:00:00Z', now)).toBe('3h ago');
    expect(formatDuration('2026-07-18T11:00:00Z', '2026-07-18T11:01:15Z')).toBe('1m 15s');
  });
});
