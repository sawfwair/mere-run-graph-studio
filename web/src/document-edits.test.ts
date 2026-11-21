import { describe, expect, it } from 'vitest';

import {
  addAssetInputs,
  deleteElements,
  moveElements,
  removeInputs,
  removeNodes,
} from './document-edits';
import {
  addCatalogNode,
  addEditorNote,
  addGraphInput,
  addGraphOutput,
  connectGraphInput,
  connectNodeOutput,
  createGraph,
  createSidecar,
  editorNoteNodeId,
  graphInputNodeId,
  graphOutputNodeId,
  setNodeArgument,
} from './graph';
import { sameNodeData } from './node-data';
import { commitHistory, documentKey, redoHistory, undoHistory, type DocumentHistory } from './history';
import type { CatalogEntry, StudioDocument } from './types';

const imageEntry: CatalogEntry = {
  kind: 'image.generate',
  title: 'Generate image',
  category: 'image',
  provider: { id: 'mere.run' },
  inputs: [{ name: 'prompt', type: 'string', required: true }],
  outputs: [{ name: 'image', type: 'asset' }],
};

const videoEntry: CatalogEntry = {
  kind: 'video.generate',
  title: 'Generate video',
  category: 'video',
  provider: { id: 'mere.run' },
  inputs: [
    { name: 'prompt', type: 'string', required: true },
    { name: 'image', type: 'asset', required: false },
  ],
  outputs: [{ name: 'video', type: 'asset' }],
};

/** image ← input "input"; video.image ← image; output "video" ← video; one note. */
function fixture(): StudioDocument & { imageId: string; videoId: string; inputName: string; outputName: string; noteName: string } {
  const image = addCatalogNode(createGraph(), createSidecar(), imageEntry);
  const video = addCatalogNode(image.graph, image.sidecar, videoEntry);
  const input = addGraphInput(video.graph, {});
  let graph = connectGraphInput(input.graph, input.name, image.nodeId, 'prompt');
  graph = connectNodeOutput(graph, image.nodeId, 'image', video.nodeId, 'image');
  const output = addGraphOutput(graph, video.sidecar, video.nodeId, 'video');
  const note = addEditorNote(output.sidecar);
  return {
    graph: output.graph,
    inputs: input.values,
    sidecar: { ...note.sidecar, inputs: { [input.name]: { x: 0, y: 0 } } },
    imageId: image.nodeId,
    videoId: video.nodeId,
    inputName: input.name,
    outputName: output.name,
    noteName: note.name,
  };
}

function documentOf(value: ReturnType<typeof fixture>): StudioDocument {
  return { graph: value.graph, inputs: value.inputs, sidecar: value.sidecar };
}

describe('document edits', () => {
  it('deletes a mixed selection of nodes, inputs, outputs, notes, and their edges in one edit', () => {
    const value = fixture();
    const next = deleteElements(documentOf(value), {
      nodeIds: [value.imageId],
      inputNames: [value.inputName],
      outputNames: [value.outputName],
      editorIds: [editorNoteNodeId(value.noteName)],
      edges: [{ kind: 'data', targetNodeId: value.videoId, targetInput: 'image' }],
    });
    expect(next.graph.nodes.map((node) => node.id)).toEqual([value.videoId]);
    expect(next.graph.inputs).toEqual({});
    expect(next.inputs).toEqual({});
    expect(next.graph.outputs).toEqual({});
    expect(next.sidecar.inputs).toEqual({});
    expect(next.sidecar.notes).toEqual({});
    expect(next.sidecar.nodes[value.imageId]).toBeUndefined();
    expect(next.graph.nodes[0]?.arguments.image).toBeUndefined();
  });

  it('removes an output through its edge and ignores elements that are already gone', () => {
    const value = fixture();
    const once = deleteElements(documentOf(value), {
      nodeIds: [], inputNames: [], outputNames: [], editorIds: [],
      edges: [{ kind: 'output', outputName: value.outputName }],
    });
    expect(once.graph.outputs).toEqual({});
    const again = deleteElements(once, {
      nodeIds: ['missing'], inputNames: ['missing'], outputNames: [value.outputName], editorIds: [],
      edges: [{ kind: 'output', outputName: value.outputName }],
    });
    expect(again).toBe(once);
  });

  it('drops arguments that reference a deleted input', () => {
    const value = fixture();
    const next = removeInputs(documentOf(value), [value.inputName]);
    const image = next.graph.nodes.find((node) => node.id === value.imageId);
    expect(image?.arguments.prompt).toBeUndefined();
    expect(removeInputs(next, [value.inputName])).toBe(next);
    expect(removeNodes(next, ['missing'])).toBe(next);
  });

  it('stores every element moved by one drag and keeps node display state', () => {
    const value = fixture();
    const sidecar = {
      ...value.sidecar,
      nodes: { ...value.sidecar.nodes, [value.imageId]: { x: 0, y: 0, collapsed: true } },
    };
    const moved = moveElements(sidecar, [
      { id: value.imageId, position: { x: 160, y: 32 } },
      { id: value.videoId, position: { x: 480, y: 32 } },
      { id: graphInputNodeId(value.inputName), position: { x: 16, y: 16 } },
      { id: graphOutputNodeId(value.outputName), position: { x: 800, y: 48 } },
      { id: editorNoteNodeId(value.noteName), position: { x: 64, y: 400 } },
    ]);
    expect(moved.nodes[value.imageId]).toEqual({ x: 160, y: 32, collapsed: true });
    expect(moved.nodes[value.videoId]).toMatchObject({ x: 480, y: 32 });
    expect(moved.inputs?.[value.inputName]).toEqual({ x: 16, y: 16 });
    expect(moved.outputs?.[value.outputName]).toEqual({ x: 800, y: 48 });
    expect(moved.notes?.[value.noteName]).toMatchObject({ x: 64, y: 400 });
    expect(sidecar.nodes[value.imageId]).toEqual({ x: 0, y: 0, collapsed: true });
    expect(moveElements(sidecar, [])).toBe(sidecar);
  });

  it('adds uniquely named asset inputs against the document it is applied to', () => {
    const value = fixture();
    const assets = [
      { name: 'photo.png', path: 'assets/photo.png', content_type: 'image/png' },
      { name: 'photo.jpg', path: 'assets/photo.jpg', content_type: 'image/jpeg' },
    ];
    const { document, created } = addAssetInputs(documentOf(value), assets, { x: 100.4, y: 50 });
    expect(created).toEqual(['photo', 'photo-2']);
    expect(document.inputs).toMatchObject({ photo: 'assets/photo.png', 'photo-2': 'assets/photo.jpg' });
    expect(document.graph.inputs.photo).toMatchObject({ type: 'asset', required: true });
    expect(document.sidecar.inputs?.['photo-2']).toEqual({ x: 356, y: 50 });
    expect(document.sidecar.inputs?.[value.inputName]).toEqual({ x: 0, y: 0 });
  });
});

