import type { CatalogEntry, JsonObject, JsonValue, WorkflowGraph, WorkflowNode } from './types';
import { recordValue } from './decode';

export interface GraphFleetCapabilities {
  worker_version: string;
  accelerator_backend: string;
  installed_model_ids: string[];
  available_secret_names?: string[];
  providers: Array<{ id: string; version: string; catalog_sha256: string; node_kinds: string[] }>;
  catalog?: {
    graph_kind?: string;
    graph_schema_version?: number;
    job_contract_version?: string;
    nodes?: CatalogEntry[];
    providers?: Array<{ id: string; version: string; catalog_sha256: string; node_kinds: string[] }>;
  };
}

interface AssetManifest {
  schema_version: 1;
  groups: [];
}

export interface GraphSubmission {
  job: {
    contract_version: 'mere.run/job-bundle.v1';
    job_id: string;
    created_at: string;
    graph_fingerprint: string;
    input_fingerprint: string;
    source_graph_fingerprint: string;
    source_input_fingerprint: string;
    requirements: {
      minimum_mere_run_version: string;
      node_kinds: string[];
      model_ids: string[];
      models: [];
      providers: Array<{ id: string; version: string; catalog_sha256: string; node_kinds: string[] }>;
      secret_names: string[];
      accelerator_backends: string[];
    };
    outputs: Array<{ name: string; reference: string }>;
  };
  graph: WorkflowGraph;
  inputs: JsonObject;
  assets: AssetManifest;
  client_id: 'graph-studio-cloud';
}

function canonicalize(value: unknown): JsonValue {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const record = recordValue(value, 'canonical JSON');
  return Object.fromEntries(
    Object.keys(record).filter((key) => record[key] !== undefined).sort().map((key) => [key, canonicalize(record[key])]),
  );
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value)).replace(/[\u007f-\uffff]/g, (character) => (
    `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`
  ));
}

export async function sha256Canonical(value: unknown): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalJson(value)));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function valuesIn(value: JsonValue, key: '$secret'): string[] {
  if (Array.isArray(value)) return value.flatMap((item) => valuesIn(item, key));
  if (!value || typeof value !== 'object') return [];
  const candidate = value[key];
  if (Object.keys(value).length === 1 && typeof candidate === 'string') return [candidate];
  return Object.values(value).flatMap((item) => valuesIn(item, key));
}

function catalogEntry(node: WorkflowNode, entries: CatalogEntry[]): CatalogEntry | undefined {
  const provider = node.provider ?? 'mere.run';
  return entries.find((entry) => entry.kind === node.kind && (entry.provider?.id ?? 'mere.run') === provider);
}

function versionParts(version: string): number[] {
  return version.split('.').slice(0, 3).map((part) => Number.parseInt(part, 10) || 0);
}

function highestVersion(versions: string[]): string {
  return versions.sort((left, right) => {
    const lhs = versionParts(left);
    const rhs = versionParts(right);
    for (let index = 0; index < 3; index += 1) {
      if (lhs[index] !== rhs[index]) return rhs[index] - lhs[index];
    }
    return 0;
  })[0] ?? '0.23.0';
}

function materializeGraph(graph: WorkflowGraph, entries: CatalogEntry[]): WorkflowGraph {
  const materialized = structuredClone(graph);
  for (const node of materialized.nodes) {
    const fields = catalogEntry(node, entries)?.inputs ?? [];
    for (const field of fields) {
      if (node.arguments[field.name] === undefined && field.default !== undefined) {
        node.arguments[field.name] = structuredClone(field.default);
      }
    }
    const seed = fields.find((input) => input.name === 'seed');
    if (seed && node.arguments.seed === undefined) {
      node.arguments.seed = crypto.getRandomValues(new Uint32Array(1))[0] & 0x7fffffff;
    }
  }
  return materialized;
}

function materializeInputs(graph: WorkflowGraph, inputs: JsonObject): JsonObject {
  const materialized = structuredClone(inputs);
  for (const [name, definition] of Object.entries(graph.inputs)) {
    if (materialized[name] === undefined && definition.default !== undefined) {
      materialized[name] = structuredClone(definition.default);
    }
  }
  return materialized;
}

function assertCloudAssetsAbsent(graph: WorkflowGraph, inputs: JsonObject, entries: CatalogEntry[]): void {
  for (const [name, definition] of Object.entries(graph.inputs)) {
    if (definition.type.startsWith('asset') && inputs[name] !== undefined) {
      throw new Error(`Cloud asset upload is required for graph input “${name}”; remove it or use the desktop Studio for this run.`);
    }
  }
  for (const node of graph.nodes) {
    const entry = catalogEntry(node, entries);
    for (const field of entry?.inputs ?? []) {
      if (field.type.startsWith('asset') && node.arguments[field.name] !== undefined) {
        throw new Error(`Cloud asset upload is required for ${node.id}.${field.name}; remove it or use the desktop Studio for this run.`);
      }
    }
  }
}

