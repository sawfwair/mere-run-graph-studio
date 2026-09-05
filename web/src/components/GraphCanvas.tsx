import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent, type ReactElement } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import {
  applyNodeChanges,
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  useReactFlow,
  type Connection,
  type Edge,
  type NodeMouseHandler,
  type OnMove,
  type OnNodesChange,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { recordValue } from '../decode';
import {
  argumentPathFromHandle,
  argumentPathHandle,
  catalogEntryFor,
  catalogKey,
  compatibleTypes,
  connectGraphInput,
  connectGraphOutput,
  connectNodeOutput,
  connectOrderingDependency,
  disconnectNodeInput,
  disconnectOrderingDependency,
  EDITOR_COLUMN_SPACING,
  EDITOR_ROW_SPACING,
  editorGroupName,
  editorGroupNodeId,
  editorNoteName,
  editorNoteNodeId,
  fieldTypeAtArgumentPath,
  GRAPH_INPUT_HANDLE,
  GRAPH_OUTPUT_HANDLE,
  graphInputName,
  graphInputNodeId,
  graphOutputName,
  graphOutputNodeId,
  ORDER_INPUT_HANDLE,
  ORDER_OUTPUT_HANDLE,
  referencesWithPaths,
  type ReferenceLocation,
  wouldCreateDependencyCycle,
} from '../graph';
import { portTypeKey, type StudioMode } from '../ui';
import type { NodeRunPreview } from '../run-preview';
import type { NodeExecutionState } from '../canvas-execution';
import type { CatalogEntry, EditorSidecar, JsonObject, WorkflowGraph } from '../types';
import { EditorGroupNode, type EditorGroupFlowNode } from './EditorGroupNode';
import { EditorNoteNode, type EditorNoteFlowNode } from './EditorNoteNode';
import { GraphInputNode, type GraphInputFlowNode } from './GraphInputNode';
import { GraphOutputNode, type GraphOutputFlowNode } from './GraphOutputNode';
import { WorkflowNode, type WorkflowFlowNode } from './WorkflowNode';

export const NODE_DRAG_TYPE = 'application/x-mere-studio-node';

export interface CanvasPosition {
  x: number;
  y: number;
}

interface GraphCanvasProps {
  graph: WorkflowGraph;
  inputs: JsonObject;
  sidecar: EditorSidecar;
  catalog: CatalogEntry[];
  selectedNodeIds: string[];
  selectedInputName: string | null;
  selectedOutputName: string | null;
  selectedEditorItemId: string | null;
  previews: Record<string, NodeRunPreview>;
  execution: Record<string, NodeExecutionState>;
  pinnedPreviews: Record<string, NodeRunPreview>;
  onPinPreview: (nodeId: string) => void;
  onUnpinPreview: (nodeId: string) => void;
  mode: StudioMode;
  artifactBlob: (runId: string, path: string, contentType?: string) => Promise<Blob>;
  inputAssetBlob: (path: string, contentType?: string) => Promise<Blob>;
  availableModels?: string[];
  onRaceModels?: (nodeId: string, models: string[]) => void;
  canInstallModels?: boolean;
  onInstallModel?: (model: string) => void;
  onGraphChange: (graph: WorkflowGraph) => void;
  onSidecarChange: (sidecar: EditorSidecar) => void;
  onSelectNodes: (ids: string[]) => void;
  onSelectInput: (name: string | null) => void;
  onSelectOutput: (name: string | null) => void;
  onSelectEditorItem: (id: string | null) => void;
  onDeleteNodes: (ids: string[]) => void;
  onDeleteInputs: (names: string[]) => void;
  onDeleteOutputs: (names: string[]) => void;
  onDeleteEditorItems: (ids: string[]) => void;
  onDropNode: (entry: CatalogEntry, position: CanvasPosition) => void;
  onDropFiles: (paths: string[], position: CanvasPosition) => void;
  onUnsupportedFileDrop: () => void;
  onQuickAdd: (position: CanvasPosition) => void;
}

type StudioFlowNode = WorkflowFlowNode | GraphInputFlowNode | GraphOutputFlowNode | EditorGroupFlowNode | EditorNoteFlowNode;
type GraphEdgeData = { kind: 'data' | 'order' | 'output'; sourceNodeId: string; targetNodeId?: string; targetInput?: string };

const edgeKinds: Record<string, GraphEdgeData['kind']> = { data: 'data', order: 'order', output: 'output' };

function edgeRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? recordValue(value, 'graph edge data') : null;
}

