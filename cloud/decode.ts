import type { TokenResponse } from './types';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function recordValue(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${label} must be an object`);
  return value;
}

function optionalString(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new Error(`${label} must be a string`);
  return value;
}

function optionalNumber(value: unknown, label: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label} must be a finite number`);
  return value;
}

export function decodeTokenResponse(value: unknown): TokenResponse {
  const source = recordValue(value, 'Token response');
  return {
    access_token: optionalString(source.access_token, 'Token response access_token'),
    id_token: optionalString(source.id_token, 'Token response id_token'),
    refresh_token: optionalString(source.refresh_token, 'Token response refresh_token'),
    expires_in: optionalNumber(source.expires_in, 'Token response expires_in'),
    error: optionalString(source.error, 'Token response error'),
    error_description: optionalString(source.error_description, 'Token response error_description'),
  };
}
