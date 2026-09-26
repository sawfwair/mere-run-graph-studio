import { env as testEnv } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

import type { Env } from './types';

function isEnv(value: unknown): value is Env {
  return value !== null && typeof value === 'object'
    && 'STUDIO_ACCOUNTS' in value
    && 'ASSETS' in value
    && 'BROKER_ORIGIN' in value
    && 'RELAY_ORIGIN' in value
    && 'STUDIO_ORIGIN' in value;
}

function environment(): Env {
  if (!isEnv(testEnv)) throw new Error('Cloudflare test environment is missing Studio bindings');
  return testEnv;
}

function project(path = 'workflows/cloud-image'): {
  path: string;
  graph: { schema_version: number; kind: string; name: string; inputs: object; nodes: unknown[]; outputs: object };
  inputs: object;
  sidecar: { schema_version: number; kind: string; viewport: { x: number; y: number; zoom: number }; nodes: object };
} {
  return {
    path,
    graph: {
      schema_version: 1,
      kind: 'mere.run/workflow-graph',
      name: 'Cloud image',
      inputs: {},
      nodes: [],
      outputs: {},
    },
    inputs: {},
    sidecar: {
      schema_version: 1,
      kind: 'mere.run/workflow-editor',
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: {},
    },
  };
}

describe('StudioAccount', () => {
  it('publishes immutable app versions and revokes only the selected version', async () => {
    const env = environment();
    const account = env.STUDIO_ACCOUNTS.get(env.STUDIO_ACCOUNTS.idFromName(`account-${crypto.randomUUID()}`));
    const draft = project();
    draft.graph.outputs = { image: { $ref: 'nodes.render.image' } };
    draft.sidecar = { ...draft.sidecar, app: { title: 'My app' } } as typeof draft.sidecar;
    expect((await account.fetch(new Request('https://account/project', {
      method: 'PUT', body: JSON.stringify(draft),
    }))).status).toBe(200);
    const first = await account.fetch(new Request('https://account/app-version', {
      method: 'POST', body: JSON.stringify({ path: draft.path }),
    }));
    expect(first.status).toBe(201);
    const version = await first.json() as { token: string };
    const changed = project();
    changed.graph.name = 'Changed';
    changed.graph.outputs = draft.graph.outputs;
    expect((await account.fetch(new Request('https://account/project', {
      method: 'PUT', body: JSON.stringify(changed),
    }))).status).toBe(200);
    const shared = await account.fetch(new Request(`https://account/shared-app?token=${version.token}`));
    expect(shared.status).toBe(200);
    expect(await shared.json()).toMatchObject({ graph: { name: 'Cloud image' }, sidecar: { app: { title: 'My app' } } });
    expect((await account.fetch(new Request(`https://account/app-versions?path=${draft.path}`))).status).toBe(200);
    const revoked = await account.fetch(new Request(`https://account/app-version?token=${version.token}`, { method: 'DELETE' }));
    expect(revoked.status).toBe(204);
    expect((await account.fetch(new Request(`https://account/shared-app?token=${version.token}`))).status).toBe(404);
    expect(await (await account.fetch(new Request(`https://account/app-versions?path=${draft.path}`))).json()).toEqual({ versions: [] });
  });

  it('rejects invalid or unpublishable app requests', async () => {
    const env = environment();
    const account = env.STUDIO_ACCOUNTS.get(env.STUDIO_ACCOUNTS.idFromName(`account-${crypto.randomUUID()}`));
    const post = (body: string) => account.fetch(new Request('https://account/app-version', { method: 'POST', body }));
    expect((await post('bad json')).status).toBe(400);
    expect((await post(JSON.stringify({ path: '../bad' }))).status).toBe(400);
    expect((await post(JSON.stringify({ path: 'missing' }))).status).toBe(404);
    const draft = project();
    await account.fetch(new Request('https://account/project', { method: 'PUT', body: JSON.stringify(draft) }));
    expect((await post(JSON.stringify({ path: draft.path }))).status).toBe(400);
    expect((await account.fetch(new Request('https://account/shared-app?token=bad'))).status).toBe(400);
    expect((await account.fetch(new Request('https://account/app-versions?path=../bad'))).status).toBe(400);
    expect((await account.fetch(new Request('https://account/app-version?token=bad', { method: 'DELETE' }))).status).toBe(400);
  });

  it('deletes account projects without exposing another path', async () => {
    const env = environment();
    const account = env.STUDIO_ACCOUNTS.get(env.STUDIO_ACCOUNTS.idFromName(`account-${crypto.randomUUID()}`));
    await account.fetch(new Request('https://account/project', { method: 'PUT', body: JSON.stringify(project()) }));
    expect((await account.fetch(new Request('https://account/project?path=../bad', { method: 'DELETE' }))).status).toBe(400);
    expect((await account.fetch(new Request('https://account/project?path=../bad'))).status).toBe(400);
    expect((await account.fetch(new Request('https://account/project?path=workflows/cloud-image', { method: 'DELETE' }))).status).toBe(204);
    expect((await account.fetch(new Request('https://account/project?path=workflows/cloud-image'))).status).toBe(404);
  });

  it('round-trips account-scoped project documents and summaries', async () => {
    const env = environment();
    const account = env.STUDIO_ACCOUNTS.get(env.STUDIO_ACCOUNTS.idFromName(`account-${crypto.randomUUID()}`));
    const saved = await account.fetch(new Request('https://account/project', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(project()),
    }));
    expect(saved.status).toBe(200);
    const loaded = await account.fetch(new Request('https://account/project?path=workflows%2Fcloud-image'));
    expect(await loaded.json()).toMatchObject({
      path: 'workflows/cloud-image',
      graph: { name: 'Cloud image' },
      inputs: {},
      sidecar: { kind: 'mere.run/workflow-editor' },
    });
    const listed = await account.fetch(new Request('https://account/projects'));
    expect(await listed.json()).toMatchObject({
      projects: [{ path: 'workflows/cloud-image', name: 'Cloud image' }],
    });
  });

  it('rejects traversal and embedded credential values', async () => {
    const env = environment();
    const account = env.STUDIO_ACCOUNTS.get(env.STUDIO_ACCOUNTS.idFromName(`account-${crypto.randomUUID()}`));
    const traversal = await account.fetch(new Request('https://account/project', {
      method: 'PUT',
      body: JSON.stringify(project('../outside')),
    }));
    expect(traversal.status).toBe(400);
    const credential = project();
    credential.graph.nodes.push({ id: 'unsafe', arguments: { api_key: 'plaintext' } });
    const rejected = await account.fetch(new Request('https://account/project', {
      method: 'PUT',
      body: JSON.stringify(credential),
    }));
    expect(rejected.status).toBe(400);
    const rejectedBody: unknown = await rejected.json();
    if (!rejectedBody || typeof rejectedBody !== 'object' || !('error' in rejectedBody)) {
      throw new Error('Expected an error response body');
    }
    expect(rejectedBody.error).toContain('credential values');
  });
});
