import { describe, expect, it } from 'vitest';

import {
  booleanValue,
  decodeArray,
  decodeBytes,
  decodeCatalogEntry,
  decodeCommandDocument,
  decodeEditorSidecar,
  decodeFieldType,
  decodeJsonObject,
  decodeJsonValue,
  decodeModelPull,
  decodeProjectSummary,
  decodeRunEvent,
  decodeStudioDocument,
  decodeStudioProject,
  decodeStudioProjectPackage,
  decodeStudioRun,
  decodeTemplateEntry,
  decodeWorkflowGraph,
  decodeWorkflowProgram,
  nullableNumber,
  nullableString,
  numberValue,
  optionalBoolean,
  optionalNumber,
  optionalString,
  parseJsonValue,
  recordValue,
  stringValue,
} from './decode';

const graph = {
  schema_version: 1,
  kind: 'mere.run/workflow-graph',
  name: 'Decoded graph',
  inputs: {
    prompt: {
      type: 'string', required: true, values: ['one'], description: 'Prompt', default: 'one',
      minimum: 0, maximum: 10, step: 1, multiline: true,
    },
  },
  execution: { max_parallel_nodes: 2 },
  nodes: [{
    id: 'render', kind: 'image.generate', provider: 'mere.run', arguments: { prompt: { $ref: 'inputs.prompt' } },
    depends_on: ['prepare'], execution: { cache: 'refresh', max_attempts: 2, timeout_seconds: 30 },
  }],
  outputs: { image: { $ref: 'nodes.render.outputs.image', label: 'hero' } },
  metadata: { owner: 'studio' },
};

const sidecar = {
  schema_version: 1,
  kind: 'mere.run/workflow-editor',
  viewport: { x: 1, y: 2, zoom: 0.8 },
  nodes: { render: { x: 10, y: 20, collapsed: false, color: '#fff' } },
  inputs: { prompt: { x: 0, y: 0 } },
  outputs: { image: { x: 100, y: 100 } },
  groups: { hero: { x: 0, y: 0, title: 'Hero', width: 200, height: 100, node_ids: ['render'] } },
  notes: { note: { x: 0, y: 0, text: 'Review', width: 120, height: 80 } },
  selection_sets: { saved: { node_ids: ['render'] } },
  promotions: { material: { consumer_id: 'render', argument_name: 'prompt', consumer_position: { x: 3, y: 4 } } },
  app: { title: 'Hero app', tagline: 'Make images', fields: { prompt: { hidden: false, locked: true, label: 'Words', order: 1 } } },
};

const program = {
  schema_version: 1,
  kind: 'mere.run/workflow-program',
  name: 'Decoded program',
  inputs: { prompt: { type: 'string' } },
  variables: { count: 1 },
  imports: { shared: './shared.json' },
  modules: {
    render: { parameters: ['prompt'], nodes: graph.nodes, outputs: graph.outputs },
  },
  steps: [{ id: 'step', module: 'render', arguments: { prompt: 'hello' }, when: true, map: { item: 'prompt', values: ['a'] } }],
  outputs: graph.outputs,
  execution: { max_parallel_nodes: 1 },
  metadata: { purpose: 'test' },
};

