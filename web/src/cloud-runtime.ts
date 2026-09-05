import { buildGraphSubmission, type GraphFleetCapabilities } from './cloud-contract';
import {
  arrayValue,
  decodeArray,
  decodeCatalogEntry,
  decodeJsonValue,
  decodeProjectSummary,
  decodeRunEvent,
  decodeStudioProject,
  decodeStudioProjectPackage,
  nullableString,
  optionalNumber,
  optionalString,
  parseJsonValue,
  recordValue,
  stringValue,
  type Decoder,
} from './decode';
import type {
  CommandDocument,
  CatalogEntry,
  EditorSidecar,
  JsonObject,
  JsonValue,
  ModelPull,
  ModelPullOptions,
  ProjectSummary,
  StudioProject,
  StudioProjectPackage,
  StudioRun,
  RunEvent,
  TemplateEntry,
  WorkflowGraph,
  WorkflowProgram,
} from './types';
import { pollModelPull, type StudioRuntime } from './runtime';

// Relay fleet + model-plan contract (subset consumed here). Hosted Studio has no
// local model store; installs run as fleet model-plans dispatched to paired
// Nodes, which report only textual phase/state — never numeric byte progress.
interface FleetNode {
  device_id: string;
  status?: string;
  runtime?: { installed_models?: string[] };
}

interface FleetSnapshot {
  nodes?: FleetNode[];
}

interface FleetModelPlan {
  plan_id: string;
  state: 'planned' | 'applying' | 'finished' | 'failed' | 'cancelled';
  model_ids?: string[];
  targets?: Array<{
    device_id: string;
    state: string;
    error?: string | null;
    missing_model_ids?: string[];
    results?: Array<{ model_id: string; state: string; error?: string }>;
  }>;
  events?: Array<{ phase?: string; message?: string }>;
}

interface RelayRun {
  job_id: string;
  state: string;
  created_at?: string;
  updated_at?: string;
  artifacts?: Array<{ name: string; kind: string; content_type?: string; size_bytes?: number; sha256?: string }>;
  error?: string | null;
  placement?: JsonValue;
  metrics?: JsonValue;
}

function decodeProvider(value: unknown, path: string): { id: string; version: string; catalog_sha256: string; node_kinds: string[] } {
  const source = recordValue(value, path);
  return {
    id: stringValue(source.id, `${path}.id`),
    version: stringValue(source.version, `${path}.version`),
    catalog_sha256: stringValue(source.catalog_sha256, `${path}.catalog_sha256`),
    node_kinds: decodeArray(source.node_kinds, stringValue, `${path}.node_kinds`),
  };
}

function decodeCapabilities(value: unknown, path: string): GraphFleetCapabilities {
  const source = recordValue(value, path);
  const catalog = source.catalog === undefined ? undefined : recordValue(source.catalog, `${path}.catalog`);
  return {
    worker_version: stringValue(source.worker_version, `${path}.worker_version`),
    accelerator_backend: stringValue(source.accelerator_backend, `${path}.accelerator_backend`),
    installed_model_ids: decodeArray(source.installed_model_ids, stringValue, `${path}.installed_model_ids`),
    available_secret_names: source.available_secret_names === undefined
      ? undefined
      : decodeArray(source.available_secret_names, stringValue, `${path}.available_secret_names`),
    providers: decodeArray(source.providers, decodeProvider, `${path}.providers`),
    catalog: catalog ? {
      graph_kind: optionalString(catalog.graph_kind, `${path}.catalog.graph_kind`),
      graph_schema_version: optionalNumber(catalog.graph_schema_version, `${path}.catalog.graph_schema_version`),
      job_contract_version: optionalString(catalog.job_contract_version, `${path}.catalog.job_contract_version`),
      nodes: catalog.nodes === undefined ? undefined : decodeArray(catalog.nodes, decodeCatalogEntry, `${path}.catalog.nodes`),
      providers: catalog.providers === undefined ? undefined : decodeArray(catalog.providers, decodeProvider, `${path}.catalog.providers`),
    } : undefined,
  };
}

