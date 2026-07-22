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
    outputName: name,
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
    if (output.value !== undefined && output.value !== null) items.push({ outputName, value: output.value });
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

export function nodePreviews(run: StudioRun): Record<string, NodeRunPreview> {
  const manifest = record(run.manifest);
  const previews: Record<string, NodeRunPreview> = {};
  for (const node of records(manifest?.nodes)) {
    const id = optionalString(node.id);
    if (!id || node.state !== 'finished') continue;
    const items = previewItems(node);
    if (items.length) previews[id] = { runId: run.id, state: String(node.state), items };
  }
  return previews;
}