describe('runtime decoders', () => {
  it('decodes complete workflow, editor, program, and project contracts', () => {
    expect(decodeWorkflowGraph(graph).nodes[0].execution?.cache).toBe('refresh');
    expect(decodeEditorSidecar(sidecar).app?.fields?.prompt.label).toBe('Words');
    expect(decodeWorkflowProgram(program).modules.render.parameters).toEqual(['prompt']);

    const document = decodeStudioDocument({ graph, inputs: { prompt: 'hello' }, sidecar, program });
    expect(document.graph.name).toBe('Decoded graph');
    expect(decodeStudioProject({ path: 'workflows/decoded', ...document }).path).toBe('workflows/decoded');
    expect(decodeStudioProjectPackage({ contract_version: 'mere.run/graph-studio-project.v1', ...document }).contract_version)
      .toBe('mere.run/graph-studio-project.v1');
  });

  it('decodes catalogs, command envelopes, summaries, and templates', () => {
    const entry = decodeCatalogEntry({
      kind: 'image.generate', title: 'Image', description: 'Generate', category: 'image',
      provider: { id: 'mere.run', version: '1.0.0', catalog_sha256: 'abc' },
      inputs: [{
        name: 'settings', type: 'json', required: true, optional: false, description: 'Settings', default: {},
        values: ['a'], minimum: 0, maximum: 1, step: 0.1, multiline: false, secret: false,
        content_types: ['application/json'],
        value_schema: {
          type: 'object', title: 'Settings', description: 'Nested', default: {}, values: ['a'], required: ['name'],
          properties: { name: { type: 'string' } }, items: { type: 'string' },
          additional_properties: { type: 'number' }, minimum: 0, maximum: 1, step: 1, multiline: false,
        },
      }],
      outputs: [{ name: 'image', type: 'asset' }],
      traits: { cacheable: true, deterministic: false, supports_progress: true, supports_previews: true, side_effects: 'none' },
      requirements: { accelerator_backends: ['metal'], model_ids: ['image-model'] },
      presentation: { style: 'material', primary_argument: 'settings' },
    });
    expect(entry.inputs[0].value_schema?.properties?.name.type).toBe('string');
    expect(decodeCommandDocument({ exit_code: 0, result: { ready: true }, stdout: '', stderr: '' }, decodeJsonValue).result)
      .toEqual({ ready: true });
    expect(decodeProjectSummary({ path: 'a', name: 'A', modified_at: 'now' }).name).toBe('A');
    expect(decodeTemplateEntry({ id: 'a', title: 'A', description: 'D', tags: ['x'] }).tags).toEqual(['x']);
  });

  it('decodes run, event, model-pull, JSON, and binary responses', () => {
    const run = decodeStudioRun({
      id: 'run', executor: 'local', run_directory: '/run', state: 'finished', created_at: 'start', updated_at: 'end',
      exit_code: 0, result: { ok: true }, stderr: '', remote_reference: null,
      events: [{ sequence: 1, type: 'state', message: 'done', phase: 'run', state: 'finished', node_id: 'render', progress: 1, metric: { fps: 1 } }],
      manifest: { nodes: [] }, actions: [{ id: 'review' }],
      artifacts: [{ name: 'image', kind: 'image', path: 'image.png', content_type: 'image/png', size_bytes: 10, sha256: 'abc' }],
      node_details: [{ id: 'render', directory: 'nodes/render', preflight: {}, stdout: 'ok', stderr: '' }],
      history: [{ created_at: 'now', kind: 'created', message: 'Created', details: { source: 'test' } }],
    });
    expect(run.events?.[0].node_id).toBe('render');
    expect(decodeRunEvent({ message: 'hello', custom: true }).message).toBe('hello');
    expect(decodeModelPull({
      model: 'image', state: 'installed', percent: 100, received_bytes: 10, total_bytes: 10,
      detail: 'done', install_path: '/models/image', stderr: '', updated_at: 'now',
    }).state).toBe('installed');
    expect(parseJsonValue('{"safe":true}')).toEqual({ safe: true });
    expect(decodeJsonObject({ nested: [1, true, null] })).toEqual({ nested: [1, true, null] });
    expect([...decodeBytes([0, 127, 255])]).toEqual([0, 127, 255]);
    expect([...decodeBytes(new Uint8Array([1, 2]))]).toEqual([1, 2]);
    expect([...decodeBytes(new Uint8Array([3, 4]).buffer)]).toEqual([3, 4]);
  });

  it('provides strict primitive helpers and actionable rejection paths', () => {
    expect(recordValue({ ok: true }).ok).toBe(true);
    expect(decodeArray(['a'], stringValue)).toEqual(['a']);
    expect(stringValue('a')).toBe('a');
    expect(numberValue(1)).toBe(1);
    expect(booleanValue(true)).toBe(true);
    expect(nullableString(null)).toBeNull();
    expect(nullableNumber(null)).toBeNull();
    expect(optionalString(undefined)).toBeUndefined();
    expect(optionalNumber(undefined)).toBeUndefined();
    expect(optionalBoolean(undefined)).toBeUndefined();
    expect(decodeFieldType('asset_collection')).toBe('asset_collection');

    expect(() => decodeWorkflowGraph({ ...graph, kind: 'wrong' })).toThrow(/workflow graph\.kind/);
    expect(() => decodeStudioProjectPackage({ ...graph, contract_version: 'wrong' })).toThrow(/contract_version/);
    expect(() => decodeModelPull({ model: 'x', state: 'unknown' })).toThrow(/model pull state/);
    expect(() => decodeBytes([256])).toThrow(/bytes/);
    expect(() => parseJsonValue('{')).toThrow(/Invalid JSON/);
    expect(() => decodeJsonValue(undefined)).toThrow(/JSON value/);
  });
});
