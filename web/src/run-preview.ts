import type { OutputContext } from './canvas-execution';
import type { JsonObject, JsonValue, RunArtifact, StudioRun } from './types';

export interface NodeRunPreviewItem {
  outputName?: string;
  value?: JsonValue;
  artifact?: RunArtifact;
}

export interface NodeRunPreview {
  runId: string;
  state: string;
  items: NodeRunPreviewItem[];
  context?: OutputContext;
  previous?: boolean;
  intermediate?: boolean;
  updatedAt?: string;
}

function record(value: JsonValue | undefined): JsonObject | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function records(value: JsonValue | undefined): JsonObject[] {
  return Array.isArray(value) ? value.map((item) => record(item)).filter((item) => item !== null) : [];
}

function optionalString(value: JsonValue | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function optionalNumber(value: JsonValue | undefined): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

function artifactItem(raw: JsonObject, fallbackName?: string): NodeRunPreviewItem | null {
  const path = optionalString(raw.path);
  if (!path) return null;
  const name = optionalString(raw.name) ?? fallbackName ?? path;
  return {
    outputName: raw.kind === 'graph.preview' ? 'Preview' : raw.kind === 'graph.node-output' ? 'Output' : name,
    artifact: {
      name,
      kind: optionalString(raw.kind) ?? 'file',
      path,
      content_type: optionalString(raw.content_type),
      size_bytes: optionalNumber(raw.size_bytes),
      sha256: optionalString(raw.sha256),
    },
  };
}

function previewItems(node: JsonObject): NodeRunPreviewItem[] {
  const items: NodeRunPreviewItem[] = [];
  const seenPaths = new Set<string>();
  for (const output of records(node.outputs)) {
    const outputName = optionalString(output.name);
    if (output.value !== undefined) items.push({ outputName, value: output.value });
    const artifact = artifactItem(output, outputName);
    if (!artifact?.artifact) continue;
    seenPaths.add(artifact.artifact.path);
    items.push(artifact);
  }
  for (const rawArtifact of records(node.artifacts)) {
    const artifact = artifactItem(rawArtifact);
    if (!artifact?.artifact || seenPaths.has(artifact.artifact.path)) continue;
    seenPaths.add(artifact.artifact.path);
    items.push(artifact);
  }
  return items;
}

export function runMatchesSource(
  run: StudioRun,
  graphFingerprint: string,
  inputFingerprint: string,
): boolean {
  const manifest = record(run.manifest);
  return manifest?.source_graph_fingerprint === graphFingerprint
    && manifest?.source_input_fingerprint === inputFingerprint;
}

function manifestPreviews(run: StudioRun): Record<string, NodeRunPreview> {
  const previews: Record<string, NodeRunPreview> = {};
  for (const node of records(record(run.manifest)?.nodes)) {
    const id = optionalString(node.id);
    if (!id) continue;
    const items = previewItems(node);
    if (items.length) previews[id] = { runId: run.id, state: optionalString(node.state) ?? 'running', items,
      intermediate: items.some((item) => item.artifact?.kind === 'graph.preview') || undefined };
  }
  return previews;
}
function eventArtifact(value: JsonValue | undefined): NodeRunPreviewItem | null {
  const raw = record(value);
  return raw ? artifactItem(raw) : null;
}
function eventPreviews(run: StudioRun): Record<string, NodeRunPreview> {
  const previews: Record<string, NodeRunPreview> = {};
  for (const event of run.events ?? []) {
    if (!event.node_id || !['artifact_ready', 'preview_ready'].includes(event.type ?? '')) continue;
    const item = eventArtifact(event.artifact);
    if (!item) continue;
    previews[event.node_id] = { runId: run.id, state: event.state ?? 'running', items: [item],
      intermediate: event.type === 'preview_ready', updatedAt: String(event.sequence ?? optionalString(event.created_at) ?? '') };
  }
  return previews;
}
function hostedArtifact(item: NodeRunPreviewItem, run: StudioRun): NodeRunPreviewItem {
  const asset = item.artifact;
  if (!asset) return item;
  const hosted = run.artifacts?.find((candidate) => candidate.name === asset.path
    || candidate.name === asset.name || (asset.sha256 && candidate.sha256 === asset.sha256));
  return hosted ? { ...item, artifact: hosted } : item;
}
export function nodePreviews(run: StudioRun): Record<string, NodeRunPreview> {
  const previews = { ...eventPreviews(run), ...manifestPreviews(run) };
  if (run.remote_reference) {
    for (const preview of Object.values(previews)) preview.items = preview.items.map((item) => hostedArtifact(item, run));
  }
  return previews;
}
