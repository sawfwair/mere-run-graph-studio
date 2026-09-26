import { describe, expect, it } from 'vitest';
import { saveBoardOutput, removeBoardOutput } from './creative-board';
import { createSidecar } from './graph';
import { decodeEditorSidecar } from './decode';

describe('comparison board', () => {
  const preview = { runId: 'run-1', state: 'finished', items: [],
    context: { model: 'image-model', seed: '42', prompt: 'private prompt stays outside board' } };
  const item = { artifact: { name: 'image.png', kind: 'graph.node-output', path: 'outputs/image.png',
    content_type: 'image/png', sha256: 'a'.repeat(64) } };

  it('survives sidecar round-trip without copying prompt or media bytes', () => {
    const saved = saveBoardOutput(createSidecar(), 'image-1', preview, item, '2026-09-26T00:00:00.000Z');
    const decoded = decodeEditorSidecar(JSON.parse(JSON.stringify(saved.sidecar)));
    expect(decoded.board).toEqual([saved.item]);
    expect(JSON.stringify(decoded)).not.toContain('private prompt');
    expect(saved.item.model).toBe('image-model');
    expect(saveBoardOutput(decoded, 'image-1', preview, item).sidecar).toBe(decoded);
    expect(removeBoardOutput(decoded, saved.item.id).board).toEqual([]);
  });

  it('rejects intermediate and unfinished outputs', () => {
    expect(() => saveBoardOutput(createSidecar(), 'image-1', { ...preview, intermediate: true }, item)).toThrow('Only completed');
    expect(() => saveBoardOutput(createSidecar(), 'image-1', { ...preview, state: 'running' }, item)).toThrow('Only completed');
  });
});
