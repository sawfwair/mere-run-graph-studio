import type { CatalogEntry, StudioDocument } from '../src/types';

export const CHOICE_CATALOG: CatalogEntry[] = [
  { kind: 'harness.controls', title: 'Choice controls', category: 'video', inputs: [
    { name: 'format', type: 'enum', values: ['mp4', 'webm'] },
    { name: 'quality', type: 'string', values: ['draft', 'final'] },
    { name: 'patch_size', type: 'integer', minimum: 1, maximum: 8 },
    { name: 'fps', type: 'integer' },
    { name: 'width', type: 'integer' },
    { name: 'seed', type: 'integer' },
    { name: 'settings', type: 'json', value_schema: { type: 'object', properties: {
      backend: { type: 'string', values: ['auto', 'metal'] },
    } } },
  ], outputs: [{ name: 'video', type: 'asset' }] },
  { kind: 'choice.value', title: 'Choice', category: 'values', presentation: { style: 'material', primary_argument: 'selected' },
    inputs: [{ name: 'options', type: 'json', value_schema: { type: 'array', items: { type: 'string' } } },
      { name: 'selected', type: 'string', required: true }], outputs: [{ name: 'value', type: 'string' }] },
];

export const CHOICE_PROJECT: StudioDocument = {
  graph: { schema_version: 1, kind: 'mere.run/workflow-graph', name: 'Choice controls',
    inputs: {
      format: { type: 'enum', values: ['mp4', 'webm', 'mov', 'gif', 'avi'] },
      quality: { type: 'string', values: ['draft', 'final'] },
      patch_size: { type: 'integer', minimum: 1, maximum: 8 },
      fps: { type: 'integer' },
    },
    nodes: [
      { id: 'controls', kind: 'harness.controls', arguments: { format: 'legacy', patch_size: 3, width: 640, settings: { backend: 'metal' } } },
      { id: 'choice', kind: 'choice.value', arguments: { options: ['draft', 'final'], selected: 'legacy' } },
    ], outputs: {},
  }, inputs: { format: 'mp4', patch_size: 3 },
  sidecar: { schema_version: 1, kind: 'mere.run/workflow-editor',
    viewport: { x: 60, y: 40, zoom: 0.85 }, nodes: { controls: { x: 300, y: 200 }, choice: { x: 740, y: 200 } } },
};