function optionalEdgeString(value: Record<string, unknown>, key: string): string | undefined | null {
  if (!(key in value)) return undefined;
  const candidate = value[key];
  return typeof candidate === 'string' ? candidate : null;
}

function graphEdgeData(value: unknown): GraphEdgeData | undefined {
  const record = edgeRecord(value);
  if (!record) return undefined;
  const kind = typeof record.kind === 'string' ? edgeKinds[record.kind] : undefined;
  if (!kind) return undefined;
  if (typeof record.sourceNodeId !== 'string') return undefined;
  const targetNodeId = optionalEdgeString(record, 'targetNodeId');
  const targetInput = optionalEdgeString(record, 'targetInput');
  if (targetNodeId === null || targetInput === null) return undefined;
  return {
    kind,
    sourceNodeId: record.sourceNodeId,
    targetNodeId,
    targetInput,
  };
}

const nodeTypes = {
  workflow: WorkflowNode,
  'graph-input': GraphInputNode,
  'graph-output': GraphOutputNode,
  'editor-group': EditorGroupNode,
  'editor-note': EditorNoteNode,
};

interface CompleteConnection {
  source: string;
  target: string;
  sourceHandle: string;
  targetHandle: string;
}

function completeConnection(connection: Connection | Edge): CompleteConnection | null {
  if (!connection.source || !connection.target || !connection.sourceHandle || !connection.targetHandle) return null;
  return {
    source: connection.source,
    target: connection.target,
    sourceHandle: connection.sourceHandle,
    targetHandle: connection.targetHandle,
  };
}

function validGraphOutputConnection(
  connection: CompleteConnection,
  graph: WorkflowGraph,
  catalog: CatalogEntry[],
): boolean {
  const source = graph.nodes.find((node) => node.id === connection.source);
  return Boolean(
    connection.targetHandle === GRAPH_OUTPUT_HANDLE
    && source
    && catalogEntryFor(source, catalog)?.outputs.some((field) => field.name === connection.sourceHandle),
  );
}

function validOrderingConnection(connection: CompleteConnection, graph: WorkflowGraph): boolean {
  return connection.sourceHandle === ORDER_OUTPUT_HANDLE
    && connection.targetHandle === ORDER_INPUT_HANDLE
    && !wouldCreateDependencyCycle(graph, connection.source, connection.target);
}

function validGraphInputConnection(
  connection: CompleteConnection,
  inputName: string,
  graph: WorkflowGraph,
  catalog: CatalogEntry[],
): boolean {
  const target = graph.nodes.find((node) => node.id === connection.target);
  const targetPath = argumentPathFromHandle(connection.targetHandle) ?? [connection.targetHandle];
  const targetField = target && catalogEntryFor(target, catalog)?.inputs.find((field) => field.name === targetPath[0]);
  const targetType = targetField && fieldTypeAtArgumentPath(targetField, targetPath.slice(1));
  return connection.sourceHandle === GRAPH_INPUT_HANDLE
    && Boolean(targetType && compatibleTypes(graph.inputs[inputName]?.type, targetType));
}

function validNodeConnection(connection: CompleteConnection, graph: WorkflowGraph, catalog: CatalogEntry[]): boolean {
  if (connection.source === connection.target || wouldCreateDependencyCycle(graph, connection.source, connection.target)) return false;
  return compatibleNodeConnection(connection, graph, catalog);
}