describe('document history', () => {
  const start = (): DocumentHistory => {
    const present = documentOf(fixture());
    return { past: [], present, future: [], savedKey: documentKey(present) };
  };
  const panned = (document: StudioDocument, x: number): StudioDocument => ({
    ...document,
    sidecar: { ...document.sidecar, viewport: { x, y: 0, zoom: 1 } },
  });

  it('keeps viewport changes without an undo step or unsaved changes', () => {
    const history = start();
    const next = commitHistory(history, panned(history.present, 240));
    expect(next.past).toHaveLength(0);
    expect(next.present.sidecar.viewport.x).toBe(240);
    expect(documentKey(next.present)).toBe(history.savedKey);
  });

  it('records edits and keeps the current viewport across undo and redo', () => {
    const history = start();
    const edited = commitHistory(history, removeNodes(history.present, [history.present.graph.nodes[0]?.id ?? '']));
    expect(edited.past).toHaveLength(1);
    const moved = commitHistory(edited, panned(edited.present, 512));
    const undone = undoHistory(moved);
    expect(undone.present.graph.nodes).toHaveLength(2);
    expect(undone.present.sidecar.viewport.x).toBe(512);
    const redone = redoHistory(undone);
    expect(redone.present.graph.nodes).toHaveLength(1);
    expect(redone.present.sidecar.viewport.x).toBe(512);
    expect(undoHistory(start())).toEqual(start());
  });
});

describe('canvas node edits', () => {
  it('changes one argument without replacing the other nodes', () => {
    const value = fixture();
    const next = setNodeArgument(value.graph, value.videoId, 'prompt', 'a slow pan');
    const video = next.nodes.find((node) => node.id === value.videoId);
    expect(video?.arguments.prompt).toBe('a slow pan');
    expect(next.nodes.find((node) => node.id === value.imageId)).toBe(value.graph.nodes.find((node) => node.id === value.imageId));
    const cleared = setNodeArgument(next, value.videoId, 'prompt', undefined);
    expect(cleared.nodes.find((node) => node.id === value.videoId)?.arguments).not.toHaveProperty('prompt');
  });

  it('treats rebuilt node data as unchanged when it shows the same thing', () => {
    const bound = new Set(['onPin']);
    const load = () => undefined;
    const preview = { runId: 'run-1', state: 'finished', items: [] };
    const data = { ordinal: 1, preview, load, onPin: () => undefined };
    expect(sameNodeData(data, { ordinal: 1, preview: structuredClone(preview), load, onPin: () => undefined }, bound)).toBe(true);
    expect(sameNodeData(data, { ordinal: 1, preview: { ...preview, state: 'running' }, load, onPin: () => undefined }, bound)).toBe(false);
    expect(sameNodeData(data, { ordinal: 1, preview, load, onPin: undefined }, bound)).toBe(false);
    expect(sameNodeData(data, { ordinal: 2, preview, load, onPin: () => undefined }, bound)).toBe(false);
    expect(sameNodeData(data, { ordinal: 1, preview, load: () => undefined, onPin: () => undefined }, bound)).toBe(false);
  });
});
