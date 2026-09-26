import { afterEach, describe, expect, it, vi } from 'vitest';
import { CloudRuntime } from './cloud-runtime';
import { sha256Canonical } from './cloud-contract';
import { parseJsonValue, recordValue } from './decode';
import type { WorkflowGraph } from './types';

const jobId = '00000000-0000-4000-8000-000000000001';
const sourceId = '00000000-0000-4000-8000-000000000002';
const workflow: WorkflowGraph = {
  schema_version: 1, kind: 'mere.run/workflow-graph', name: 'Refine',
  inputs: { source: { type: 'asset', required: true } },
  nodes: [{ id: 'crop', kind: 'image.crop', provider: 'mere-image-compose', arguments: { source: { $ref: 'inputs.source' } } }],
  outputs: { image: { $ref: 'nodes.crop.outputs.image' } },
};
const capabilities = {
  worker_version: '0.50.0', accelerator_backend: 'cpu', installed_model_ids: [],
  providers: [{ id: 'mere-image-compose', version: '0.4.0', catalog_sha256: 'a'.repeat(64), node_kinds: ['image.crop'] }],
  catalog: { nodes: [{ kind: 'image.crop', title: 'Crop image',
    provider: { id: 'mere-image-compose', version: '0.4.0' },
    inputs: [{ name: 'source', type: 'asset', required: true }], outputs: [{ name: 'image', type: 'asset' }] }] },
};

afterEach(() => vi.unstubAllGlobals());

describe('hosted result reuse', () => {
  it('uploads the declared content hash before committing the job', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
      (byte) => byte.toString(16).padStart(2, '0')).join('');
    const calls: Array<{ path: string; init?: RequestInit }> = [];
    vi.stubGlobal('window', { location: { origin: 'https://studio.mere.run' } });
    vi.stubGlobal('fetch', vi.fn(async (raw: string, init?: RequestInit) => {
      calls.push({ path: raw, init });
      if (raw.endsWith('/capabilities')) return Response.json(capabilities);
      if (raw.endsWith('/artifacts/image.png')) return new Response(bytes, { headers: { 'Content-Type': 'image/png' } });
      if (raw.endsWith(`/assets/${digest}`)) return Response.json({ uploaded: true });
      if (raw.endsWith('/commit')) return Response.json({ job_id: jobId, state: 'queued' });
      return Response.json({ job_id: jobId, state: 'planned', missing_asset_digests: [digest] });
    }));
    const inputs = { source: `run-artifact://${sourceId}/image.png` };
    const run = await new CloudRuntime().startRun(workflow, inputs, 'relay:fleet');
    expect(run.state).toBe('queued');
    const creation = calls.find((call) => call.path === '/api/relay/api/graph-jobs');
    const rawBody = creation?.init?.body;
    if (typeof rawBody !== 'string') throw new Error('Expected JSON submission body');
    const body = recordValue(parseJsonValue(rawBody), 'submission');
    expect(body.inputs).toEqual({ source: 'asset://source' });
    expect(body.assets).toMatchObject({ groups: [{ entries: [{ digest, size_bytes: 4, content_type: 'image/png' }] }] });
    expect(recordValue(body.job).source_input_fingerprint).toBe(await sha256Canonical(inputs));
    const upload = calls.findIndex((call) => call.path.endsWith(`/assets/${digest}`));
    const commit = calls.findIndex((call) => call.path.endsWith('/commit'));
    expect(upload).toBeGreaterThan(-1);
    expect(commit).toBeGreaterThan(upload);
    expect(calls[upload].init?.body).toBeInstanceOf(Blob);
  });

  it('rejects browser filesystem paths before creating a job', async () => {
    vi.stubGlobal('fetch', vi.fn());
    await expect(new CloudRuntime().startRun(workflow, { source: '/private/file.png' }, 'relay:fleet'))
      .rejects.toThrow('Hosted input must reference');
    expect(fetch).not.toHaveBeenCalled();
  });
});
