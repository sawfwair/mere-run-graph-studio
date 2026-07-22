import { invoke } from '@tauri-apps/api/core';

import {
  arrayValue,
  booleanValue,
  decodeArray,
  decodeBytes,
  decodeCatalogEntry,
  decodeCommandDocument,
  decodeEditorSidecar,
  decodeJsonObject,
  decodeJsonValue,
  decodeModelPull,
  decodeProjectSummary,
  decodeStudioDocument,
  decodeStudioProject,
  decodeStudioProjectPackage,
  decodeStudioRun,
  decodeTemplateEntry,
  decodeWorkflowGraph,
  nullableString,
  numberValue,
  recordValue,
  stringValue,
  type Decoder,
} from './decode';

import type {
  CatalogEntry,
  CommandDocument,
  EditorSidecar,
  JsonObject,
  JsonValue,
  ModelPull,
  ModelPullOptions,
  ProjectSummary,
  StudioProject,
  StudioProjectPackage,
  StudioRun,
  TemplateEntry,
  WorkflowGraph,
  WorkflowProgram,
} from './types';

const MODEL_PULL_TERMINAL: ReadonlySet<string> = new Set(['installed', 'failed']);

async function invokeDecoded<T>(command: string, decoder: Decoder<T>, args?: Record<string, unknown>): Promise<T> {
  const value: unknown = await invoke<unknown>(command, args);
  return decoder(value, `Tauri command ${command}`);
}

export interface DesktopCommandStatus {
  path: string | null;
  available: boolean;
  version: string | null;
  error: string | null;
}

export interface DesktopStatus {
  app_version: string;
  platform: string;
  architecture: string;
  config_path: string;
  workspace: string;
  onboarding_complete: boolean;
  mere_run: DesktopCommandStatus;
  workflow_tools: DesktopCommandStatus;
}

export interface DesktopConfiguration {
  workspace: string;
  mere_run_command: string;
  workflow_tools_command: string;
  onboarding_complete: boolean;
}

export interface ImportedAsset {
  name: string;
  path: string;
  content_type: string;
  size_bytes: number;
}

function decodeDesktopCommandStatus(value: unknown, path: string): DesktopCommandStatus {
  const source = recordValue(value, path);
  return {
    path: nullableString(source.path, `${path}.path`),
    available: booleanValue(source.available, `${path}.available`),
    version: nullableString(source.version, `${path}.version`),
    error: nullableString(source.error, `${path}.error`),
  };
}

function decodeDesktopStatus(value: unknown, path: string): DesktopStatus {
  const source = recordValue(value, path);
  return {
    app_version: stringValue(source.app_version, `${path}.app_version`),
    platform: stringValue(source.platform, `${path}.platform`),
    architecture: stringValue(source.architecture, `${path}.architecture`),
    config_path: stringValue(source.config_path, `${path}.config_path`),
    workspace: stringValue(source.workspace, `${path}.workspace`),
    onboarding_complete: booleanValue(source.onboarding_complete, `${path}.onboarding_complete`),
    mere_run: decodeDesktopCommandStatus(source.mere_run, `${path}.mere_run`),
    workflow_tools: decodeDesktopCommandStatus(source.workflow_tools, `${path}.workflow_tools`),
  };
}

function decodeCatalogCommand(value: unknown, path: string): CommandDocument<{ nodes: CatalogEntry[] }> {
  return decodeCommandDocument(value, (result, resultPath) => {
    const source = recordValue(result, resultPath);
    return { nodes: decodeArray(source.nodes, decodeCatalogEntry, `${resultPath}.nodes`) };
  }, path);
}

function decodeJsonCommand(value: unknown, path: string): CommandDocument<JsonValue> {
  return decodeCommandDocument(value, decodeJsonValue, path);
}

function decodeProjects(value: unknown, path: string): { projects: ProjectSummary[] } {
  const source = recordValue(value, path);
  return { projects: decodeArray(source.projects, decodeProjectSummary, `${path}.projects`) };
}