function requiredProviders(
  graph: WorkflowGraph,
  capabilities: GraphFleetCapabilities,
): GraphSubmission['job']['requirements']['providers'] {
  const providerIds = new Set(graph.nodes.map((node) => node.provider ?? 'mere.run'));
  providerIds.delete('mere.run');
  const providers = capabilities.providers.filter((provider) => providerIds.has(provider.id));
  if (providers.length !== providerIds.size) throw new Error('A graph provider required by this workflow is not connected.');
  return providers;
}

function requiredAccelerators(entries: CatalogEntry[], capabilities: GraphFleetCapabilities): string[] {
  const acceleratorSets = entries
    .map((entry) => entry.requirements?.accelerator_backends ?? [])
    .filter((values) => values.length > 0);
  const backends = acceleratorSets.length
    ? acceleratorSets.reduce((available, values) => available.filter((value) => values.includes(value)))
    : [capabilities.accelerator_backend].filter((value) => value && value !== 'mixed');
  if (!backends.length) throw new Error('The workflow nodes do not share a compatible accelerator backend.');
  return backends.sort();
}

function requiredModels(graph: WorkflowGraph, entries: CatalogEntry[]): string[] {
  const modelIds = new Set(entries.flatMap((entry) => entry.requirements?.model_ids ?? []));
  for (const node of graph.nodes) {
    const model = node.arguments.model;
    if (typeof model === 'string' && model) modelIds.add(model);
  }
  return [...modelIds].sort();
}

function requiredSecrets(graph: WorkflowGraph, capabilities: GraphFleetCapabilities): string[] {
  const names = [...new Set(graph.nodes.flatMap((node) => valuesIn(node.arguments, '$secret')))].sort();
  const unavailable = names.filter((name) => !(capabilities.available_secret_names ?? []).includes(name));
  if (unavailable.length) throw new Error(`Fleet secret configuration is missing: ${unavailable.join(', ')}`);
  return names;
}

function requiredVersion(entries: CatalogEntry[], capabilities: GraphFleetCapabilities): string {
  const versions = entries
    .filter((entry) => (entry.provider?.id ?? 'mere.run') === 'mere.run')
    .map((entry) => entry.provider?.version ?? capabilities.worker_version);
  return highestVersion(versions);
}

export async function buildGraphSubmission(
  graph: WorkflowGraph,
  inputs: JsonObject,
  capabilities: GraphFleetCapabilities,
): Promise<GraphSubmission> {
  const entries = capabilities.catalog?.nodes ?? [];
  if (!graph.nodes.length) throw new Error('Add at least one node before running this workflow.');
  const missingKinds = graph.nodes.filter((node) => !catalogEntry(node, entries));
  if (missingKinds.length) throw new Error(`Fleet catalog does not provide: ${missingKinds.map((node) => node.kind).join(', ')}`);
  assertCloudAssetsAbsent(graph, inputs, entries);
  const [sourceGraphFingerprint, sourceInputFingerprint] = await Promise.all([
    sha256Canonical(graph),
    sha256Canonical(inputs),
  ]);
  const materializedGraph = materializeGraph(graph, entries);
  const materializedInputs = materializeInputs(graph, inputs);
  const selectedEntries = materializedGraph.nodes.map((node) => catalogEntry(node, entries)!);
  const providers = requiredProviders(materializedGraph, capabilities);
  const acceleratorBackends = requiredAccelerators(selectedEntries, capabilities);
  const modelIds = requiredModels(materializedGraph, selectedEntries);
  const secretNames = requiredSecrets(materializedGraph, capabilities);
  const assets: AssetManifest = { schema_version: 1, groups: [] };
  const jobId = crypto.randomUUID().toLowerCase();
  return {
    job: {
      contract_version: 'mere.run/job-bundle.v1',
      job_id: jobId,
      created_at: new Date().toISOString(),
      graph_fingerprint: await sha256Canonical(materializedGraph),
      input_fingerprint: await sha256Canonical({ inputs: materializedInputs, assets }),
      source_graph_fingerprint: sourceGraphFingerprint,
      source_input_fingerprint: sourceInputFingerprint,
      requirements: {
        minimum_mere_run_version: requiredVersion(selectedEntries, capabilities),
        node_kinds: [...new Set(materializedGraph.nodes.map((node) => node.kind))].sort(),
        model_ids: modelIds,
        models: [],
        providers,
        secret_names: secretNames,
        accelerator_backends: acceleratorBackends.sort(),
      },
      outputs: Object.entries(materializedGraph.outputs)
        .map(([name, reference]) => ({ name, reference: reference.$ref }))
        .sort((left, right) => left.name.localeCompare(right.name)),
    },
    graph: materializedGraph,
    inputs: materializedInputs,
    assets,
    client_id: 'graph-studio-cloud',
  };
}
