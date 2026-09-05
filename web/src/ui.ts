import type { CatalogEntry, CatalogField, FieldType, JsonValue, WorkflowNode } from './types';
import { isGraphReference, isSecretReference } from './graph';

export type StudioMode = 'easy' | 'pro';
export type StudioView = 'app' | 'canvas' | 'program' | 'json' | 'prepare' | 'runs' | 'catalog' | 'inspector';

const PRO_ONLY_VIEWS = new Set<StudioView>(['program', 'json', 'prepare']);

export function viewAvailableInMode(view: StudioView, mode: StudioMode): boolean {
  return mode === 'pro' || !PRO_ONLY_VIEWS.has(view);
}

export function coerceViewForMode(view: StudioView, mode: StudioMode): StudioView {
  return viewAvailableInMode(view, mode) ? view : 'canvas';
}

const MODE_STORAGE_KEY = 'mere-studio-mode';

export function loadStoredMode(): StudioMode {
  try {
    const stored = window.localStorage.getItem(MODE_STORAGE_KEY);
    return stored === 'pro' ? 'pro' : 'easy';
  } catch {
    return 'easy';
  }
}

export function storeMode(mode: StudioMode): void {
  try {
    window.localStorage.setItem(MODE_STORAGE_KEY, mode);
  } catch {
    // Storage can be unavailable in private sessions; the toggle still works in memory.
  }
}

const ACRONYMS = new Set(['id', 'url', 'uri', 'cfg', 'fps', 'vae', 'llm', 'gpu', 'cpu', 'api', 'ssh']);

export function friendlyLabel(name: string): string {
  const words = name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[_\-\s]+/)
    .filter(Boolean)
    .map((word) => (ACRONYMS.has(word.toLowerCase()) ? word.toUpperCase() : word.toLowerCase()));
  if (!words.length) return name;
  const [first, ...rest] = words;
  const lead = ACRONYMS.has(first.toLowerCase()) ? first.toUpperCase() : first[0].toUpperCase() + first.slice(1);
  return [lead, ...rest].join(' ');
}

const TYPE_LABELS: Record<FieldType, string> = {
  string: 'text',
  integer: 'whole number',
  number: 'number',
  boolean: 'on or off',
  enum: 'choice',
  json: 'structured data',
  asset: 'media file',
  asset_directory: 'media folder',
  asset_array: 'media list',
  asset_collection: 'media collection',
};

export function friendlyType(type: FieldType): string {
  return TYPE_LABELS[type] ?? type;
}

export type CategoryKey = 'values' | 'text' | 'image' | 'video' | 'audio' | 'model' | 'dataset' | 'other';

const CATEGORY_KEYS: CategoryKey[] = ['values', 'text', 'image', 'video', 'audio', 'model', 'dataset'];

export function categoryKey(category: string | undefined): CategoryKey {
  return CATEGORY_KEYS.find((key) => key === category) ?? 'other';
}

const CATEGORY_TITLES: Record<CategoryKey, string> = {
  values: 'Values',
  text: 'Text',
  image: 'Image',
  video: 'Video',
  audio: 'Audio',
  model: 'Models',
  dataset: 'Datasets',
  other: 'Other',
};

export function categoryTitle(category: string | undefined): string {
  return CATEGORY_TITLES[categoryKey(category)];
}

export type PortTypeKey = 'asset' | 'text' | 'number' | 'bool' | 'data';

export function portTypeKey(type: FieldType): PortTypeKey {
  if (type === 'asset' || type === 'asset_directory' || type === 'asset_array' || type === 'asset_collection') return 'asset';
  if (type === 'string' || type === 'enum') return 'text';
  if (type === 'integer' || type === 'number') return 'number';
  if (type === 'boolean') return 'bool';
  return 'data';
}

export function isEssentialField(field: CatalogField): boolean {
  if (field.required === true) return true;
  if (field.required === false || field.optional === true) return false;
  return field.default === undefined && !field.secret;
}

export function splitFieldsForMode(fields: CatalogField[], mode: StudioMode): {
  primary: CatalogField[];
  advanced: CatalogField[];
} {
  if (mode === 'pro') return { primary: fields, advanced: [] };
  const primary: CatalogField[] = [];
  const advanced: CatalogField[] = [];
  for (const field of fields) (isEssentialField(field) ? primary : advanced).push(field);
  return { primary, advanced };
}

export function describeReference(ref: string): string {
  const nodeMatch = /^nodes\.([^.]+)\.outputs\.(.+)$/.exec(ref);
  if (nodeMatch) return `${nodeMatch[1]} · ${nodeMatch[2]}`;
  const inputMatch = /^inputs\.(.+)$/.exec(ref);
  if (inputMatch) return `input · ${inputMatch[1]}`;
  return ref;
}

function summarizeString(value: string, limit: number): string {
  const flat = value.replace(/\s+/g, ' ').trim();
  if (!flat) return '—';
  return flat.length > limit ? `${flat.slice(0, limit - 1)}…` : flat;
}

function summarizeSecret(value: { $secret: string }): string {
  return value.$secret ? `secret · ${value.$secret}` : 'secret · unset';
}

function summarizeScalar(value: JsonValue, limit: number): string | undefined {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'on' : 'off';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return summarizeString(value, limit);
  return undefined;
}

export function summarizeValue(value: JsonValue | undefined, limit = 26): string {
  if (value === undefined) return '—';
  if (isGraphReference(value)) return `→ ${describeReference(value.$ref)}`;
  if (isSecretReference(value)) return summarizeSecret(value);
  const scalar = summarizeScalar(value, limit);
  if (scalar !== undefined) return scalar;
  if (Array.isArray(value)) return value.length === 1 ? '1 item' : `${value.length} items`;
  return '{…}';
}

export function textValue(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return fallback;
}

export interface ArgumentSummary {
  name: string;
  label: string;
  text: string;
  kind: 'constant' | 'reference' | 'secret';
}

function argumentSummary(node: WorkflowNode, field: CatalogField): ArgumentSummary | null {
  const value = node.arguments[field.name];
  if (value === undefined || isGraphReference(value)) return null;
  if (typeof value === 'object' && value !== null && !isSecretReference(value)) return null;
  return {
    name: field.name,
    label: friendlyLabel(field.name),
    text: summarizeValue(value),
    kind: isSecretReference(value) ? 'secret' : 'constant',
  };
}

export function argumentSummaries(node: WorkflowNode, entry: CatalogEntry | undefined, max = 3): ArgumentSummary[] {
  if (!entry) return [];
  const ordered = [...entry.inputs].sort((left, right) => Number(isEssentialField(right)) - Number(isEssentialField(left)));
  const summaries: ArgumentSummary[] = [];
  for (const field of ordered) {
    if (summaries.length >= max) break;
    const summary = argumentSummary(node, field);
    if (summary) summaries.push(summary);
  }
  return summaries;
}

export function formatRelativeTime(iso: string, now = Date.now()): string {
  const timestamp = new Date(iso).getTime();
  if (Number.isNaN(timestamp)) return '';
  const seconds = Math.round((now - timestamp) / 1000);
  if (seconds < 10) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function formatDuration(startIso: string, endIso: string): string {
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return '';
  const seconds = Math.max(1, Math.round((end - start) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export function isSliderField(field: CatalogField): boolean {
  return (
    (field.type === 'integer' || field.type === 'number') &&
    field.minimum !== undefined &&
    field.maximum !== undefined &&
    field.maximum > field.minimum
  );
}

export function isLongTextField(field: CatalogField): boolean {
  return field.type === 'string' && (field.multiline === true || field.name === 'prompt' || field.name.endsWith('_prompt'));
}