function decodeRelayRun(value: unknown, path: string): RelayRun {
  const source = recordValue(value, path);
  return {
    job_id: stringValue(source.job_id, `${path}.job_id`),
    state: stringValue(source.state, `${path}.state`),
    created_at: optionalString(source.created_at, `${path}.created_at`),
    updated_at: optionalString(source.updated_at, `${path}.updated_at`),
    artifacts: source.artifacts === undefined ? undefined : arrayValue(source.artifacts, `${path}.artifacts`).map((item, index) => {
      const artifactPath = `${path}.artifacts[${index}]`;
      const artifact = recordValue(item, artifactPath);
      return {
        name: stringValue(artifact.name, `${artifactPath}.name`),
        kind: stringValue(artifact.kind, `${artifactPath}.kind`),
        content_type: optionalString(artifact.content_type, `${artifactPath}.content_type`),
        size_bytes: optionalNumber(artifact.size_bytes, `${artifactPath}.size_bytes`),
        sha256: optionalString(artifact.sha256, `${artifactPath}.sha256`),
      };
    }),
    error: source.error === undefined ? undefined : nullableString(source.error, `${path}.error`),
    placement: source.placement === undefined ? undefined : decodeJsonValue(source.placement, `${path}.placement`),
    metrics: source.metrics === undefined ? undefined : decodeJsonValue(source.metrics, `${path}.metrics`),
  };
}

function decodeRelayRuns(value: unknown, path: string): { jobs: RelayRun[] } {
  const source = recordValue(value, path);
  return { jobs: decodeArray(source.jobs, decodeRelayRun, `${path}.jobs`) };
}

function decodeFleetSnapshot(value: unknown, path: string): FleetSnapshot {
  const source = recordValue(value, path);
  return {
    nodes: source.nodes === undefined ? undefined : arrayValue(source.nodes, `${path}.nodes`).map((item, index) => {
      const nodePath = `${path}.nodes[${index}]`;
      const node = recordValue(item, nodePath);
      const runtime = node.runtime === undefined ? undefined : recordValue(node.runtime, `${nodePath}.runtime`);
      return {
        device_id: stringValue(node.device_id, `${nodePath}.device_id`),
        status: optionalString(node.status, `${nodePath}.status`),
        runtime: runtime ? {
          installed_models: runtime.installed_models === undefined
            ? undefined
            : decodeArray(runtime.installed_models, stringValue, `${nodePath}.runtime.installed_models`),
        } : undefined,
      };
    }),
  };
}

function planState(value: unknown, path: string): FleetModelPlan['state'] {
  if (value === 'planned' || value === 'applying' || value === 'finished' || value === 'failed' || value === 'cancelled') return value;
  throw new Error(`Invalid ${path}: expected a fleet model-plan state`);
}

function decodeFleetModelPlan(value: unknown, path: string): FleetModelPlan {
  const source = recordValue(value, path);
  return {
    plan_id: stringValue(source.plan_id, `${path}.plan_id`),
    state: planState(source.state, `${path}.state`),
    model_ids: source.model_ids === undefined ? undefined : decodeArray(source.model_ids, stringValue, `${path}.model_ids`),
    targets: source.targets === undefined ? undefined : arrayValue(source.targets, `${path}.targets`).map((item, index) => {
      const targetPath = `${path}.targets[${index}]`;
      const target = recordValue(item, targetPath);
      return {
        device_id: stringValue(target.device_id, `${targetPath}.device_id`),
        state: stringValue(target.state, `${targetPath}.state`),
        error: target.error === undefined ? undefined : nullableString(target.error, `${targetPath}.error`),
        missing_model_ids: target.missing_model_ids === undefined
          ? undefined
          : decodeArray(target.missing_model_ids, stringValue, `${targetPath}.missing_model_ids`),
        results: target.results === undefined ? undefined : arrayValue(target.results, `${targetPath}.results`).map((resultValue, resultIndex) => {
          const resultPath = `${targetPath}.results[${resultIndex}]`;
          const result = recordValue(resultValue, resultPath);
          return {
            model_id: stringValue(result.model_id, `${resultPath}.model_id`),
            state: stringValue(result.state, `${resultPath}.state`),
            error: optionalString(result.error, `${resultPath}.error`),
          };
        }),
      };
    }),
    events: source.events === undefined ? undefined : arrayValue(source.events, `${path}.events`).map((item, index) => {
      const eventPath = `${path}.events[${index}]`;
      const event = recordValue(item, eventPath);
      return {
        phase: optionalString(event.phase, `${eventPath}.phase`),
        message: optionalString(event.message, `${eventPath}.message`),
      };
    }),
  };
}

