import { describe, expect, it } from 'vitest';

import compatibility from '../../contracts/fixtures/graph-v1/graph-compatibility.v1.json';
import assets from '../../contracts/fixtures/graph-v1/parallel-image-video.assets.json';
import graph from '../../contracts/fixtures/graph-v1/parallel-image-video.workflow.json';
import inputs from '../../contracts/fixtures/graph-v1/parallel-image-video.inputs.json';
import materialAssets from '../../contracts/fixtures/graph-v1/creative-materials.assets.json';
import materialGraph from '../../contracts/fixtures/graph-v1/creative-materials.workflow.json';
import materialInputs from '../../contracts/fixtures/graph-v1/creative-materials.inputs.json';
import { buildGraphSubmission, canonicalJson, sha256Canonical } from './cloud-contract';
import type { WorkflowGraph } from './types';

describe('cloud graph contract', () => {
  it('matches the cross-runtime canonical fingerprints', async () => {
    expect(await sha256Canonical(graph)).toBe(compatibility.canonical_fixture.graph_fingerprint);
    expect(await sha256Canonical({ inputs, assets })).toBe(compatibility.canonical_fixture.input_fingerprint);
    expect(await sha256Canonical(materialGraph)).toBe(compatibility.material_fixture.graph_fingerprint);
    expect(await sha256Canonical({ inputs: materialInputs, assets: materialAssets })).toBe(compatibility.material_fixture.input_fingerprint);
    expect(canonicalJson({ z: 'é', a: 1 })).toBe('{"a":1,"z":"\\u00e9"}');
  });

  it('materializes an immutable Relay submission from the live Node catalog', async () => {
    const fixture: WorkflowGraph = {
      schema_version: 1,
      kind: 'mere.run/workflow-graph',
      name: 'Cloud image',
      inputs: { prompt: { type: 'string', required: true } },
      nodes: [{
        id: 'generate',
        kind: 'image.generate',
        arguments: { prompt: { $ref: 'inputs.prompt' } },
      }],
      outputs: { image: { $ref: 'nodes.generate.outputs.image' } },
    };
    const submission = await buildGraphSubmission(fixture, { prompt: 'A lighthouse at dawn' }, {
      worker_version: '0.23.0',
      accelerator_backend: 'metal',
      installed_model_ids: [],
      available_secret_names: [],
      providers: [],
      catalog: {
        nodes: [{
          kind: 'image.generate',
          title: 'Generate image',
          provider: { id: 'mere.run', version: '0.23.0' },
          inputs: [
            { name: 'prompt', type: 'string', required: true },
            { name: 'seed', type: 'integer', required: false },
            { name: 'steps', type: 'integer', required: false, default: 20 },
          ],
          outputs: [{ name: 'image', type: 'asset' }],
          requirements: { accelerator_backends: ['metal', 'cuda'], model_ids: [] },
        }],
      },
    });
    expect(submission.job.contract_version).toBe('mere.run/job-bundle.v1');
    expect(submission.job.requirements).toMatchObject({
      minimum_mere_run_version: '0.23.0',
      node_kinds: ['image.generate'],
      accelerator_backends: ['cuda', 'metal'],
    });
    expect(submission.graph.nodes[0].arguments.seed).toEqual(expect.any(Number));
    expect(submission.graph.nodes[0].arguments.steps).toBe(20);
    expect(submission.job.graph_fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(submission.job.source_graph_fingerprint).toBe(await sha256Canonical(fixture));
    expect(submission.job.source_input_fingerprint).toBe(await sha256Canonical({ prompt: 'A lighthouse at dawn' }));
  });
});
