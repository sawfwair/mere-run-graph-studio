import { decodeWorkflowGraph, parseJsonValue, recordValue, stringValue } from './decode';
import { clone, referencesIn, uniqueId } from './graph';
import type { EditorNodeState, EditorSidecar, JsonValue, WorkflowGraph, WorkflowNode } from './types';

export interface SavedPreset {
  contract_version: 'mere.run/graph-studio-preset.v1';
  id: string;
  title: string;
  created_at: string;
  nodes: WorkflowNode[];
  positions: Record<string, EditorNodeState>;
}

const STORAGE_KEY = 'mere-studio-saved-presets-v1';
const MAX_PRESETS = 100;
const CREDENTIAL_FIELD = /^(access[_-]?token|refresh[_-]?token|id[_-]?token|api[_-]?key|password|secret[_-]?value)$/i;

function hasCredentialValue(value: JsonValue): boolean {
  if (Array.isArray(value)) return value.some(hasCredentialValue);
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(([key, item]) => (CREDENTIAL_FIELD.test(key)
    && typeof item === 'string' && item.length > 0) || hasCredentialValue(item));
}

function validateSelection(nodes: WorkflowNode[], wanted: Set<string>): void {
  if (!nodes.length || nodes.length > 100) throw new Error('A preset must contain between one and 100 nodes.');
  for (const node of nodes) {
    if (hasCredentialValue(node.arguments)) throw new Error('Presets can store named secret references, not credential values.');
    if (node.depends_on?.some((id) => !wanted.has(id))) throw new Error('Include every ordering dependency in the preset.');
    validateNodeReferences(node, wanted);
  }
}

function validateNodeReferences(node: WorkflowNode, wanted: Set<string>): void {
  for (const value of Object.values(node.arguments)) {
    for (const reference of referencesIn(value)) {
      if (!reference.startsWith('nodes.') || !wanted.has(reference.split('.')[1] ?? '')) {
        throw new Error('Include all connected source nodes, or disconnect external inputs before saving.');
      }
    }
  }
}

export function capturePreset(graph: WorkflowGraph, sidecar: EditorSidecar, nodeIds: string[], title: string): SavedPreset {
  const wanted = new Set(nodeIds);
  const nodes = graph.nodes.filter((node) => wanted.has(node.id));
  if (!nodes.length || nodes.length !== wanted.size) throw new Error('Select one or more existing nodes.');
  if (!title.trim()) throw new Error('Give the saved preset a name.');
  validateSelection(nodes, wanted);
  return {
    contract_version: 'mere.run/graph-studio-preset.v1',
    id: crypto.randomUUID(), title: title.trim(), created_at: new Date().toISOString(),
    nodes: clone(nodes),
    positions: Object.fromEntries(nodes.map((node, index) => [node.id, sidecar.nodes[node.id] ?? { x: index * 420, y: 0 }])),
  };
}

function remapValue(value: JsonValue, ids: Map<string, string>): JsonValue {
  if (Array.isArray(value)) return value.map((item) => remapValue(item, ids));
  if (value && typeof value === 'object') {
    if (typeof value.$ref === 'string') {
      const match = /^nodes\.([a-z][a-z0-9-]*)\.(.*)$/.exec(value.$ref);
      const mapped = match && ids.get(match[1]);
      if (mapped && match) return { ...value, $ref: `nodes.${mapped}.${match[2]}` };
    }
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, remapValue(item, ids)]));
  }
  return value;
}

export function insertPreset(graph: WorkflowGraph, sidecar: EditorSidecar, preset: SavedPreset, position: { x: number; y: number }): {
  graph: WorkflowGraph; sidecar: EditorSidecar; nodeIds: string[];
} {
  const ids = new Map<string, string>();
  const existing = new Set(graph.nodes.map((node) => node.id));
  for (const node of preset.nodes) {
    const id = uniqueId(node.id, existing);
    ids.set(node.id, id); existing.add(id);
  }
  const nextNodes = preset.nodes.map((node) => ({
    ...clone(node), id: ids.get(node.id)!,
    arguments: Object.fromEntries(Object.entries(node.arguments).map(([name, value]) => [name, remapValue(value, ids)])),
    depends_on: node.depends_on?.map((id) => ids.get(id)!),
  }));
  const sourcePositions = preset.nodes.map((node) => preset.positions[node.id] ?? { x: 0, y: 0 });
  const minX = Math.min(...sourcePositions.map((item) => item.x));
  const minY = Math.min(...sourcePositions.map((item) => item.y));
  const nextSidecar = clone(sidecar);
  for (const node of preset.nodes) {
    const source = preset.positions[node.id] ?? { x: 0, y: 0 };
    nextSidecar.nodes[ids.get(node.id)!] = { ...source, x: position.x + source.x - minX, y: position.y + source.y - minY };
  }
  const nodeIds = nextNodes.map((node) => node.id);
  if (nodeIds.length > 1) {
    const name = uniqueId('group', Object.keys(nextSidecar.groups ?? {}));
    const maxX = Math.max(...sourcePositions.map((item) => item.x));
    const maxY = Math.max(...sourcePositions.map((item) => item.y));
    nextSidecar.groups = { ...nextSidecar.groups, [name]: {
      title: preset.title, x: position.x - 28, y: position.y - 54,
      width: Math.max(384, maxX - minX + 384), height: Math.max(260, maxY - minY + 260),
      node_ids: nodeIds,
    } };
  }
  return { graph: { ...graph, nodes: [...graph.nodes, ...nextNodes] }, sidecar: nextSidecar, nodeIds };
}

export function decodePreset(value: unknown): SavedPreset {
  const raw = recordValue(value, 'saved preset');
  if (raw.contract_version !== 'mere.run/graph-studio-preset.v1') throw new Error('Unsupported saved preset version.');
  const nodes = decodeWorkflowGraph({ schema_version: 1, kind: 'mere.run/workflow-graph', name: 'preset',
    inputs: {}, nodes: raw.nodes, outputs: {} }, 'saved preset graph').nodes;
  validateSelection(nodes, new Set(nodes.map((node) => node.id)));
  const positions = recordValue(raw.positions, 'saved preset positions');
  const typedPositions: Record<string, EditorNodeState> = {};
  for (const node of nodes) {
    const position = recordValue(positions[node.id], `saved preset position ${node.id}`);
    if (typeof position.x !== 'number' || typeof position.y !== 'number') throw new Error('Invalid saved preset position.');
    if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) throw new Error('Invalid saved preset position.');
    typedPositions[node.id] = { x: position.x, y: position.y };
  }
  return { contract_version: 'mere.run/graph-studio-preset.v1',
    id: stringValue(raw.id, 'saved preset id'), title: stringValue(raw.title, 'saved preset title'),
    created_at: stringValue(raw.created_at, 'saved preset date'), nodes, positions: typedPositions };
}

export function loadPresetLibrary(): SavedPreset[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = parseJsonValue(raw, 'saved preset library');
    return Array.isArray(parsed) ? parsed.slice(0, MAX_PRESETS).map(decodePreset) : [];
  } catch { return []; }
}

export function storePresetLibrary(presets: SavedPreset[]): void {
  if (presets.length > MAX_PRESETS) throw new Error('You can save at most 100 presets.');
  const text = JSON.stringify(presets);
  if (text.length > 2_000_000) throw new Error('The saved preset library is full.');
  localStorage.setItem(STORAGE_KEY, text);
}