function decodeCloudProjects(value: unknown, path: string): { projects: ProjectSummary[] } {
  const source = recordValue(value, path);
  return { projects: decodeArray(source.projects, decodeProjectSummary, `${path}.projects`) };
}

function decodeSavedProject(value: unknown, path: string): { status: string; path: string } {
  const source = recordValue(value, path);
  return { status: stringValue(source.status, `${path}.status`), path: stringValue(source.path, `${path}.path`) };
}

function command<T>(result: T | null, error = ''): CommandDocument<T> {
  return { exit_code: error ? 1 : 0, result, stdout: '', stderr: error };
}

function studioRun(run: RelayRun, events?: RunEvent[], manifest?: JsonValue): StudioRun {
  const createdAt = run.created_at ?? new Date().toISOString();
  const terminal = ['finished', 'failed', 'cancelled'].includes(run.state);
  return {
    id: run.job_id,
    executor: 'relay:fleet',
    run_directory: '',
    state: run.state,
    created_at: createdAt,
    updated_at: run.updated_at ?? createdAt,
    exit_code: terminal ? (run.state === 'finished' ? 0 : 1) : null,
    result: { placement: run.placement ?? null, metrics: run.metrics ?? null },
    stderr: run.error ?? '',
    remote_reference: run.job_id,
    events,
    manifest,
    artifacts: (run.artifacts ?? []).map((artifact) => ({ ...artifact, path: artifact.name })),
  };
}

// The Node reports coarse phase labels (no byte/percent progress), so map them
// to human copy rather than leaking the raw enum into the review sheet.
const PLAN_PHASE_LABELS: Record<string, string> = {
  preflighting: 'Checking the model…',
  pulling: 'Downloading the model…',
  already_installed: 'Already installed.',
  installed: 'Installed on your fleet.',
  cancelled: 'Cancelled.',
};

function planTarget(plan: FleetModelPlan, model: string): NonNullable<FleetModelPlan['targets']>[number] | undefined {
  return plan.targets?.find((entry) => (entry.missing_model_ids ?? []).includes(model)) ?? plan.targets?.[0];
}

function planLastEvent(plan: FleetModelPlan): NonNullable<FleetModelPlan['events']>[number] | undefined {
  return plan.events?.at(-1);
}

function failedPlanDetail(
  target: ReturnType<typeof planTarget>,
  event: ReturnType<typeof planLastEvent>,
  model: string,
): string {
  const resultError = target?.results?.find((entry) => entry.model_id === model && entry.error)?.error;
  return target?.error ?? resultError ?? event?.message ?? 'Fleet install did not complete.';
}

function activePlanDetail(event: ReturnType<typeof planLastEvent>, done: boolean): string {
  const phaseLabel = event?.phase ? PLAN_PHASE_LABELS[event.phase] : undefined;
  return event?.message ?? phaseLabel ?? (done ? 'Installed on your fleet.' : 'Installing on your fleet…');
}

function pullState(failed: boolean, done: boolean): ModelPull['state'] {
  if (failed) return 'failed';
  return done ? 'installed' : 'installing';
}

function planToPull(plan: FleetModelPlan, model: string): ModelPull {
  const target = planTarget(plan, model);
  const failed = plan.state === 'failed' || plan.state === 'cancelled';
  const done = plan.state === 'finished';
  const lastEvent = planLastEvent(plan);
  const detail = failed ? failedPlanDetail(target, lastEvent, model) : activePlanDetail(lastEvent, done);
  return {
    model,
    state: pullState(failed, done),
    percent: done ? 100 : null,
    received_bytes: null,
    total_bytes: null,
    detail,
    install_path: null,
    stderr: failed ? (detail ?? '') : '',
    updated_at: new Date().toISOString(),
  };
}

async function responseBody(response: Response): Promise<unknown> {
  const contentType = response.headers.get('Content-Type') ?? '';
  return contentType.includes('json') ? response.json() : null;
}

