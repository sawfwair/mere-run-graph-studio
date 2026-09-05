import { sha256Canonical } from '../src/cloud-contract';
import type { StudioDocument, StudioRun } from '../src/types';

// Development-only data for reviewing connected values, ports, and result previews.
export const NODE_FIXTURE: StudioDocument = {
  graph: {
    schema_version: 1, kind: 'mere.run/workflow-graph', name: 'Node design examples',
    inputs: { motion: { type: 'string', required: true, description: 'Camera movement for the video.' } },
    nodes: [
      { id: 'description', kind: 'text.value', arguments: { value: 'A coastal observatory in soft morning light.' } },
      { id: 'render', kind: 'image.generate', arguments: { prompt: { $ref: 'nodes.description.outputs.text' }, model: 'image-example', seed: 42 } },
      { id: 'animate', kind: 'video.generate', arguments: { prompt: { $ref: 'inputs.motion' }, image: { $ref: 'nodes.render.outputs.image' } } },
    ],
    outputs: { video: { $ref: 'nodes.animate.outputs.video' } },
  },
  inputs: { motion: 'Move slowly toward the observatory.' },
  sidecar: {
    schema_version: 1, kind: 'mere.run/workflow-editor',
    viewport: { x: 80, y: 120, zoom: 0.88 },
    nodes: { description: { x: 0, y: 200 }, render: { x: 420, y: 210 }, animate: { x: 840, y: 210 } },
    inputs: { motion: { x: 480, y: 0 } }, outputs: { video: { x: 1220, y: 285 } },
  },
};

export async function nodeFixtureRun(): Promise<StudioRun> {
  return {
    id: 'example-run', executor: 'relay:fleet', run_directory: 'examples/run',
    state: 'finished', created_at: '2026-09-04T12:00:00Z', updated_at: '2026-09-04T12:00:00Z',
    exit_code: 0, result: null, stderr: '', remote_reference: null,
    manifest: {
      source_graph_fingerprint: await sha256Canonical(NODE_FIXTURE.graph),
      source_input_fingerprint: await sha256Canonical(NODE_FIXTURE.inputs),
      nodes: [{ id: 'description', state: 'finished', outputs: [{ name: 'text', value: 'A coastal observatory in soft morning light.' }] }],
    },
  };
}