function decodeSavedProject(value: unknown, path: string): { status: string; path: string } {
  const source = recordValue(value, path);
  return { status: stringValue(source.status, `${path}.status`), path: stringValue(source.path, `${path}.path`) };
}

function decodeComparisons(value: unknown, path: string): { comparisons: { executor: string; document: CommandDocument<JsonValue> }[] } {
  const source = recordValue(value, path);
  return {
    comparisons: arrayValue(source.comparisons, `${path}.comparisons`).map((item, index) => {
      const itemPath = `${path}.comparisons[${index}]`;
      const comparison = recordValue(item, itemPath);
      return {
        executor: stringValue(comparison.executor, `${itemPath}.executor`),
        document: decodeJsonCommand(comparison.document, `${itemPath}.document`),
      };
    }),
  };
}

function decodeCompiledProgram(value: unknown, path: string): {
  graph: WorkflowGraph;
  report: JsonValue;
  document: CommandDocument<JsonValue>;
} {
  const source = recordValue(value, path);
  return {
    graph: decodeWorkflowGraph(source.graph, `${path}.graph`),
    report: decodeJsonValue(source.report, `${path}.report`),
    document: decodeJsonCommand(source.document, `${path}.document`),
  };
}

function decodeRuns(value: unknown, path: string): { runs: StudioRun[] } {
  const source = recordValue(value, path);
  return { runs: decodeArray(source.runs, decodeStudioRun, `${path}.runs`) };
}

function decodeImportedAsset(value: unknown, path: string): ImportedAsset {
  const source = recordValue(value, path);
  return {
    name: stringValue(source.name, `${path}.name`),
    path: stringValue(source.path, `${path}.path`),
    content_type: stringValue(source.content_type, `${path}.content_type`),
    size_bytes: numberValue(source.size_bytes, `${path}.size_bytes`),
  };
}

function decodeImportedAssets(value: unknown, path: string): { assets: ImportedAsset[] } {
  const source = recordValue(value, path);
  return { assets: decodeArray(source.assets, decodeImportedAsset, `${path}.assets`) };
}

function decodeTemplates(value: unknown, path: string): { available: boolean; document: CommandDocument<{ templates: TemplateEntry[] }> | null } {
  const source = recordValue(value, path);
  return {
    available: booleanValue(source.available, `${path}.available`),
    document: source.document === null ? null : decodeCommandDocument(source.document, (result, resultPath) => {
      const resultSource = recordValue(result, resultPath);
      return { templates: decodeArray(resultSource.templates, decodeTemplateEntry, `${resultPath}.templates`) };
    }, `${path}.document`),
  };
}

function decodeLoadedTemplate(value: unknown, path: string): {
  graph: WorkflowGraph;
  inputs: JsonObject;
  sidecar: EditorSidecar;
  document: CommandDocument<JsonValue>;
} {
  const source = recordValue(value, path);
  return {
    graph: decodeWorkflowGraph(source.graph, `${path}.graph`),
    inputs: decodeJsonObject(source.inputs, `${path}.inputs`),
    sidecar: decodeEditorSidecar(source.sidecar, `${path}.sidecar`),
    document: decodeJsonCommand(source.document, `${path}.document`),
  };
}

function decodePublishedTemplate(value: unknown, path: string): { template: TemplateEntry; document: CommandDocument<JsonValue> } {
  const source = recordValue(value, path);
  return {
    template: decodeTemplateEntry(source.template, `${path}.template`),
    document: decodeJsonCommand(source.document, `${path}.document`),
  };
}

