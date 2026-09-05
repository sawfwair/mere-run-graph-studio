import { describe, expect, it } from 'vitest';
import { captureRunSource, elapsedLabel, mergeRunUpdate, nodeExecution } from './canvas-execution';
import { decodeRunEvent } from './decode';
import { nodePreviews } from './run-preview';
import type { StudioRun, WorkflowGraph } from './types';

const base: StudioRun = { id: 'run', executor: 'local', state: 'running', created_at: '2026-09-05T12:00:00Z', updated_at: '2026-09-05T12:00:10Z', exit_code: null, run_directory: '', remote_reference: null, result: null, stderr: '' };
const completed = { id: 'image', state: 'finished', started_at: base.created_at, completed_at: base.updated_at, outputs: [{ name: 'image', path: 'image.png', content_type: 'image/png', sha256: 'abc' }] };

describe('canvas execution', () => {
  it('decodes public structured progress and displays only reported fractions', () => {
    const event = decodeRunEvent({ node_id: 'video', type: 'node_progress', state: 'running', progress: { phase: 'generating', current: 7, total: 20, unit: 'steps' } });
    const state = nodeExecution({ ...base, events: [event] }, ['video']).video;
    expect(state).toMatchObject({ state: 'running', phase: 'generating', fraction: 0.35, detail: '7 / 20 steps' });
    expect(nodeExecution({ ...base, events: [{ ...event, progress: { phase: 'loading_model' } }] }, ['video']).video.fraction).toBeUndefined();
    expect(nodeExecution({ ...base, events: [{ ...event, progress: { fraction: 2 } }] }, ['video']).video.fraction).toBeUndefined();
    expect(nodeExecution({ ...base, events: [{ ...event, progress: 50 }] }, ['video']).video.fraction).toBeUndefined();
  });
  it('keeps completed upstream outputs during execution and after downstream failure', () => {
    const running = { ...base, manifest: { nodes: [completed, { id: 'video', state: 'running', outputs: [] }] } };
    expect(nodePreviews(running).image.items).toHaveLength(1);
    const failed = { ...running, state: 'failed', manifest: { nodes: [completed, { id: 'video', state: 'failed', outputs: [] }] } };
    expect(nodePreviews(failed).image.items).toHaveLength(1);
    expect(nodeExecution(failed, ['image', 'video', 'later'])).toMatchObject({ image: { state: 'finished' }, video: { state: 'failed' }, later: { state: 'skipped' } });
  });
  it('does not let old progress overwrite a completed node, and clears progress for a new attempt', () => {
    const previous = { ...base, manifest: { nodes: [completed] }, events: [{ node_id: 'image', type: 'node_progress', state: 'running', created_at: base.created_at, progress: { fraction: 0.5 } }] };
    expect(nodeExecution(previous, ['image']).image.state).toBe('finished');
    expect(nodeExecution({ ...previous, manifest: { nodes: [{ id: 'image', state: 'finished' }] } }, ['image']).image.state).toBe('finished');
    const resumed = { ...previous, events: [...previous.events, { node_id: 'image', type: 'node_resumed', state: 'running', created_at: '2026-09-05T12:01:00Z' }] };
    expect(nodeExecution(resumed, ['image']).image).toEqual({ state: 'running', startedAt: '2026-09-05T12:01:00Z' });
  });
  it('retains observed manifests and events when a later response omits them', () => {
    const prior = { ...base, manifest: { nodes: [completed] }, events: [{ sequence: 1, type: 'node_finished', node_id: 'image', state: 'finished' }] };
    const merged = mergeRunUpdate(prior, { ...base, state: 'failed', events: [] });
    expect(nodePreviews(merged).image.items).toHaveLength(1);
    expect(merged.events).toHaveLength(1);
    expect(mergeRunUpdate(prior, { ...base, id: 'other' }).manifest).toBeUndefined();
  });
  it('uses event previews before completion and registered artifact names for hosted retrieval', () => {
    const events = [{ sequence: 1, type: 'preview_ready', state: 'running', node_id: 'image', artifact: { name: 'preview', path: 'nodes/image/preview.png', content_type: 'image/png' } }];
    expect(nodePreviews({ ...base, events }).image).toMatchObject({ intermediate: true, items: [{ artifact: { path: 'nodes/image/preview.png' } }] });
    const hosted = { ...base, remote_reference: 'job', manifest: { nodes: [completed] }, artifacts: [{ name: 'registered-image', kind: 'image', path: 'registered-image', sha256: 'abc' }] };
    expect(nodePreviews(hosted).image.items[0].artifact?.path).toBe('registered-image');
  });
  it('labels published intermediate media and prefers immutable hosted aliases', () => {
    const artifact = { name: '_live-image-abc', path: '.relay-publications/abc', kind: 'graph.preview', content_type: 'image/png', sha256: 'abc' };
    const preview = nodePreviews({ ...base, remote_reference: 'job', manifest: { nodes: [{ id: 'image', state: 'running', artifacts: [artifact] }] }, artifacts: [artifact] }).image;
    expect(preview.intermediate).toBe(true);
    expect(preview.items[0].outputName).toBe('Preview');
    expect(preview.items[0].artifact?.name).toBe('_live-image-abc');
  });
  it('captures submitted settings without copying secret references or later edits', async () => {
    const graph: WorkflowGraph = { schema_version: 1, kind: 'mere.run/workflow-graph', name: 'Test', inputs: { prompt: { type: 'string' } }, nodes: [{ id: 'image', kind: 'image.generate', arguments: { prompt: { $ref: 'inputs.prompt' }, model: 'image-test', seed: 7 } }, { id: 'secret', kind: 'text.generate', arguments: { prompt: { $secret: 'private-prompt' } } }], outputs: {} };
    const source = await captureRunSource(graph, { prompt: 'A lighthouse' });
    graph.nodes[0].arguments.seed = 42;
    expect(source.nodes.image).toEqual({ prompt: 'A lighthouse', model: 'image-test', seed: '7' });
    expect(source.nodes.secret.prompt).toBeUndefined();
    expect(source.graphJson).toContain('"seed":7');
  });
  it('stops elapsed time at completion and rejects invalid timestamps', () => {
    expect(elapsedLabel(base.created_at, base.updated_at, Date.now())).toBe('10 s');
    expect(elapsedLabel('invalid', undefined, Date.now())).toBeNull();
    expect(elapsedLabel(base.created_at, undefined, Date.parse('2026-09-05T12:01:04Z'))).toBe('1 min 4 s');
  });
});
