import type {
  CatalogEntry,
  CatalogField,
  CatalogValueSchema,
  EditorSidecar,
  FieldType,
  GraphInputDefinition,
  GraphReference,
  JsonObject,
  JsonValue,
  WorkflowGraph,
  WorkflowNode,
} from './types';
import { recordValue } from './decode';

export const createGraph = (): WorkflowGraph => ({
  schema_version: 1,
  kind: 'mere.run/workflow-graph',
  name: 'Untitled workflow',
  inputs: {},
  execution: { max_parallel_nodes: 1 },
  nodes: [],
  outputs: {},
  metadata: {},
});

export const createSidecar = (): EditorSidecar => ({
  schema_version: 1,
  kind: 'mere.run/workflow-editor',
  viewport: { x: 0, y: 0, zoom: 1 },
  nodes: {},
  inputs: {},
  outputs: {},
  groups: {},
  notes: {},
  selection_sets: {},
  promotions: {},
});

export const ORDER_INPUT_HANDLE = '__order-in';
export const ORDER_OUTPUT_HANDLE = '__order-out';
export const GRAPH_OUTPUT_HANDLE = '__graph-output';
export const GRAPH_INPUT_HANDLE = '__graph-input';
const GRAPH_INPUT_PREFIX = 'graph-input:';
const GRAPH_OUTPUT_PREFIX = 'graph-output:';
const EDITOR_GROUP_PREFIX = 'editor-group:';
const EDITOR_NOTE_PREFIX = 'editor-note:';

export function graphInputNodeId(name: string): string {
  return `${GRAPH_INPUT_PREFIX}${name}`;
}

export function graphInputName(nodeId: string): string | null {
  return nodeId.startsWith(GRAPH_INPUT_PREFIX) ? nodeId.slice(GRAPH_INPUT_PREFIX.length) : null;
}

export function graphOutputNodeId(name: string): string {
  return `${GRAPH_OUTPUT_PREFIX}${name}`;
}

export function graphOutputName(nodeId: string): string | null {
  return nodeId.startsWith(GRAPH_OUTPUT_PREFIX) ? nodeId.slice(GRAPH_OUTPUT_PREFIX.length) : null;
}

export function editorGroupNodeId(name: string): string {
  return `${EDITOR_GROUP_PREFIX}${name}`;
}

export function editorGroupName(nodeId: string): string | null {
  return nodeId.startsWith(EDITOR_GROUP_PREFIX) ? nodeId.slice(EDITOR_GROUP_PREFIX.length) : null;
}

export function editorNoteNodeId(name: string): string {
  return `${EDITOR_NOTE_PREFIX}${name}`;
}

export function editorNoteName(nodeId: string): string | null {
  return nodeId.startsWith(EDITOR_NOTE_PREFIX) ? nodeId.slice(EDITOR_NOTE_PREFIX.length) : null;
}

export function clone<T>(value: T): T {
  return structuredClone(value);
}

export function providerId(entry: CatalogEntry): string {
  return entry.provider?.id ?? 'mere.run';
}

export function catalogKey(entry: CatalogEntry): string {
  return `${providerId(entry)}:${entry.kind}`;
}

export function catalogEntryFor(node: WorkflowNode, catalog: CatalogEntry[]): CatalogEntry | undefined {
  return catalog.find(
    (entry) => entry.kind === node.kind && (!node.provider || node.provider === 'mere.run' || providerId(entry) === node.provider),
  );
}

const fieldTypeDefaults: Partial<Record<FieldType, JsonValue>> = {
  boolean: false,
  json: {},
  asset_collection: [],
  asset_array: [],
};

const schemaTypeDefaults: Partial<Record<CatalogValueSchema['type'], JsonValue>> = {
  array: [],
  json: {},
  boolean: false,
};

export function compatibleTypes(source: FieldType, target: FieldType): boolean {
  if (source === target || (source === 'integer' && target === 'number')) return true;
  return (
    ['asset_collection', 'asset_array'].includes(source) && ['asset_collection', 'asset_array'].includes(target)
  );
}

function defaultForFieldType(field: CatalogField): JsonValue {
  if (field.type === 'integer' || field.type === 'number') return field.minimum ?? 0;
  if (field.type === 'enum') return field.values?.[0] ?? '';
  const fallback = fieldTypeDefaults[field.type];
  if (fallback !== undefined) return clone(fallback);
  return '';
}

export function defaultFieldValue(field: CatalogField): JsonValue | undefined {
  if (field.default !== undefined) return clone(field.default);
  if (field.value_schema) return defaultSchemaValue(field.value_schema);
  if (field.secret) return { $secret: '' };
  if (field.required === false) return undefined;
  return defaultForFieldType(field);
}

function defaultForSchemaType(schema: CatalogValueSchema): JsonValue {
  if (schema.type === 'integer' || schema.type === 'number') return schema.minimum ?? 0;
  if (schema.type === 'enum') return schema.values?.[0] ?? '';
  const fallback = schemaTypeDefaults[schema.type];
  if (fallback !== undefined) return clone(fallback);
  return '';
}

