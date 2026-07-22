import { describe, expect, it } from 'vitest';

import {
  appFields,
  appTagline,
  appTitle,
  buildVariationInputs,
  defaultVariationField,
  outputResults,
  resolveOutputs,
  seedSweep,
  variationCandidates,
  variationValues,
} from './app-mode';
import { createGraph, createSidecar } from './graph';
import type { StudioRun, WorkflowGraph } from './types';

function graphWith(inputs: WorkflowGraph['inputs'], outputs: WorkflowGraph['outputs'] = {}): WorkflowGraph {
  return { ...createGraph(), name: 'Poster maker', inputs, outputs };
}

describe('run-as-app field surface', () => {
  it('exposes inputs in graph order, hides and reorders per config, and humanizes labels', () => {
    const graph = graphWith({
      prompt: { type: 'string', required: true },
      seed: { type: 'integer' },
      internal_flag: { type: 'boolean' },
    });
    const sidecar = {
      ...createSidecar(),
      app: {
        fields: {
          internal_flag: { hidden: true },
          seed: { order: -1, label: 'Random seed', locked: true },
        },
      },
    };
    const fields = appFields(graph, sidecar);
    expect(fields.map((field) => field.name)).toEqual(['seed', 'prompt']);
    expect(fields[0].label).toBe('Random seed');
    expect(fields[0].locked).toBe(true);
    expect(fields[1].label).toBe('Prompt');
    expect(fields[1].locked).toBe(false);
  });

  it('derives an app title and tagline with sensible fallbacks', () => {
    const graph = graphWith({});
    const bare = createSidecar();
    expect(appTitle(graph, bare)).toBe('Poster maker');
    expect(appTitle(createGraph(), bare)).toBe('Your app');
    expect(appTagline(bare)).toBe('');
    expect(appTitle(graph, { ...bare, app: { title: 'Studio' } })).toBe('Studio');
    expect(appTagline({ ...bare, app: { tagline: '  make posters  ' } })).toBe('make posters');
  });
});

describe('output resolution', () => {
  const graph = graphWith(
    { prompt: { type: 'string' } },
    { hero: { $ref: 'nodes.render.outputs.image' }, note: { $ref: 'inputs.prompt' } },
  );

  it('maps node-backed outputs and drops non-node references', () => {
    expect(resolveOutputs(graph)).toEqual([{ name: 'hero', nodeId: 'render', outputName: 'image' }]);
  });

  it('pairs each output with its produced item from a run manifest', () => {
    const run: StudioRun = {
      id: 'run-1',
      executor: 'local',
      run_directory: '/tmp/run-1',
      state: 'finished',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:01Z',
      exit_code: 0,
      result: null,
      stderr: '',
      remote_reference: null,
      manifest: {
        nodes: [{
          id: 'render',
          state: 'finished',
          outputs: [{ name: 'image', path: 'nodes/render/hero.png', content_type: 'image/png' }],
        }],
      },
    };
    const results = outputResults(graph, run);
    expect(results).toHaveLength(1);
    expect(results[0].item?.artifact?.path).toBe('nodes/render/hero.png');
    expect(outputResults(graph, null)[0].item).toBeNull();
  });
});

describe('variation sweeps', () => {
  const graph = graphWith({
    prompt: { type: 'string' },
    seed: { type: 'integer' },
    guidance: { type: 'number', minimum: 0, maximum: 10 },
    ratio: { type: 'enum', values: ['1:1', '16:9', '9:16'] },
  });

  it('finds sweepable inputs and prefers the seed as default', () => {
    expect(variationCandidates(graph).map((candidate) => candidate.kind)).toEqual(['seed', 'number', 'choice']);
    expect(defaultVariationField(graph)?.name).toBe('seed');
  });

  it('produces distinct seeds from an injectable random source', () => {
    const sequence = [0.1, 0.1, 0.2, 0.3];
    let index = 0;
    const seeds = seedSweep(3, () => sequence[index++ % sequence.length]);
    expect(new Set(seeds).size).toBe(3);
  });

  it('sweeps choices, spreads numbers across the range, and clamps the count', () => {
    const choices = variationValues(graph, {}, { name: 'ratio', label: 'Ratio', kind: 'choice' }, 8);
    expect(choices.map((variation) => variation.value)).toEqual(['1:1', '16:9', '9:16']);

    const numbers = variationValues(graph, {}, { name: 'guidance', label: 'Guidance', kind: 'number' }, 3);
    expect(numbers.map((variation) => variation.value)).toEqual([0, 5, 10]);

    const clamped = variationValues(graph, {}, { name: 'ratio', label: 'Ratio', kind: 'choice' }, 1);
    expect(clamped.length).toBeGreaterThanOrEqual(2);
  });

  it('builds one input object per variation, overriding only the swept field', () => {
    const built = buildVariationInputs({ prompt: 'garden', seed: 1 }, 'seed', [
      { label: 'a', value: 10 },
      { label: 'b', value: 20 },
    ]);
    expect(built).toEqual([
      { prompt: 'garden', seed: 10 },
      { prompt: 'garden', seed: 20 },
    ]);
  });
});
