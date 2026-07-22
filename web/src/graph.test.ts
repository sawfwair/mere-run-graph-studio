import { describe, expect, it } from 'vitest';

import {
  addCatalogNode,
  addEditorGroup,
  addEditorNote,
  addGraphOutput,
  alignEditorNodes,
  argumentPathHandle,
  autoLayoutGraph,
  collectExecutorReferences,
  connectGraphInput,
  connectOrderingDependency,
  connectNodeOutput,
  createGraph,
  createSidecar,
  deleteGraphOutput,
  deleteNode,
  defaultSchemaValue,
  disconnectNodeInput,
  disconnectOrderingDependency,
  graphOutputName,
  graphOutputNodeId,
  inlineMaterialNode,
  layoutEditorNodes,
  promoteNodeArgument,
  referencesWithPaths,
  renameNode,
  renameGraphOutput,
  saveEditorSelection,
  wouldCreateDependencyCycle,
} from './graph';
import type { CatalogEntry } from './types';

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

describe('graph editing', () => {
  it('adds catalog nodes with deterministic ids and separate positions', () => {
    const first = addCatalogNode(createGraph(), createSidecar(), imageEntry);
    const second = addCatalogNode(first.graph, first.sidecar, imageEntry);

    expect(first.nodeId).toBe('generate');
    expect(second.nodeId).toBe('generate-2');
    expect(second.graph.nodes[0].arguments.prompt).toBe('');
    expect(second.sidecar.nodes['generate-2']).toEqual({ x: 400, y: 80 });
    expect(JSON.stringify(second.graph)).not.toContain('"x"');
  });

  it('connects, renames, and deletes without leaving stale references', () => {
    const image = addCatalogNode(createGraph(), createSidecar(), imageEntry);
    const video = addCatalogNode(image.graph, image.sidecar, videoEntry);
    const connected = connectNodeOutput(video.graph, image.nodeId, 'image', video.nodeId, 'image');
    connected.outputs.final = { $ref: `nodes.${video.nodeId}.outputs.video` };
    const renamed = renameNode(connected, video.sidecar, image.nodeId, 'source-image');

    expect(renamed.graph.nodes[1].arguments.image).toEqual({ $ref: 'nodes.source-image.outputs.image' });
    expect(renamed.sidecar.nodes['source-image']).toBeDefined();
    const deleted = deleteNode(renamed.graph, renamed.sidecar, 'source-image');
    expect(deleted.graph.nodes[0].arguments.image).toBeUndefined();
    expect(deleted.sidecar.nodes['source-image']).toBeUndefined();
  });

  it('discovers nested SSH and Relay executor profiles', () => {
    const references = collectExecutorReferences({ profiles: [{ kind: 'ssh', name: 'gpu' }, { kind: 'relay', name: 'fleet' }] });
    expect([...references]).toEqual(['ssh:gpu', 'relay:fleet']);
  });

  it('creates, renames, and removes first-class graph outputs with sidecar positions', () => {
    const image = addCatalogNode(createGraph(), createSidecar(), imageEntry);
    const exposed = addGraphOutput(image.graph, image.sidecar, image.nodeId, 'image');
    const renamed = renameGraphOutput(exposed.graph, exposed.sidecar, exposed.name, 'hero-image');

    expect(renamed.graph.outputs['hero-image']).toEqual({ $ref: 'nodes.generate.outputs.image' });
    expect(renamed.sidecar.outputs?.['hero-image']).toBeDefined();
    expect(graphOutputName(graphOutputNodeId('hero-image'))).toBe('hero-image');
    const removed = deleteGraphOutput(renamed.graph, renamed.sidecar, 'hero-image');
    expect(removed.graph.outputs).toEqual({});
    expect(removed.sidecar.outputs).toEqual({});
  });

  it('adds removable ordering-only edges and rejects dependency cycles', () => {
    const image = addCatalogNode(createGraph(), createSidecar(), imageEntry);
    const video = addCatalogNode(image.graph, image.sidecar, videoEntry);
    const ordered = connectOrderingDependency(video.graph, image.nodeId, video.nodeId);

    expect(ordered.nodes[1].depends_on).toEqual([image.nodeId]);
    expect(wouldCreateDependencyCycle(ordered, video.nodeId, image.nodeId)).toBe(true);
    expect(() => connectOrderingDependency(ordered, video.nodeId, image.nodeId)).toThrow(/cycle/);
    expect(disconnectOrderingDependency(ordered, image.nodeId, video.nodeId).nodes[1].depends_on).toBeUndefined();
  });

  it('builds deterministic nested defaults from catalog value schemas', () => {
    expect(defaultSchemaValue({
      type: 'object',
      properties: {
        enabled: { type: 'boolean', default: true },
        prompts: { type: 'array', items: { type: 'string' } },
        policy: {
          type: 'object',
          properties: { attempts: { type: 'integer', minimum: 1 } },
        },
      },
    })).toEqual({ enabled: true, prompts: [], policy: { attempts: 1 } });
  });

  it('connects and disconnects recursively addressed argument paths', () => {
    const graph = createGraph();
    graph.nodes = [
      { id: 'source', kind: 'text.value', arguments: { value: 'hello' } },
      {
        id: 'join',
        kind: 'text.join',
        arguments: { parts: ['', 'tail'], separator: ' ' },
      },
    ];
    const handle = argumentPathHandle(['parts', '0']);
    const connected = connectNodeOutput(graph, 'source', 'text', 'join', handle);
    expect(connected.nodes[1].arguments.parts).toEqual([
      { $ref: 'nodes.source.outputs.text' },
      'tail',
    ]);
    expect(referencesWithPaths(connected.nodes[1].arguments.parts, ['parts'])).toEqual([
      { reference: 'nodes.source.outputs.text', path: ['parts', '0'] },
    ]);
    expect(disconnectNodeInput(connected, 'join', handle).nodes[1].arguments.parts).toEqual([null, 'tail']);
  });

  it('connects first-class graph inputs to compatible workflow arguments', () => {
    const graph = createGraph();
    graph.inputs.reference = { type: 'asset', required: true };
    graph.nodes = [{ id: 'video', kind: videoEntry.kind, arguments: { prompt: 'animate' } }];

    const connected = connectGraphInput(graph, 'reference', 'video', 'image');
    expect(connected.nodes[0].arguments.image).toEqual({ $ref: 'inputs.reference' });
    expect(() => connectGraphInput(graph, 'missing', 'video', 'image')).toThrow(/Unknown graph input/);
  });

  it('promotes constants and inlines literal material nodes in one graph edit', () => {
    const graph = createGraph();
    graph.nodes = [{ id: 'render', kind: imageEntry.kind, arguments: { prompt: 'luminous garden' } }];
    const sidecar = createSidecar();
    sidecar.nodes.render = { x: 400, y: 120 };
    const promoted = promoteNodeArgument(graph, sidecar, [imageEntry], 'render', 'prompt');

    expect(promoted.graph.nodes[0]).toMatchObject({
      id: 'render-prompt',
      kind: 'text.value',
      arguments: { value: 'luminous garden' },
    });
    expect(promoted.graph.nodes[1].arguments.prompt).toEqual({
      $ref: 'nodes.render-prompt.outputs.text',
    });
    expect(promoted.sidecar.nodes['render-prompt']).toEqual({ x: 60, y: 120 });

    const leftSidecar = createSidecar();
    leftSidecar.nodes.render = { x: 80, y: 120 };
    const promotedAtLeftEdge = promoteNodeArgument(graph, leftSidecar, [imageEntry], 'render', 'prompt');
    expect(promotedAtLeftEdge.sidecar.nodes['render-prompt']).toEqual({ x: 80, y: 120 });
    expect(promotedAtLeftEdge.sidecar.nodes.render).toEqual({ x: 420, y: 120 });
    const inlinedAtLeftEdge = inlineMaterialNode(
      promotedAtLeftEdge.graph,
      promotedAtLeftEdge.sidecar,
      promotedAtLeftEdge.materialNodeId,
    );
    expect(inlinedAtLeftEdge.sidecar.nodes.render).toEqual({ x: 80, y: 120 });

    const inlined = inlineMaterialNode(
      promoted.graph,
      promoted.sidecar,
      promoted.materialNodeId,
    );
    expect(inlined.deleted).toBe(true);
    expect(inlined.graph.nodes).toEqual([
      { id: 'render', kind: 'image.generate', arguments: { prompt: 'luminous garden' } },
    ]);
  });

  it('keeps layout, groups, notes, and saved selections in the editor sidecar', () => {
    const image = addCatalogNode(createGraph(), createSidecar(), imageEntry);
    const video = addCatalogNode(image.graph, image.sidecar, videoEntry);
    const connected = connectNodeOutput(video.graph, image.nodeId, 'image', video.nodeId, 'image');
    const laidOut = autoLayoutGraph(connected, video.sidecar);

    expect(laidOut.nodes[image.nodeId].x).toBeLessThan(laidOut.nodes[video.nodeId].x);
    const aligned = alignEditorNodes(laidOut, [image.nodeId, video.nodeId], 'horizontal');
    expect(aligned.nodes[image.nodeId].y).toBe(aligned.nodes[video.nodeId].y);
    const arranged = layoutEditorNodes(aligned, [image.nodeId, video.nodeId]);
    expect(arranged.nodes[video.nodeId].x).toBeGreaterThan(arranged.nodes[image.nodeId].x);

    const grouped = addEditorGroup(arranged, [image.nodeId, video.nodeId]);
    const noted = addEditorNote(grouped.sidecar);
    const selected = saveEditorSelection(noted.sidecar, [image.nodeId, video.nodeId]);
    expect(grouped.sidecar.groups?.[grouped.name].node_ids).toEqual([image.nodeId, video.nodeId]);
    expect(noted.sidecar.notes?.[noted.name].text).toContain('context');
    expect(selected.sidecar.selection_sets?.[selected.name].node_ids).toHaveLength(2);
    expect(JSON.stringify(connected)).not.toContain('selection_sets');
  });
});