export function defaultSchemaValue(schema: CatalogValueSchema): JsonValue {
  if (schema.default !== undefined) return clone(schema.default);
  if (schema.type !== 'object') return defaultForSchemaType(schema);
  return Object.fromEntries(
    Object.entries(schema.properties ?? {}).map(([name, property]) => [name, defaultSchemaValue(property)]),
  );
}

export function schemaFieldType(schema: CatalogValueSchema): FieldType {
  if (schema.type === 'object' || schema.type === 'array') return 'json';
  return schema.type;
}

export function uniqueId(base: string, existing: Iterable<string>): string {
  const ids = new Set(existing);
  const clean = base
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^[^a-z]+/, '')
    .replace(/-+$/g, '') || 'node';
  if (!ids.has(clean)) return clean;
  let index = 2;
  while (ids.has(`${clean}-${index}`)) index += 1;
  return `${clean}-${index}`;
}

export function alignEditorNodes(
  sidecar: EditorSidecar,
  nodeIds: string[],
  axis: 'horizontal' | 'vertical',
): EditorSidecar {
  if (nodeIds.length < 2) return sidecar;
  const next = clone(sidecar);
  const positions = nodeIds.map((id) => next.nodes[id]).filter((value) => value !== undefined);
  if (positions.length < 2) return sidecar;
  const coordinate = axis === 'horizontal'
    ? positions.reduce((sum, value) => sum + value.y, 0) / positions.length
    : positions.reduce((sum, value) => sum + value.x, 0) / positions.length;
  for (const nodeId of nodeIds) {
    const position = next.nodes[nodeId];
    if (!position) continue;
    next.nodes[nodeId] = axis === 'horizontal' ? { ...position, y: coordinate } : { ...position, x: coordinate };
  }
  return next;
}

export function layoutEditorNodes(sidecar: EditorSidecar, nodeIds: string[]): EditorSidecar {
  if (!nodeIds.length) return sidecar;
  const next = clone(sidecar);
  const positions = nodeIds.map((id) => next.nodes[id]).filter((value) => value !== undefined);
  if (!positions.length) return sidecar;
  const originX = Math.min(...positions.map((value) => value.x));
  const originY = Math.min(...positions.map((value) => value.y));
  const columns = Math.max(1, Math.ceil(Math.sqrt(nodeIds.length)));
  nodeIds.forEach((nodeId, index) => {
    const current = next.nodes[nodeId];
    if (!current) return;
    next.nodes[nodeId] = {
      ...current,
      x: originX + (index % columns) * 336,
      y: originY + Math.floor(index / columns) * 240,
    };
  });
  return next;
}

function graphLayers(graph: WorkflowGraph): Map<string, number> {
  const layers = new Map<string, number>();
  const pending = new Set(graph.nodes.map((node) => node.id));
  while (pending.size) {
    let progressed = false;
    for (const node of graph.nodes) {
      if (!pending.has(node.id)) continue;
      const dependencies = [...nodeDependencies(node)].filter((id) => graph.nodes.some((candidate) => candidate.id === id));
      if (dependencies.some((id) => !layers.has(id))) continue;
      layers.set(node.id, dependencies.length ? Math.max(...dependencies.map((id) => layers.get(id) ?? 0)) + 1 : 0);
      pending.delete(node.id);
      progressed = true;
    }
    if (!progressed) {
      for (const nodeId of pending) layers.set(nodeId, 0);
      break;
    }
  }
  return layers;
}

function positionGraphNodes(next: EditorSidecar, graph: WorkflowGraph, layers: Map<string, number>, originX: number): void {
  const rows = new Map<number, number>();
  for (const node of graph.nodes) {
    const layer = layers.get(node.id) ?? 0;
    const row = rows.get(layer) ?? 0;
    next.nodes[node.id] = { ...next.nodes[node.id], x: originX + layer * 352, y: 80 + row * 240 };
    rows.set(layer, row + 1);
  }
}

function positionGraphOutputs(next: EditorSidecar, graph: WorkflowGraph, layers: Map<string, number>, originX: number): void {
  next.outputs = { ...next.outputs };
  Object.entries(graph.outputs).forEach(([name, reference], index) => {
    const match = /^nodes\.([a-z][a-z0-9-]*)\.outputs\./.exec(reference.$ref);
    const source = match ? next.nodes[match[1]] : undefined;
    next.outputs![name] = source
      ? { ...next.outputs![name], x: source.x + 352, y: source.y }
      : { ...next.outputs![name], x: originX + (Math.max(...layers.values(), 0) + 1) * 352, y: 80 + index * 88 };
  });
}

export function autoLayoutGraph(graph: WorkflowGraph, sidecar: EditorSidecar): EditorSidecar {
  const next = clone(sidecar);
  const inputNames = Object.keys(graph.inputs);
  next.inputs = { ...next.inputs };
  inputNames.forEach((name, index) => {
    next.inputs![name] = { ...next.inputs![name], x: 40, y: 80 + index * 160 };
  });
  const originX = inputNames.length ? 328 : 80;
  const layers = graphLayers(graph);
  positionGraphNodes(next, graph, layers, originX);
  positionGraphOutputs(next, graph, layers, originX);
  return next;
}

