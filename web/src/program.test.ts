import { describe, expect, it } from 'vitest';

import { addCatalogNode, connectNodeOutput, createGraph, createSidecar } from './graph';
import { addModuleFromSelection, addProgramStep, createProgramFromGraph } from './program';
import type { CatalogEntry } from './types';

const image: CatalogEntry = {
  kind: 'image.generate', title: 'Image', category: 'image', inputs: [{ name: 'prompt', type: 'string', required: true }], outputs: [{ name: 'image', type: 'asset' }],
};
const video: CatalogEntry = {
  kind: 'video.generate', title: 'Video', category: 'video', inputs: [{ name: 'image', type: 'asset' }], outputs: [{ name: 'video', type: 'asset' }],
};

describe('workflow program authoring', () => {
  it('lifts a graph into a reusable module and compile-time step', () => {
    const graph = createGraph();
    graph.inputs.prompt = { type: 'string' };
    const added = addCatalogNode(graph, createSidecar(), image);
    added.graph.nodes[0].arguments.prompt = { $ref: 'inputs.prompt' };
    added.graph.outputs.image = { $ref: 'nodes.generate.outputs.image' };

    const program = createProgramFromGraph(added.graph);
    expect(program.modules.workflow.nodes[0].arguments.prompt).toEqual({ $param: 'prompt' });
    expect(program.steps[0].arguments.prompt).toEqual({ $ref: 'inputs.prompt' });
    expect(program.outputs.image).toEqual({ $ref: 'steps.workflow.outputs.image' });
  });

  it('creates modules from closed selections and rejects outside dependencies', () => {
    const first = addCatalogNode(createGraph(), createSidecar(), image);
    const second = addCatalogNode(first.graph, first.sidecar, video);
    const connected = connectNodeOutput(second.graph, first.nodeId, 'image', second.nodeId, 'image');
    const program = createProgramFromGraph(connected);

    expect(() => addModuleFromSelection(program, connected, [image, video], [second.nodeId])).toThrow(/outside the module/);
    const added = addModuleFromSelection(program, connected, [image, video], [first.nodeId, second.nodeId]);
    const stepped = addProgramStep(added.program, added.moduleId);
    expect(Object.keys(stepped.modules[added.moduleId].outputs)).toEqual(['generate-image', 'generate-2-video']);
    expect(stepped.steps.at(-1)?.module).toBe(added.moduleId);
  });
});
