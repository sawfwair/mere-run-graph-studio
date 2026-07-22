import { env as testEnv } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

import { handleRequest } from './worker';
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

function fetchWorker(url: string, init?: RequestInit): Promise<Response> {
  return handleRequest(new Request(url, init), environment());
}

describe('cloud worker security boundary', () => {
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