export function addEditorGroup(sidecar: EditorSidecar, nodeIds: string[]): { sidecar: EditorSidecar; name: string } {
  if (!nodeIds.length) throw new Error('Select at least one node to create a group.');
  const next = clone(sidecar);
  const positions = nodeIds.map((id) => next.nodes[id]).filter((value) => value !== undefined);
  if (!positions.length) throw new Error('The selected nodes do not have editor positions.');
  const name = uniqueId('group', Object.keys(next.groups ?? {}));
  const minX = Math.min(...positions.map((value) => value.x));
  const minY = Math.min(...positions.map((value) => value.y));
  const maxX = Math.max(...positions.map((value) => value.x));
  const maxY = Math.max(...positions.map((value) => value.y));
  next.groups = {
    ...next.groups,
    [name]: {
      title: `Group ${Object.keys(next.groups ?? {}).length + 1}`,
      x: minX - 28,
      y: minY - 54,
      width: Math.max(342, maxX - minX + 342),
      height: Math.max(250, maxY - minY + 310),
      node_ids: [...nodeIds],
      color: '#5F8F7B',
    },
  };
  return { sidecar: next, name };
}

export function addEditorNote(sidecar: EditorSidecar): { sidecar: EditorSidecar; name: string } {
  const next = clone(sidecar);
  const name = uniqueId('note', Object.keys(next.notes ?? {}));
  const index = Object.keys(next.notes ?? {}).length;
  const nodePositions = Object.values(next.nodes);
  const originX = nodePositions.length ? Math.min(...nodePositions.map((value) => value.x)) : 96;
  const originY = nodePositions.length ? Math.max(...nodePositions.map((value) => value.y)) + 320 : 96;
  next.notes = {
    ...next.notes,
    [name]: {
      text: 'Add context for this workflow.',
      x: originX + index * 240,
      y: originY,
      width: 220,
      height: 120,
      color: '#D4A54E',
    },
  };
  return { sidecar: next, name };
}

export function saveEditorSelection(sidecar: EditorSidecar, nodeIds: string[]): { sidecar: EditorSidecar; name: string } {
  if (!nodeIds.length) throw new Error('Select at least one node to save a selection.');
  const next = clone(sidecar);
  const name = uniqueId('selection', Object.keys(next.selection_sets ?? {}));
  next.selection_sets = { ...next.selection_sets, [name]: { node_ids: [...nodeIds] } };
  return { sidecar: next, name };
}

export function addCatalogNode(
  graph: WorkflowGraph,
  sidecar: EditorSidecar,
  entry: CatalogEntry,
): { graph: WorkflowGraph; sidecar: EditorSidecar; nodeId: string } {
  const nextGraph = clone(graph);
  const nextSidecar = clone(sidecar);
  const nodeId = uniqueId(entry.kind.split('.').at(-1) ?? 'node', nextGraph.nodes.map((node) => node.id));
  const node: WorkflowNode = { id: nodeId, kind: entry.kind, arguments: {} };
  if (providerId(entry) !== 'mere.run') node.provider = providerId(entry);
  for (const field of entry.inputs) {
    const value = defaultFieldValue(field);
    if (value !== undefined) node.arguments[field.name] = value;
  }
  if (entry.inputs.some((field) => field.secret)) node.execution = { cache: 'never' };
  nextGraph.nodes.push(node);
  const index = nextGraph.nodes.length - 1;
  nextSidecar.nodes[nodeId] = {
    x: 80 + (index % 3) * 320,
    y: 80 + Math.floor(index / 3) * 210,
  };
  return { graph: nextGraph, sidecar: nextSidecar, nodeId };
}

const literalMaterialKinds = new Set([
  'text.value',
  'integer.value',
  'number.value',
  'boolean.value',
  'json.value',
  'seed.value',
  'choice.value',
]);

interface MaterialSpec {
  kind: string;
  outputName: string;
  arguments: Record<string, JsonValue>;
}

type MaterialFactory = (value: JsonValue, field: CatalogField) => MaterialSpec | null;

const materialFactories: Partial<Record<FieldType, MaterialFactory>> = {
  string: (value) => typeof value === 'string'
    ? { kind: 'text.value', outputName: 'text', arguments: { value } }
    : null,
  enum: (value, field) => typeof value === 'string'
    ? { kind: 'choice.value', outputName: 'value', arguments: { options: field.values ?? [value], selected: value } }
    : null,
  integer: (value) => typeof value === 'number' && Number.isInteger(value)
    ? { kind: 'integer.value', outputName: 'value', arguments: { value } }
    : null,
  number: (value) => typeof value === 'number'
    ? { kind: 'number.value', outputName: 'value', arguments: { value } }
    : null,
  boolean: (value) => typeof value === 'boolean'
    ? { kind: 'boolean.value', outputName: 'value', arguments: { value } }
    : null,
  json: (value) => ({ kind: 'json.value', outputName: 'value', arguments: { value } }),
};

function materialSpec(argumentName: string, field: CatalogField, value: JsonValue): MaterialSpec {
  if (argumentName === 'seed' && typeof value === 'number' && Number.isInteger(value)) {
    return { kind: 'seed.value', outputName: 'seed', arguments: { seed: value } };
  }
  const spec = materialFactories[field.type]?.(value, field);
  if (!spec) throw new Error(`Argument '${argumentName}' cannot be promoted as a material value.`);
  return spec;
}

