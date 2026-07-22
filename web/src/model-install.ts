import type { CommandDocument, JsonObject, JsonValue } from './types';

// The install review sheet reads a `mere.run model pull --preflight --json`
// envelope (or the cloud runtime's synthetic equivalent). This module distils
// that document into a flat, render-ready summary so the component stays dumb.

export interface ModelPreflightSummary {
  model: string;
  status: string;
  supported: boolean;
  installed: boolean;
  blocked: boolean;
  cloud: boolean;
  summary: string | null;
  downloadBytes: number | null;
  requiredBytes: number | null;
  availableBytes: number | null;
  usageTerms: string[];
  blockers: string[];
  notes: string[];
}

const isObject = (value: JsonValue | undefined): value is JsonObject =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const asArray = (value: JsonValue | undefined): JsonValue[] => (Array.isArray(value) ? value : []);
const asString = (value: JsonValue | undefined): string | null => (typeof value === 'string' ? value : null);
const asNumber = (value: JsonValue | undefined): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

function stringList(value: JsonValue | undefined): string[] {
  return asArray(value).filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

/** Pick the preflight model entry that matches the requested id, else the
 *  selected one, else the first — tolerating a document that omits models. */
function pickModelEntry(models: JsonValue[], model: string): JsonObject | null {
  const objects = models.filter(isObject);
  return (
    objects.find((entry) => entry.id === model)
    ?? objects.find((entry) => entry.selected === true)
    ?? objects[0]
    ?? null
  );
}

function diagnosticMessages(
  diagnostics: JsonObject[],
  severities: Set<JsonValue>,
  fallback: string,
): string[] {
  return diagnostics
    .filter((item) => severities.has(item.severity))
    .map((item) => asString(item.message) ?? asString(item.title) ?? fallback)
    .filter((message) => message.length > 0);
}

function firstNumber(...values: (JsonValue | undefined)[]): number | null {
  for (const value of values) {
    const number = asNumber(value);
    if (number !== null) return number;
  }
  return null;
}

function failedPreflight(base: ModelPreflightSummary, document: CommandDocument | null): ModelPreflightSummary {
  const message = document?.stderr.trim();
  return { ...base, blocked: true, blockers: message ? [message] : ['Could not inspect this model.'] };
}

function installState(status: string, entry: JsonObject | null, blockers: string[]): Pick<ModelPreflightSummary, 'installed' | 'blocked'> {
  return {
    installed: entry?.installed === true || status === 'installed' || status === 'ready',
    blocked: status === 'blocked' || blockers.length > 0,
  };
}

function objectOrEmpty(value: JsonValue | undefined): JsonObject {
  return isObject(value) ? value : {};
}

function modelName(entry: JsonObject | null, fallback: string): string {
  return asString(entry?.id) ?? fallback;
}

function usageTerms(entry: JsonObject | null): string[] {
  return entry ? stringList(entry.usage_terms) : [];
}

export function summarizeModelPreflight(model: string, document: CommandDocument | null): ModelPreflightSummary {
  const base: ModelPreflightSummary = {
    model,
    status: 'unknown',
    supported: true,
    installed: false,
    blocked: false,
    cloud: false,
    summary: null,
    downloadBytes: null,
    requiredBytes: null,
    availableBytes: null,
    usageTerms: [],
    blockers: [],
    notes: [],
  };
  const envelope = document?.result;
  // A failed preflight surfaces as a stderr-only document; treat as blocking.
  if (!isObject(envelope)) return failedPreflight(base, document);
  const status = asString(envelope.status) ?? 'unknown';
  const result = objectOrEmpty(envelope.result);
  const entry = pickModelEntry(asArray(result.models), model);
  const store = objectOrEmpty(result.model_store);
  const diagnostics = asArray(envelope.diagnostics).filter(isObject);
  const blockers = diagnosticMessages(diagnostics, new Set(['blocker']), 'Blocker');
  const notes = diagnosticMessages(diagnostics, new Set(['warning', 'note']), '');

  return {
    model: modelName(entry, model),
    status,
    supported: entry?.supported !== false,
    ...installState(status, entry, blockers),
    cloud: envelope.cloud === true,
    summary: asString(envelope.summary),
    downloadBytes: firstNumber(entry?.estimated_download_bytes, result.estimated_download_bytes),
    requiredBytes: firstNumber(entry?.estimated_required_bytes, result.estimated_required_bytes),
    availableBytes: asNumber(store.available_bytes),
    usageTerms: usageTerms(entry),
    blockers,
    notes,
  };
}

/** Human byte size for review copy — binary units, one decimal above KB. */
export function formatBytes(bytes: number | null): string | null {
  if (bytes === null || bytes < 0) return null;
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 100 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

/** Fractional install progress in [0,1], or null when indeterminate. */
export function pullFraction(received: number | null, total: number | null, percent: number | null): number | null {
  if (percent !== null && percent >= 0) return Math.min(1, percent / 100);
  if (received !== null && total !== null && total > 0) return Math.min(1, received / total);
  return null;
}