export interface StudioRuntime {
  readonly executionScope?: 'local' | 'cloud';
  catalog(): Promise<CommandDocument<{ nodes: CatalogEntry[] }>>;
  executors(): Promise<CommandDocument<JsonValue>>;
  projects(): Promise<{ projects: ProjectSummary[] }>;
  loadProject(path: string): Promise<StudioProject>;
  saveProject(project: StudioProject): Promise<{ status: string; path: string }>;
  exportProject(project: Omit<StudioProject, 'path'>): Promise<StudioProjectPackage>;
  importProject(project: JsonValue): Promise<Omit<StudioProject, 'path'>>;
  check(
    mode: 'validate' | 'preflight',
    graph: WorkflowGraph,
    inputs: JsonObject,
    executor: string,
  ): Promise<CommandDocument<JsonValue>>;
  comparePreflight(
    graph: WorkflowGraph,
    inputs: JsonObject,
    executors: string[],
  ): Promise<{ comparisons: { executor: string; document: CommandDocument<JsonValue> }[] }>;
  compileProgram(program: WorkflowProgram): Promise<{
    graph: WorkflowGraph;
    report: JsonValue;
    document: CommandDocument<JsonValue>;
  }>;
  startRun(graph: WorkflowGraph, inputs: JsonObject, executor: string): Promise<StudioRun>;
  listRuns(): Promise<{ runs: StudioRun[] }>;
  inspectRun(id: string): Promise<StudioRun>;
  watchRun(id: string, onRun: (run: StudioRun) => void, signal: AbortSignal): Promise<void>;
  cancelRun(id: string): Promise<StudioRun>;
  fetchRun(id: string, allArtifacts: boolean, artifactNames?: string[]): Promise<StudioRun>;
  retryRun(id: string): Promise<StudioRun>;
  resumeRun(id: string): Promise<StudioRun>;
  artifactBlob(id: string, path: string, contentType?: string): Promise<Blob>;
  importAssets(paths: string[]): Promise<{ assets: ImportedAsset[] }>;
  inputAssetBlob(path: string, contentType?: string): Promise<Blob>;
  templates(): Promise<{ available: boolean; document: CommandDocument<{ templates: TemplateEntry[] }> | null }>;
  loadTemplate(templateId: string): Promise<{
    graph: WorkflowGraph;
    inputs: JsonObject;
    sidecar: EditorSidecar;
    document: CommandDocument<JsonValue>;
  }>;
  publishTemplate(
    graph: WorkflowGraph,
    inputs: JsonObject,
    template: { template_id: string; title: string; description: string; tags: string[] },
  ): Promise<{ template: TemplateEntry; document: CommandDocument<JsonValue> }>;
  inspectComfy(workflow: JsonValue): Promise<CommandDocument<JsonValue>>;
  importComfy(workflow: JsonValue, model: string): Promise<{
    graph: WorkflowGraph;
    inputs: JsonObject;
    sidecar: EditorSidecar;
    document: CommandDocument<JsonValue>;
  }>;
  /** Whether this runtime can install a model onto its execution target. */
  canInstallModels(): boolean;
  /** Structured install dry-run: support, download size, disk, license terms. */
  modelPreflight(model: string): Promise<CommandDocument<JsonValue>>;
  /** Begin installing a model and return the initial tracking record. */
  startModelPull(model: string, options?: ModelPullOptions): Promise<ModelPull>;
  /** Latest tracking record for an in-flight or finished install. */
  inspectModelPull(model: string): Promise<ModelPull>;
  /** Poll an install to a terminal state, calling back on every update. */
  watchModelPull(model: string, onPull: (pull: ModelPull) => void, signal: AbortSignal): Promise<void>;
}

export function isNativeDesktop(): boolean {
  return '__TAURI_INTERNALS__' in window;
}

// Native Studio is intentionally an offline Tauri IPC client. There is no
// browser HTTP fallback, authentication gate, or network dependency here.
export class NativeRuntime implements StudioRuntime {
  status(): Promise<DesktopStatus> {
    return invokeDecoded('studio_status', decodeDesktopStatus);
  }