function positionMaterialNode(
  sidecar: EditorSidecar,
  consumerId: string,
  materialNodeId: string,
  argumentName: string,
): void {
  const position = sidecar.nodes[consumerId] ?? { x: 360, y: 120 };
  sidecar.promotions = {
    ...sidecar.promotions,
    [materialNodeId]: {
      consumer_id: consumerId,
      argument_name: argumentName,
      consumer_position: { ...position },
    },
  };
  if (position.x < 360) {
    sidecar.nodes[consumerId] = { x: position.x + 340, y: position.y };
    sidecar.nodes[materialNodeId] = { x: position.x, y: position.y };
  } else {
    sidecar.nodes[materialNodeId] = { x: position.x - 340, y: position.y };
  }
}

export function promoteNodeArgument(
  graph: WorkflowGraph,
  sidecar: EditorSidecar,
  catalog: CatalogEntry[],
  nodeId: string,
  argumentName: string,
): { graph: WorkflowGraph; sidecar: EditorSidecar; materialNodeId: string } {
  const nextGraph = clone(graph);
  const nextSidecar = clone(sidecar);
  const consumer = nextGraph.nodes.find((node) => node.id === nodeId);
  if (!consumer) throw new Error(`Unknown node: ${nodeId}`);
  const entry = catalogEntryFor(consumer, catalog);
  const field = entry?.inputs.find((candidate) => candidate.name === argumentName);
  const value = consumer.arguments[argumentName];
  if (!field || value === undefined || isGraphReference(value) || isSecretReference(value)) {
    throw new Error('Only constant, non-secret arguments can be promoted.');
  }
  if (['asset', 'asset_directory', 'asset_array', 'asset_collection'].includes(field.type)) {
    throw new Error('Asset arguments remain direct media bindings.');
  }

  const spec = materialSpec(argumentName, field, value);

  const materialNodeId = uniqueId(
    `${consumer.id}-${argumentName}`.replaceAll('_', '-'),
    nextGraph.nodes.map((node) => node.id),
  );
  const material: WorkflowNode = { id: materialNodeId, kind: spec.kind, arguments: spec.arguments };
  const consumerIndex = nextGraph.nodes.findIndex((node) => node.id === consumer.id);
  nextGraph.nodes.splice(Math.max(0, consumerIndex), 0, material);
  consumer.arguments[argumentName] = { $ref: `nodes.${materialNodeId}.outputs.${spec.outputName}` };
  positionMaterialNode(nextSidecar, consumer.id, materialNodeId, argumentName);
  return { graph: nextGraph, sidecar: nextSidecar, materialNodeId };
}

function materialNodeValue(node: WorkflowNode): { outputName: string; value: JsonValue } | null {
  if (!literalMaterialKinds.has(node.kind)) return null;
  if (node.kind === 'text.value') return { outputName: 'text', value: node.arguments.value };
  if (node.kind === 'seed.value') return { outputName: 'seed', value: node.arguments.seed };
  if (node.kind === 'choice.value') return { outputName: 'value', value: node.arguments.selected };
  return { outputName: 'value', value: node.arguments.value };
}

function inlineTargets(graph: WorkflowGraph, consumerNodeId?: string): WorkflowNode[] {
  const targets = consumerNodeId ? graph.nodes.filter((node) => node.id === consumerNodeId) : graph.nodes;
  if (consumerNodeId && !targets.length) throw new Error(`Unknown consumer node: ${consumerNodeId}`);
  return targets;
}

function replaceMaterialReferences(targets: WorkflowNode[], reference: string, value: JsonValue): void {
  for (const target of targets) {
    target.arguments = Object.fromEntries(
      Object.entries(target.arguments).map(([name, argument]) => [
        name,
        replaceExactReference(argument, reference, value),
      ]),
    );
  }
}

function materialIsReferenced(graph: WorkflowGraph, reference: string): boolean {
  return graph.nodes.some((node) =>
    Object.values(node.arguments).some((value) => referencesIn(value).includes(reference)))
    || Object.values(graph.outputs).some((output) => output.$ref === reference);
}

function deleteMaterialNode(graph: WorkflowGraph, sidecar: EditorSidecar, nodeId: string): void {
  graph.nodes = graph.nodes.filter((node) => node.id !== nodeId);
  delete sidecar.nodes[nodeId];
  const promotion = sidecar.promotions?.[nodeId];
  if (promotion && sidecar.nodes[promotion.consumer_id]) {
    sidecar.nodes[promotion.consumer_id] = { ...promotion.consumer_position };
  }
  if (sidecar.promotions) delete sidecar.promotions[nodeId];
}

