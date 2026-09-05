import { canonicalJson, sha256Canonical } from './cloud-contract';
import { isGraphReference } from './graph';
import type { JsonObject, JsonValue, RunEvent, StudioRun, WorkflowGraph } from './types';

export interface OutputContext { prompt?: string; model?: string; seed?: string }
export interface RunSource {
  graphJson: string;
  inputsJson: string;
  graphHash: string;
  inputHash: string;
  nodes: Record<string, OutputContext>;
}
export interface NodeExecutionState {
  state: string;
  phase?: string;
  fraction?: number;
  detail?: string;
  startedAt?: string;
  completedAt?: string;
}

export function runActive(state: string): boolean {
  return ['starting', 'submitting', 'planned', 'preflighting', 'queued', 'assigned', 'running'].includes(state);
}
export function runStateLabel(state: string): string {
  const labels: Record<string, string> = { planned: 'Waiting', starting: 'Starting', submitting: 'Submitting', preflighting: 'Checking requirements', queued: 'Queued', assigned: 'Assigned', running: 'Running', finished: 'Completed', failed: 'Failed', cancelled: 'Cancelled', skipped: 'Not run', unknown: 'Result unavailable', interrupted: 'Stopped' };
  return labels[state] ?? state;
}
export function jsonRecord(value: JsonValue | undefined): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}
export function jsonRecords(value: JsonValue | undefined): JsonObject[] {
  return Array.isArray(value) ? value.map(jsonRecord) : [];
}
function string(value: JsonValue | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}
function resolved(value: JsonValue | undefined, graph: WorkflowGraph, inputs: JsonObject, depth = 0): JsonValue | undefined {
  if (!isGraphReference(value)) return value;
  if (depth > 8) return undefined;
  if (value.$ref.startsWith('inputs.')) return inputs[value.$ref.slice(7)];
  const match = /^nodes\.([^.]+)\.outputs\./.exec(value.$ref);
  const node = graph.nodes.find((candidate) => candidate.id === match?.[1]);
  if (!node || !['text.value', 'integer.value', 'number.value', 'seed.value', 'choice.value'].includes(node.kind)) return undefined;
  return resolved(node.kind === 'choice.value' ? node.arguments.selected : node.arguments.value, graph, inputs, depth + 1);
}
function contextFor(node: WorkflowGraph['nodes'][number], graph: WorkflowGraph, inputs: JsonObject): OutputContext {
  const prompt = resolved(node.arguments.prompt, graph, inputs);
  const model = resolved(node.arguments.model, graph, inputs);
  const seed = resolved(node.arguments.seed, graph, inputs);
  return { prompt: string(prompt), model: string(model), seed: typeof seed === 'number' ? String(seed) : undefined };
}
export async function captureRunSource(graph: WorkflowGraph, inputs: JsonObject): Promise<RunSource> {
  const [graphHash, inputHash] = await Promise.all([sha256Canonical(graph), sha256Canonical(inputs)]);
  return { graphJson: canonicalJson(graph), inputsJson: canonicalJson(inputs), graphHash, inputHash,
    nodes: Object.fromEntries(graph.nodes.map((node) => [node.id, contextFor(node, graph, inputs)])) };
}

