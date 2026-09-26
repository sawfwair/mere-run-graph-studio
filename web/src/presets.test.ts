import { describe, expect, it } from 'vitest';
import { capturePreset, decodePreset, insertPreset } from './presets';
import { createGraph, createSidecar } from './graph';
import type { WorkflowGraph } from './types';

describe('saved node presets', () => {
  const graph: WorkflowGraph = {
    ...createGraph(),
    nodes: [
      { id: 'prompt', kind: 'text.value', arguments: { value: 'hello' } },
      { id: 'render', kind: 'image.generate', arguments: { prompt: { $ref: 'nodes.prompt.outputs.text' } }, depends_on: ['prompt'] },
    ],
  };
  const sidecar = { ...createSidecar(), nodes: { prompt: { x: 10, y: 20 }, render: { x: 440, y: 20 } } };

  it('remaps collisions and internal references on insertion', () => {
    const preset = decodePreset(JSON.parse(JSON.stringify(capturePreset(graph, sidecar, ['prompt', 'render'], 'Image starter'))));
    const inserted = insertPreset(graph, sidecar, preset, { x: 100, y: 200 });
    expect(inserted.nodeIds).toEqual(['prompt-2', 'render-2']);
    expect(inserted.graph.nodes[3]?.arguments.prompt).toEqual({ $ref: 'nodes.prompt-2.outputs.text' });
    expect(inserted.graph.nodes[3]?.depends_on).toEqual(['prompt-2']);
    expect(inserted.sidecar.nodes['prompt-2']).toMatchObject({ x: 100, y: 200 });
    expect(Object.values(inserted.sidecar.groups ?? {})[0]?.node_ids).toEqual(['prompt-2', 'render-2']);
  });

  it('rejects incomplete selections', () => {
    expect(() => capturePreset(graph, sidecar, ['render'], 'Incomplete')).toThrow('Include every ordering dependency');
  });

  it('rejects credential values and malformed imported presets', () => {
    const unsafe = { ...graph, nodes: [{ id: 'unsafe', kind: 'tool.call', arguments: { api_key: 'plaintext' } }] };
    expect(() => capturePreset(unsafe, sidecar, ['unsafe'], 'Unsafe')).toThrow('credential values');
    const preset = capturePreset(graph, sidecar, ['prompt', 'render'], 'Valid');
    expect(() => decodePreset({ ...preset, nodes: [] })).toThrow('between one and 100');
    expect(() => decodePreset({ ...preset, positions: { ...preset.positions, prompt: { x: Infinity, y: 1 } } })).toThrow('Invalid saved preset position');
  });
});