export function inlineMaterialNode(
  graph: WorkflowGraph,
  sidecar: EditorSidecar,
  nodeId: string,
  consumerNodeId?: string,
): { graph: WorkflowGraph; sidecar: EditorSidecar; deleted: boolean } {
  const material = graph.nodes.find((node) => node.id === nodeId);
  const resolved = material && materialNodeValue(material);
  if (!material || !resolved || resolved.value === undefined || isGraphReference(resolved.value)) {
    throw new Error('Only literal material nodes can be inlined.');
  }
  const reference = `nodes.${nodeId}.outputs.${resolved.outputName}`;
  if (!consumerNodeId && Object.values(graph.outputs).some((output) => output.$ref === reference)) {
    throw new Error('Remove or reconnect the graph output before inlining this material everywhere.');
  }
  const nextGraph = clone(graph);
  const nextSidecar = clone(sidecar);
  replaceMaterialReferences(inlineTargets(nextGraph, consumerNodeId), reference, resolved.value);
  const deleted = !materialIsReferenced(nextGraph, reference);
  if (deleted) deleteMaterialNode(nextGraph, nextSidecar, nodeId);
  return { graph: nextGraph, sidecar: nextSidecar, deleted };
}

export function isGraphReference(value: JsonValue | undefined): value is GraphReference {
  return Boolean(
    value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 1 && '$ref' in value,
  );
}

export function isSecretReference(value: JsonValue | undefined): value is { $secret: string } {
  return Boolean(
    value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      Object.keys(value).length === 1 &&
      '$secret' in value,
  );
}

export function referencesIn(value: JsonValue | undefined, found: string[] = []): string[] {
  if (Array.isArray(value)) value.forEach((item) => referencesIn(item, found));
  else if (value && typeof value === 'object') {
    if (isGraphReference(value)) found.push(value.$ref);
    else Object.values(value).forEach((item) => referencesIn(item, found));
  }
  return found;
}

export interface ReferenceLocation {
  reference: string;
  path: string[];
}

export const ARGUMENT_PATH_HANDLE_PREFIX = 'argument:';

export function referencesWithPaths(
  value: JsonValue | undefined,
  path: string[] = [],
  found: ReferenceLocation[] = [],
): ReferenceLocation[] {
  if (isGraphReference(value)) {
    found.push({ reference: value.$ref, path });
  } else if (Array.isArray(value)) {
    value.forEach((item, index) => referencesWithPaths(item, [...path, String(index)], found));
  } else if (value && typeof value === 'object') {
    Object.entries(value).forEach(([key, item]) => referencesWithPaths(item, [...path, key], found));
  }
  return found;
}

function escapePointerSegment(value: string): string {
  return value.replaceAll('~', '~0').replaceAll('/', '~1');
}

function unescapePointerSegment(value: string): string {
  return value.replaceAll('~1', '/').replaceAll('~0', '~');
}

export function argumentPathHandle(path: string[]): string {
  return `${ARGUMENT_PATH_HANDLE_PREFIX}/${path.map(escapePointerSegment).join('/')}`;
}

export function argumentPathFromHandle(handle: string): string[] | null {
  if (!handle.startsWith(ARGUMENT_PATH_HANDLE_PREFIX)) return null;
  const pointer = handle.slice(ARGUMENT_PATH_HANDLE_PREFIX.length);
  if (!pointer.startsWith('/')) return null;
  return pointer.slice(1).split('/').map(unescapePointerSegment);
}

export function valueAtPath(value: JsonValue | undefined, path: string[]): JsonValue | undefined {
  let current = value;
  for (const segment of path) {
    if (Array.isArray(current)) {
      const index = Number.parseInt(segment, 10);
      if (!Number.isInteger(index) || index < 0 || index >= current.length) return undefined;
      current = current[index];
    } else if (current && typeof current === 'object' && segment in current) {
      current = current[segment];
    } else {
      return undefined;
    }
  }
  return current;
}

function setValueAtPath(value: JsonValue, path: string[], replacement: JsonValue): JsonValue {
  if (!path.length) return replacement;
  const [segment, ...rest] = path;
  if (Array.isArray(value)) {
    const index = Number.parseInt(segment, 10);
    if (!Number.isInteger(index) || index < 0 || index >= value.length) {
      throw new Error(`Invalid array argument path: ${path.join('/')}`);
    }
    const next = [...value];
    next[index] = setValueAtPath(next[index], rest, replacement);
    return next;
  }
  if (value && typeof value === 'object' && segment in value) {
    return { ...value, [segment]: setValueAtPath(value[segment], rest, replacement) };
  }
  throw new Error(`Unknown argument path: ${path.join('/')}`);
}

export function fieldTypeAtArgumentPath(field: CatalogField, nestedPath: string[]): FieldType | null {
  if (!nestedPath.length) return field.type;
  let schema = field.value_schema;
  for (const segment of nestedPath) {
    if (!schema) return null;
    if (schema.type === 'array') schema = schema.items;
    else if (schema.type === 'object') schema = schema.properties?.[segment] ?? schema.additional_properties;
    else return null;
  }
  return schema ? schemaFieldType(schema) : null;
}

function replaceReferencesMatching(
  value: JsonValue,
  predicate: (reference: string) => boolean,
): JsonValue {
  if (isGraphReference(value)) return predicate(value.$ref) ? null : value;
  if (Array.isArray(value)) return value.map((item) => replaceReferencesMatching(item, predicate));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, replaceReferencesMatching(item, predicate)]),
    );
  }
  return value;
}