function numeric(value: JsonValue | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
function progressFraction(progress: JsonObject): number | undefined {
  const current = numeric(progress.current);
  const total = numeric(progress.total);
  const ratio = numeric(progress.fraction) ?? (current !== undefined && total !== undefined && total > 0 ? current / total : undefined);
  return ratio !== undefined && ratio >= 0 && ratio <= 1 ? ratio : undefined;
}
function progressDetail(progress: JsonObject): string | undefined {
  const current = numeric(progress.current);
  const total = numeric(progress.total);
  return current !== undefined && total !== undefined ? `${current} / ${total} ${string(progress.unit) ?? ''}`.trim() : undefined;
}
function eventProgress(event: RunEvent): Pick<NodeExecutionState, 'phase' | 'fraction' | 'detail'> {
  const progress = jsonRecord(event.progress);
  return { phase: string(progress.phase) ?? event.phase, fraction: progressFraction(progress), detail: progressDetail(progress) };
}
function applyEvent(previous: NodeExecutionState, event: RunEvent): NodeExecutionState {
  const time = string(event.created_at);
  const next = { ...previous };
  if (event.type === 'node_started' || event.type === 'node_resumed') {
    return { state: 'running', startedAt: time };
  }
  if (event.state) next.state = event.state;
  if (event.type === 'node_preflight_started') next.state = 'preflighting';
  if (event.type === 'node_progress') Object.assign(next, eventProgress(event));
  if (event.type === 'node_finished') { next.completedAt = time; next.fraction = undefined; }
  return next;
}
function terminalNode(state: NodeExecutionState, run: StudioRun): NodeExecutionState {
  if (runActive(run.state) || !runActive(state.state)) return state;
  // A missing node result is not evidence that the node completed successfully.
  const next = state.state === 'planned' ? 'skipped' : run.state === 'finished' ? 'unknown' : run.state === 'failed' ? 'interrupted' : run.state;
  return { ...state, state: next, completedAt: run.updated_at, fraction: undefined };
}
function manifestState(node: JsonObject, previous: NodeExecutionState): NodeExecutionState {
  return { ...previous, state: string(node.state) ?? previous.state,
    startedAt: string(node.started_at) ?? previous.startedAt,
    completedAt: string(node.completed_at) ?? previous.completedAt };
}
function eventAfterCompletion(state: NodeExecutionState, event: RunEvent): boolean {
  if (runActive(state.state)) return true;
  const time = string(event.created_at);
  if (state.completedAt && time) return Date.parse(time) > Date.parse(state.completedAt);
  // Without timestamps, only an explicit new attempt can reopen a terminal node.
  return event.type === 'node_resumed';
}
function applyNodeEvents(states: Record<string, NodeExecutionState>, run: StudioRun): void {
  for (const event of run.events ?? []) {
    const id = event.node_id;
    if (!id || !states[id]) continue;
    if (!eventAfterCompletion(states[id], event)) continue;
    states[id] = applyEvent(states[id], event);
  }
}
export function nodeExecution(run: StudioRun, nodeIds: string[]): Record<string, NodeExecutionState> {
  const states: Record<string, NodeExecutionState> = Object.fromEntries(nodeIds.map((id) => [id, { state: 'planned' }]));
  for (const node of jsonRecords(jsonRecord(run.manifest).nodes)) {
    const id = string(node.id);
    if (id && states[id]) states[id] = manifestState(node, states[id]);
  }
  applyNodeEvents(states, run);
  return Object.fromEntries(Object.entries(states).map(([id, state]) => [id, terminalNode(state, run)]));
}

function mergeManifest(previous: StudioRun, next: StudioRun): JsonValue | undefined {
  if (!next.manifest) return previous.manifest;
  const old = jsonRecord(previous.manifest);
  const fresh = jsonRecord(next.manifest);
  const nodes = new Map(jsonRecords(old.nodes).map((node) => [node.id, node]));
  for (const node of jsonRecords(fresh.nodes)) nodes.set(node.id, { ...nodes.get(node.id), ...node });
  return { ...old, ...fresh, nodes: [...nodes.values()] };
}
export function mergeRunUpdate(previous: StudioRun | null, next: StudioRun): StudioRun {
  if (previous?.id !== next.id) return next;
  const events = new Map((previous.events ?? []).map((event, index) => [event.sequence ?? index, event]));
  for (const [index, event] of (next.events ?? []).entries()) events.set(event.sequence ?? index, event);
  return { ...next, manifest: mergeManifest(previous, next), events: [...events.values()].slice(-5000) };
}

export function elapsedLabel(start: string | undefined, end: string | undefined, now: number): string | null {
  if (!start) return null;
  const from = Date.parse(start);
  const to = end ? Date.parse(end) : now;
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  const seconds = Math.max(0, Math.floor((to - from) / 1000));
  return seconds < 60 ? `${seconds} s` : `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
}
