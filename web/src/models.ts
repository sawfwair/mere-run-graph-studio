import { clone } from './graph';
import type { CatalogEntry, JsonObject, JsonValue, WorkflowGraph } from './types';

// Generation nodes choose their model through a free-string `model` argument —
// the catalog does not enumerate options. The option list is exactly the set of
// models the executor reports as installed (surfaced by `mere.run executor list
// --json` as `installed_model_ids` on each node / relay fleet worker), plus
// whatever value is already set. We never invent a "known universe" of models:
// showing a model that is not installed would only produce a preflight failure.

export const MODEL_FIELD = 'model';

/** Does this node expose a swappable model? Returns the field name or null. */
export function modelFieldFor(entry: CatalogEntry | undefined): string | null {
  if (!entry) return null;
  const field = entry.inputs.find((candidate) => candidate.name === MODEL_FIELD && (candidate.type === 'string' || candidate.type === 'enum'));
  return field ? field.name : null;
}

function categoryPrefix(entry: CatalogEntry | undefined): string {
  if (entry?.category === 'video') return 'video-';
  if (entry?.category === 'image') return 'image-';
  return '';
}

const isObject = (value: JsonValue | undefined): value is JsonObject =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/** Extract installed model ids from the `mere.run executor list --json` document,
 *  wherever the probe surfaces them (installed_model_ids, installed_models,
 *  capabilities.models). Requirement lists and preferences are ignored. */
export function parseInstalledModels(document: JsonValue | undefined): string[] {
  const found = new Set<string>();
  const keys = new Set(['installed_model_ids', 'installedmodelids', 'installed_models', 'models']);
  const walk = (value: JsonValue | undefined) => {
    if (Array.isArray(value)) { value.forEach(walk); return; }
    if (!isObject(value)) return;
    for (const [key, nested] of Object.entries(value)) {
      if (keys.has(key.toLowerCase()) && Array.isArray(nested)) {
        for (const item of nested) {
          if (typeof item === 'string') found.add(item);
          else if (isObject(item) && typeof item.id === 'string') found.add(item.id);
        }
      }
      walk(nested);
    }
  };
  walk(document);
  return [...found];
}

/** Candidate models for a node: the value already set (so the picker reflects
 *  reality) plus installed models that match the node's media category. Nothing
 *  that is not installed is ever offered — deduped, ordered. */
export function candidateModels(entry: CatalogEntry | undefined, current: JsonValue | undefined, installed: string[] = []): string[] {
  const prefix = categoryPrefix(entry);
  const matchesCategory = (id: string) => (prefix ? id.startsWith(prefix) : true);
  const ordered: string[] = [];
  const add = (id: string) => { if (id && !ordered.includes(id)) ordered.push(id); };
  if (typeof current === 'string') add(current);
  installed.filter(matchesCategory).forEach(add);
  return ordered;
}

/** Constant model values referenced by nodes (wired $ref models are skipped). */
export function referencedModels(graph: WorkflowGraph): { nodeId: string; model: string }[] {
  const referenced: { nodeId: string; model: string }[] = [];
  for (const node of graph.nodes) {
    const value = node.arguments[MODEL_FIELD];
    if (typeof value === 'string' && value) referenced.push({ nodeId: node.id, model: value });
  }
  return referenced;
}

/** Referenced models absent from the installed set — the ones a portable graph
 *  brought that this target can't run. Deduped, in first-seen order. */
export function missingModels(graph: WorkflowGraph, installed: string[]): string[] {
  const have = new Set(installed);
  const missing: string[] = [];
  for (const { model } of referencedModels(graph)) {
    if (!have.has(model) && !missing.includes(model)) missing.push(model);
  }
  return missing;
}

/** Per-executor installed models, keyed by each executor's identifier, parsed
 *  best-effort from `mere.run executor list --json` so a missing model can be
 *  routed to an executor that does have it. */
export function parseInstalledModelsByExecutor(document: JsonValue | undefined): Record<string, string[]> {
  const byExecutor: Record<string, string[]> = {};
  const idKeys = ['reference', 'id', 'name', 'target', 'executor'];
  const visit = (value: JsonValue | undefined) => {
    if (Array.isArray(value)) { value.forEach(visit); return; }
    if (!isObject(value)) return;
    const identifier = idKeys.map((key) => value[key]).find((candidate) => typeof candidate === 'string') as string | undefined;
    if (identifier) {
      const models = parseInstalledModels(value);
      if (models.length) byExecutor[identifier] = [...new Set([...(byExecutor[identifier] ?? []), ...models])];
    }
    for (const nested of Object.values(value)) visit(nested);
  };
  visit(document);
  return byExecutor;
}

/** Executor identifiers whose installed set contains the model. */
export function executorsWithModel(byExecutor: Record<string, string[]>, model: string): string[] {
  return Object.entries(byExecutor).filter(([, models]) => models.includes(model)).map(([identifier]) => identifier);
}

/** Build one graph variant per model, overriding arguments.model on the target
 *  node. The source graph is never mutated. */
export function buildModelVariants(graph: WorkflowGraph, nodeId: string, models: string[]): { model: string; graph: WorkflowGraph }[] {
  return models.map((model) => {
    const next = clone(graph);
    const node = next.nodes.find((candidate) => candidate.id === nodeId);
    if (node) node.arguments = { ...node.arguments, [MODEL_FIELD]: model };
    return { model, graph: next };
  });
}