function replaceExactReference(value: JsonValue, reference: string, replacement: JsonValue): JsonValue {
  if (isGraphReference(value)) return value.$ref === reference ? clone(replacement) : value;
  if (Array.isArray(value)) return value.map((item) => replaceExactReference(item, reference, replacement));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, replaceExactReference(item, reference, replacement)]),
    );
  }
  return value;
}

function replaceReference(value: JsonValue, from: string, to: string): JsonValue {
  if (Array.isArray(value)) return value.map((item) => replaceReference(item, from, to));
  if (!value || typeof value !== 'object') return value;
  if (isGraphReference(value)) return { $ref: value.$ref.replace(from, to) };
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replaceReference(item, from, to)]));
}

function renameGraphReferences(graph: WorkflowGraph, nodeId: string, desired: string): void {
  for (const candidate of graph.nodes) {
    candidate.arguments = Object.fromEntries(
      Object.entries(candidate.arguments).map(([key, value]) => [
        key,
        replaceReference(value, `nodes.${nodeId}.`, `nodes.${desired}.`),
      ]),
    );
    if (candidate.depends_on) candidate.depends_on = candidate.depends_on.map((id) => (id === nodeId ? desired : id));
  }
  graph.outputs = Object.fromEntries(
    Object.entries(graph.outputs).map(([key, value]) => {
      const replaced = replaceReference(value, `nodes.${nodeId}.`, `nodes.${desired}.`);
      if (!isGraphReference(replaced)) throw new Error(`Invalid graph output reference: ${key}`);
      return [key, replaced];
    }),
  );
}

function renameSidecarReferences(sidecar: EditorSidecar, nodeId: string, desired: string): void {
  if (sidecar.nodes[nodeId]) {
    sidecar.nodes[desired] = sidecar.nodes[nodeId];
    delete sidecar.nodes[nodeId];
  }
  if (sidecar.promotions) {
    sidecar.promotions = Object.fromEntries(
      Object.entries(sidecar.promotions).map(([materialId, promotion]) => [
        materialId === nodeId ? desired : materialId,
        { ...promotion, consumer_id: promotion.consumer_id === nodeId ? desired : promotion.consumer_id },
      ]),
    );
  }
  for (const group of Object.values(sidecar.groups ?? {})) {
    group.node_ids = group.node_ids.map((id) => id === nodeId ? desired : id);
  }
  for (const selection of Object.values(sidecar.selection_sets ?? {})) {
    selection.node_ids = selection.node_ids.map((id) => id === nodeId ? desired : id);
  }
}

export function renameNode(
  graph: WorkflowGraph,
  sidecar: EditorSidecar,
  nodeId: string,
  desired: string,
): { graph: WorkflowGraph; sidecar: EditorSidecar } {
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(desired)) throw new Error('Use a lowercase ID with letters, numbers, and hyphens.');
  if (graph.nodes.some((node) => node.id !== nodeId && node.id === desired)) throw new Error('That node ID is already in use.');
  const nextGraph = clone(graph);
  const nextSidecar = clone(sidecar);
  const node = nextGraph.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) throw new Error(`Unknown node: ${nodeId}`);
  node.id = desired;
  renameGraphReferences(nextGraph, nodeId, desired);
  renameSidecarReferences(nextSidecar, nodeId, desired);
  return { graph: nextGraph, sidecar: nextSidecar };
}

function deleteNodeReferences(graph: WorkflowGraph, nodeId: string): void {
  for (const node of graph.nodes) {
    node.depends_on = node.depends_on?.filter((id) => id !== nodeId);
    if (node.depends_on?.length === 0) delete node.depends_on;
    node.arguments = Object.fromEntries(
      Object.entries(node.arguments).flatMap(([name, value]) => {
        if (isGraphReference(value) && value.$ref.startsWith(`nodes.${nodeId}.`)) return [];
        return [[name, replaceReferencesMatching(value, (reference) => reference.startsWith(`nodes.${nodeId}.`))]];
      }),
    );
  }
  graph.outputs = Object.fromEntries(
    Object.entries(graph.outputs).filter(([, value]) => !value.$ref.startsWith(`nodes.${nodeId}.`)),
  );
}

function deleteSidecarReferences(sidecar: EditorSidecar, nodeId: string): void {
  delete sidecar.nodes[nodeId];
  if (sidecar.promotions) {
    sidecar.promotions = Object.fromEntries(
      Object.entries(sidecar.promotions).filter(
        ([materialId, promotion]) => materialId !== nodeId && promotion.consumer_id !== nodeId,
      ),
    );
  }
  for (const group of Object.values(sidecar.groups ?? {})) {
    group.node_ids = group.node_ids.filter((id) => id !== nodeId);
  }
  for (const selection of Object.values(sidecar.selection_sets ?? {})) {
    selection.node_ids = selection.node_ids.filter((id) => id !== nodeId);
  }
  sidecar.selection_sets = Object.fromEntries(
    Object.entries(sidecar.selection_sets ?? {}).filter(([, selection]) => selection.node_ids.length),
  );
}

