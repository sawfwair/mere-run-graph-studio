import { afterEach, describe, expect, it, vi } from 'vitest';
import { CloudRuntime } from './cloud-runtime';

const manifest = { nodes: [{ id: 'image', state: 'finished', outputs: [{ name: 'text', value: 'Finished upstream' }] }] };
afterEach(() => vi.unstubAllGlobals());

describe('hosted partial run inspection', () => {
  it.each(['running', 'failed', 'cancelled', 'finished'])('reads available output manifests for a %s run', async (state) => {
    const requests: string[] = [];
    vi.stubGlobal('fetch', async (input: string) => {
      requests.push(input);
      if (input.endsWith('/run-manifest')) return Response.json(manifest);
      if (input.endsWith('/events')) return new Response(JSON.stringify({ sequence: 1, type: 'node_progress', node_id: 'video', state: 'running', progress: { phase: 'encoding', fraction: 0.5 } }) + '\n');
      return Response.json({ job_id: 'job', state });
    });
    const run = await new CloudRuntime().inspectRun('job');
    expect(run.manifest).toEqual(manifest);
    expect(run.events?.[0].progress).toEqual({ phase: 'encoding', fraction: 0.5 });
    expect(requests).toContain('/api/relay/api/graph-jobs/job/run-manifest');
  });
  it('keeps live events when the worker has not uploaded a manifest yet', async () => {
    vi.stubGlobal('fetch', async (input: string) => {
      if (input.endsWith('/run-manifest')) return Response.json({ error: 'Run manifest not found' }, { status: 404 });
      if (input.endsWith('/events')) return new Response(JSON.stringify({ sequence: 1, type: 'node_started', node_id: 'image', state: 'running' }) + '\n');
      return Response.json({ job_id: 'job', state: 'running' });
    });
    const run = await new CloudRuntime().inspectRun('job');
    expect(run.manifest).toBeUndefined();
    expect(run.events?.[0].node_id).toBe('image');
  });
});
