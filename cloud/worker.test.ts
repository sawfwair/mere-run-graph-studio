import { env as testEnv } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

import { handleRequest } from './worker';
import type { Env } from './types';
import { recordValue } from './decode';

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

function fetchWorker(url: string, init?: RequestInit): Promise<Response> {
  return handleRequest(new Request(url, init), environment());
}

describe('cloud worker security boundary', () => {
  it('exposes only the token snapshot and honors revocation without authentication', async () => {
    const env = environment();
    const id = env.STUDIO_ACCOUNTS.idFromName(`share-${crypto.randomUUID()}`);
    const account = env.STUDIO_ACCOUNTS.get(id);
    await account.fetch(new Request('https://account/project', { method: 'PUT', body: JSON.stringify({
      path: 'public-app', graph: { schema_version: 1, kind: 'mere.run/workflow-graph', name: 'Public app',
        inputs: {}, nodes: [], outputs: { result: { $ref: 'nodes.render.outputs.image' } } }, inputs: {},
      sidecar: { schema_version: 1, kind: 'mere.run/workflow-editor', viewport: { x: 42, y: 11, zoom: 1 },
        nodes: { render: { x: 20, y: 20 } }, notes: { private: { text: 'private note' } }, board: [], app: { title: 'Shared' } },
    }) }));
    const publication = await account.fetch(new Request('https://account/app-version', {
      method: 'POST', body: JSON.stringify({ path: 'public-app' }),
    }));
    const version = recordValue(await publication.json(), 'version');
    if (typeof version.token !== 'string') throw new Error('Missing share token');
    const path = `https://studio.mere.run/api/shared-app/${id.toString()}/${version.token}`;
    const response = await fetchWorker(path);
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    const snapshot = recordValue(await response.json(), 'snapshot');
    expect(snapshot.sidecar).toEqual({ schema_version: 1, kind: 'mere.run/workflow-editor',
      viewport: { x: 0, y: 0, zoom: 1 }, nodes: {}, app: { title: 'Shared' } });
    expect((await fetchWorker(path, { method: 'POST' })).status).toBe(401);
    await account.fetch(new Request(`https://account/app-version?token=${version.token}`, { method: 'DELETE' }));
    expect((await fetchWorker(path)).status).toBe(404);
  });

  it('starts PKCE auth with a safe return path and transient cookies', async () => {
    const response = await fetchWorker('https://studio.mere.run/auth/start?return_to=%2F%2Fevil.example', {
      redirect: 'manual',
    });
    expect(response.status).toBe(302);
    const location = new URL(response.headers.get('Location') ?? '');
    expect(location.origin).toBe('https://mere.world');
    expect(location.pathname).toBe('/oauth/authorize');
    expect(location.searchParams.get('code_challenge_method')).toBe('S256');
    expect(response.headers.get('Set-Cookie')).toContain('mere_studio_oauth_state=');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('rejects invalid callbacks, missing refresh state, and anonymous sessions', async () => {
    const callback = await fetchWorker('https://studio.mere.run/auth/callback?state=wrong', { redirect: 'manual' });
    expect(callback.status).toBe(302);
    expect(callback.headers.get('Location')).toBe('https://studio.mere.run/?auth_error=invalid_response');

    const refresh = await fetchWorker('https://studio.mere.run/auth/refresh', { method: 'POST' });
    expect(refresh.status).toBe(401);
    expect(await refresh.json()).toEqual({ authenticated: false });

    const session = await fetchWorker('https://studio.mere.run/auth/session');
    expect(session.status).toBe(401);
    expect(session.headers.get('Cache-Control')).toBe('no-store');
  });

  it('blocks anonymous API access and clears both session cookies on logout', async () => {
    const api = await fetchWorker('https://studio.mere.run/api/studio/projects');
    expect(api.status).toBe(401);
    expect(await api.json()).toEqual({ error: 'Unauthorized' });

    const logout = await fetchWorker('https://studio.mere.run/auth/logout', { redirect: 'manual' });
    expect(logout.status).toBe(302);
    expect(logout.headers.get('Location')).toBe('https://studio.mere.run/');
    const cookies = logout.headers.get('Set-Cookie') ?? '';
    expect(cookies).toContain('mere_studio_access=');
    expect(cookies).toContain('mere_studio_refresh=');
  });
});