export function deleteNode(
  graph: WorkflowGraph,
  sidecar: EditorSidecar,
  nodeId: string,
): { graph: WorkflowGraph; sidecar: EditorSidecar } {
  const nextGraph = clone(graph);
  const nextSidecar = clone(sidecar);
  nextGraph.nodes = nextGraph.nodes.filter((node) => node.id !== nodeId);
  deleteNodeReferences(nextGraph, nodeId);
  deleteSidecarReferences(nextSidecar, nodeId);
  return { graph: nextGraph, sidecar: nextSidecar };
}

export function connectNodeOutput(
  graph: WorkflowGraph,
  sourceNodeId: string,
  sourceOutput: string,
  targetNodeId: string,
  targetInput: string,
): WorkflowGraph {
  const next = clone(graph);
  const target = next.nodes.find((node) => node.id === targetNodeId);
  if (!target) throw new Error(`Unknown target node: ${targetNodeId}`);
  const path = argumentPathFromHandle(targetInput) ?? [targetInput];
  const [fieldName, ...nestedPath] = path;
  if (!(fieldName in target.arguments) && nestedPath.length) {
    throw new Error(`Unknown target argument: ${fieldName}`);
  }
  if (!nestedPath.length) {
    target.arguments[fieldName] = { $ref: `nodes.${sourceNodeId}.outputs.${sourceOutput}` };
  } else {
    target.arguments[fieldName] = setValueAtPath(
      target.arguments[fieldName],
      nestedPath,
      { $ref: `nodes.${sourceNodeId}.outputs.${sourceOutput}` },
    );
  }
  return next;
}

export function connectGraphInput(
  graph: WorkflowGraph,
  inputName: string,
  targetNodeId: string,
  targetInput: string,
): WorkflowGraph {
  const next = clone(graph);
  if (!next.inputs[inputName]) throw new Error(`Unknown graph input: ${inputName}`);
  const target = next.nodes.find((node) => node.id === targetNodeId);
  if (!target) throw new Error(`Unknown target node: ${targetNodeId}`);
  const path = argumentPathFromHandle(targetInput) ?? [targetInput];
  const [fieldName, ...nestedPath] = path;
  if (!(fieldName in target.arguments) && nestedPath.length) {
    throw new Error(`Unknown target argument: ${fieldName}`);
  }
  const reference = graphInputReference(inputName);
  if (!nestedPath.length) target.arguments[fieldName] = reference;
  else {
    target.arguments[fieldName] = setValueAtPath(
      target.arguments[fieldName],
      nestedPath,
      reference,
    );
  }
  return next;
}

function nodeDependencies(node: WorkflowNode): Set<string> {
  const dependencies = new Set(node.depends_on ?? []);
  for (const value of Object.values(node.arguments)) {
    for (const reference of referencesIn(value)) {
      const match = /^nodes\.([a-z][a-z0-9-]*)\.outputs\./.exec(reference);
      if (match) dependencies.add(match[1]);
    }
  }
  return dependencies;
}

export function wouldCreateDependencyCycle(graph: WorkflowGraph, sourceNodeId: string, targetNodeId: string): boolean {
  if (sourceNodeId === targetNodeId) return true;
  const dependents = new Map<string, Set<string>>();
  for (const node of graph.nodes) {
    for (const dependency of nodeDependencies(node)) {
      const values = dependents.get(dependency) ?? new Set<string>();
      values.add(node.id);
      dependents.set(dependency, values);
    }
  }
  const pending = [targetNodeId];
  const visited = new Set<string>();
  while (pending.length) {
    const current = pending.pop();
    if (!current || visited.has(current)) continue;
    if (current === sourceNodeId) return true;
    visited.add(current);
    pending.push(...(dependents.get(current) ?? []));
  }
  return false;
}

export function connectOrderingDependency(
  graph: WorkflowGraph,
  sourceNodeId: string,
  targetNodeId: string,
): WorkflowGraph {
  if (wouldCreateDependencyCycle(graph, sourceNodeId, targetNodeId)) {
    throw new Error('That ordering edge would create a cycle.');
  }
  const next = clone(graph);
  const target = next.nodes.find((node) => node.id === targetNodeId);
  if (!target) throw new Error(`Unknown target node: ${targetNodeId}`);
  target.depends_on = [...new Set([...(target.depends_on ?? []), sourceNodeId])];
  return next;
}

export function disconnectNodeInput(graph: WorkflowGraph, targetNodeId: string, targetInput: string): WorkflowGraph {
  const next = clone(graph);
  const target = next.nodes.find((node) => node.id === targetNodeId);
  if (!target) return next;
  const path = argumentPathFromHandle(targetInput) ?? [targetInput];
  const [fieldName, ...nestedPath] = path;
  if (!nestedPath.length) delete target.arguments[fieldName];
  else if (fieldName in target.arguments) {
    target.arguments[fieldName] = setValueAtPath(target.arguments[fieldName], nestedPath, null);
  }
  return next;
}

export function disconnectOrderingDependency(
  graph: WorkflowGraph,
  sourceNodeId: string,
  targetNodeId: string,
): WorkflowGraph {
  const next = clone(graph);
  const target = next.nodes.find((node) => node.id === targetNodeId);
  if (!target) return next;
  target.depends_on = target.depends_on?.filter((dependency) => dependency !== sourceNodeId);
  if (!target.depends_on?.length) delete target.depends_on;
  return next;
}

