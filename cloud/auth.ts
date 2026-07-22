import {
  createRemoteJWKSet,
  jwtVerify,
  type JWTVerifyGetKey,
} from 'jose';

import type { Env, Identity, TokenResponse } from './types';
import { decodeTokenResponse } from './decode';

const CLIENT_ID = 'mererun-studio';
const ACCESS_COOKIE = 'mere_studio_access';
const REFRESH_COOKIE = 'mere_studio_refresh';
const STATE_COOKIE = 'mere_studio_oauth_state';
const VERIFIER_COOKIE = 'mere_studio_oauth_verifier';
const RETURN_COOKIE = 'mere_studio_return_to';

let jwks: JWTVerifyGetKey | null = null;
let jwksOrigin: string | null = null;

function getJwks(origin: string): JWTVerifyGetKey {
  if (!jwks || jwksOrigin !== origin) {
    jwks = createRemoteJWKSet(new URL('/.well-known/jwks.json', origin), {
      timeoutDuration: 15_000,
    });
    jwksOrigin = origin;
  }
  return jwks;
}

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function randomValue(bytes = 32): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(bytes)));
}

async function codeChallenge(verifier: string): Promise<string> {
  return base64Url(new Uint8Array(await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(verifier),
  )));
}

export function cookiesIn(request: Request): Map<string, string> {
  const cookies = new Map<string, string>();
  for (const item of (request.headers.get('Cookie') ?? '').split(';')) {
    const [name, ...value] = item.trim().split('=');
    if (name) cookies.set(name, decodeURIComponent(value.join('=')));
  }
  return cookies;
}

function cookie(name: string, value: string, url: URL, maxAge: number, path = '/'): string {
  return [
    `${name}=${encodeURIComponent(value)}`,
    `Path=${path}`,
    `Max-Age=${maxAge}`,
    'HttpOnly',
    'SameSite=Lax',
    url.protocol === 'https:' ? 'Secure' : '',
  ].filter(Boolean).join('; ');
}

function safeReturnPath(value: string | undefined | null): string {
  return value?.startsWith('/') && !value.startsWith('//') ? value : '/app';
}

function callbackUrl(env: Env): string {
  return `${env.STUDIO_ORIGIN}/auth/callback`;
}

async function exchangeToken(env: Env, body: URLSearchParams): Promise<TokenResponse> {
  const response = await fetch(new URL('/oauth/token', env.BROKER_ORIGIN), {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
      Origin: env.BROKER_ORIGIN,
    },
    body,
  });
  try {
    const value: unknown = await response.json();
    return decodeTokenResponse(value);
  } catch {
    return { error: 'invalid_response', error_description: 'mere.world returned an invalid token response.' };
  }
}

function appendSessionCookies(headers: Headers, url: URL, tokens: TokenResponse, previousRefresh?: string): void {
  const accessToken = tokens.access_token ?? tokens.id_token;
  if (!accessToken) return;
  headers.append('Set-Cookie', cookie(
    ACCESS_COOKIE,
    accessToken,
    url,
    Math.max(60, Math.min(86_400, Math.round(tokens.expires_in ?? 900))),
  ));
  const refreshToken = tokens.refresh_token ?? previousRefresh;
  if (refreshToken) headers.append('Set-Cookie', cookie(REFRESH_COOKIE, refreshToken, url, 30 * 24 * 60 * 60));
}

export async function verifyAccessToken(token: string, env: Env): Promise<Identity | null> {
  try {
    const { payload } = await jwtVerify(token, getJwks(env.BROKER_ORIGIN), { issuer: env.BROKER_ORIGIN });
    if (typeof payload.sub !== 'string' || !payload.sub) return null;
    return {
      user_id: payload.sub,
      email: typeof payload.email === 'string' ? payload.email : undefined,
      name: typeof payload.name === 'string' ? payload.name : undefined,
    };
  } catch {
    return null;
  }
}

