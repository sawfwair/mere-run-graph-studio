import { nodeFixtureRun } from './node-fixture';
import { CHOICE_CATALOG, CHOICE_PROJECT } from './choice-fixture';
import type { StudioRuntime } from '../src/runtime';
import type { CatalogEntry, CommandDocument, ModelPull, StudioDocument } from '../src/types';

// A canned StudioRuntime for the visual harness: enough real-looking data to
// render every editor surface, no network / Tauri / relay. Extend as needed
// when a surface you want to screenshot calls a method that currently throws.

const ok = <T>(result: T | null, error = ''): CommandDocument<T> => ({ exit_code: error ? 1 : 0, result, stdout: '', stderr: error });
const idle = (): ModelPull => ({ model: '', state: 'installed', percent: 100, received_bytes: null, total_bytes: null, detail: '', install_path: null, stderr: '', updated_at: '' });

export const HARNESS_CATALOG: CatalogEntry[] = [
  { kind: 'text.prompt', title: 'Prompt', category: 'text', inputs: [{ name: 'text', type: 'string', required: true }], outputs: [{ name: 'text', type: 'string' }], requirements: { network_access: false } },
  { kind: 'image.generate', title: 'Generate image', category: 'image', inputs: [{ name: 'prompt', type: 'string', required: true }, { name: 'model', type: 'string' }, { name: 'seed', type: 'number' }], outputs: [{ name: 'image', type: 'asset' }] },
  { kind: 'image.upscale', title: 'Upscale image', category: 'image', inputs: [{ name: 'image', type: 'asset', required: true }], outputs: [{ name: 'image', type: 'asset' }] },
  { kind: 'video.generate', title: 'Generate video', category: 'video', inputs: [{ name: 'prompt', type: 'string', required: true }, { name: 'image', type: 'asset', required: false }, { name: 'end_image', type: 'asset', required: false }, { name: 'model', type: 'string', required: false }], outputs: [{ name: 'video', type: 'asset' }], requirements: { network_access: true } },
  { kind: 'audio.generate', title: 'Generate audio', category: 'audio', inputs: [{ name: 'prompt', type: 'string' }], outputs: [{ name: 'audio', type: 'asset' }] },
  { kind: 'boolean.value', title: 'Boolean', category: 'values', inputs: [{ name: 'value', type: 'boolean', required: true }], outputs: [{ name: 'value', type: 'boolean' }] },
  { kind: 'number.value', title: 'Number', category: 'values', inputs: [{ name: 'value', type: 'number', required: true }], outputs: [{ name: 'value', type: 'number' }] },
  { kind: 'dataset.prepare', title: 'Prepare dataset', category: 'dataset', inputs: [{ name: 'source', type: 'asset' }], outputs: [{ name: 'dataset', type: 'json' }] },
];

export function createMockRuntime(example = false, templates = false, controls = false): StudioRuntime {
  const mock: StudioRuntime = {
    executionScope: 'cloud' as const,
    catalog: async () => ok({ nodes: [...HARNESS_CATALOG, ...(controls ? CHOICE_CATALOG : []), ...(example ? [{ kind: 'text.value', title: 'Text value', category: 'text', presentation: { style: 'material', primary_argument: 'value' }, inputs: [{ name: 'value', type: 'string', required: true, multiline: true }], outputs: [{ name: 'text', type: 'string' }] } satisfies CatalogEntry] : [])] }),
    executors: async () => ok({ executors: [{ reference: 'relay:fleet', kind: 'relay', name: 'fleet', installed_model_ids: ['image-krea2-raw', 'video-ltx23-av-mlx'] }] }),
    models: async () => ok({ installed_model_ids: ['image-krea2-raw', 'video-ltx23-av-mlx'] }),
    probeExecutor: async () => ok({ installed_model_ids: ['image-krea2-raw', 'video-ltx23-av-mlx'] }),
    templates: async () => ({ available: templates, document: ok({ templates: templates ? [
      { id: 'product-hero', title: 'Product hero', description: 'Create a product image and video.', tags: ['image', 'video'] },
    ] : [] }) }),
    projects: async () => ({ projects: [] }),
    listRuns: async () => ({ runs: example ? [await nodeFixtureRun()] : [] }),
    inspectRun: async () => { if (example) return nodeFixtureRun(); throw new Error('harness: no runs'); },
    watchRun: async () => {},
    canInstallModels: () => true,
    modelPreflight: async () => ok({ status: 'ok', result: { models: [] } }),
    startModelPull: async () => idle(),
    inspectModelPull: async () => idle(),
    watchModelPull: async () => {},
    artifactBlob: async () => new Blob([]),
    inputAssetBlob: async () => new Blob([]),
    importAssets: async () => ({ assets: [] }),
    importRunArtifact: async () => ({ name: 'output.png', path: 'assets/harness/output.png', content_type: 'image/png', size_bytes: 100 }),
    saveProject: async () => ({ status: 'ok', path: 'untitled' }),
    loadProject: async () => { throw new Error('harness: no projects'); },
    exportProject: async (project) => ({ contract_version: 'mere.run/graph-studio-project.v1', ...project }),
    importProject: async () => { throw new Error('harness: import unsupported'); },
    check: async () => ok({ valid: true }),
    comparePreflight: async () => ({ comparisons: [] }),
    compileProgram: async () => { throw new Error('harness: compile unsupported'); },
    startRun: async () => { throw new Error('harness: run unsupported'); },
    cancelRun: async () => { throw new Error('harness: run unsupported'); },
    fetchRun: async () => { throw new Error('harness: run unsupported'); },
    retryRun: async () => { throw new Error('harness: run unsupported'); },
    resumeRun: async () => { throw new Error('harness: run unsupported'); },
    loadTemplate: async () => {
      if (!templates) throw new Error('harness: templates unsupported');
      if (controls) return { ...CHOICE_PROJECT, document: ok(null) };
      return {
        graph: { ...HARNESS_PROJECT.graph, name: 'Product hero', inputs: {
          product: { type: 'string' as const, required: true, default: 'Ceramic lamp' },
          description: { type: 'string' as const, required: true, default: 'Product photograph on a pale green set' },
        } },
        inputs: { product: 'Ceramic lamp', description: 'Product photograph on a pale green set' },
        sidecar: HARNESS_PROJECT.sidecar,
        document: ok(null),
      };
    },
    publishTemplate: async () => { throw new Error('harness: templates unsupported'); },
    inspectComfy: async () => ok(null, 'harness: comfy unsupported'),
    importComfy: async () => { throw new Error('harness: comfy unsupported'); },
  };
  return mock;
}

export const HARNESS_PROJECT: StudioDocument = {
  graph: {
    schema_version: 1,
    kind: 'mere.run/workflow-graph',
    name: 'Product hero shots',
    inputs: {},
    nodes: [
      { id: 'render', kind: 'image.generate', arguments: { prompt: 'a red sports car', seed: 7 } },
      { id: 'clip', kind: 'video.generate', arguments: { prompt: 'orbit the car', image: { $ref: 'nodes.render.outputs.image' } } },
    ],
    outputs: {},
  },
  inputs: {},
  sidecar: {
    schema_version: 1,
    kind: 'mere.run/workflow-editor',
    viewport: { x: 120, y: 80, zoom: 0.85 },
    nodes: { render: { x: 120, y: 120 }, clip: { x: 520, y: 260 } },
  },
};
