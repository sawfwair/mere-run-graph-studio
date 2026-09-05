import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import {
  AlignHorizontalJustifyCenter,
  AlignVerticalJustifyCenter,
  AppWindow,
  BookmarkPlus,
  Check,
  ArrowRight,
  CloudCog,
  Command,
  Download,
  FileJson2,
  FolderOpen,
  Frame,
  LayoutGrid,
  LibraryBig,
  ListChecks,
  LogOut,
  Play,
  Plus,
  Redo2,
  RotateCw,
  Save,
  Settings,
  SlidersHorizontal,
  Sparkles,
  StickyNote,
  Undo2,
  Upload,
  Workflow,
  X,
} from 'lucide-react';
import { ReactFlowProvider } from '@xyflow/react';

import { AppView, type AppVariation } from './components/AppView';
import { ModelInstallSheet } from './components/ModelInstallSheet';
import { buildVariationInputs, variationValues, type VariationCandidate } from './app-mode';
import { buildModelVariants, executorsWithModel, missingModels, parseInstalledModels, parseInstalledModelsByExecutor } from './models';
import { CloudLanding } from './components/CloudLanding';
import { CommandPalette, type PaletteGroup } from './components/CommandPalette';
import { DiagnosticsDrawer } from './components/DiagnosticsDrawer';
import { DesktopSetup } from './components/DesktopSetup';
import { GraphCanvas, type CanvasPosition } from './components/GraphCanvas';
import { HelpOverlay } from './components/HelpOverlay';
import { Inspector } from './components/Inspector';
import { Library } from './components/Library';
import { ProgramView } from './components/ProgramView';
import { PrepareView } from './components/PrepareView';
import { RunsView } from './components/RunsView';
import { TemplateForm } from './components/TemplateForm';
import { ToastStack, type ToastItem } from './components/Toasts';
import {
  addCatalogNode,
  addEditorGroup,
  addEditorNote,
  addGraphOutput,
  addGraphInput,
  alignEditorNodes,
  autoLayoutGraph,
  clone,
  collectExecutorReferences,
  commandPayload,
  createGraph,
  createSidecar,
  deleteGraphOutput,
  deleteNode,
  editorGroupName,
  editorGroupNodeId,
  editorNoteName,
  editorNoteNodeId,
  layoutEditorNodes,
  inlineMaterialNode,
  promoteNodeArgument,
  referencesIn,
  renameGraphInput,
  renameGraphOutput,
  renameNode,
  saveEditorSelection,
  uniqueId,
} from './graph';
import { loadRecoveredDocument, useDocumentHistory } from './history';
import { CloudRuntime } from './cloud-runtime';
import { captureRunSource } from './canvas-execution';
import { useCanvasRun } from './use-canvas-run';
import { CanvasRunBar } from './components/CanvasRunBar';
import { decodeJsonObject, decodeWorkflowGraph, parseJsonValue, recordValue } from './decode';
import {
  isNativeDesktop,
  NativeRuntime,
  type DesktopConfiguration,
  type DesktopStatus,
  type StudioRuntime,
} from './runtime';
import { coerceViewForMode, loadStoredMode, storeMode, type StudioMode, type StudioView } from './ui';
import type {
  CatalogEntry,
  CommandDocument,
  Diagnostic,
  EditorSidecar,
  JsonObject,
  JsonValue,
  ModelPull,
  ProjectSummary,
  StudioRun,
  TemplateEntry,
  WorkflowGraph,
  WorkflowNode,
} from './types';
import './styles.css';

type PaletteScope = 'all' | 'nodes';
type JsonDocument = 'workflow' | 'inputs';

function decodeDiagnostic(candidate: Record<string, unknown>): Diagnostic | null {
  if (typeof candidate.message !== 'string' || typeof candidate.severity !== 'string') return null;
  const normalized = candidate.severity === 'error' ? 'blocker' : candidate.severity;
  if (normalized !== 'info' && normalized !== 'warning' && normalized !== 'blocker' && normalized !== 'success') return null;
  return {
    severity: normalized,
    title: typeof candidate.title === 'string' ? candidate.title : 'Diagnostic',
    message: candidate.message,
    nodeId: typeof candidate.node_id === 'string' ? candidate.node_id : undefined,
  };
}

function diagnosticsIn(value: unknown, found: Diagnostic[] = []): Diagnostic[] {
  if (Array.isArray(value)) value.forEach((item) => diagnosticsIn(item, found));
  else if (value && typeof value === 'object') {
    const candidate = recordValue(value, 'diagnostic');
    const diagnostic = decodeDiagnostic(candidate);
    if (diagnostic) found.push(diagnostic);
    Object.values(candidate).forEach((item) => diagnosticsIn(item, found));
  }
  return found;
}

function commandDiagnostics(document: CommandDocument<JsonValue>, operation: string): Diagnostic[] {
  const detailed = diagnosticsIn(document.result);
  if (detailed.length) return detailed;
  if (document.exit_code === 0) return [{ severity: 'success', title: `${operation} passed`, message: document.stderr || 'No blockers reported.' }];
  return [{ severity: 'blocker', title: `${operation} failed`, message: document.stderr || document.stdout || 'Command failed.' }];
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'workflow';
}

function readFlag(key: string): boolean {
  try { return window.localStorage.getItem(key) === '1'; } catch { return false; }
}
function writeFlag(key: string, value: boolean): void {
  try { window.localStorage.setItem(key, value ? '1' : '0'); } catch { /* private mode */ }
}

function editableShortcutTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && target.matches('input, textarea, select, [contenteditable="true"]');
}

interface ShortcutActions {
  openPalette: () => void;
  saveProject: () => void;
  runGraph: () => void;
  undo: () => void;
  redo: () => void;
  closePalette: () => void;
  closeHelp: () => void;
  toggleHelp: () => void;
  setView: (view: StudioView) => void;
  refreshRuns: () => void;
}

const baseShortcutViews: Partial<Record<string, StudioView>> = { '1': 'canvas', '5': 'runs' };
const proShortcutViews: Partial<Record<string, StudioView>> = { '2': 'program', '3': 'json', '4': 'prepare' };

function shortcutView(key: string, mode: StudioMode): StudioView | undefined {
  return baseShortcutViews[key] ?? (mode === 'pro' ? proShortcutViews[key] : undefined);
}

function handleCommandShortcut(event: KeyboardEvent, actions: ShortcutActions): boolean {
  if (!event.metaKey && !event.ctrlKey) return false;
  const key = event.key.toLowerCase();
  if (key === 'k') actions.openPalette();
  else if (key === 's') actions.saveProject();
  else if (key === 'enter') actions.runGraph();
  else if (key === 'z' && !editableShortcutTarget(event.target)) {
    if (event.shiftKey) actions.redo();
    else actions.undo();
  } else return false;
  event.preventDefault();
  return true;
}

function handleViewShortcut(event: KeyboardEvent, mode: StudioMode, actions: ShortcutActions): void {
  if (window.document.querySelector('dialog[open]')) return;
  if (event.key === 'Escape') {
    actions.closeHelp();
    actions.closePalette();
    return;
  }
  if (editableShortcutTarget(event.target)) return;
  if (event.key === '?') {
    actions.toggleHelp();
    return;
  }
  const view = shortcutView(event.key, mode);
  if (!view) return;
  actions.setView(view);
  if (view === 'runs') actions.refreshRuns();
}

function viewTabClass(view: StudioView, target: StudioView, base = ''): string {
  return `${base}${view === target ? ' active' : ''}`.trim();
}