export function connectGraphOutput(
  graph: WorkflowGraph,
  outputName: string,
  sourceNodeId: string,
  sourceOutput: string,
): WorkflowGraph {
  if (!(outputName in graph.outputs)) throw new Error(`Unknown graph output: ${outputName}`);
  const next = clone(graph);
  next.outputs[outputName] = { $ref: `nodes.${sourceNodeId}.outputs.${sourceOutput}` };
  return next;
}

export function addGraphOutput(
  graph: WorkflowGraph,
  sidecar: EditorSidecar,
  sourceNodeId: string,
  sourceOutput: string,
): { graph: WorkflowGraph; sidecar: EditorSidecar; name: string } {
  const nextGraph = clone(graph);
  const nextSidecar = clone(sidecar);
  const name = uniqueId(sourceOutput.replaceAll('_', '-'), Object.keys(nextGraph.outputs));
  nextGraph.outputs[name] = { $ref: `nodes.${sourceNodeId}.outputs.${sourceOutput}` };
  const sourcePosition = nextSidecar.nodes[sourceNodeId] ?? { x: 80, y: 80 };
  nextSidecar.outputs = {
    ...nextSidecar.outputs,
    [name]: { x: sourcePosition.x + 380, y: sourcePosition.y },
  };
  return { graph: nextGraph, sidecar: nextSidecar, name };
}

export function renameGraphOutput(
  graph: WorkflowGraph,
  sidecar: EditorSidecar,
  oldName: string,
  newName: string,
): { graph: WorkflowGraph; sidecar: EditorSidecar } {
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(newName)) throw new Error('Use a lowercase output ID.');
  if (oldName !== newName && newName in graph.outputs) throw new Error('That output ID is already in use.');
  const nextGraph = clone(graph);
  const nextSidecar = clone(sidecar);
  const reference = nextGraph.outputs[oldName];
  if (!reference) throw new Error(`Unknown graph output: ${oldName}`);
  delete nextGraph.outputs[oldName];
  nextGraph.outputs[newName] = reference;
  if (nextSidecar.outputs?.[oldName]) {
    nextSidecar.outputs[newName] = nextSidecar.outputs[oldName];
    delete nextSidecar.outputs[oldName];
  }
  return { graph: nextGraph, sidecar: nextSidecar };
}

export function deleteGraphOutput(
  graph: WorkflowGraph,
  sidecar: EditorSidecar,
  name: string,
): { graph: WorkflowGraph; sidecar: EditorSidecar } {
  const nextGraph = clone(graph);
  const nextSidecar = clone(sidecar);
  delete nextGraph.outputs[name];
  if (nextSidecar.outputs) delete nextSidecar.outputs[name];
  return { graph: nextGraph, sidecar: nextSidecar };
}

export function graphInputReference(name: string): GraphReference {
  return { $ref: `inputs.${name}` };
}

export function addGraphInput(
  graph: WorkflowGraph,
  values: JsonObject,
): { graph: WorkflowGraph; values: JsonObject; name: string } {
  const nextGraph = clone(graph);
  const nextValues = clone(values);
  const name = uniqueId('input', Object.keys(nextGraph.inputs));
  nextGraph.inputs[name] = { type: 'string', required: true };
  nextValues[name] = '';
  return { graph: nextGraph, values: nextValues, name };
}

export function renameGraphInput(
  graph: WorkflowGraph,
  values: JsonObject,
  oldName: string,
  newName: string,
): { graph: WorkflowGraph; values: JsonObject } {
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(newName)) throw new Error('Use a lowercase input ID.');
  if (oldName !== newName && newName in graph.inputs) throw new Error('That input ID is already in use.');
  const nextGraph = clone(graph);
  const nextValues = clone(values);
  const definition = nextGraph.inputs[oldName];
  if (!definition) throw new Error(`Unknown input: ${oldName}`);
  delete nextGraph.inputs[oldName];
  nextGraph.inputs[newName] = definition;
  if (oldName in nextValues) {
    nextValues[newName] = nextValues[oldName];
    delete nextValues[oldName];
  }
  for (const node of nextGraph.nodes) {
    node.arguments = Object.fromEntries(
      Object.entries(node.arguments).map(([key, value]) => [
        key,
        replaceReference(value, `inputs.${oldName}`, `inputs.${newName}`),
      ]),
    );
  }
  return { graph: nextGraph, values: nextValues };
}

export function updateGraphInput(
  graph: WorkflowGraph,
  name: string,
  update: Partial<GraphInputDefinition>,
): WorkflowGraph {
  const next = clone(graph);
  next.inputs[name] = { ...next.inputs[name], ...update };
  return next;
}

export function commandPayload<T>(document: { result?: T | null }): T | null {
  return document.result ?? null;
}

export function collectExecutorReferences(value: unknown, found = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((item) => collectExecutorReferences(item, found));
  else if (value && typeof value === 'object') {
    const candidate = recordValue(value, 'executor document');
    if (typeof candidate.name === 'string' && (candidate.kind === 'ssh' || candidate.kind === 'relay')) {
      found.add(`${candidate.kind}:${candidate.name}`);
    }
    Object.values(candidate).forEach((item) => collectExecutorReferences(item, found));
  }
  return found;
}