function responseError(body: unknown, path: string, status: number): Error {
  const errorBody = body && typeof body === 'object' && !Array.isArray(body)
    ? recordValue(body, `HTTP ${path} error`)
    : null;
  const message = errorBody && typeof errorBody.error === 'string'
    ? errorBody.error
    : `Request failed: ${status}`;
  return new Error(message);
}

function installedPull(model: string): ModelPull {
  return {
    model,
    state: 'installed',
    percent: 100,
    received_bytes: null,
    total_bytes: null,
    detail: 'Already installed across your fleet.',
    install_path: null,
    stderr: '',
    updated_at: new Date().toISOString(),
  };
}

export class CloudRuntime implements StudioRuntime {
  readonly executionScope = 'cloud' as const;
  private capabilities: GraphFleetCapabilities | null = null;
  private readonly modelPlans = new Map<string, string>();

  private async refreshRequest<T>(path: string, decoder: Decoder<T>, init?: RequestInit): Promise<T> {
    const refresh = await fetch('/auth/refresh', { method: 'POST', headers: { Origin: window.location.origin } });
    if (refresh.ok) return this.request(path, decoder, init, true);
    window.location.assign(`/auth/start?return_to=${encodeURIComponent(window.location.pathname)}`);
    throw new Error('Your session expired. Redirecting to mere.world…');
  }

  private async request<T>(path: string, decoder: Decoder<T>, init?: RequestInit, refreshed = false): Promise<T> {
    const headers = new Headers(init?.headers);
    headers.set('Content-Type', 'application/json');
    const response = await fetch(path, {
      ...init,
      headers,
    });
    if (response.status === 401 && !refreshed) return this.refreshRequest(path, decoder, init);
    const body = await responseBody(response);
    if (!response.ok) throw responseError(body, path, response.status);
    return decoder(body, `HTTP ${path}`);
  }

  private async fleet(): Promise<GraphFleetCapabilities> {
    if (this.capabilities) return this.capabilities;
    const capabilities = await this.request('/api/relay/api/graph-jobs/capabilities', decodeCapabilities);
    // Only cache a fleet that actually reported a catalog. A Node that connects
    // *after* the page loaded would otherwise be masked forever by a cached-empty
    // result, surfacing as a permanent "Catalog unavailable" until a full reload.
    if ((capabilities.catalog?.nodes?.length ?? 0) > 0) this.capabilities = capabilities;
    return capabilities;
  }

  async catalog(): Promise<CommandDocument<{ nodes: CatalogEntry[] }>> {
    const capabilities = await this.fleet();
    const nodes = capabilities.catalog?.nodes ?? [];
    return command({ nodes }, nodes.length ? '' : 'Connect an updated mere.run Node to load its graph catalog.');
  }

  executors(): Promise<CommandDocument<JsonValue>> {
    return Promise.resolve(command({ executors: [{ kind: 'relay', name: 'fleet' }] }));
  }

  projects(): Promise<{ projects: ProjectSummary[] }> {
    return this.request('/api/studio/projects', decodeCloudProjects);
  }

  loadProject(path: string): Promise<StudioProject> {
    return this.request(`/api/studio/project?path=${encodeURIComponent(path)}`, decodeStudioProject);
  }

  saveProject(project: StudioProject): Promise<{ status: string; path: string }> {
    return this.request('/api/studio/project', decodeSavedProject, { method: 'PUT', body: JSON.stringify(project) });
  }

  exportProject(project: Omit<StudioProject, 'path'>): Promise<StudioProjectPackage> {
    return Promise.resolve({ contract_version: 'mere.run/graph-studio-project.v1', ...structuredClone(project) });
  }

  importProject(project: JsonValue): Promise<Omit<StudioProject, 'path'>> {
    if (!project || typeof project !== 'object' || Array.isArray(project)
      || project.contract_version !== 'mere.run/graph-studio-project.v1') {
      return Promise.reject(new Error('Project package must use mere.run/graph-studio-project.v1'));
    }
    const decoded = decodeStudioProjectPackage(project);
    return Promise.resolve({ graph: decoded.graph, inputs: decoded.inputs, sidecar: decoded.sidecar, program: decoded.program });
  }

