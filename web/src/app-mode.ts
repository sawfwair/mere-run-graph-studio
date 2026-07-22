import { friendlyLabel } from './ui';
import { nodePreviews, type NodeRunPreviewItem } from './run-preview';
import type {
  EditorAppConfig,
  EditorSidecar,
  GraphInputDefinition,
  JsonObject,
  JsonValue,
  StudioRun,
  WorkflowGraph,
} from './types';

// Run-as-App turns a graph into a run-only surface: exposed graph inputs become
// a form, graph outputs become a results gallery. Everything here is pure so the
// contract can be unit-tested without a runtime or the DOM.

export interface AppField {
  name: string;
  definition: GraphInputDefinition;
  label: string;
  locked: boolean;
}

const appConfig = (sidecar: EditorSidecar): EditorAppConfig => sidecar.app ?? {};

export function appTitle(graph: WorkflowGraph, sidecar: EditorSidecar): string {
  const configured = appConfig(sidecar).title?.trim();
  if (configured) return configured;
  return graph.name && graph.name !== 'Untitled workflow' ? graph.name : 'Your app';
}

export function appTagline(sidecar: EditorSidecar): string {
  return appConfig(sidecar).tagline?.trim() ?? '';
}

/** Ordered, visible fields for the app form. Hidden inputs are dropped; the rest
 *  are sorted by explicit order then by their position in the graph. */
export function appFields(graph: WorkflowGraph, sidecar: EditorSidecar): AppField[] {
  const fields = appConfig(sidecar).fields ?? {};
  const order = Object.keys(graph.inputs);
  return order
    .filter((name) => !fields[name]?.hidden)
    .map((name) => ({ name, position: order.indexOf(name) }))
    .sort((left, right) => {
      const leftOrder = fields[left.name]?.order;
      const rightOrder = fields[right.name]?.order;
      if (leftOrder !== undefined || rightOrder !== undefined) {
        return (leftOrder ?? left.position) - (rightOrder ?? right.position);
      }
      return left.position - right.position;
    })
    .map(({ name }) => ({
      name,
      definition: graph.inputs[name],
      label: fields[name]?.label?.trim() || friendlyLabel(name),
      locked: fields[name]?.locked === true,
    }));
}

export interface ResolvedOutput {
  name: string;
  nodeId: string;
  outputName: string;
}

const OUTPUT_REF = /^nodes\.([a-z][a-z0-9-]*)\.outputs\.(.+)$/;

/** Graph outputs resolved back to the producing node + output they name. */
export function resolveOutputs(graph: WorkflowGraph): ResolvedOutput[] {
  return Object.entries(graph.outputs).flatMap(([name, reference]) => {
    const match = OUTPUT_REF.exec(reference.$ref);
    return match ? [{ name, nodeId: match[1], outputName: match[2] }] : [];
  });
}

export interface OutputResult extends ResolvedOutput {
  item: NodeRunPreviewItem | null;
}

/** Pair each graph output with the matching produced item from a finished run. */
export function outputResults(graph: WorkflowGraph, run: StudioRun | null): OutputResult[] {
  const previews = run ? nodePreviews(run) : {};
  return resolveOutputs(graph).map((output) => {
    const preview = previews[output.nodeId];
    const item = preview?.items.find((candidate) => candidate.outputName === output.outputName)
      ?? preview?.items[0]
      ?? null;
    return { ...output, item };
  });
}

// ---- Variations: fan one setup into N runs by sweeping a single input ----

export interface VariationCandidate {
  name: string;
  label: string;
  kind: 'seed' | 'number' | 'choice';
}

function looksLikeSeed(name: string, definition: GraphInputDefinition): boolean {
  return definition.type === 'integer' && /(^|[_-])seed($|[_-])/i.test(name);
}

/** Inputs we can sweep automatically: seeds, bounded numbers, and choices. */
export function variationCandidates(graph: WorkflowGraph): VariationCandidate[] {
  const candidates: VariationCandidate[] = [];
  for (const [name, definition] of Object.entries(graph.inputs)) {
    const label = friendlyLabel(name);
    if (looksLikeSeed(name, definition)) candidates.push({ name, label, kind: 'seed' });
    else if (definition.type === 'enum' && (definition.values?.length ?? 0) > 1) candidates.push({ name, label, kind: 'choice' });
    else if (definition.type === 'integer' || definition.type === 'number') candidates.push({ name, label, kind: 'number' });
  }
  return candidates;
}

/** Pick the best default dimension to sweep — prefer an explicit seed. */
export function defaultVariationField(graph: WorkflowGraph): VariationCandidate | null {
  const candidates = variationCandidates(graph);
  return candidates.find((candidate) => candidate.kind === 'seed') ?? candidates[0] ?? null;
}

/** Distinct pseudo-random seed values. `random` is injectable for tests. */
export function seedSweep(count: number, random: () => number = Math.random): number[] {
  const seeds = new Set<number>();
  let guard = 0;
  while (seeds.size < count && guard < count * 20) {
    seeds.add(Math.floor(random() * 1_000_000_000));
    guard += 1;
  }
  return [...seeds];
}

export interface Variation {
  label: string;
  value: JsonValue;
}

/** The values to sweep for a chosen dimension, as {label, value} pairs. */
export function variationValues(
  graph: WorkflowGraph,
  base: JsonObject,
  candidate: VariationCandidate,
  count: number,
  random: () => number = Math.random,
): Variation[] {
  const clamped = Math.max(2, Math.min(24, Math.floor(count)));
  const definition = graph.inputs[candidate.name];
  if (candidate.kind === 'choice') {
    return (definition.values ?? []).slice(0, clamped).map((value) => ({ label: value, value }));
  }
  if (candidate.kind === 'number') {
    const min = definition.minimum ?? 0;
    const max = definition.maximum ?? (typeof base[candidate.name] === 'number' ? Number(base[candidate.name]) * 2 : min + clamped);
    const span = max - min;
    return Array.from({ length: clamped }, (_unused, index) => {
      const raw = min + (span * index) / (clamped - 1);
      const value = definition.type === 'integer' ? Math.round(raw) : Math.round(raw * 100) / 100;
      return { label: String(value), value };
    });
  }
  return seedSweep(clamped, random).map((value) => ({ label: `seed ${value}`, value }));
}

/** Build the concrete input objects for a variation sweep. */
export function buildVariationInputs(base: JsonObject, field: string, variations: Variation[]): JsonObject[] {
  return variations.map((variation) => ({ ...base, [field]: variation.value }));
}