// Exported so the visual harness (web/harness) can mount the real editor shell
// against a mock runtime. Not otherwise used outside this module.
export function Workspace({ runtime, onOpenSettings, onSignOut }: {
  runtime: StudioRuntime;
  onOpenSettings?: () => void;
  onSignOut?: () => void;
}): ReactElement {
  const recoveredDocument = useMemo(loadRecoveredDocument, []);
  const initialDocument = useMemo(() => recoveredDocument ?? {
    graph: createGraph(),
    inputs: {},
    sidecar: createSidecar(),
  }, [recoveredDocument]);
  const {
    document,
    commit: commitDocument,
    replace: replaceDocument,
    markSaved,
    undo,
    redo,
    canUndo,
    canRedo,
    dirty,
  } = useDocumentHistory(initialDocument, recoveredDocument === null);
  const { graph, inputs, sidecar, program } = document;
  const setGraph = useCallback((next: WorkflowGraph) => {
    commitDocument((current) => ({ ...current, graph: next }));
  }, [commitDocument]);
  const setInputs = useCallback((next: JsonObject) => {
    commitDocument((current) => ({ ...current, inputs: next }));
  }, [commitDocument]);
  const setSidecar = useCallback((next: EditorSidecar) => {
    commitDocument((current) => ({ ...current, sidecar: next }));
  }, [commitDocument]);
  const [mode, setMode] = useState<StudioMode>(loadStoredMode);
  const [leftCollapsed, setLeftCollapsed] = useState(() => readFlag('mere-studio-left-collapsed'));
  const [rightCollapsed, setRightCollapsed] = useState(() => readFlag('mere-studio-right-collapsed'));
  useEffect(() => writeFlag('mere-studio-left-collapsed', leftCollapsed), [leftCollapsed]);
  useEffect(() => writeFlag('mere-studio-right-collapsed', rightCollapsed), [rightCollapsed]);
  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);
  const [executors, setExecutors] = useState(['local']);
  const [executor, setExecutor] = useState('local');
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const selectedNodeId = selectedNodeIds.length === 1 ? selectedNodeIds[0] : null;
  const [selectedInputName, setSelectedInputName] = useState<string | null>(null);
  const [selectedOutputName, setSelectedOutputName] = useState<string | null>(null);
  const [selectedEditorItemId, setSelectedEditorItemId] = useState<string | null>(null);
  const [view, setView] = useState<StudioView>('canvas');
  const [projectPath, setProjectPath] = useState<string | null>(null);
  const [health, setHealth] = useState<'connecting' | 'ready' | 'error'>('connecting');
  const [busy, setBusy] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([]);
  const [diagnosticTitle, setDiagnosticTitle] = useState('Ready');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteScope, setPaletteScope] = useState<PaletteScope>('all');
  const palettePosition = useRef<CanvasPosition | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const toastId = useRef(0);
  const [jsonText, setJsonText] = useState(() => JSON.stringify(graph, null, 2));
  const [inputsText, setInputsText] = useState(() => JSON.stringify(inputs, null, 2));
  const [jsonDocument, setJsonDocument] = useState<JsonDocument>('workflow');
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [runs, setRuns] = useState<StudioRun[]>([]);
  const [selectedRun, setSelectedRun] = useState<StudioRun | null>(null);
  const canvas = useCanvasRun(graph, inputs, runs, runtime);
  const trackCanvasRun = canvas.track;
  const loadCanvasArtifact = useCallback((id: string, path: string, contentType?: string) => runtime.artifactBlob(id, path, contentType), [runtime]);
  const [variations, setVariations] = useState<AppVariation[]>([]);
  const [variationField, setVariationField] = useState<string | null>(null);
  const [variationBusy, setVariationBusy] = useState(false);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [installedByExecutor, setInstalledByExecutor] = useState<Record<string, string[]>>({});
  const [appRunId, setAppRunId] = useState<string | null>(null);
  const [installModel, setInstallModel] = useState<string | null>(null);
  const [installPreflight, setInstallPreflight] = useState<CommandDocument<JsonValue> | null>(null);
  const [installPreflightError, setInstallPreflightError] = useState<string | null>(null);
  const [installPull, setInstallPull] = useState<ModelPull | null>(null);
  const [installStarting, setInstallStarting] = useState(false);
  const [preflightDocument, setPreflightDocument] = useState<CommandDocument<JsonValue> | null>(null);
  const [preflightComparisons, setPreflightComparisons] = useState<{
    executor: string;
    document: CommandDocument<JsonValue>;
  }[]>([]);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [templates, setTemplates] = useState<TemplateEntry[]>([]);
  const [templateDraft, setTemplateDraft] = useState<{
    id: string;
    graph: WorkflowGraph;
    inputs: JsonObject;
    sidecar: EditorSidecar;
  } | null>(null);
  const [publishDraft, setPublishDraft] = useState({ template_id: 'workflow-template', title: '', description: '', tags: '' });
  const [workflowToolsAvailable, setWorkflowToolsAvailable] = useState(false);
  const [savePath, setSavePath] = useState('workflows/untitled');
  const [comfyWorkflow, setComfyWorkflow] = useState<JsonValue | null>(null);
  const [comfyReport, setComfyReport] = useState<JsonValue | null>(null);
  const [comfyModel, setComfyModel] = useState('image-krea2-turbo');
  const saveDialog = useRef<HTMLDialogElement>(null);
  const openDialog = useRef<HTMLDialogElement>(null);
  const comfyDialog = useRef<HTMLDialogElement>(null);
  const templateDialog = useRef<HTMLDialogElement>(null);
  const publishDialog = useRef<HTMLDialogElement>(null);
  const comfyFile = useRef<HTMLInputElement>(null);
  const projectFile = useRef<HTMLInputElement>(null);

  useEffect(() => setJsonText(JSON.stringify(graph, null, 2)), [graph]);
  useEffect(() => setInputsText(JSON.stringify(inputs, null, 2)), [inputs]);

  const pushToast = useCallback((tone: ToastItem['tone'], title: string, message?: string) => {
    toastId.current += 1;
    const id = toastId.current;
    setToasts((current) => [...current.slice(-3), { id, tone, title, message }]);
    window.setTimeout(
      () => setToasts((current) => current.filter((item) => item.id !== id)),
      tone === 'error' ? 6000 : 3600,
    );
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts((current) => current.filter((item) => item.id !== id));
  }, []);

  const showError = useCallback((title: string, error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    setDiagnosticTitle(title);
    setDiagnostics([{ severity: 'blocker', title, message }]);
    setDrawerOpen(true);
    pushToast('error', title, message);
  }, [pushToast]);

  const refreshRuns = useCallback(async () => {
    try {
      const result = await runtime.listRuns();
      setRuns(result.runs);
      if (selectedRun) {
        const refreshed = result.runs.find((run) => run.id === selectedRun.id);
        if (refreshed) setSelectedRun(await runtime.inspectRun(refreshed.id));
      }
    } catch (error) {
      showError('Run refresh failed', error);
    }
  }, [runtime, selectedRun, showError]);

  useEffect(() => {
    let live = true;
    void runtime.listRuns().then((result) => {
      if (live) setRuns(result.runs);
    }).catch(() => {
      // Run history is optional at startup; explicit refresh surfaces errors.
    });
    return () => { live = false; };
  }, [runtime]);

  const refreshInstalledModels = useCallback(async () => {
    try {
      const executorDocument = await runtime.executors();
      setAvailableModels(parseInstalledModels(commandPayload(executorDocument)));
      setInstalledByExecutor(parseInstalledModelsByExecutor(commandPayload(executorDocument)));
    } catch {
      // Best-effort refresh; the prior installed set stays in view.
    }
  }, [runtime]);

  const loadEnvironment = useCallback((options?: { quiet?: boolean }) => {
    setHealth('connecting');
    return Promise.all([runtime.catalog(), runtime.executors(), runtime.templates()])
      .then(([catalogDocument, executorDocument, templateDocument]) => {
        const payload = commandPayload(catalogDocument);
        setCatalog(payload?.nodes ?? []);
        setAvailableModels(parseInstalledModels(commandPayload(executorDocument)));
        setInstalledByExecutor(parseInstalledModelsByExecutor(commandPayload(executorDocument)));
        const references = collectExecutorReferences(commandPayload(executorDocument));
        const targets = runtime.executionScope === 'cloud' ? [...references] : ['local', ...references];
        setExecutors(targets.length ? targets : [runtime.executionScope === 'cloud' ? 'relay:fleet' : 'local']);
        setExecutor((current) => (targets.includes(current) ? current : targets[0] ?? (runtime.executionScope === 'cloud' ? 'relay:fleet' : 'local')));
        setWorkflowToolsAvailable(templateDocument.available);
        setTemplates(commandPayload(templateDocument.document ?? { result: null })?.templates ?? []);
        setHealth(catalogDocument.exit_code === 0 ? 'ready' : 'error');
        if (catalogDocument.exit_code !== 0 && !options?.quiet) showError('Catalog unavailable', catalogDocument.stderr);
      })
      .catch((error: unknown) => {
        setHealth('error');
        if (!options?.quiet) showError('CLI unavailable', error);
      });
  }, [runtime, showError]);

  useEffect(() => { void loadEnvironment(); }, [loadEnvironment]);

  useEffect(() => {
    if (!canvas.run) return;
    const update = canvas.run;
    setRuns((current) => [update, ...current.filter((item) => item.id !== update.id)]);
    setSelectedRun((current) => current?.id === update.id ? update : current);
  }, [canvas.run]);

  const selectedRunId = selectedRun?.id;
  const selectedRunState = selectedRun?.state;
  useEffect(() => {
    if (selectedRunId === canvas.runId) return undefined;
    if (!selectedRunId || !selectedRunState || !['starting', 'running', 'submitting', 'queued', 'assigned'].includes(selectedRunState)) return undefined;
    const controller = new AbortController();
    void runtime.watchRun(selectedRunId, (run) => {
      setSelectedRun(run);
      setRuns((current) => [run, ...current.filter((item) => item.id !== run.id)]);
    }, controller.signal).catch((error: unknown) => {
      if (!controller.signal.aborted) showError('Run stream failed', error);
    });
    return () => controller.abort();
  }, [runtime, selectedRunId, selectedRunState, showError, canvas.runId]);

  const updateSelectedNodeIds = useCallback((ids: string[]) => {
    setSelectedNodeIds((current) => (
      current.length === ids.length && current.every((id, index) => id === ids[index]) ? current : ids
    ));
  }, []);

  const selectNode = (id: string | null) => {
    updateSelectedNodeIds(id ? [id] : []);
    setSelectedInputName(null);
    setSelectedOutputName(null);
    setSelectedEditorItemId(null);
  };

  const selectNodes = useCallback((ids: string[]) => {
    updateSelectedNodeIds(ids);
    setSelectedInputName(null);
    setSelectedOutputName(null);
    setSelectedEditorItemId(null);
  }, [updateSelectedNodeIds]);

  const selectInput = (name: string | null) => {
    setSelectedInputName(name);
    setSelectedNodeIds([]);
    setSelectedOutputName(null);
    setSelectedEditorItemId(null);
  };

  const selectOutput = (name: string | null) => {
    setSelectedOutputName(name);
    setSelectedNodeIds([]);
    setSelectedInputName(null);
    setSelectedEditorItemId(null);
  };

  const selectEditorItem = (id: string | null) => {
    setSelectedEditorItemId(id);
    setSelectedNodeIds([]);
    setSelectedInputName(null);
    setSelectedOutputName(null);
  };

  const addNode = (entry: CatalogEntry, position?: CanvasPosition) => {
    const result = addCatalogNode(graph, sidecar, entry);
    const nextSidecar = position ? {
      ...result.sidecar,
      nodes: {
        ...result.sidecar.nodes,
        [result.nodeId]: { x: Math.round(position.x), y: Math.round(position.y) },
      },
    } : result.sidecar;
    commitDocument((current) => ({ ...current, graph: result.graph, sidecar: nextSidecar }));
    selectNode(result.nodeId);
    setView('canvas');
  };

  const removeNodes = (ids: string[]) => {
    commitDocument((current) => {
      let nextGraph = current.graph;
      let nextSidecar = current.sidecar;
      for (const id of ids) {
        const result = deleteNode(nextGraph, nextSidecar, id);
        nextGraph = result.graph;
        nextSidecar = result.sidecar;
      }
      return { ...current, graph: nextGraph, sidecar: nextSidecar };
    });
    setSelectedNodeIds((current) => current.filter((id) => !ids.includes(id)));
  };

  const removeNode = (id: string) => removeNodes([id]);

  const updateNode = (node: WorkflowNode) =>
    setGraph({ ...graph, nodes: graph.nodes.map((candidate) => (candidate.id === node.id ? node : candidate)) });

  const promoteArgument = (nodeId: string, argumentName: string) => {
    try {
      const result = promoteNodeArgument(graph, sidecar, catalog, nodeId, argumentName);
      commitDocument((current) => ({ ...current, graph: result.graph, sidecar: result.sidecar }));
      selectNode(result.materialNodeId);
    } catch (error) {
      showError('Could not create a value node', error);
    }
  };

  const inlineMaterial = (nodeId: string, consumerNodeId?: string) => {
    try {
      const result = inlineMaterialNode(graph, sidecar, nodeId, consumerNodeId);
      commitDocument((current) => ({ ...current, graph: result.graph, sidecar: result.sidecar }));
      selectNode(result.deleted ? consumerNodeId ?? null : nodeId);
    } catch (error) {
      showError('Could not replace the reference', error);
    }
  };

  const renameSelectedNode = (nodeId: string, desired: string) => {
    try {
      const result = renameNode(graph, sidecar, nodeId, desired);
      commitDocument((current) => ({ ...current, graph: result.graph, sidecar: result.sidecar }));
      selectNode(desired);
    } catch (error) {
      showError('Could not rename the item', error);
    }
  };

  const addInput = () => {
    const result = addGraphInput(graph, inputs);
    const index = Object.keys(result.graph.inputs).length - 1;
    const nextSidecar = clone(sidecar);
    if (index === 0) {
      const positions = Object.values(nextSidecar.nodes);
      const minX = positions.length ? Math.min(...positions.map((position) => position.x)) : 320;
      const shift = Math.max(0, 320 - minX);
      if (shift) {
        nextSidecar.nodes = Object.fromEntries(
          Object.entries(nextSidecar.nodes).map(([id, position]) => [id, { ...position, x: position.x + shift }]),
        );
        nextSidecar.outputs = Object.fromEntries(
          Object.entries(nextSidecar.outputs ?? {}).map(([name, position]) => [name, { ...position, x: position.x + shift }]),
        );
        nextSidecar.groups = Object.fromEntries(
          Object.entries(nextSidecar.groups ?? {}).map(([name, value]) => [name, { ...value, x: value.x + shift }]),
        );
        nextSidecar.notes = Object.fromEntries(
          Object.entries(nextSidecar.notes ?? {}).map(([name, value]) => [name, { ...value, x: value.x + shift }]),
        );
        nextSidecar.promotions = Object.fromEntries(
          Object.entries(nextSidecar.promotions ?? {}).map(([name, value]) => [
            name,
            {
              ...value,
              consumer_position: {
                ...value.consumer_position,
                x: value.consumer_position.x + shift,
              },
            },
          ]),
        );
      }
    }
    nextSidecar.inputs = {
      ...nextSidecar.inputs,
      [result.name]: { x: 32, y: 64 + index * 150 },
    };
    commitDocument((current) => ({
      ...current,
      graph: result.graph,
      inputs: result.values,
      sidecar: nextSidecar,
    }));
    selectInput(result.name);
    setView('canvas');
  };

  const renameInput = (name: string, desired: string) => {
    try {
      const result = renameGraphInput(graph, inputs, name, desired);
      const nextSidecar = clone(sidecar);
      if (nextSidecar.inputs?.[name]) {
        nextSidecar.inputs[desired] = nextSidecar.inputs[name];
        delete nextSidecar.inputs[name];
      }
      commitDocument((current) => ({ ...current, graph: result.graph, inputs: result.values, sidecar: nextSidecar }));
      selectInput(desired);
    } catch (error) {
      showError('Could not rename the item', error);
    }
  };

  const deleteInputs = (names: string[]) => {
    const nextGraph = clone(graph);
    const nextInputs = clone(inputs);
    const nextSidecar = clone(sidecar);
    for (const name of names) {
      delete nextGraph.inputs[name];
      delete nextInputs[name];
      if (nextSidecar.inputs) delete nextSidecar.inputs[name];
    }
    for (const node of nextGraph.nodes) {
      for (const [argument, value] of Object.entries(node.arguments)) {
        if (names.some((name) => referencesIn(value).includes(`inputs.${name}`))) delete node.arguments[argument];
      }
    }
    commitDocument((current) => ({ ...current, graph: nextGraph, inputs: nextInputs, sidecar: nextSidecar }));
    selectNode(null);
  };
  const deleteInput = (name: string) => deleteInputs([name]);

  const importDroppedFiles = useCallback(async (paths: string[], position: CanvasPosition) => {
    try {
      const result = await runtime.importAssets(paths);
      if (!result.assets.length) return;
      const nextGraph = clone(graph);
      const nextInputs = clone(inputs);
      const nextSidecar = clone(sidecar);
      nextSidecar.inputs = { ...nextSidecar.inputs };
      const created: string[] = [];
      result.assets.forEach((asset, index) => {
        const stem = asset.name.replace(/\.[^.]+$/, '');
        const name = uniqueId(stem, [...Object.keys(nextGraph.inputs), ...created]);
        created.push(name);
        nextGraph.inputs[name] = {
          type: 'asset',
          required: true,
          description: `Imported ${asset.content_type}`,
        };
        nextInputs[name] = asset.path;
        nextSidecar.inputs![name] = {
          x: Math.round(position.x + (index % 3) * 256),
          y: Math.round(position.y + Math.floor(index / 3) * 164),
        };
      });
      commitDocument((current) => ({
        ...current,
        graph: nextGraph,
        inputs: nextInputs,
        sidecar: nextSidecar,
      }));
      selectInput(created[0] ?? null);
      pushToast(
        'success',
        result.assets.length === 1 ? 'Media added to the graph' : `${result.assets.length} files added to the graph`,
        'Each file is a graph input and can be wired into compatible nodes.',
      );
    } catch (error) {
      showError('File import failed', error);
    }
  }, [commitDocument, graph, inputs, pushToast, runtime, showError, sidecar]);

  const exposeOutput = (nodeId: string, outputName: string) => {
    const result = addGraphOutput(graph, sidecar, nodeId, outputName);
    commitDocument((current) => ({ ...current, graph: result.graph, sidecar: result.sidecar }));
    selectOutput(result.name);
  };

  const renameOutput = (name: string, desired: string) => {
    try {
      const result = renameGraphOutput(graph, sidecar, name, desired);
      commitDocument((current) => ({ ...current, graph: result.graph, sidecar: result.sidecar }));
      selectOutput(desired);
    } catch (error) {
      showError('Could not rename the item', error);
    }
  };

  const removeOutputs = (names: string[]) => {
    commitDocument((current) => {
      let nextGraph = current.graph;
      let nextSidecar = current.sidecar;
      for (const name of names) {
        const result = deleteGraphOutput(nextGraph, nextSidecar, name);
        nextGraph = result.graph;
        nextSidecar = result.sidecar;
      }
      return { ...current, graph: nextGraph, sidecar: nextSidecar };
    });
    if (selectedOutputName && names.includes(selectedOutputName)) selectOutput(null);
  };

  const removeOutput = (name: string) => removeOutputs([name]);

  const removeEditorItems = (ids: string[]) => {
    commitDocument((current) => {
      const nextSidecar = clone(current.sidecar);
      for (const id of ids) {
        const groupName = editorGroupName(id);
        const noteName = editorNoteName(id);
        if (groupName && nextSidecar.groups) delete nextSidecar.groups[groupName];
        if (noteName && nextSidecar.notes) delete nextSidecar.notes[noteName];
      }
      return { ...current, sidecar: nextSidecar };
    });
    if (selectedEditorItemId && ids.includes(selectedEditorItemId)) selectEditorItem(null);
  };

  const alignSelection = (axis: 'horizontal' | 'vertical') => setSidecar(alignEditorNodes(sidecar, selectedNodeIds, axis));
  const layoutSelection = () => setSidecar(layoutEditorNodes(sidecar, selectedNodeIds));
  const autoLayout = () => setSidecar(autoLayoutGraph(graph, sidecar));

  const groupSelection = () => {
    try {
      const result = addEditorGroup(sidecar, selectedNodeIds);
      setSidecar(result.sidecar);
      selectEditorItem(editorGroupNodeId(result.name));
    } catch (error) {
      showError('Could not group the nodes', error);
    }
  };

  const addNote = () => {
    const result = addEditorNote(sidecar);
    setSidecar(result.sidecar);
    selectEditorItem(editorNoteNodeId(result.name));
  };

  const saveSelection = () => {
    try {
      const result = saveEditorSelection(sidecar, selectedNodeIds);
      setSidecar(result.sidecar);
      setDiagnosticTitle('Selection saved');
      setDiagnostics([{ severity: 'success', title: 'Selection saved', message: result.name }]);
    } catch (error) {
      showError('Could not save the selection', error);
    }
  };

  const newWorkflow = () => {
    canvas.reset();
    replaceDocument({ graph: createGraph(), inputs: {}, sidecar: createSidecar() }, true);
    setProjectPath(null);
    setSelectedNodeIds([]);
    setSelectedInputName(null);
    setSelectedOutputName(null);
    setSelectedEditorItemId(null);
    setView('canvas');
  };

  const saveProject = useCallback(async (path = projectPath) => {
    if (!path) {
      setSavePath(`workflows/${slug(graph.name)}`);
      saveDialog.current?.showModal();
      return;
    }
    setBusy('Saving');
    const savedDocument = { graph, inputs, sidecar, program };
    try {
      await runtime.saveProject({ path, ...savedDocument });
      setProjectPath(path);
      markSaved(savedDocument);
      setDiagnosticTitle('Saved');
      setDiagnostics([{ severity: 'success', title: 'Project saved', message: path }]);
      pushToast('success', 'Workflow saved', path);
    } catch (error) {
      showError('Save failed', error);
    } finally {
      setBusy(null);
    }
  }, [graph, inputs, markSaved, program, projectPath, pushToast, runtime, showError, sidecar]);

  const openProjects = async () => {
    try {
      const result = await runtime.projects();
      setProjects(result.projects);
      openDialog.current?.showModal();
    } catch (error) {
      showError('Could not load the project list', error);
    }
  };

  const loadProject = async (path: string) => {
    setBusy('Opening');
    try {
      const project = await runtime.loadProject(path);
      canvas.reset();
      replaceDocument({ graph: project.graph, inputs: project.inputs, sidecar: project.sidecar, program: project.program }, true);
      setProjectPath(path);
      setSelectedNodeIds([]);
      setSelectedInputName(null);
      setSelectedOutputName(null);
      setSelectedEditorItemId(null);
      openDialog.current?.close();
      pushToast('success', 'Workflow opened', path);
    } catch (error) {
      showError('Open failed', error);
    } finally {
      setBusy(null);
    }
  };

  const exportProject = async () => {
    setBusy('Exporting');
    try {
      const packageDocument = await runtime.exportProject({ graph, inputs, sidecar, program });
      const blob = new Blob([`${JSON.stringify(packageDocument, null, 2)}\n`], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = window.document.createElement('a');
      anchor.href = url;
      anchor.download = `${slug(graph.name)}.meregraph.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      setDiagnosticTitle('Exported');
      setDiagnostics([{ severity: 'success', title: 'Project exported', message: anchor.download }]);
      pushToast('success', 'Project exported', anchor.download);
    } catch (error) {
      showError('Export failed', error);
    } finally {
      setBusy(null);
    }
  };

  const importProject = async (file: File) => {
    setBusy('Importing');
    try {
      const project = await runtime.importProject(parseJsonValue(await file.text(), file.name));
      canvas.reset();
      replaceDocument(
        { graph: project.graph, inputs: project.inputs, sidecar: project.sidecar, program: project.program },
        false,
      );
      setProjectPath(null);
      setSelectedNodeIds([]);
      setSelectedInputName(null);
      setSelectedOutputName(null);
      setSelectedEditorItemId(null);
      setView('canvas');
      setDiagnosticTitle('Imported');
      setDiagnostics([{ severity: 'success', title: 'Project imported', message: file.name }]);
      pushToast('success', 'Project imported', file.name);
      const missing = availableModels.length ? missingModels(project.graph, availableModels) : [];
      if (missing.length) {
        pushToast(
          'info',
          missing.length === 1 ? 'This graph needs a model you haven’t installed' : `This graph needs ${missing.length} models you haven’t installed`,
          `${missing.join(', ')}. Choose another model on the node or use an executor with the required model.`,
        );
      }
    } catch (error) {
      showError('Import failed', error);
    } finally {
      setBusy(null);
    }
  };

  const loadTemplate = async (templateId: string) => {
    setBusy('Loading template');
    try {
      const template = await runtime.loadTemplate(templateId);
      setTemplateDraft({ id: templateId, graph: template.graph, inputs: template.inputs, sidecar: template.sidecar });
      templateDialog.current?.showModal();
    } catch (error) {
      showError('Could not load the template', error);
    } finally {
      setBusy(null);
    }
  };

  const applyTemplate = () => {
    if (!templateDraft) return;
    canvas.reset();
    replaceDocument({ graph: templateDraft.graph, inputs: templateDraft.inputs, sidecar: templateDraft.sidecar }, false);
    setProjectPath(null);
    setSelectedNodeIds([]);
    setSelectedInputName(null);
    setSelectedOutputName(null);
    setSelectedEditorItemId(null);
    setDiagnosticTitle('Template loaded');
    setDiagnostics([{ severity: 'success', title: 'Template loaded', message: templateDraft.id }]);
    pushToast('success', 'Template loaded', templateDraft.graph.name);
    templateDialog.current?.close();
  };

  const openPublishTemplate = () => {
    setPublishDraft({
      template_id: slug(graph.name),
      title: graph.name,
      description: `Reusable ${graph.name} workflow.`,
      tags: '',
    });
    publishDialog.current?.showModal();
  };

  const publishTemplate = async () => {
    setBusy('Publishing template');
    try {
      await runtime.publishTemplate(graph, inputs, {
        template_id: publishDraft.template_id,
        title: publishDraft.title,
        description: publishDraft.description,
        tags: publishDraft.tags.split(',').map((tag) => tag.trim()).filter(Boolean),
      });
      const result = await runtime.templates();
      setTemplates(commandPayload(result.document ?? { result: null })?.templates ?? []);
      setWorkflowToolsAvailable(result.available);
      publishDialog.current?.close();
      setDiagnosticTitle('Template published');
      setDiagnostics([{ severity: 'success', title: 'Template published', message: publishDraft.template_id }]);
      pushToast('success', 'Template published', publishDraft.title);
    } catch (error) {
      showError('Template publishing failed', error);
    } finally {
      setBusy(null);
    }
  };

  const chooseComfyWorkflow = async (file: File) => {
    setBusy('Inspecting import');
    try {
      const workflow = parseJsonValue(await file.text(), file.name);
      const document = await runtime.inspectComfy(workflow);
      setComfyWorkflow(workflow);
      setComfyReport(document.result);
      comfyDialog.current?.showModal();
    } catch (error) {
      showError('ComfyUI inspection failed', error);
    } finally {
      setBusy(null);
    }
  };

  const importComfy = async () => {
    if (comfyWorkflow === null) return;
    setBusy('Importing workflow');
    try {
      const imported = await runtime.importComfy(comfyWorkflow, comfyModel);
      canvas.reset();
      replaceDocument({ graph: imported.graph, inputs: imported.inputs, sidecar: imported.sidecar }, false);
      setProjectPath(null);
      setSelectedNodeIds([]);
      setSelectedInputName(null);
      setSelectedOutputName(null);
      setSelectedEditorItemId(null);
      setDiagnosticTitle('Comfy import');
      setDiagnostics(commandDiagnostics(imported.document, 'Comfy import'));
      setDrawerOpen(true);
      comfyDialog.current?.close();
      pushToast('success', 'ComfyUI workflow imported', 'Review the import report in diagnostics.');
    } catch (error) {
      showError('ComfyUI import failed', error);
    } finally {
      setBusy(null);
    }
  };

  const checkGraph = async (mode: 'validate' | 'preflight') => {
    setBusy(mode === 'validate' ? 'Validating' : 'Preflighting');
    try {
      const document = await runtime.check(mode, graph, inputs, executor);
      setDiagnosticTitle(mode === 'validate' ? 'Validation' : 'Preflight');
      setDiagnostics(commandDiagnostics(document, mode === 'validate' ? 'Validation' : 'Preflight'));
      setDrawerOpen(true);
      if (mode === 'preflight') {
        setPreflightDocument(document);
        setPreflightComparisons([]);
        setView('prepare');
      }
    } catch (error) {
      showError(`${mode} failed`, error);
    } finally {
      setBusy(null);
    }
  };

  const comparePreflight = async () => {
    setBusy('Comparing executors');
    try {
      const result = await runtime.comparePreflight(graph, inputs, executors);
      setPreflightComparisons(result.comparisons);
    } catch (error) {
      showError('Executor comparison failed', error);
    } finally {
      setBusy(null);
    }
  };

  const compileProgram = async () => {
    if (!program) return;
    setBusy('Compiling program');
    try {
      const result = await runtime.compileProgram(program);
      commitDocument((current) => ({
        ...current,
        graph: result.graph,
        sidecar: autoLayoutGraph(result.graph, current.sidecar),
      }));
      setDiagnosticTitle('Program compiled');
      setDiagnostics([{ severity: 'success', title: 'Program compiled', message: JSON.stringify(result.report) }]);
      setDrawerOpen(true);
      setView('canvas');
    } catch (error) {
      showError('Program compilation failed', error);
    } finally {
      setBusy(null);
    }
  };

  const runGraph = useCallback(async (options?: { keepView?: boolean; executor?: string }) => {
    const target = options?.executor ?? executor;
    setBusy('Submitting');
    try {
      if (options?.executor && options.executor !== executor) setExecutor(options.executor);
      const captured = await captureRunSource(graph, inputs);
      const run = await runtime.startRun(graph, inputs, target);
      trackCanvasRun(run, captured);
      setRuns((current) => [run, ...current.filter((item) => item.id !== run.id)]);
      setSelectedRun(run);
      if (options?.keepView) setAppRunId(run.id);
      else setView('canvas');
      pushToast('info', 'Run started', `${graph.name} on ${target}`);
    } catch (error) {
      showError('Run failed', error);
    } finally {
      setBusy(null);
    }
  }, [executor, graph, inputs, pushToast, runtime, showError, trackCanvasRun]);

  const appRunning = Boolean(
    appRunId && selectedRun?.id === appRunId
    && ['starting', 'running', 'submitting', 'queued', 'assigned'].includes(selectedRun.state),
  );

  // Models installed on the selected executor — scopes the node chip and the App
  // view to the target you'll actually run on. Falls back to the fleet-wide union
  // when the probe doesn't key installs per executor, preserving prior behavior.
  const installedOnTarget = installedByExecutor[executor] ?? availableModels;
  const appMissingModels = useMemo(
    () => (availableModels.length ? missingModels(graph, installedOnTarget) : []),
    [availableModels.length, graph, installedOnTarget],
  );
  const appModelRoute = useMemo(() => {
    for (const model of appMissingModels) {
      const capable = executorsWithModel(installedByExecutor, model).filter((id) => id !== executor && executors.includes(id));
      if (capable.length) return { model, executor: capable[0] };
    }
    return null;
  }, [appMissingModels, executor, executors, installedByExecutor]);

  const runVariations = async (candidate: VariationCandidate, count: number) => {
    setVariationBusy(true);
    try {
      const values = variationValues(graph, inputs, candidate, count);
      const inputSets = buildVariationInputs(inputs, candidate.name, values);
      const started = await Promise.all(inputSets.map((set) => runtime.startRun(graph, set, executor)));
      setVariations(started.map((run, index) => ({ label: values[index]?.label ?? `#${index + 1}`, run })));
      setVariationField(candidate.name);
      setRuns((current) => [...started, ...current.filter((item) => !started.some((run) => run.id === item.id))]);
      pushToast('info', `Running ${started.length} variations`, `Varying ${candidate.label} on ${executor}`);
    } catch (error) {
      showError('Variations failed', error);
    } finally {
      setVariationBusy(false);
    }
  };

  const clearVariations = () => {
    setVariations([]);
    setVariationField(null);
  };

  const runModelRace = async (nodeId: string, models: string[]) => {
    setVariationBusy(true);
    try {
      const variants = buildModelVariants(graph, nodeId, models);
      const started = await Promise.all(variants.map((variant) => runtime.startRun(variant.graph, inputs, executor)));
      setVariations(started.map((run, index) => ({ label: variants[index]?.model ?? `#${index + 1}`, run })));
      setVariationField('model');
      setRuns((current) => [...started, ...current.filter((item) => !started.some((run) => run.id === item.id))]);
      setView('app');
      pushToast('info', `Comparing ${started.length} models`, `on ${executor}`);
    } catch (error) {
      showError('Model comparison failed', error);
    } finally {
      setVariationBusy(false);
    }
  };

  const canInstallModels = runtime.canInstallModels();

  const beginInstall = useCallback((model: string) => {
    if (!canInstallModels) return;
    setInstallModel(model);
    setInstallPreflight(null);
    setInstallPreflightError(null);
    setInstallPull(null);
    setInstallStarting(false);
    void runtime.modelPreflight(model)
      .then((document) => setInstallPreflight(document))
      .catch((error: unknown) => setInstallPreflightError(error instanceof Error ? error.message : String(error)));
  }, [canInstallModels, runtime]);

  const closeInstall = useCallback(() => {
    setInstallModel(null);
    setInstallPreflight(null);
    setInstallPreflightError(null);
    setInstallPull(null);
    setInstallStarting(false);
  }, []);

  const confirmInstall = useCallback((options: { acceptLicense: boolean; allowUnsupported: boolean }) => {
    const model = installModel;
    if (!model) return;
    setInstallStarting(true);
    setInstallPull(null);
    const controller = new AbortController();
    void runtime.startModelPull(model, options)
      .then((pull) => {
        setInstallPull(pull);
        setInstallStarting(false);
        if (pull.state === 'installed') {
          void refreshInstalledModels();
          pushToast('info', 'Model installed', model);
          return;
        }
        return runtime.watchModelPull(model, (update) => {
          setInstallPull(update);
          if (update.state === 'installed') {
            void refreshInstalledModels();
            pushToast('info', 'Model installed', model);
          } else if (update.state === 'failed') {
            pushToast('error', 'Installation failed', update.detail ?? model);
          }
        }, controller.signal);
      })
      .catch((error: unknown) => {
        setInstallStarting(false);
        setInstallPull({
          model,
          state: 'failed',
          percent: null,
          received_bytes: null,
          total_bytes: null,
          detail: error instanceof Error ? error.message : String(error),
          install_path: null,
          stderr: '',
          updated_at: new Date().toISOString(),
        });
      });
  }, [installModel, pushToast, refreshInstalledModels, runtime]);

  const variationWatchKey = variations
    .filter((variation) => ['starting', 'running', 'submitting', 'queued', 'assigned'].includes(variation.run.state))
    .map((variation) => variation.run.id)
    .join(',');

  useEffect(() => {
    if (!variationWatchKey) return undefined;
    const controller = new AbortController();
    for (const id of variationWatchKey.split(',')) {
      void runtime.watchRun(id, (run) => {
        setVariations((current) => current.map((variation) => (variation.run.id === run.id ? { ...variation, run } : variation)));
      }, controller.signal).catch(() => {
        // A failed variation stream leaves that tile in its last state; the run list still records it.
      });
    }
    return () => controller.abort();
  }, [runtime, variationWatchKey]);

  const inspectRun = async (id: string) => {
    try {
      setSelectedRun(await runtime.inspectRun(id));
    } catch (error) {
      showError('Run inspection failed', error);
    }
  };

  const cancelRun = async (id: string) => {
    try {
      setSelectedRun(await runtime.cancelRun(id));
      await refreshRuns();
    } catch (error) {
      showError('Cancellation failed', error);
    }
  };

  const fetchRun = async (id: string, allArtifacts: boolean, artifactNames: string[]) => {
    try {
      setSelectedRun(await runtime.fetchRun(id, allArtifacts, artifactNames));
      await refreshRuns();
      pushToast('success', 'Artifacts downloaded', allArtifacts ? 'All artifacts downloaded.' : 'Selected outputs downloaded.');
    } catch (error) {
      showError('Download failed', error);
    }
  };

  const resumeRun = async (id: string) => {
    try {
      const run = await runtime.resumeRun(id);
      if (canvas.runId === id) trackCanvasRun(run);
      setSelectedRun(run);
      setRuns((current) => [run, ...current.filter((item) => item.id !== run.id)]);
    } catch (error) {
      showError('Resume failed', error);
    }
  };

  const retryRun = async (id: string) => {
    try {
      const run = await runtime.retryRun(id);
      if (canvas.runId === id) trackCanvasRun(run);
      setSelectedRun(run);
      await refreshRuns();
    } catch (error) {
      showError('Retry failed', error);
    }
  };

  const applyJson = () => {
    try {
      if (jsonDocument === 'workflow') {
        setGraph(decodeWorkflowGraph(parseJsonValue(jsonText, 'workflow JSON')));
      } else {
        setInputs(decodeJsonObject(parseJsonValue(inputsText, 'inputs JSON')));
      }
      setJsonError(null);
      pushToast('success', 'JSON applied', jsonDocument === 'workflow' ? 'Workflow updated.' : 'Input values updated.');
      setView('canvas');
    } catch (error) {
      setJsonError(error instanceof Error ? error.message : String(error));
    }
  };

  const formatJson = () => {
    try {
      if (jsonDocument === 'workflow') setJsonText(JSON.stringify(parseJsonValue(jsonText, 'workflow JSON'), null, 2));
      else setInputsText(JSON.stringify(parseJsonValue(inputsText, 'inputs JSON'), null, 2));
      setJsonError(null);
    } catch (error) {
      setJsonError(error instanceof Error ? error.message : String(error));
    }
  };

  const copyJson = async () => {
    try {
      await navigator.clipboard.writeText(jsonDocument === 'workflow' ? jsonText : inputsText);
      pushToast('success', 'Copied', jsonDocument === 'workflow' ? 'Workflow JSON copied.' : 'Inputs JSON copied.');
    } catch (error) {
      showError('Copy failed', error);
    }
  };

  const downloadJson = () => {
    const text = jsonDocument === 'workflow' ? jsonText : inputsText;
    const suffix = jsonDocument === 'workflow' ? 'workflow' : 'inputs';
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const anchor = window.document.createElement('a');
    anchor.href = url;
    anchor.download = `${slug(graph.name)}.${suffix}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const switchMode = useCallback((next: StudioMode) => {
    setMode((current) => {
      if (current === next) return current;
      storeMode(next);
      setView((currentView) => coerceViewForMode(currentView, next));
      pushToast(
        'info',
        next === 'easy' ? 'Easy mode' : 'Pro mode',
        next === 'easy' ? 'The editor shows essential settings. Your workflow stays the same.' : 'The editor shows all workflow and execution settings.',
      );
      return next;
    });
  }, [pushToast]);

  const openPalette = useCallback((scope: PaletteScope = 'all', position: CanvasPosition | null = null) => {
    setPaletteScope(scope);
    palettePosition.current = position;
    setPaletteOpen(true);
  }, []);

  const closePalette = useCallback(() => {
    setPaletteOpen(false);
    palettePosition.current = null;
  }, []);

  const edgeCount = useMemo(
    () => graph.nodes.reduce(
      (count, node) => count + Object.values(node.arguments).filter(
        (value) => value && typeof value === 'object' && '$ref' in value && typeof value.$ref === 'string' && value.$ref.startsWith('nodes.'),
      ).length + (node.depends_on?.length ?? 0),
      Object.keys(graph.outputs).length,
    ),
    [graph.nodes, graph.outputs],
  );

  const paletteGroups: PaletteGroup[] = (() => {
    const nodeGroup: PaletteGroup = {
      title: 'Add node',
      items: catalog.map((entry) => ({
        id: `node:${entry.kind}:${entry.provider?.id ?? ''}`,
        title: entry.title,
        subtitle: mode === 'pro' ? entry.kind : entry.description,
        keywords: `${entry.kind} ${entry.category ?? ''} ${entry.description ?? ''}`,
        icon: <Plus size={14} />,
        run: () => addNode(entry, palettePosition.current ?? undefined),
      })),
    };
    if (paletteScope === 'nodes') return [nodeGroup];
    const actions: PaletteGroup = {
      title: 'Actions',
      items: [
        { id: 'run', title: 'Run workflow', subtitle: `on ${executor}`, hint: '⌘⏎', icon: <Play size={14} />, run: () => void runGraph() },
        { id: 'app', title: 'Run as app', subtitle: 'Run the workflow with a form and view the results', icon: <AppWindow size={14} />, run: () => setView('app') },
        { id: 'validate', title: mode === 'easy' ? 'Check workflow' : 'Validate workflow', icon: <Check size={14} />, run: () => void checkGraph('validate') },
        ...(mode === 'pro' ? [
          { id: 'preflight', title: 'Preflight executor', subtitle: executor, icon: <CloudCog size={14} />, run: () => void checkGraph('preflight') },
          { id: 'program', title: 'Open program editor', icon: <Frame size={14} />, run: () => setView('program') },
          { id: 'prepare', title: 'Open Prepare', icon: <CloudCog size={14} />, run: () => setView('prepare') },
          { id: 'json', title: 'Open workflow JSON', icon: <FileJson2 size={14} />, run: () => setView('json') },
        ] : []),
        { id: 'save', title: 'Save workflow', hint: '⌘S', icon: <Save size={14} />, run: () => void saveProject() },
        { id: 'open', title: 'Open workflow', icon: <FolderOpen size={14} />, run: () => void openProjects() },
        { id: 'import-project', title: 'Import project file', icon: <Upload size={14} />, run: () => projectFile.current?.click() },
        { id: 'export-project', title: 'Export project file', icon: <Download size={14} />, run: () => void exportProject() },
        { id: 'new', title: 'New workflow', icon: <Plus size={14} />, run: newWorkflow },
        { id: 'undo', title: 'Undo', hint: '⌘Z', icon: <Undo2 size={14} />, run: undo },
        { id: 'redo', title: 'Redo', hint: '⇧⌘Z', icon: <Redo2 size={14} />, run: redo },
        {
          id: 'mode',
          title: mode === 'easy' ? 'Switch to Pro mode' : 'Switch to Easy mode',
          subtitle: mode === 'easy' ? 'All settings, plus Program, Prepare, and JSON views' : 'Templates and essential controls',
          icon: mode === 'easy' ? <SlidersHorizontal size={14} /> : <Sparkles size={14} />,
          run: () => switchMode(mode === 'easy' ? 'pro' : 'easy'),
        },
        { id: 'help', title: 'Shortcuts and tips', hint: '?', icon: <Command size={14} />, run: () => setHelpOpen(true) },
      ],
    };
    const templateGroup: PaletteGroup = {
      title: 'Templates',
      items: templates.map((template) => ({
        id: `template:${template.id}`,
        title: template.title,
        subtitle: template.description,
        keywords: template.tags.join(' '),
        icon: <Workflow size={14} />,
        run: () => void loadTemplate(template.id),
      })),
    };
    return [actions, nodeGroup, ...(templates.length ? [templateGroup] : [])];
  })();

  useEffect(() => {
    const actions: ShortcutActions = {
      openPalette,
      saveProject: () => { void saveProject(); },
      runGraph: () => { void runGraph(); },
      undo,
      redo,
      closePalette,
      closeHelp: () => setHelpOpen(false),
      toggleHelp: () => setHelpOpen((current) => !current),
      setView,
      refreshRuns: () => { void refreshRuns(); },
    };
    const handleShortcut = (event: KeyboardEvent) => {
      if (!handleCommandShortcut(event, actions)) handleViewShortcut(event, mode, actions);
    };
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, [closePalette, mode, openPalette, redo, refreshRuns, saveProject, runGraph, undo]);

  const library = (
    <Library
      catalog={catalog}
      graph={graph}
      templates={templates}
      workflowToolsAvailable={workflowToolsAvailable}
      mode={mode}
      collapsed={leftCollapsed}
      onCollapsedChange={setLeftCollapsed}
      onAddNode={addNode}
      onAddInput={addInput}
      onSelectInput={selectInput}
      onLoadTemplate={(templateId) => void loadTemplate(templateId)}
      onImportComfy={() => comfyFile.current?.click()}
      onPublishTemplate={openPublishTemplate}
    />
  );

  const inspector = (
    <Inspector
      graph={graph}
      inputs={inputs}
      sidecar={sidecar}
      catalog={catalog}
      selectedNodeId={selectedNodeId}
      selectedNodeIds={selectedNodeIds}
      selectedInputName={selectedInputName}
      selectedOutputName={selectedOutputName}
      selectedEditorItemId={selectedEditorItemId}
      mode={mode}
      collapsed={rightCollapsed}
      onCollapsedChange={setRightCollapsed}
      onGraphChange={setGraph}
      onInputsChange={setInputs}
      onUpdateNode={updateNode}
      onPromoteArgument={promoteArgument}
      onInlineMaterial={inlineMaterial}
      onRenameNode={renameSelectedNode}
      onDeleteNode={removeNode}
      onRenameInput={renameInput}
      onDeleteInput={deleteInput}
      onAddOutput={exposeOutput}
      onRenameOutput={renameOutput}
      onDeleteOutput={removeOutput}
      onSidecarChange={setSidecar}
      onSelectNodes={selectNodes}
      onDeleteEditorItem={(id) => removeEditorItems([id])}
    />
  );

  return (
    <div className={`app-shell mode-${mode}${leftCollapsed ? ' left-collapsed' : ''}${rightCollapsed ? ' right-collapsed' : ''}`}>
      {(() => (
      <header className="topbar">
        <div className="brand-block">
          <span className="brand-mark"><img src="/brand/mark.svg" alt="" /></span>
          <span className="brand-copy"><strong>Graph Studio<span className="brand-period">.</span></strong><small>by mere.run</small></span>
        </div>
        <div className="command-bar" role="toolbar" aria-label="Workflow commands">
          <button className="icon-button" onClick={newWorkflow} title="New workflow" aria-label="New workflow"><Plus size={15} /></button>
          <button className="icon-button" onClick={() => void openProjects()} title="Open workflow" aria-label="Open workflow"><FolderOpen size={15} /></button>
          <button className={`icon-button ${dirty ? 'attention' : ''}`} onClick={() => void saveProject()} title="Save workflow (⌘S)" aria-label="Save workflow"><Save size={15} /></button>
          <button className="icon-button project-transfer" onClick={() => projectFile.current?.click()} title="Import project file" aria-label="Import project"><Upload size={15} /></button>
          <button className="icon-button project-transfer" onClick={() => void exportProject()} title="Export project file" aria-label="Export project"><Download size={15} /></button>
          <span className="toolbar-divider" />
          <button className="icon-button" disabled={!canUndo} onClick={undo} title="Undo (⌘Z)" aria-label="Undo"><Undo2 size={15} /></button>
          <button className="icon-button" disabled={!canRedo} onClick={redo} title="Redo (⇧⌘Z)" aria-label="Redo"><Redo2 size={15} /></button>
          <span className="toolbar-divider" />
          <button className="command-button" disabled={Boolean(busy)} onClick={() => void checkGraph('validate')}>
            <Check size={14} /> {mode === 'easy' ? 'Check' : 'Validate'}
          </button>
          {mode === 'pro' ? (
            <button className="command-button" disabled={Boolean(busy)} onClick={() => void checkGraph('preflight')}><CloudCog size={14} /> Preflight</button>
          ) : null}
          <label className="executor-picker" title={`Execution target: ${executor}`}>
            <span>Target</span>
            <select value={executor} onChange={(event) => setExecutor(event.target.value)} aria-label="Executor">
              {executors.map((item) => <option key={item}>{item}</option>)}
            </select>
          </label>
          <button className="command-button primary" disabled={Boolean(busy)} onClick={() => void runGraph()}><Play size={13} fill="currentColor" /> Run</button>
        </div>
        <div className="topbar-right">
          {onOpenSettings ? <button className="icon-button ghost desktop-settings-button" onClick={onOpenSettings} title="Desktop settings" aria-label="Desktop settings"><Settings size={15} /></button> : null}
          {onSignOut ? <button className="icon-button ghost desktop-settings-button" onClick={onSignOut} title="Sign out" aria-label="Sign out"><LogOut size={15} /></button> : null}
          <div className="mode-toggle" role="radiogroup" aria-label="Editor mode">
            <button role="radio" aria-checked={mode === 'easy'} className={mode === 'easy' ? 'active' : ''} onClick={() => switchMode('easy')} title="Easy mode"><Sparkles size={13} /> Easy</button>
            <button role="radio" aria-checked={mode === 'pro'} className={mode === 'pro' ? 'active' : ''} onClick={() => switchMode('pro')} title="Pro mode"><SlidersHorizontal size={13} /> Pro</button>
          </div>
          <div className={`health ${health}`} title={busy ?? health}><span /><strong>{busy ?? (health === 'ready' ? 'Ready' : health === 'error' ? 'Error' : 'Connecting')}</strong></div>
          {health === 'error' && !busy ? (
            <button className="icon-button ghost health-retry" onClick={() => void loadEnvironment()} title="Reconnect and reload the catalog" aria-label="Reconnect">
              <RotateCw size={14} />
            </button>
          ) : null}
        </div>
        {busy ? <span className="busy-bar" aria-hidden /> : null}
      </header>
      ))()}

      {library}

      {(() => (
      <main className="workspace">
        <div className="workspace-heading">
          <div className="workspace-identity">
            <span className="workspace-eyebrow">Workspace <span aria-hidden="true">/</span> Workflow</span>
            <h1 title={projectPath ?? graph.name}>{graph.name}</h1>
          </div>
          <button className={`save-state ${dirty ? 'unsaved' : ''}`} onClick={() => void saveProject()} title="Save workflow (⌘S)">
            {dirty ? <span className="save-dot" /> : <Check size={12} />}
            {dirty ? 'Unsaved changes' : 'No changes'}
          </button>
        </div>
        {(() => (
        <div className="viewbar">
          <div className="segmented" role="tablist">
            <button role="tab" aria-selected={view === 'app'} title="Run as app" className={viewTabClass(view, 'app', 'app-tab')} onClick={() => setView('app')}><AppWindow size={14} /> App</button>
            <button role="tab" aria-selected={view === 'canvas'} title="Canvas (1)" className={viewTabClass(view, 'canvas')} onClick={() => setView('canvas')}><Workflow size={14} /> Canvas</button>
            {mode === 'pro' ? (
              <button role="tab" aria-selected={view === 'program'} title="Program (2)" className={viewTabClass(view, 'program')} onClick={() => setView('program')}><Frame size={14} /> Program</button>
            ) : null}
            {mode === 'pro' ? (
              <button role="tab" aria-selected={view === 'json'} title="Graph JSON (3)" className={viewTabClass(view, 'json')} onClick={() => setView('json')}><FileJson2 size={14} /> JSON</button>
            ) : null}
            {mode === 'pro' ? (
              <button role="tab" aria-selected={view === 'prepare'} title="Prepare (4)" className={viewTabClass(view, 'prepare')} onClick={() => setView('prepare')}><CloudCog size={14} /> Prepare</button>
            ) : null}
            <button role="tab" aria-selected={view === 'runs'} title="Runs (5)" className={viewTabClass(view, 'runs')} onClick={() => { setView('runs'); void refreshRuns(); }}><Play size={14} /> Runs</button>
            <button role="tab" aria-selected={view === 'catalog'} title="Library" className={viewTabClass(view, 'catalog', 'mobile-catalog-tab')} onClick={() => setView('catalog')}><LibraryBig size={14} /> Library</button>
            <button role="tab" aria-selected={view === 'inspector'} title="Inspector" className={viewTabClass(view, 'inspector', 'compact-inspector-tab')} onClick={() => setView('inspector')}><SlidersHorizontal size={14} /> Inspect</button>
          </div>
          <button className="palette-hint" onClick={() => openPalette()} title="Command palette (⌘K)"><Command size={12} /><span>K</span></button>
        </div>
        ))()}
        {(() => (
        view === 'app' ? (
          <AppView
            graph={graph}
            inputs={inputs}
            sidecar={sidecar}
            latestRun={canvas.matchingRun}
            running={appRunning || busy === 'Submitting'}
            variations={variations}
            variationField={variationField}
            variationBusy={variationBusy}
            missingModels={appMissingModels}
            modelRoute={appModelRoute}
            onInputsChange={setInputs}
            onSidecarChange={setSidecar}
            onRun={() => void runGraph({ keepView: true })}
            onRunVariations={(candidate, count) => void runVariations(candidate, count)}
            onClearVariations={clearVariations}
            onShare={() => void exportProject()}
            onEditGraph={() => setView('canvas')}
            onRunOnExecutor={(execId) => void runGraph({ keepView: true, executor: execId })}
            canInstallModels={canInstallModels}
            onInstallModel={beginInstall}
            artifactBlob={(id, path, contentType) => runtime.artifactBlob(id, path, contentType)}
            inputAssetBlob={(path, contentType) => runtime.inputAssetBlob(path, contentType)}
          />
        ) : view === 'canvas' ? ((() => (
          <div className="canvas-view">
            <CanvasRunBar run={canvas.run} previous={!canvas.matches} error={canvas.streamError}
              onCancel={canvas.cancel} onReconnect={canvas.reconnect}
              onDetails={() => { if (canvas.run) setSelectedRun(canvas.run); setView('runs'); }} />
            <div className="canvas-context">
              <span><Workflow size={13} /> {graph.nodes.length} {graph.nodes.length === 1 ? 'node' : 'nodes'} <i /> {edgeCount} {edgeCount === 1 ? 'connection' : 'connections'}</span>
              <button className="canvas-add" onClick={() => openPalette('nodes')}><Plus size={14} /> Add node</button>
            </div>
            {mode === 'pro' ? (
              <div className="canvas-toolstrip" role="toolbar" aria-label="Canvas layout">
                <button className="icon-button small" disabled={!graph.nodes.length} onClick={() => selectNodes(graph.nodes.map((node) => node.id))} title="Select all nodes" aria-label="Select all nodes"><ListChecks size={14} /></button>
                <span className="toolbar-divider" />
                <button className="icon-button small" disabled={selectedNodeIds.length < 2} onClick={() => alignSelection('horizontal')} title="Align horizontally" aria-label="Align horizontally"><AlignHorizontalJustifyCenter size={14} /></button>
                <button className="icon-button small" disabled={selectedNodeIds.length < 2} onClick={() => alignSelection('vertical')} title="Align vertically" aria-label="Align vertically"><AlignVerticalJustifyCenter size={14} /></button>
                <button className="icon-button small" disabled={!selectedNodeIds.length} onClick={layoutSelection} title="Arrange selection" aria-label="Arrange selection"><LayoutGrid size={14} /></button>
                <span className="toolbar-divider" />
                <button className="icon-button small" disabled={!selectedNodeIds.length} onClick={groupSelection} title="Group selection" aria-label="Group selection"><Frame size={14} /></button>
                <button className="icon-button small" onClick={addNote} title="Add note" aria-label="Add note"><StickyNote size={14} /></button>
                <button className="icon-button small" disabled={!selectedNodeIds.length} onClick={saveSelection} title="Save selection" aria-label="Save selection"><BookmarkPlus size={14} /></button>
                <span className="toolbar-divider" />
                <button className="icon-button small" disabled={!graph.nodes.length} onClick={autoLayout} title="Auto layout" aria-label="Auto layout"><Workflow size={14} /></button>
              </div>
            ) : null}
            <GraphCanvas
              graph={graph}
              inputs={inputs}
              sidecar={sidecar}
              catalog={catalog}
              selectedNodeIds={selectedNodeIds}
              selectedInputName={selectedInputName}
              selectedOutputName={selectedOutputName}
              selectedEditorItemId={selectedEditorItemId}
              previews={canvas.previews}
              execution={canvas.execution}
              pinnedPreviews={canvas.pins}
              onPinPreview={canvas.pin}
              onUnpinPreview={canvas.unpin}
              mode={mode}
              artifactBlob={loadCanvasArtifact}
              inputAssetBlob={(path, contentType) => runtime.inputAssetBlob(path, contentType)}
              availableModels={installedOnTarget}
              onRaceModels={(nodeId, models) => void runModelRace(nodeId, models)}
              canInstallModels={canInstallModels}
              onInstallModel={beginInstall}
              onGraphChange={setGraph}
              onSidecarChange={setSidecar}
              onSelectNodes={selectNodes}
              onSelectInput={selectInput}
              onSelectOutput={selectOutput}
              onSelectEditorItem={selectEditorItem}
              onDeleteNodes={removeNodes}
              onDeleteInputs={deleteInputs}
              onDeleteOutputs={removeOutputs}
              onDeleteEditorItems={removeEditorItems}
              onDropNode={(entry, position) => addNode(entry, position)}
              onDropFiles={(paths, position) => void importDroppedFiles(paths, position)}
              onUnsupportedFileDrop={() => {
                if (!isNativeDesktop()) {
                  pushToast('info', 'Use the desktop app to drop files', 'To add files, use the desktop app.');
                }
              }}
              onQuickAdd={(position) => openPalette('nodes', position)}
            />
            {!graph.nodes.length ? (
              <div className="canvas-hero">
                <div className="canvas-start">
                  <span className="hero-badge"><Sparkles size={19} /></span>
                  <h2>{mode === 'easy' ? 'Create a workflow' : 'Build your workflow'}</h2>
                  <p>To build a workflow, add nodes and connect their inputs and outputs.{isNativeDesktop() ? ' In the desktop app, you can also drop files onto the canvas.' : ''}</p>
                  <div className="hero-actions">
                    <button className="command-button primary" onClick={() => openPalette('nodes')}><Plus size={14} /> Add node</button>
                    <button className="command-button" onClick={() => openPalette()}><Command size={13} /> Commands</button>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        ))()
        ) : view === 'program' ? (
          <ProgramView
            program={program}
            graph={graph}
            catalog={catalog}
            selectedNodeIds={selectedNodeIds}
            busy={Boolean(busy)}
            onChange={(next) => commitDocument((current) => ({ ...current, program: next }))}
            onCompile={() => void compileProgram()}
            onError={showError}
          />
        ) : view === 'json' ? ((() => (
          <div className="json-view">
            <div className="editor-heading">
              <div className="json-tabs" role="tablist">
                <button role="tab" aria-selected={jsonDocument === 'workflow'} className={jsonDocument === 'workflow' ? 'active' : ''} onClick={() => { setJsonDocument('workflow'); setJsonError(null); }}>Workflow</button>
                <button role="tab" aria-selected={jsonDocument === 'inputs'} className={jsonDocument === 'inputs' ? 'active' : ''} onClick={() => { setJsonDocument('inputs'); setJsonError(null); }}>Inputs</button>
              </div>
              <div className="editor-actions">
                <button className="command-button subtle" onClick={formatJson}>Format</button>
                <button className="command-button subtle" onClick={() => void copyJson()}>Copy</button>
                <button className="command-button subtle" onClick={downloadJson}>Download</button>
                <button className="command-button" onClick={applyJson}>Apply</button>
              </div>
            </div>
            <textarea
              value={jsonDocument === 'workflow' ? jsonText : inputsText}
              onChange={(event) => (jsonDocument === 'workflow' ? setJsonText(event.target.value) : setInputsText(event.target.value))}
              spellCheck={false}
            />
            {jsonError ? <div className="json-error">{jsonError}</div> : null}
          </div>
        ))()
        ) : view === 'prepare' ? (
          <PrepareView
            executor={executor}
            executors={executors}
            document={preflightDocument}
            comparisons={preflightComparisons}
            busy={Boolean(busy)}
            onCompare={() => void comparePreflight()}
          />
        ) : view === 'runs' ? (
          <RunsView
            runs={runs}
            selected={selectedRun}
            onSelect={(id) => void inspectRun(id)}
            onRefresh={() => void refreshRuns()}
            onCancel={(id) => void cancelRun(id)}
            onFetch={(id, allArtifacts, artifactNames) => void fetchRun(id, allArtifacts, artifactNames)}
            onRetry={(id) => void retryRun(id)}
            onResume={(id) => void resumeRun(id)}
            artifactBlob={(id, path, contentType) => runtime.artifactBlob(id, path, contentType)}
          />
        ) : view === 'catalog' ? (
          <div className="mobile-library-view">{library}</div>
        ) : (
          <div className="mobile-inspector-view">{inspector}</div>
        )
        ))()}
      </main>
      ))()}

      {inspector}

      <DiagnosticsDrawer
        diagnostics={diagnostics}
        title={diagnosticTitle}
        open={drawerOpen}
        mode={mode}
        nodeCount={graph.nodes.length}
        edgeCount={edgeCount}
        executor={executor}
        onToggle={() => setDrawerOpen((value) => !value)}
        onSelectNode={(id) => { selectNode(id); setView('canvas'); }}
        onOpenHelp={() => setHelpOpen(true)}
      />

      <CommandPalette
        open={paletteOpen}
        placeholder={paletteScope === 'nodes' ? 'Search nodes' : 'Search actions, nodes, and templates'}
        groups={paletteGroups}
        onClose={closePalette}
      />
      <HelpOverlay open={helpOpen} mode={mode} onClose={() => setHelpOpen(false)} />
      <ToastStack toasts={toasts} onDismiss={dismissToast} />

      {(() => (<>
      <dialog ref={saveDialog}>
        <form method="dialog" className="dialog-body" onSubmit={(event) => {
          event.preventDefault();
          saveDialog.current?.close();
          void saveProject(savePath);
        }}>
          <div className="dialog-heading"><strong>Save workflow</strong><button className="icon-button small" type="button" onClick={() => saveDialog.current?.close()} title="Close save dialog" aria-label="Close save dialog"><X size={15} /></button></div>
          <label className="field"><span>Project path</span><input value={savePath} onChange={(event) => setSavePath(event.target.value)} /></label>
          <div className="dialog-actions"><button className="command-button" type="button" onClick={() => saveDialog.current?.close()}>Cancel</button><button className="command-button primary" type="submit">Save</button></div>
        </form>
      </dialog>

      <dialog ref={openDialog}>
        <div className="dialog-body wide">
          <div className="dialog-heading"><strong>Open workflow</strong><button className="icon-button small" onClick={() => openDialog.current?.close()} title="Close open dialog" aria-label="Close open dialog"><X size={15} /></button></div>
          <div className="project-list">
            {projects.map((project) => (
              <button key={project.path} onClick={() => void loadProject(project.path)}>
                <Workflow size={15} /><span><strong>{project.name}</strong><small>{project.path}</small></span><time>{new Date(project.modified_at).toLocaleDateString()}</time>
              </button>
            ))}
            {!projects.length ? <div className="empty-state">No saved projects</div> : null}
          </div>
        </div>
      </dialog>

      <input
        className="visually-hidden"
        ref={projectFile}
        type="file"
        aria-label="Import project file"
        accept="application/json,.meregraph.json,.json"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void importProject(file);
          event.target.value = '';
        }}
      />
      <input
        className="visually-hidden"
        ref={comfyFile}
        type="file"
        aria-label="Import ComfyUI workflow"
        accept="application/json,.json"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void chooseComfyWorkflow(file);
          event.target.value = '';
        }}
      />
      <dialog ref={templateDialog}>
        <div className="dialog-body wide">
          <div className="dialog-heading"><strong>{templateDraft?.graph.name ?? 'Workflow template'}</strong><button className="icon-button small" onClick={() => templateDialog.current?.close()} title="Close template dialog" aria-label="Close template dialog"><X size={15} /></button></div>
          {templateDraft ? <TemplateForm
            graph={templateDraft.graph}
            values={templateDraft.inputs}
            onChange={(values) => setTemplateDraft({ ...templateDraft, inputs: values })}
          /> : null}
          <div className="dialog-actions"><button className="command-button" onClick={() => templateDialog.current?.close()}>Cancel</button><button className="command-button primary" onClick={applyTemplate}>Create workflow</button></div>
        </div>
      </dialog>
      <dialog ref={publishDialog}>
        <div className="dialog-body wide">
          <div className="dialog-heading"><strong>Publish workflow template</strong><button className="icon-button small" onClick={() => publishDialog.current?.close()} title="Close publish dialog" aria-label="Close publish dialog"><X size={15} /></button></div>
          <label className="field"><span>Template ID</span><input value={publishDraft.template_id} onChange={(event) => setPublishDraft({ ...publishDraft, template_id: event.target.value })} /></label>
          <label className="field"><span>Title</span><input value={publishDraft.title} onChange={(event) => setPublishDraft({ ...publishDraft, title: event.target.value })} /></label>
          <label className="field"><span>Description</span><textarea rows={4} value={publishDraft.description} onChange={(event) => setPublishDraft({ ...publishDraft, description: event.target.value })} /></label>
          <label className="field"><span>Tags</span><input value={publishDraft.tags} onChange={(event) => setPublishDraft({ ...publishDraft, tags: event.target.value })} /></label>
          <div className="dialog-actions"><button className="command-button" onClick={() => publishDialog.current?.close()}>Cancel</button><button className="command-button primary" onClick={() => void publishTemplate()}>Publish</button></div>
        </div>
      </dialog>
      <dialog ref={comfyDialog}>
        <div className="dialog-body wide">
          <div className="dialog-heading"><strong>Import ComfyUI workflow</strong><button className="icon-button small" onClick={() => comfyDialog.current?.close()} title="Close import dialog" aria-label="Close import dialog"><X size={15} /></button></div>
          <label className="field"><span>Managed model ID</span><input value={comfyModel} onChange={(event) => setComfyModel(event.target.value)} /></label>
          <pre className="import-report">{JSON.stringify(comfyReport, null, 2)}</pre>
          <div className="dialog-actions"><button className="command-button" onClick={() => comfyDialog.current?.close()}>Cancel</button><button className="command-button primary" onClick={() => void importComfy()}>Import</button></div>
        </div>
      </dialog>
      {installModel ? (
        <ModelInstallSheet
          model={installModel}
          scope={runtime.executionScope === 'cloud' ? 'cloud' : 'local'}
          preflight={installPreflight}
          preflightError={installPreflightError}
          pull={installPull}
          starting={installStarting}
          onConfirm={confirmInstall}
          onClose={closeInstall}
        />
      ) : null}
      </>))()}
    </div>
  );
}

function NativeApp() {
  const runtime = useMemo(() => new NativeRuntime(), []);
  const [status, setStatus] = useState<DesktopStatus | null>(null);
  const [settings, setSettings] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void runtime.status()
      .then(setStatus)
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)));
  }, [runtime]);

  const saveConfiguration = async (configuration: DesktopConfiguration) => {
    setSaving(true);
    setError(null);
    try {
      const next = await runtime.configure(configuration);
      setStatus(next);
      setSettings(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSaving(false);
    }
  };

  if (!status) {
    return <main className="desktop-setup"><div className="setup-loading"><span /><strong>{error ?? 'Starting Graph Studio'}</strong></div></main>;
  }
  if (settings || !status.onboarding_complete || !status.mere_run.available) {
    return <DesktopSetup
      status={status}
      settings={settings || status.onboarding_complete}
      saving={saving}
      error={error}
      onSave={(configuration) => void saveConfiguration(configuration)}
      onCancel={status.onboarding_complete && status.mere_run.available ? () => { setError(null); setSettings(false); } : undefined}
    />;
  }
  return <ReactFlowProvider><Workspace runtime={runtime} onOpenSettings={() => setSettings(true)} /></ReactFlowProvider>;
}

function CloudApp() {
  const runtime = useMemo(() => new CloudRuntime(), []);
  const [session, setSession] = useState<'loading' | 'ready' | 'guest'>('loading');
  const inStudio = window.location.pathname === '/app' || window.location.pathname.startsWith('/app/');

  useEffect(() => {
    if (!inStudio) return;
    void fetch('/auth/session')
      .then((response) => setSession(response.ok ? 'ready' : 'guest'))
      .catch(() => setSession('guest'));
  }, [inStudio]);

  if (!inStudio) return <CloudLanding />;
  if (session === 'loading') return <main className="cloud-gate"><span /><strong>Checking your sign-in session</strong></main>;
  if (session === 'guest') {
    return <main className="cloud-gate"><div><Workflow size={24} /><h1>Graph Studio</h1><p>Sign in with Mere World to open your projects and run workflows on connected machines.</p><a className="cloud-button large" href="/auth/start?return_to=%2Fapp">Sign in <ArrowRight size={17} /></a></div></main>;
  }
  return <ReactFlowProvider><Workspace runtime={runtime} onSignOut={() => window.location.assign('/auth/logout')} /></ReactFlowProvider>;
}

function DesktopDevelopmentGate() {
  return (
    <main className="cloud-gate">
      <div>
        <Workflow size={24} />
        <h1>Desktop Graph Studio</h1>
        <p>To open this development build, run <code>pnpm desktop:dev</code>. The desktop app runs local workflows without a Mere World account.</p>
      </div>
    </main>
  );
}

export default function App(): ReactElement {
  if (__MERE_GRAPH_STUDIO_CLOUD__) return <CloudApp />;
  return isNativeDesktop() ? <NativeApp /> : <DesktopDevelopmentGate />;
}