function compatibleNodeConnection(connection: CompleteConnection, graph: WorkflowGraph, catalog: CatalogEntry[]): boolean {
  const source = graph.nodes.find((node) => node.id === connection.source);
  const target = graph.nodes.find((node) => node.id === connection.target);
  const sourceField = source && catalogEntryFor(source, catalog)?.outputs.find((field) => field.name === connection.sourceHandle);
  const targetPath = argumentPathFromHandle(connection.targetHandle) ?? [connection.targetHandle];
  const targetField = target && catalogEntryFor(target, catalog)?.inputs.find((field) => field.name === targetPath[0]);
  const targetType = targetField && fieldTypeAtArgumentPath(targetField, targetPath.slice(1));
  return Boolean(sourceField && targetType && compatibleTypes(sourceField.type, targetType));
}

type EntryMap = Map<string, CatalogEntry | undefined>;

function referenceTargetHandle(inputName: string, location: ReferenceLocation): string {
  return location.path.length === 1 ? inputName : argumentPathHandle(location.path);
}

function inputReferenceEdge(
  inputName: string,
  location: ReferenceLocation,
  targetId: string,
  graph: WorkflowGraph,
  entries: EntryMap,
  selectedInputName: string | null,
  selectedNodeIds: string[],
): Edge | null {
  const match = /^inputs\.([a-z][a-z0-9-]*)$/.exec(location.reference);
  if (!match || !entries.get(targetId)) return null;
  const sourceName = match[1];
  const targetHandle = referenceTargetHandle(inputName, location);
  const sourceType = graph.inputs[sourceName]?.type;
  const active = selectedInputName === sourceName || selectedNodeIds.includes(targetId);
  return {
    id: `input:${sourceName}:${targetId}:${targetHandle}`,
    source: graphInputNodeId(sourceName),
    sourceHandle: GRAPH_INPUT_HANDLE,
    target: targetId,
    targetHandle,
    type: 'default',
    className: `edge-t-${sourceType ? portTypeKey(sourceType) : 'data'} ${active ? 'edge-active' : ''}`,
    animated: active,
    markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 },
    data: { kind: 'data', sourceNodeId: graphInputNodeId(sourceName), targetNodeId: targetId, targetInput: targetHandle } satisfies GraphEdgeData,
  };
}

function nodeReferenceEdge(
  inputName: string,
  location: ReferenceLocation,
  targetId: string,
  entries: EntryMap,
  selectedNodeIds: string[],
): Edge | null {
  const match = /^nodes\.([a-z][a-z0-9-]*)\.outputs\.([a-zA-Z0-9_-]+)$/.exec(location.reference);
  if (!match || !entries.get(targetId)) return null;
  const sourceType = entries.get(match[1])?.outputs.find((field) => field.name === match[2])?.type;
  if (!sourceType) return null;
  const targetHandle = referenceTargetHandle(inputName, location);
  const active = selectedNodeIds.includes(match[1]) || selectedNodeIds.includes(targetId);
  return {
    id: `${match[1]}:${match[2]}:${targetId}:${targetHandle}`,
    source: match[1],
    sourceHandle: match[2],
    target: targetId,
    targetHandle,
    type: 'default',
    className: `edge-t-${portTypeKey(sourceType)} ${active ? 'edge-active' : ''}`,
    animated: active,
    markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 },
    data: { kind: 'data', sourceNodeId: match[1], targetNodeId: targetId, targetInput: targetHandle } satisfies GraphEdgeData,
  };
}

function referenceEdge(
  inputName: string,
  location: ReferenceLocation,
  targetId: string,
  graph: WorkflowGraph,
  entries: EntryMap,
  selectedInputName: string | null,
  selectedNodeIds: string[],
): Edge | null {
  return inputReferenceEdge(inputName, location, targetId, graph, entries, selectedInputName, selectedNodeIds)
    ?? nodeReferenceEdge(inputName, location, targetId, entries, selectedNodeIds);
}