export async function authenticate(request: Request, env: Env): Promise<{ identity: Identity; token: string } | null> {
  const token = cookiesIn(request).get(ACCESS_COOKIE);
  if (!token) return null;
  const identity = await verifyAccessToken(token, env);
  return identity ? { identity, token } : null;
}

export async function startAuth(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const state = randomValue();
  const verifier = randomValue(48);
  const authorize = new URL('/oauth/authorize', env.BROKER_ORIGIN);
  authorize.searchParams.set('response_type', 'code');
  authorize.searchParams.set('client_id', CLIENT_ID);
  authorize.searchParams.set('redirect_uri', callbackUrl(env));
  authorize.searchParams.set('scope', 'openid profile email offline_access');
  authorize.searchParams.set('state', state);
  authorize.searchParams.set('code_challenge', await codeChallenge(verifier));
  authorize.searchParams.set('code_challenge_method', 'S256');
  const headers = new Headers({ Location: authorize.toString(), 'Cache-Control': 'no-store' });
  headers.append('Set-Cookie', cookie(STATE_COOKIE, state, url, 600, '/auth'));
  headers.append('Set-Cookie', cookie(VERIFIER_COOKIE, verifier, url, 600, '/auth'));
  headers.append('Set-Cookie', cookie(RETURN_COOKIE, safeReturnPath(url.searchParams.get('return_to')), url, 600, '/auth'));
  return new Response(null, { status: 302, headers });
}

export async function finishAuth(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const cookies = cookiesIn(request);
  const code = url.searchParams.get('code');
  const verifier = cookies.get(VERIFIER_COOKIE);
  if (!code || !verifier || url.searchParams.get('state') !== cookies.get(STATE_COOKIE)) {
    return Response.redirect(new URL('/?auth_error=invalid_response', env.STUDIO_ORIGIN).toString(), 302);
  }
  const tokens = await exchangeToken(env, new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: CLIENT_ID,
    code,
    redirect_uri: callbackUrl(env),
    code_verifier: verifier,
  }));
  const accessToken = tokens.access_token ?? tokens.id_token;
  if (!accessToken || !(await verifyAccessToken(accessToken, env))) {
    return Response.redirect(new URL('/?auth_error=invalid_token', env.STUDIO_ORIGIN).toString(), 302);
  }
  const headers = new Headers({
    Location: new URL(safeReturnPath(cookies.get(RETURN_COOKIE)), env.STUDIO_ORIGIN).toString(),
    'Cache-Control': 'no-store',
  });
  appendSessionCookies(headers, url, tokens);
  for (const name of [STATE_COOKIE, VERIFIER_COOKIE, RETURN_COOKIE]) {
    headers.append('Set-Cookie', cookie(name, '', url, 0, '/auth'));
  }
  return new Response(null, { status: 302, headers });
}

export async function refreshAuth(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const refreshToken = cookiesIn(request).get(REFRESH_COOKIE);
  if (!refreshToken) return Response.json({ authenticated: false }, { status: 401 });
  const tokens = await exchangeToken(env, new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: CLIENT_ID,
    refresh_token: refreshToken,
  }));
  const accessToken = tokens.access_token ?? tokens.id_token;
  const identity = accessToken ? await verifyAccessToken(accessToken, env) : null;
  if (!accessToken || !identity) return Response.json({ authenticated: false }, { status: 401 });
  const headers = new Headers({ 'Cache-Control': 'no-store' });
  appendSessionCookies(headers, url, tokens, refreshToken);
  return Response.json({ authenticated: true, user: identity }, { headers });
}

export function logout(request: Request, env: Env): Response {
  const url = new URL(request.url);
  const headers = new Headers({ Location: new URL('/', env.STUDIO_ORIGIN).toString(), 'Cache-Control': 'no-store' });
  headers.append('Set-Cookie', cookie(ACCESS_COOKIE, '', url, 0));
  headers.append('Set-Cookie', cookie(REFRESH_COOKIE, '', url, 0));
  return new Response(null, { status: 302, headers });
}