  configure(request: DesktopConfiguration): Promise<DesktopStatus> {
    return invokeDecoded('studio_configure', decodeDesktopStatus, { request });
  }

  catalog(): Promise<CommandDocument<{ nodes: CatalogEntry[] }>> {
    return invokeDecoded('studio_catalog', decodeCatalogCommand);
  }

  executors(): Promise<CommandDocument<JsonValue>> {
    return invokeDecoded('studio_executors', decodeJsonCommand);
  }

  projects(): Promise<{ projects: ProjectSummary[] }> {
    return invokeDecoded('studio_projects', decodeProjects);
  }

  loadProject(path: string): Promise<StudioProject> {
    return invokeDecoded('studio_load_project', decodeStudioProject, { value: path });
  }

  saveProject(project: StudioProject): Promise<{ status: string; path: string }> {
    return invokeDecoded('studio_save_project', decodeSavedProject, { request: project });
  }

  exportProject(project: Omit<StudioProject, 'path'>): Promise<StudioProjectPackage> {
    return invokeDecoded('studio_export_project', decodeStudioProjectPackage, { request: project });
  }

  importProject(project: JsonValue): Promise<Omit<StudioProject, 'path'>> {
    return invokeDecoded('studio_import_project', decodeStudioDocument, { request: project });
  }

  check(
    mode: 'validate' | 'preflight',
    graph: WorkflowGraph,
    inputs: JsonObject,
    executor: string,
  ): Promise<CommandDocument<JsonValue>> {
    return invokeDecoded('studio_check', decodeJsonCommand, { request: { mode, graph, inputs, executor } });
  }

  comparePreflight(
    graph: WorkflowGraph,
    inputs: JsonObject,
    executors: string[],
  ): Promise<{ comparisons: { executor: string; document: CommandDocument<JsonValue> }[] }> {
    return invokeDecoded('studio_compare_preflight', decodeComparisons, { request: { graph, inputs, executors } });
  }

  compileProgram(program: WorkflowProgram): Promise<{
    graph: WorkflowGraph;
    report: JsonValue;
    document: CommandDocument<JsonValue>;
  }> {
    return invokeDecoded('studio_compile_program', decodeCompiledProgram, { request: { program } });
  }

  startRun(graph: WorkflowGraph, inputs: JsonObject, executor: string): Promise<StudioRun> {
    return invokeDecoded('studio_start_run', decodeStudioRun, { request: { graph, inputs, executor } });
  }

  listRuns(): Promise<{ runs: StudioRun[] }> {
    return invokeDecoded('studio_list_runs', decodeRuns);
  }

  inspectRun(id: string): Promise<StudioRun> {
    return invokeDecoded('studio_inspect_run', decodeStudioRun, { value: id });
  }

