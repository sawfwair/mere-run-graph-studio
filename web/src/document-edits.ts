// Pure whole-document edits. Each function maps one StudioDocument to the next,
// so a compound gesture (deleting a mixed selection, dragging several nodes,
// importing files after an await) commits once against the latest document
// instead of overwriting it with a copy captured at render time.
import {
  clone,
  deleteGraphOutput,
  deleteNode,
  disconnectNodeInput,
  disconnectOrderingDependency,
  editorGroupName,
  editorNoteName,
  graphInputName,
  graphOutputName,
  referencesIn,
  uniqueId,
} from './graph';
import type { EditorSidecar, StudioDocument, WorkflowNode } from './types';

export interface CanvasPoint {
  x: number;
  y: number;
}

export type EdgeRemoval =
  | { kind: 'data'; targetNodeId: string; targetInput: string }
  | { kind: 'order'; sourceNodeId: string; targetNodeId: string }
  | { kind: 'output'; outputName: string };

export interface DeleteRequest {
  nodeIds: string[];
  inputNames: string[];
  outputNames: string[];
  editorIds: string[];
  edges: EdgeRemoval[];
}

export interface AssetInput {
  name: string;
  path: string;
  content_type: string;
}

export function removeNodes(document: StudioDocument, ids: string[]): StudioDocument {
  let graph = document.graph;
  let sidecar = document.sidecar;
  for (const id of ids) {
    if (!graph.nodes.some((node) => node.id === id)) continue;
    ({ graph, sidecar } = deleteNode(graph, sidecar, id));
  }
  return graph === document.graph ? document : { ...document, graph, sidecar };
}

function dropInputReferences(node: WorkflowNode, names: string[]): void {
  for (const [argument, value] of Object.entries(node.arguments)) {
    const references = referencesIn(value);
    if (names.some((name) => references.includes(`inputs.${name}`))) delete node.arguments[argument];
  }
}

export function removeInputs(document: StudioDocument, names: string[]): StudioDocument {
  const present = names.filter((name) => name in document.graph.inputs);
  if (!present.length) return document;
  const graph = clone(document.graph);
  const inputs = clone(document.inputs);
  const sidecar = clone(document.sidecar);
  for (const name of present) {
    delete graph.inputs[name];
    delete inputs[name];
    if (sidecar.inputs) delete sidecar.inputs[name];
  }
  for (const node of graph.nodes) dropInputReferences(node, present);
  return { ...document, graph, inputs, sidecar };
}

export function removeOutputs(document: StudioDocument, names: string[]): StudioDocument {
  let graph = document.graph;
  let sidecar = document.sidecar;
  for (const name of new Set(names)) {
    if (!(name in graph.outputs)) continue;
    ({ graph, sidecar } = deleteGraphOutput(graph, sidecar, name));
  }
  return graph === document.graph ? document : { ...document, graph, sidecar };
}

export function removeEditorItems(document: StudioDocument, ids: string[]): StudioDocument {
  if (!ids.length) return document;
  const sidecar = clone(document.sidecar);
  for (const id of ids) {
    const groupName = editorGroupName(id);
    const noteName = editorNoteName(id);
    if (groupName && sidecar.groups) delete sidecar.groups[groupName];
    if (noteName && sidecar.notes) delete sidecar.notes[noteName];
  }
  return { ...document, sidecar };
}

export function removeEdges(document: StudioDocument, edges: EdgeRemoval[]): StudioDocument {
  let graph = document.graph;
  const outputNames: string[] = [];
  for (const edge of edges) {
    if (edge.kind === 'data') graph = disconnectNodeInput(graph, edge.targetNodeId, edge.targetInput);
    else if (edge.kind === 'order') graph = disconnectOrderingDependency(graph, edge.sourceNodeId, edge.targetNodeId);
    else outputNames.push(edge.outputName);
  }
  const disconnected = graph === document.graph ? document : { ...document, graph };
  return removeOutputs(disconnected, outputNames);
}

/** Applies one canvas deletion (nodes, inputs, outputs, editor items, edges) as a single edit. */
export function deleteElements(document: StudioDocument, request: DeleteRequest): StudioDocument {
  let next = removeEdges(document, request.edges);
  next = removeNodes(next, request.nodeIds);
  next = removeInputs(next, request.inputNames);
  next = removeOutputs(next, request.outputNames);
  return removeEditorItems(next, request.editorIds);
}

function moveElement(sidecar: EditorSidecar, id: string, position: CanvasPoint): void {
  const outputName = graphOutputName(id);
  const inputName = graphInputName(id);
  const groupName = editorGroupName(id);
  const noteName = editorNoteName(id);
  if (outputName) sidecar.outputs = { ...sidecar.outputs, [outputName]: position };
  else if (inputName) sidecar.inputs = { ...sidecar.inputs, [inputName]: position };
  else if (groupName) {
    const group = sidecar.groups?.[groupName];
    if (group) sidecar.groups = { ...sidecar.groups, [groupName]: { ...group, ...position } };
  } else if (noteName) {
    const note = sidecar.notes?.[noteName];
    if (note) sidecar.notes = { ...sidecar.notes, [noteName]: { ...note, ...position } };
  } else sidecar.nodes = { ...sidecar.nodes, [id]: { ...sidecar.nodes[id], ...position } };
}

/** Stores the final positions of every element moved by one drag gesture. */
export function moveElements(
  sidecar: EditorSidecar,
  moved: readonly { id: string; position: CanvasPoint }[],
): EditorSidecar {
  if (!moved.length) return sidecar;
  const next = { ...sidecar };
  for (const { id, position } of moved) moveElement(next, id, { x: position.x, y: position.y });
  return next;
}

/**
 * Adds one asset graph input per file, laid out in a three-column grid from
 * `origin`. Names are made unique against the document being edited.
 */
export function addAssetInputs(
  document: StudioDocument,
  assets: readonly AssetInput[],
  origin: CanvasPoint,
): { document: StudioDocument; created: string[] } {
  const graph = clone(document.graph);
  const inputs = clone(document.inputs);
  const sidecar = clone(document.sidecar);
  const positions = { ...sidecar.inputs };
  const created: string[] = [];
  assets.forEach((asset, index) => {
    const name = uniqueId(asset.name.replace(/\.[^.]+$/, ''), Object.keys(graph.inputs));
    created.push(name);
    graph.inputs[name] = { type: 'asset', required: true, description: `Imported ${asset.content_type}` };
    inputs[name] = asset.path;
    positions[name] = {
      x: Math.round(origin.x + (index % 3) * 256),
      y: Math.round(origin.y + Math.floor(index / 3) * 164),
    };
  });
  sidecar.inputs = positions;
  return { document: { ...document, graph, inputs, sidecar }, created };
}