  async check(
    mode: 'validate' | 'preflight',
    graph: WorkflowGraph,
    inputs: JsonObject,
    _executor: string,
  ): Promise<CommandDocument<JsonValue>> {
    try {
      const submission = await buildGraphSubmission(graph, inputs, await this.fleet());
      if (mode === 'validate') return command({ valid: true, job: submission.job });
      const result = await this.request('/api/relay/api/graph-jobs/preflight', decodeJsonValue, {
        method: 'POST',
        body: JSON.stringify(submission),
      });
      return command(result);
    } catch (error) {
      return command(null, error instanceof Error ? error.message : String(error));
    }
  }

  async comparePreflight(
    graph: WorkflowGraph,
    inputs: JsonObject,
    executors: string[],
  ): Promise<{ comparisons: { executor: string; document: CommandDocument<JsonValue> }[] }> {
    const comparisons = await Promise.all(executors.map(async (executor) => ({
      executor,
      document: await this.check('preflight', graph, inputs, executor),
    })));
    return { comparisons };
  }

  compileProgram(_program: WorkflowProgram): Promise<{ graph: WorkflowGraph; report: JsonValue; document: CommandDocument<JsonValue> }> {
    return Promise.reject(new Error('Program compilation requires the workflow-tools provider on a paired Node.'));
  }

  async startRun(graph: WorkflowGraph, inputs: JsonObject, _executor: string): Promise<StudioRun> {
    const submission = await buildGraphSubmission(graph, inputs, await this.fleet());
    const created = await this.request('/api/relay/api/graph-jobs', decodeRelayRun, {
      method: 'POST',
      body: JSON.stringify(submission),
    });
    const committed = await this.request(`/api/relay/api/graph-jobs/${created.job_id}/commit`, decodeRelayRun, {
      method: 'POST',
      body: '{}',
    });
    return studioRun(committed);
  }

  async listRuns(): Promise<{ runs: StudioRun[] }> {
    const response = await this.request('/api/relay/api/graph-jobs?limit=100', decodeRelayRuns);
    return { runs: response.jobs.map((run) => studioRun(run)) };
  }

  async inspectRun(id: string): Promise<StudioRun> {
    const run = await this.request(`/api/relay/api/graph-jobs/${encodeURIComponent(id)}`, decodeRelayRun);
    const eventsResponse = await fetch(`/api/relay/api/graph-jobs/${encodeURIComponent(id)}/events`);
    const events = eventsResponse.ok
      ? (await eventsResponse.text()).split('\n').filter(Boolean).map((line, index) => decodeRunEvent(parseJsonValue(line, `run event line ${index + 1}`)))
      : [];
    let manifest: JsonValue | undefined;
    try {
      manifest = await this.request(`/api/relay/api/graph-jobs/${encodeURIComponent(id)}/run-manifest`, decodeJsonValue);
    } catch {
      // A worker may publish its manifest only after execution finishes.
      manifest = undefined;
    }
    return studioRun(run, events, manifest);
  }