function orderingEdge(sourceId: string, targetId: string): Edge {
  return {
    id: `order:${sourceId}:${targetId}`,
    source: sourceId,
    sourceHandle: ORDER_OUTPUT_HANDLE,
    target: targetId,
    targetHandle: ORDER_INPUT_HANDLE,
    type: 'smoothstep',
    className: 'ordering-edge',
    markerEnd: { type: MarkerType.ArrowClosed, width: 13, height: 13 },
    data: { kind: 'order', sourceNodeId: sourceId, targetNodeId: targetId } satisfies GraphEdgeData,
  };
}

function graphOutputEdge(name: string, reference: string, entries: EntryMap): Edge | null {
  const match = /^nodes\.([a-z][a-z0-9-]*)\.outputs\.([a-zA-Z0-9_-]+)$/.exec(reference);
  if (!match || !entries.get(match[1])?.outputs.some((field) => field.name === match[2])) return null;
  return {
    id: `output:${name}`,
    source: match[1],
    sourceHandle: match[2],
    target: graphOutputNodeId(name),
    targetHandle: GRAPH_OUTPUT_HANDLE,
    type: 'default',
    className: 'graph-output-edge',
    markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 },
    data: { kind: 'output', sourceNodeId: match[1] } satisfies GraphEdgeData,
  };
}

