import { StudioAccount } from './account';
import { authenticate, finishAuth, logout, refreshAuth, startAuth } from './auth';
import type { Env } from './types';

export { StudioAccount };

const RELAY_PATHS = [
  /^\/api\/graph-jobs(?:\/.*)?$/,
  /^\/api\/fleet$/,
  /^\/api\/fleet\/model-plans(?:\/.*)?$/,
  /^\/api\/status$/,
];

function noStore(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'no-store');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function secure(response: Response, env: Env): Response {
  const headers = new Headers(response.headers);
  headers.set('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "connect-src 'self'",
    "font-src 'self' data:",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "form-action 'self' https://mere.world",
  ].join('; '));
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  if (env.STUDIO_ORIGIN.startsWith('https://')) {
    headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

async function accountRequest(request: Request, env: Env, userId: string): Promise<Response> {
  const url = new URL(request.url);
  const suffix = url.pathname.slice('/api/studio'.length) || '/';
  const id = env.STUDIO_ACCOUNTS.idFromName(userId);
  return env.STUDIO_ACCOUNTS.get(id).fetch(new Request(`${url.origin}${suffix}${url.search}`, {
    method: request.method,
    headers: request.headers,
    body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
  }));
}

async function relayRequest(request: Request, env: Env, token: string): Promise<Response> {
  const source = new URL(request.url);
  const pathname = source.pathname.slice('/api/relay'.length);
  if (!RELAY_PATHS.some((pattern) => pattern.test(pathname))) return new Response('Not Found', { status: 404 });
  const target = new URL(`${pathname}${source.search}`, env.RELAY_ORIGIN);
  const headers = new Headers(request.headers);
  headers.delete('Cookie');
  headers.delete('Origin');
  headers.set('Authorization', `Bearer ${token}`);
  const response = await fetch(target, {
    method: request.method,
    headers,
    body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
    redirect: 'manual',
  });
  return noStore(response);
}

async function authRoute(request: Request, env: Env, url: URL): Promise<Response | null> {
  if (url.pathname === '/auth/start' && request.method === 'GET') return startAuth(request, env);
  if (url.pathname === '/auth/callback' && request.method === 'GET') return finishAuth(request, env);
  if (url.pathname === '/auth/refresh' && request.method === 'POST') return refreshAuth(request, env);
  if (url.pathname === '/auth/logout') return logout(request, env);
  return null;
}

async function apiRoute(request: Request, env: Env, url: URL): Promise<Response> {
  const session = await authenticate(request, env);
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  if (!['GET', 'HEAD'].includes(request.method) && request.headers.get('Origin') !== env.STUDIO_ORIGIN) {
    return Response.json({ error: 'Cross-origin session mutation denied' }, { status: 403 });
  }
  if (url.pathname.startsWith('/api/studio/')) return accountRequest(request, env, session.identity.user_id);
  if (url.pathname.startsWith('/api/relay/')) return relayRequest(request, env, session.token);
  return new Response('Not Found', { status: 404 });
}

export async function handleRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const authResponse = await authRoute(request, env, url);
  if (authResponse) return authResponse;
  if (url.pathname.startsWith('/api/')) return apiRoute(request, env, url);
  const session = await authenticate(request, env);
  if (url.pathname === '/auth/session' && request.method === 'GET') {
    return session
      ? Response.json({ authenticated: true, user: session.identity }, { headers: { 'Cache-Control': 'no-store' } })
      : Response.json({ authenticated: false }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
  }
  return secure(await env.ASSETS.fetch(request), env);
}

export default { fetch: handleRequest } satisfies ExportedHandler<Env>;