  async watchRun(id: string, onRun: (run: StudioRun) => void, signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      const run = await this.inspectRun(id);
      onRun(run);
      if (['finished', 'failed', 'cancelled'].includes(run.state)) return;
      await new Promise<void>((resolve) => {
        const timeout = window.setTimeout(resolve, 800);
        signal.addEventListener('abort', () => { window.clearTimeout(timeout); resolve(); }, { once: true });
      });
    }
  }

  async cancelRun(id: string): Promise<StudioRun> {
    return studioRun(await this.request(`/api/relay/api/graph-jobs/${encodeURIComponent(id)}`, decodeRelayRun, { method: 'DELETE' }));
  }

  fetchRun(id: string, _allArtifacts: boolean, _artifactNames?: string[]): Promise<StudioRun> {
    return this.inspectRun(id);
  }

  async retryRun(id: string): Promise<StudioRun> {
    return studioRun(await this.request(`/api/relay/api/graph-jobs/${encodeURIComponent(id)}/retry`, decodeRelayRun, { method: 'POST', body: '{}' }));
  }

  resumeRun(id: string): Promise<StudioRun> {
    return this.retryRun(id);
  }

  async artifactBlob(id: string, path: string): Promise<Blob> {
    const response = await fetch(`/api/relay/api/graph-jobs/${encodeURIComponent(id)}/artifacts/${encodeURIComponent(path)}`);
    if (!response.ok) throw new Error(`Artifact download failed: ${response.status}`);
    return response.blob();
  }

  importAssets(_paths: string[]): Promise<{ assets: never[] }> {
    return Promise.reject(new Error('File drop is available in the desktop app. Hosted asset upload is not enabled yet.'));
  }

  inputAssetBlob(_path: string, _contentType?: string): Promise<Blob> {
    return Promise.reject(new Error('Workspace input assets are only available in the desktop app.'));
  }

  templates(): Promise<{ available: boolean; document: CommandDocument<{ templates: TemplateEntry[] }> | null }> {
    return Promise.resolve({ available: false, document: command({ templates: [] }) });
  }

  loadTemplate(_templateId: string): Promise<{ graph: WorkflowGraph; inputs: JsonObject; sidecar: EditorSidecar; document: CommandDocument<JsonValue> }> {
    return Promise.reject(new Error('No cloud template provider is connected.'));
  }

  publishTemplate(
    _graph: WorkflowGraph,
    _inputs: JsonObject,
    _template: { template_id: string; title: string; description: string; tags: string[] },
  ): Promise<{ template: TemplateEntry; document: CommandDocument<JsonValue> }> {
    return Promise.reject(new Error('Template publishing requires a workflow-tools provider.'));
  }

  inspectComfy(_workflow: JsonValue): Promise<CommandDocument<JsonValue>> {
    return Promise.resolve(command(null, 'Comfy import requires a compatible provider on a paired Node.'));
  }

  importComfy(_workflow: JsonValue, _model: string): Promise<{ graph: WorkflowGraph; inputs: JsonObject; sidecar: EditorSidecar; document: CommandDocument<JsonValue> }> {
    return Promise.reject(new Error('Comfy import requires a compatible provider on a paired Node.'));
  }

  canInstallModels(): boolean {
    return true;
  }

  // Hosted Studio has no local model store to dry-run against; a fleet install
  // is a declarative model-plan whose only gate is accepting the model licenses.
  modelPreflight(model: string): Promise<CommandDocument<JsonValue>> {
    return Promise.resolve(command({
      schema_version: 1,
      mode: 'preflight',
      status: 'ok',
      cloud: true,
      summary: `${model} will be installed on the paired Nodes in your fleet that don’t already have it. Applying accepts the model’s usage terms.`,
      result: { models: [{ id: model, status: 'will_download', selected: true }] },
      diagnostics: [],
      actions: [],
    }));
  }

  async startModelPull(model: string, options: ModelPullOptions = {}): Promise<ModelPull> {
    const snapshot = await this.request('/api/relay/api/fleet', decodeFleetSnapshot);
    const nodes = snapshot.nodes ?? [];
    if (!nodes.length) throw new Error('Pair a mere.run Node before installing models on your fleet.');
    const missing = nodes.filter((node) => !(node.runtime?.installed_models ?? []).includes(model));
    if (!missing.length) {
      this.modelPlans.delete(model);
      return installedPull(model);
    }
    const targetDeviceIds = [...new Set(missing.map((node) => node.device_id).filter(Boolean))];
    const plan = await this.request('/api/relay/api/fleet/model-plans', decodeFleetModelPlan, {
      method: 'POST',
      body: JSON.stringify({ target_device_ids: targetDeviceIds, model_ids: [model] }),
    });
    this.modelPlans.set(model, plan.plan_id);
    const applied = await this.request(
      `/api/relay/api/fleet/model-plans/${encodeURIComponent(plan.plan_id)}/apply`,
      decodeFleetModelPlan,
      { method: 'POST', body: JSON.stringify({ accept_model_licenses: options.acceptLicense ?? true }) },
    );
    return planToPull(applied, model);
  }

  async inspectModelPull(model: string): Promise<ModelPull> {
    const planId = this.modelPlans.get(model);
    if (!planId) throw new Error(`No fleet install is tracked for ${model}.`);
    const plan = await this.request(`/api/relay/api/fleet/model-plans/${encodeURIComponent(planId)}`, decodeFleetModelPlan);
    return planToPull(plan, model);
  }

  watchModelPull(model: string, onPull: (pull: ModelPull) => void, signal: AbortSignal): Promise<void> {
    return pollModelPull((id) => this.inspectModelPull(id), model, onPull, signal);
  }
}