export function GraphCanvas({
  graph,
  inputs,
  sidecar,
  catalog,
  selectedNodeIds,
  selectedInputName,
  selectedOutputName,
  selectedEditorItemId,
  previews,
  execution, pinnedPreviews, onPinPreview, onUnpinPreview,
  mode,
  artifactBlob,
  inputAssetBlob,
  availableModels,
  onRaceModels,
  canInstallModels,
  onInstallModel,
  onGraphChange,
  onSidecarChange,
  onSelectNodes,
  onSelectInput,
  onSelectOutput,
  onSelectEditorItem,
  onDeleteNodes,
  onDeleteInputs,
  onDeleteOutputs,
  onDeleteEditorItems,
  onDropNode,
  onDropFiles,
  onUnsupportedFileDrop,
  onQuickAdd,
}: GraphCanvasProps): ReactElement {
  const { screenToFlowPosition } = useReactFlow();
  const shellRef = useRef<HTMLDivElement>(null);
  const [fileDropActive, setFileDropActive] = useState(false);
  const derivedNodes = useMemo<StudioFlowNode[]>(
    () => {
      const inputNodes: GraphInputFlowNode[] = Object.entries(graph.inputs).map(([name, definition], index) => ({
        id: graphInputNodeId(name),
        type: 'graph-input',
        position: sidecar.inputs?.[name] ?? { x: 32, y: 64 + index * 150 },
        data: {
          name,
          definition,
          value: inputs[name],
          assetBlob: inputAssetBlob,
          onSelect: () => {
            onSelectNodes([]);
            onSelectOutput(null);
            onSelectEditorItem(null);
            onSelectInput(name);
          },
        },
        ariaLabel: `Graph input ${name}`,
        selected: selectedInputName === name,
        deletable: true,
        zIndex: 3,
      }));
      const workflowNodes: WorkflowFlowNode[] = graph.nodes.map((value, index) => ({
        id: value.id,
        type: 'workflow',
        position: sidecar.nodes[value.id] ?? { x: 80 + (index % 3) * EDITOR_COLUMN_SPACING, y: 80 + Math.floor(index / 3) * EDITOR_ROW_SPACING },
        data: {
          value,
          entry: catalogEntryFor(value, catalog),
          ordinal: index + 1,
          mode,
          preview: previews[value.id],
          execution: execution[value.id],
          pinnedPreview: pinnedPreviews[value.id],
          onPinPreview: () => onPinPreview(value.id),
          onUnpinPreview: () => onUnpinPreview(value.id),
          artifactBlob,
          availableModels,
          onRaceModels,
          canInstallModels,
          onInstallModel,
          onArgumentChange: (name, argument) => {
            const next = structuredClone(graph);
            const node = next.nodes.find((candidate) => candidate.id === value.id);
            if (node) {
              if (argument === undefined) delete node.arguments[name];
              else node.arguments[name] = argument;
              onGraphChange(next);
            }
          },
        },
        ariaLabel: `Workflow node ${value.id}`,
        selected: selectedNodeIds.includes(value.id),
        zIndex: 2,
      }));
      const outputNodes: GraphOutputFlowNode[] = Object.entries(graph.outputs).map(([name, reference], index) => ({
        id: graphOutputNodeId(name),
        type: 'graph-output',
        position: sidecar.outputs?.[name] ?? { x: 80 + ((graph.nodes.length % 3) + 1) * EDITOR_COLUMN_SPACING, y: 80 + index * 112 },
        data: {
          name,
          reference,
          onSelect: () => {
            onSelectNodes([]);
            onSelectEditorItem(null);
            onSelectOutput(name);
          },
        },
        ariaLabel: `Graph output ${name}`,
        selected: selectedOutputName === name,
        deletable: true,
        zIndex: 3,
      }));
      const groupNodes: EditorGroupFlowNode[] = Object.entries(sidecar.groups ?? {}).map(([name, value]) => ({
        id: editorGroupNodeId(name),
        type: 'editor-group',
        position: { x: value.x, y: value.y },
        style: { width: value.width, height: value.height },
        data: {
          name,
          value,
          onResize: (width, height) => onSidecarChange({
            ...sidecar,
            groups: { ...sidecar.groups, [name]: { ...value, width, height } },
          }),
          onSelect: () => {
            onSelectNodes([]);
            onSelectOutput(null);
            onSelectEditorItem(editorGroupNodeId(name));
          },
        },
        ariaLabel: `Editor group ${name}`,
        selected: selectedEditorItemId === editorGroupNodeId(name),
        deletable: true,
        zIndex: 0,
      }));
      const noteNodes: EditorNoteFlowNode[] = Object.entries(sidecar.notes ?? {}).map(([name, value]) => ({
        id: editorNoteNodeId(name),
        type: 'editor-note',
        position: { x: value.x, y: value.y },
        style: { width: value.width, height: value.height },
        data: {
          name,
          value,
          onResize: (width, height) => onSidecarChange({
            ...sidecar,
            notes: { ...sidecar.notes, [name]: { ...value, width, height } },
          }),
          onSelect: () => {
            onSelectNodes([]);
            onSelectOutput(null);
            onSelectEditorItem(editorNoteNodeId(name));
          },
        },
        ariaLabel: `Editor note ${name}`,
        selected: selectedEditorItemId === editorNoteNodeId(name),
        deletable: true,
        zIndex: 1,
      }));
      return [...groupNodes, ...noteNodes, ...inputNodes, ...workflowNodes, ...outputNodes];
    },
    [
      catalog,
      execution, pinnedPreviews, onPinPreview, onUnpinPreview,
      artifactBlob,
      graph,
      inputAssetBlob,
      availableModels,
      onRaceModels,
      canInstallModels,
      onInstallModel,
      inputs,
      mode,
      onGraphChange,
      onSelectEditorItem,
      onSelectNodes,
      onSelectInput,
      onSelectOutput,
      onSidecarChange,
      selectedEditorItemId,
      selectedNodeIds,
      selectedInputName,
      selectedOutputName,
      sidecar,
      previews,
    ],
  );

  // React Flow is a controlled flow: it will not apply live drag or selection to
  // the `nodes` prop without an onNodesChange handler. We keep a local copy that
  // applyNodeChanges mutates during interaction (so nodes follow the cursor and
  // select on click), and resync it whenever the derived nodes change — node
  // drags are still persisted to the sidecar on drag-stop.
  const [nodes, setNodes] = useState<StudioFlowNode[]>(derivedNodes);
  useEffect(() => {
    setNodes((current) => {
      const previous = new Map(current.map((node) => [node.id, node]));
      return derivedNodes.map((node) => {
        const prior = previous.get(node.id);
        // Catalog arrival can add handles without changing the card size.
        // Let React Flow measure those handles again; preserve measurements
        // for data-only updates so output events do not reobserve every node.
        if (node.type === 'workflow' && prior?.type === 'workflow' && prior.data.entry !== node.data.entry) return node;
        return { ...prior, ...node };
      });
    });
  }, [derivedNodes]);
  const onNodesChange = useCallback<OnNodesChange<StudioFlowNode>>(
    (changes) => setNodes((current) => applyNodeChanges(changes, current)),
    [],
  );

  const edges = useMemo<Edge[]>(() => {
    const entries = new Map(graph.nodes.map((node) => {
      const rendered = nodes.find((candidate) => candidate.id === node.id);
      return [node.id, rendered?.type === 'workflow' ? rendered.data.entry : undefined];
    }));
    const result: Edge[] = [];
    for (const target of graph.nodes) {
      for (const [inputName, value] of Object.entries(target.arguments)) {
        for (const location of referencesWithPaths(value, [inputName])) {
          const edge = referenceEdge(inputName, location, target.id, graph, entries, selectedInputName, selectedNodeIds);
          if (edge) result.push(edge);
        }
      }
      for (const dependency of target.depends_on ?? []) {
        result.push(orderingEdge(dependency, target.id));
      }
    }
    for (const [name, reference] of Object.entries(graph.outputs)) {
      const edge = graphOutputEdge(name, reference.$ref, entries);
      if (edge) result.push(edge);
    }
    return result;
  }, [graph, nodes, selectedInputName, selectedNodeIds]);

  const validConnection = useCallback(
    (connection: Connection | Edge) => {
      const complete = completeConnection(connection);
      if (!complete) return false;
      if (graphOutputName(complete.target)) return validGraphOutputConnection(complete, graph, catalog);
      const ordering = complete.sourceHandle === ORDER_OUTPUT_HANDLE || complete.targetHandle === ORDER_INPUT_HANDLE;
      if (ordering) return validOrderingConnection(complete, graph);
      const inputName = graphInputName(complete.source);
      if (inputName) return validGraphInputConnection(complete, inputName, graph, catalog);
      return validNodeConnection(complete, graph, catalog);
    },
    [catalog, graph],
  );

  const connect = useCallback(
    (connection: Connection) => {
      if (!validConnection(connection) || !connection.sourceHandle || !connection.targetHandle) return;
      const outputName = graphOutputName(connection.target);
      const inputName = graphInputName(connection.source);
      if (outputName) {
        onGraphChange(connectGraphOutput(graph, outputName, connection.source, connection.sourceHandle));
      } else if (inputName) {
        onGraphChange(connectGraphInput(graph, inputName, connection.target, connection.targetHandle));
      } else if (connection.sourceHandle === ORDER_OUTPUT_HANDLE && connection.targetHandle === ORDER_INPUT_HANDLE) {
        onGraphChange(connectOrderingDependency(graph, connection.source, connection.target));
      } else {
        onGraphChange(
          connectNodeOutput(graph, connection.source, connection.sourceHandle, connection.target, connection.targetHandle),
        );
      }
    },
    [graph, onGraphChange, validConnection],
  );

  const selectNode: NodeMouseHandler<StudioFlowNode> = useCallback(
    (event, node) => {
      const outputName = graphOutputName(node.id);
      const inputName = graphInputName(node.id);
      const groupName = editorGroupName(node.id);
      const noteName = editorNoteName(node.id);
      // Each of these handlers already clears the other selection kinds, so
      // call exactly one. Calling the others afterwards (to "clear" them) would
      // wipe the selection just made — which is what broke node click-select.
      if (outputName) {
        onSelectOutput(outputName);
      } else if (inputName) {
        onSelectInput(inputName);
      } else if (groupName || noteName) {
        onSelectEditorItem(node.id);
      } else {
        const additive = event.metaKey || event.ctrlKey || event.shiftKey;
        onSelectNodes(additive
          ? selectedNodeIds.includes(node.id)
            ? selectedNodeIds.filter((id) => id !== node.id)
            : [...selectedNodeIds, node.id]
          : [node.id]);
      }
    },
    [onSelectEditorItem, onSelectInput, onSelectNodes, onSelectOutput, selectedNodeIds],
  );

  const moveEnd: OnMove = useCallback(
    (_event, viewport) => onSidecarChange({ ...sidecar, viewport }),
    [onSidecarChange, sidecar],
  );

  const paneClick = useCallback(
    (event: MouseEvent) => {
      if (event.detail === 2) {
        onQuickAdd(screenToFlowPosition({ x: event.clientX, y: event.clientY }));
        return;
      }
      onSelectNodes([]);
      onSelectInput(null);
      onSelectOutput(null);
      onSelectEditorItem(null);
    },
    [onQuickAdd, onSelectEditorItem, onSelectInput, onSelectNodes, onSelectOutput, screenToFlowPosition],
  );

  const dropNode = useCallback(
    (event: DragEvent) => {
      const key = event.dataTransfer.getData(NODE_DRAG_TYPE);
      if (!key) {
        if (event.dataTransfer.files.length) {
          event.preventDefault();
          onUnsupportedFileDrop();
        }
        return;
      }
      event.preventDefault();
      const entry = catalog.find((candidate) => catalogKey(candidate) === key);
      if (!entry) return;
      onDropNode(entry, screenToFlowPosition({ x: event.clientX, y: event.clientY }));
    },
    [catalog, onDropNode, onUnsupportedFileDrop, screenToFlowPosition],
  );

  useEffect(() => {
    if (!('__TAURI_INTERNALS__' in window)) return undefined;
    let live = true;
    let unlisten: (() => void) | undefined;
    const currentWindow = getCurrentWindow();
    void currentWindow.onDragDropEvent(({ payload }) => {
      void (async () => {
      if (!live) return;
      if (payload.type === 'leave') {
        setFileDropActive(false);
        return;
      }
      const scale = await currentWindow.scaleFactor();
      const point = { x: payload.position.x / scale, y: payload.position.y / scale };
      const bounds = shellRef.current?.getBoundingClientRect();
      const inside = Boolean(
        bounds
          && point.x >= bounds.left
          && point.x <= bounds.right
          && point.y >= bounds.top
          && point.y <= bounds.bottom,
      );
      if (payload.type === 'enter' || payload.type === 'over') {
        setFileDropActive(inside);
      } else if (payload.type === 'drop') {
        setFileDropActive(false);
        if (inside && payload.paths.length) {
          onDropFiles(payload.paths, screenToFlowPosition(point));
        }
      }
      })();
    }).then((stop) => {
      if (live) unlisten = stop;
      else stop();
    });
    return () => {
      live = false;
      unlisten?.();
    };
  }, [onDropFiles, screenToFlowPosition]);

  return (
    <div className={`graph-canvas-shell ${fileDropActive ? 'file-drop-active' : ''}`} ref={shellRef}>
      <ReactFlow<StudioFlowNode>
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      nodeTypes={nodeTypes}
      defaultViewport={sidecar.viewport}
      fitView={window.matchMedia('(max-width: 1080px)').matches}
      minZoom={0.25}
      maxZoom={1.8}
      fitViewOptions={{ padding: 0.2, maxZoom: 1.1 }}
      snapToGrid
      snapGrid={[16, 16]}
      deleteKeyCode={['Backspace', 'Delete']}
      multiSelectionKeyCode={['Meta', 'Control', 'Shift']}
      zoomOnDoubleClick={false}
      onConnect={connect}
      isValidConnection={validConnection}
      onNodeClick={selectNode}
      onPaneClick={paneClick}
      onNodeDragStop={(_event, node) => {
        const outputName = graphOutputName(node.id);
        const inputName = graphInputName(node.id);
        const groupName = editorGroupName(node.id);
        const noteName = editorNoteName(node.id);
        if (outputName) {
          onSidecarChange({ ...sidecar, outputs: { ...sidecar.outputs, [outputName]: node.position } });
        } else if (inputName) {
          onSidecarChange({ ...sidecar, inputs: { ...sidecar.inputs, [inputName]: node.position } });
        } else if (groupName) {
          const value = sidecar.groups?.[groupName];
          if (value) onSidecarChange({ ...sidecar, groups: { ...sidecar.groups, [groupName]: { ...value, ...node.position } } });
        } else if (noteName) {
          const value = sidecar.notes?.[noteName];
          if (value) onSidecarChange({ ...sidecar, notes: { ...sidecar.notes, [noteName]: { ...value, ...node.position } } });
        } else {
          onSidecarChange({ ...sidecar, nodes: { ...sidecar.nodes, [node.id]: node.position } });
        }
      }}
      onNodesDelete={(deleted) => {
        const nodeIds = deleted.filter((node) => node.type === 'workflow').map((node) => node.id);
        const inputNames = deleted.map((node) => graphInputName(node.id)).filter((name): name is string => Boolean(name));
        const outputNames = deleted.map((node) => graphOutputName(node.id)).filter((name): name is string => Boolean(name));
        const editorIds = deleted.filter((node) => node.type === 'editor-group' || node.type === 'editor-note').map((node) => node.id);
        if (nodeIds.length) onDeleteNodes(nodeIds);
        if (inputNames.length) onDeleteInputs(inputNames);
        if (outputNames.length) onDeleteOutputs(outputNames);
        if (editorIds.length) onDeleteEditorItems(editorIds);
      }}
      onEdgesDelete={(deleted) => {
        let next = graph;
        for (const edge of deleted) {
          const data = graphEdgeData(edge.data);
          if (data?.kind === 'data' && data.targetNodeId && data.targetInput) {
            next = disconnectNodeInput(next, data.targetNodeId, data.targetInput);
          } else if (data?.kind === 'order' && data.targetNodeId) {
            next = disconnectOrderingDependency(next, data.sourceNodeId, data.targetNodeId);
          } else if (data?.kind === 'output') {
            const outputName = graphOutputName(edge.target);
            if (outputName) onDeleteOutputs([outputName]);
          }
        }
        if (next !== graph) onGraphChange(next);
      }}
      onMoveEnd={moveEnd}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes(NODE_DRAG_TYPE)) {
          event.preventDefault();
          event.dataTransfer.dropEffect = 'copy';
        } else if (event.dataTransfer.types.includes('Files')) {
          event.preventDefault();
          event.dataTransfer.dropEffect = 'copy';
        }
      }}
      onDrop={dropNode}
      colorMode="dark"
      proOptions={{ hideAttribution: true }}
    >
      <Background variant={BackgroundVariant.Dots} gap={22} size={1.4} color="var(--canvas-dot)" />
      <Controls position="bottom-left" orientation="horizontal" showInteractive={false} />
      {mode === 'pro' ? (
        <MiniMap
          position="bottom-right"
          pannable
          zoomable
          nodeColor={(node) => (node.selected ? 'var(--accent)' : 'var(--minimap-node)')}
          maskColor="var(--minimap-mask)"
        />
      ) : null}
      </ReactFlow>
      <div className="canvas-file-drop" aria-hidden={!fileDropActive}>
        <strong>Drop media into the graph</strong>
        <span>Each file becomes a visual, wireable input card.</span>
      </div>
    </div>
  );
}
