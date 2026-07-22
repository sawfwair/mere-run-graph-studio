import { describe, expect, it } from 'vitest';

import {
  buildModelVariants,
  candidateModels,
  executorsWithModel,
  missingModels,
  modelFieldFor,
  parseInstalledModels,
  parseInstalledModelsByExecutor,
  referencedModels,
} from './models';
import { createGraph } from './graph';
import type { CatalogEntry, JsonValue, WorkflowGraph } from './types';

const imageEntry: CatalogEntry = {
  kind: 'image.generate', title: 'Generate image', category: 'image',
  inputs: [{ name: 'prompt', type: 'string', required: true }, { name: 'model', type: 'string' }],
  outputs: [{ name: 'image', type: 'asset' }],
};
const knockoutEntry: CatalogEntry = {
  kind: 'image.knockout', title: 'Knockout', category: 'image',
  inputs: [{ name: 'input', type: 'asset' }], outputs: [{ name: 'image', type: 'asset' }],
};

describe('model field detection', () => {
  it('finds a string model field and ignores nodes without one', () => {
    expect(modelFieldFor(imageEntry)).toBe('model');
    expect(modelFieldFor(knockoutEntry)).toBeNull();
    expect(modelFieldFor(undefined)).toBeNull();
  });
});

describe('installed-model discovery', () => {
  it('pulls model ids from nested probe shapes wherever they appear', () => {
    const document: JsonValue = {
      executors: [
        { id: 'local', capabilities: { graphWorker: { installed_model_ids: ['image-krea2-raw', 'video-ltx-av'] } } },
        { id: 'relay:fleet', runtime: { models: [{ id: 'image-zimage-nano' }, { id: 'image-krea2-raw' }] } },
      ],
    };
    expect(parseInstalledModels(document).sort()).toEqual(['image-krea2-raw', 'image-zimage-nano', 'video-ltx-av']);
    expect(parseInstalledModels(undefined)).toEqual([]);
  });
});

describe('candidate models', () => {
  it('offers the current value then category-matched installed models, deduped', () => {
    const installed = ['image-zimage-nano', 'video-ltx-av', 'image-krea2-raw'];
    const candidates = candidateModels(imageEntry, 'image-krea2-turbo', installed);
    expect(candidates[0]).toBe('image-krea2-turbo');
    // a video model is filtered out for an image node
    expect(candidates).not.toContain('video-ltx-av');
    expect(candidates).toContain('image-zimage-nano');
    expect(candidates).toContain('image-krea2-raw');
    expect(new Set(candidates).size).toBe(candidates.length);
  });

  it('never invents uninstalled models — with nothing installed it offers only the set value', () => {
    expect(candidateModels(imageEntry, 'image-krea2-raw', [])).toEqual(['image-krea2-raw']);
    expect(candidateModels(imageEntry, undefined, [])).toEqual([]);
    // every offered model came from the installed set (plus the current value)
    const installed = ['image-zimage-nano'];
    expect(candidateModels(imageEntry, undefined, installed)).toEqual(['image-zimage-nano']);
  });
});

describe('missing-model detection for portable graphs', () => {
  const graph: WorkflowGraph = {
    ...createGraph(),
    nodes: [
      { id: 'render', kind: 'image.generate', arguments: { model: 'image-hidream-o1', prompt: 'x' } },
      { id: 'wired', kind: 'image.generate', arguments: { model: { $ref: 'inputs.m' }, prompt: 'y' } },
      { id: 'default', kind: 'image.generate', arguments: { prompt: 'z' } },
    ],
  };

  it('lists only constant model references, skipping wired and default models', () => {
    expect(referencedModels(graph)).toEqual([{ nodeId: 'render', model: 'image-hidream-o1' }]);
  });

  it('flags a referenced model that the target has not installed', () => {
    expect(missingModels(graph, ['image-krea2-raw'])).toEqual(['image-hidream-o1']);
    expect(missingModels(graph, ['image-hidream-o1'])).toEqual([]);
  });

  it('maps installed models per executor and finds who can run a model', () => {
    const document: JsonValue = {
      executors: [
        { reference: 'local', capabilities: { graph_worker: { installed_model_ids: ['image-krea2-raw'] } } },
        { reference: 'relay:fleet', capabilities: { graph_worker: { installed_model_ids: ['image-hidream-o1', 'image-krea2-raw'] } } },
      ],
    };
    const byExecutor = parseInstalledModelsByExecutor(document);
    expect(byExecutor['local']).toEqual(['image-krea2-raw']);
    expect(byExecutor['relay:fleet']).toContain('image-hidream-o1');
    expect(executorsWithModel(byExecutor, 'image-hidream-o1')).toEqual(['relay:fleet']);
  });
});

describe('model race variants', () => {
  it('builds one graph per model without mutating the source', () => {
    const graph: WorkflowGraph = { ...createGraph(), nodes: [{ id: 'render', kind: 'image.generate', arguments: { model: 'image-krea2-raw', prompt: 'x' } }] };
    const variants = buildModelVariants(graph, 'render', ['image-zimage-nano', 'image-klein-max']);
    expect(variants.map((variant) => variant.model)).toEqual(['image-zimage-nano', 'image-klein-max']);
    expect(variants[0].graph.nodes[0].arguments.model).toBe('image-zimage-nano');
    expect(variants[0].graph.nodes[0].arguments.prompt).toBe('x');
    expect(graph.nodes[0].arguments.model).toBe('image-krea2-raw');
  });
});