  async watchRun(id: string, onRun: (run: StudioRun) => void, signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      const run = await this.inspectRun(id);
      onRun(run);
      if (['finished', 'failed', 'cancelled'].includes(run.state)) return;
      await new Promise<void>((resolve) => {
        const timeout = window.setTimeout(resolve, 350);
        signal.addEventListener('abort', () => {
          window.clearTimeout(timeout);
          resolve();
        }, { once: true });
      });
    }
  }

  cancelRun(id: string): Promise<StudioRun> {
    return invokeDecoded('studio_cancel_run', decodeStudioRun, { value: id });
  }

  fetchRun(id: string, allArtifacts: boolean, artifactNames: string[] = []): Promise<StudioRun> {
    return invokeDecoded('studio_fetch_run', decodeStudioRun, {
      request: { id, all_artifacts: allArtifacts, artifact_names: artifactNames },
    });
  }

  retryRun(id: string): Promise<StudioRun> {
    return invokeDecoded('studio_retry_run', decodeStudioRun, { value: id });
  }

  resumeRun(id: string): Promise<StudioRun> {
    return invokeDecoded('studio_resume_run', decodeStudioRun, { value: id });
  }

  async artifactBlob(id: string, path: string, contentType?: string): Promise<Blob> {
    const bytes = await invokeDecoded('studio_artifact', decodeBytes, { id, path });
    return new Blob([bytes], { type: contentType });
  }

  importAssets(paths: string[]): Promise<{ assets: ImportedAsset[] }> {
    return invokeDecoded('studio_import_assets', decodeImportedAssets, { request: { paths } });
  }

  async inputAssetBlob(path: string, contentType?: string): Promise<Blob> {
    const bytes = await invokeDecoded('studio_input_asset', decodeBytes, { path });
    return new Blob([bytes], { type: contentType });
  }

  templates(): Promise<{ available: boolean; document: CommandDocument<{ templates: TemplateEntry[] }> | null }> {
    return invokeDecoded('studio_templates', decodeTemplates);
  }

  loadTemplate(templateId: string): Promise<{
    graph: WorkflowGraph;
    inputs: JsonObject;
    sidecar: EditorSidecar;
    document: CommandDocument<JsonValue>;
  }> {
    return invokeDecoded('studio_load_template', decodeLoadedTemplate, { value: templateId });
  }

  publishTemplate(
    graph: WorkflowGraph,
    inputs: JsonObject,
    template: { template_id: string; title: string; description: string; tags: string[] },
  ): Promise<{ template: TemplateEntry; document: CommandDocument<JsonValue> }> {
    return invokeDecoded('studio_publish_template', decodePublishedTemplate, { request: { graph, inputs, ...template } });
  }

  inspectComfy(workflow: JsonValue): Promise<CommandDocument<JsonValue>> {
    return invokeDecoded('studio_inspect_comfy', decodeJsonCommand, { request: { workflow } });
  }

  importComfy(workflow: JsonValue, model: string): Promise<{
    graph: WorkflowGraph;
    inputs: JsonObject;
    sidecar: EditorSidecar;
    document: CommandDocument<JsonValue>;
  }> {
    return invokeDecoded('studio_import_comfy', decodeLoadedTemplate, { request: { workflow, model } });
  }

  canInstallModels(): boolean {
    return true;
  }

  modelPreflight(model: string): Promise<CommandDocument<JsonValue>> {
    return invokeDecoded('studio_model_preflight', decodeJsonCommand, { request: { target: model } });
  }

  startModelPull(model: string, options: ModelPullOptions = {}): Promise<ModelPull> {
    return invokeDecoded('studio_model_pull', decodeModelPull, {
      request: {
        target: model,
        accept_license: options.acceptLicense ?? false,
        allow_unsupported: options.allowUnsupported ?? false,
        force: options.force ?? false,
      },
    });
  }

  inspectModelPull(model: string): Promise<ModelPull> {
    return invokeDecoded('studio_inspect_model_pull', decodeModelPull, { value: model });
  }

  watchModelPull(model: string, onPull: (pull: ModelPull) => void, signal: AbortSignal): Promise<void> {
    return pollModelPull((id) => this.inspectModelPull(id), model, onPull, signal);
  }
}

/** Shared poll loop for model installs — used by every runtime, since a pull is
 *  observed by re-reading its record until it reaches a terminal state. */
export async function pollModelPull(
  inspect: (model: string) => Promise<ModelPull>,
  model: string,
  onPull: (pull: ModelPull) => void,
  signal: AbortSignal,
): Promise<void> {
  while (!signal.aborted) {
    let pull: ModelPull;
    try {
      pull = await inspect(model);
    } catch {
      if (signal.aborted) return;
      throw new Error(`Lost track of the ${model} install.`);
    }
    onPull(pull);
    if (MODEL_PULL_TERMINAL.has(pull.state)) return;
    await new Promise<void>((resolve) => {
      const timeout = window.setTimeout(resolve, 500);
      signal.addEventListener('abort', () => {
        window.clearTimeout(timeout);
        resolve();
      }, { once: true });
    });
  }
}
