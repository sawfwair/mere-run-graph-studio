import type { NodeRunPreview, NodeRunPreviewItem } from './run-preview';
import type { EditorBoardItem, EditorSidecar } from './types';

function boardItem(nodeId: string, preview: NodeRunPreview, item: NodeRunPreviewItem, createdAt: string): EditorBoardItem {
  const artifact = item.artifact!;
  return { id: crypto.randomUUID(), node_id: nodeId, run_id: preview.runId,
    path: artifact.path, name: item.outputName ?? artifact.name, created_at: createdAt,
    content_type: artifact.content_type, sha256: artifact.sha256,
    model: preview.context?.model, seed: preview.context?.seed };
}

export function saveBoardOutput(
  sidecar: EditorSidecar,
  nodeId: string,
  preview: NodeRunPreview,
  item: NodeRunPreviewItem,
  createdAt = new Date().toISOString(),
): { sidecar: EditorSidecar; item: EditorBoardItem } {
  const artifact = item.artifact;
  if (!artifact || preview.intermediate || preview.state !== 'finished') {
    throw new Error('Only completed media outputs can be saved to the board.');
  }
  const board = sidecar.board ?? [];
  const existing = board.find((entry) => entry.run_id === preview.runId && entry.path === artifact.path);
  if (existing) return { sidecar, item: existing };
  if (board.length >= 100) throw new Error('The board can hold at most 100 outputs.');
  const saved = boardItem(nodeId, preview, item, createdAt);
  return { sidecar: { ...sidecar, board: [...board, saved] }, item: saved };
}

export function removeBoardOutput(sidecar: EditorSidecar, id: string): EditorSidecar {
  return { ...sidecar, board: (sidecar.board ?? []).filter((item) => item.id !== id) };
}
