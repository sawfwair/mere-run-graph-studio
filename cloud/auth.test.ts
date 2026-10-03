import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { env as testEnv } from 'cloudflare:test';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { verifyAccessToken } from './auth';
import type { Env } from './types';

const issuer = 'https://studio-auth.example.test';
let keys: Awaited<ReturnType<typeof generateKeyPair>>;
let jwk: Awaited<ReturnType<typeof exportJWK>>;
beforeAll(async () => { keys = await generateKeyPair('RS256', { extractable: true }); jwk = await exportJWK(keys.publicKey); });
afterEach(() => vi.unstubAllGlobals());
function isEnv(value: unknown): value is Env {
  return value !== null && typeof value === 'object' && 'STUDIO_ACCOUNTS' in value && 'ASSETS' in value && 'BROKER_ORIGIN' in value && 'RELAY_ORIGIN' in value && 'STUDIO_ORIGIN' in value;
}
function environment(): Env {
  if (!isEnv(testEnv)) throw new Error('Missing Studio bindings');
  return { ...testEnv, BROKER_ORIGIN: issuer, AUTH_INTERNAL_TOKEN: 'server-token' };
}
async function token(audience = 'mererun-studio'): Promise<string> {
  return new SignJWT({ email: 'owner@example.test' }).setProtectedHeader({ alg: 'RS256', kid: 'studio-test' }).setIssuer(issuer).setAudience(audience).setSubject('owner').setIssuedAt().setExpirationTime('15m').sign(keys.privateKey);
}
function broker() {
  let allowed = true;
  const fetcher = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input instanceof URL ? input.href : input);
    if (url.pathname === '/.well-known/jwks.json') return Response.json({ keys: [{ ...jwk, kid: 'studio-test', alg: 'RS256' }] });
    expect(url.pathname).toBe('/api/auth/app/admission');
    expect(JSON.parse(typeof init?.body === 'string' ? init.body : 'null')).toEqual({ userId: 'owner', clientId: 'mererun-studio', audienceOrigin: 'https://studio.mere.run' });
    return Response.json({ allowed });
  });
  vi.stubGlobal('fetch', fetcher);
  return { fetcher, revoke: () => { allowed = false; } };
}
describe('Studio current app admission', () => {
  it('rejects a previously admitted JWT immediately after the grant is revoked', async () => {
    const control = broker(); const jwt = await token();
    expect((await verifyAccessToken(jwt, environment()))?.user_id).toBe('owner');
    control.revoke(); expect(await verifyAccessToken(jwt, environment())).toBeNull();
  });
  it('rejects tokens issued for another app', async () => {
    broker(); expect(await verifyAccessToken(await token('mererun-ios'), environment())).toBeNull();
  });
  it('fails closed when the admission binding is missing or the broker is unavailable', async () => {
    const control = broker(); const jwt = await token(); const env = environment();
    delete env.AUTH_INTERNAL_TOKEN; expect(await verifyAccessToken(jwt, env)).toBeNull();
    control.fetcher.mockRejectedValueOnce(new Error('offline')); expect(await verifyAccessToken(jwt, environment())).toBeNull();
  });
});
