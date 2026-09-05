import type {
  CatalogEntry,
  CatalogField,
  CatalogProvider,
  CatalogValueSchema,
  CommandDocument,
  EditorAppConfig,
  EditorAppField,
  EditorGroupState,
  EditorNodeState,
  EditorNoteState,
  EditorPromotionState,
  EditorSelectionSet,
  EditorSidecar,
  FieldType,
  GraphInputDefinition,
  GraphReference,
  JsonObject,
  JsonValue,
  ModelPull,
  ModelPullState,
  ProjectSummary,
  RunArtifact,
  RunEvent,
  RunHistoryEntry,
  RunNodeDetail,
  StudioDocument,
  StudioProject,
  StudioProjectPackage,
  StudioRun,
  TemplateEntry,
  WorkflowGraph,
  WorkflowModule,
  WorkflowNode,
  WorkflowProgram,
  WorkflowProgramStep,
} from './types';

export type Decoder<T> = (value: unknown, path: string) => T;

const fieldTypes: Record<string, FieldType> = {
  string: 'string',
  integer: 'integer',
  number: 'number',
  boolean: 'boolean',
  enum: 'enum',
  json: 'json',
  asset: 'asset',
  asset_directory: 'asset_directory',
  asset_array: 'asset_array',
  asset_collection: 'asset_collection',
};

const schemaTypes: Record<string, CatalogValueSchema['type']> = {
  object: 'object',
  array: 'array',
  string: 'string',
  integer: 'integer',
  number: 'number',
  boolean: 'boolean',
  enum: 'enum',
  json: 'json',
};

function invalid(path: string, expectation: string): never {
  throw new Error(`Invalid ${path}: expected ${expectation}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function recordValue(value: unknown, path = 'value'): Record<string, unknown> {
  if (!isRecord(value)) return invalid(path, 'an object');
  return value;
}

export function arrayValue(value: unknown, path = 'value'): unknown[] {
  if (!Array.isArray(value)) return invalid(path, 'an array');
  return value;
}

export function stringValue(value: unknown, path = 'value'): string {
  if (typeof value !== 'string') return invalid(path, 'a string');
  return value;
}

export function numberValue(value: unknown, path = 'value'): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return invalid(path, 'a finite number');
  return value;
}

export function booleanValue(value: unknown, path = 'value'): boolean {
  if (typeof value !== 'boolean') return invalid(path, 'a boolean');
  return value;
}

export function nullableString(value: unknown, path = 'value'): string | null {
  return value === null ? null : stringValue(value, path);
}

export function nullableNumber(value: unknown, path = 'value'): number | null {
  return value === null ? null : numberValue(value, path);
}

export function optionalString(value: unknown, path = 'value'): string | undefined {
  return value === undefined ? undefined : stringValue(value, path);
}

export function optionalNumber(value: unknown, path = 'value'): number | undefined {
  return value === undefined ? undefined : numberValue(value, path);
}

export function optionalBoolean(value: unknown, path = 'value'): boolean | undefined {
  return value === undefined ? undefined : booleanValue(value, path);
}

export function decodeArray<T>(value: unknown, decoder: Decoder<T>, path = 'value'): T[] {
  return arrayValue(value, path).map((item, index) => decoder(item, `${path}[${index}]`));
}

function optionalArray<T>(value: unknown, decoder: Decoder<T>, path: string): T[] | undefined {
  return value === undefined ? undefined : decodeArray(value, decoder, path);
}

function decodeRecord<T>(value: unknown, decoder: Decoder<T>, path: string): Record<string, T> {
  return Object.fromEntries(
    Object.entries(recordValue(value, path)).map(([key, item]) => [key, decoder(item, `${path}.${key}`)]),
  );
}

export function decodeJsonValue(value: unknown, path = 'JSON value'): JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map((item, index) => decodeJsonValue(item, `${path}[${index}]`));
  const record = recordValue(value, path);
  return Object.fromEntries(
    Object.entries(record).map(([key, item]) => [key, decodeJsonValue(item, `${path}.${key}`)]),
  );
}

export function decodeJsonObject(value: unknown, path = 'JSON object'): JsonObject {
  const decoded = decodeJsonValue(value, path);
  if (!isRecord(decoded)) return invalid(path, 'a JSON object');
  return decoded;
}

export function parseJsonValue(text: string, path = 'JSON'): JsonValue {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new Error(`Invalid ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
  return decodeJsonValue(value, path);
}

export function decodeFieldType(value: unknown, path = 'field type'): FieldType {
  if (typeof value === 'string' && fieldTypes[value]) return fieldTypes[value];
  return invalid(path, 'a supported field type');
}

function optionalDecoded<T>(value: unknown, decoder: Decoder<T>, path: string): T | undefined {
  return value === undefined ? undefined : decoder(value, path);
}

function stringArray(value: unknown, path: string): string[] {
  return decodeArray(value, stringValue, path);
}

function optionalStringArray(value: unknown, path: string): string[] | undefined {
  return value === undefined ? undefined : stringArray(value, path);
}

function decodeCatalogValueSchema(value: unknown, path = 'catalog schema'): CatalogValueSchema {
  const source = recordValue(value, path);
  const type = typeof source.type === 'string' ? schemaTypes[source.type] : undefined;
  if (!type) return invalid(`${path}.type`, 'a schema type');
  return {
    type,
    title: optionalString(source.title, `${path}.title`),
    description: optionalString(source.description, `${path}.description`),
    default: optionalDecoded(source.default, decodeJsonValue, `${path}.default`),
    values: optionalStringArray(source.values, `${path}.values`),
    properties: optionalDecoded(
      source.properties,
      (item, itemPath) => decodeRecord(item, decodeCatalogValueSchema, itemPath),
      `${path}.properties`,
    ),
    required: optionalStringArray(source.required, `${path}.required`),
    items: optionalDecoded(source.items, decodeCatalogValueSchema, `${path}.items`),
    additional_properties: optionalDecoded(
      source.additional_properties,
      decodeCatalogValueSchema,
      `${path}.additional_properties`,
    ),
    minimum: optionalNumber(source.minimum, `${path}.minimum`),
    maximum: optionalNumber(source.maximum, `${path}.maximum`),
    step: optionalNumber(source.step, `${path}.step`),
    multiline: optionalBoolean(source.multiline, `${path}.multiline`),
  };
}

function decodeCatalogField(value: unknown, path = 'catalog field'): CatalogField {
  const source = recordValue(value, path);
  return {
    name: stringValue(source.name, `${path}.name`),
    type: decodeFieldType(source.type, `${path}.type`),
    required: optionalBoolean(source.required, `${path}.required`),
    optional: optionalBoolean(source.optional, `${path}.optional`),
    description: optionalString(source.description, `${path}.description`),
    default: source.default === undefined ? undefined : decodeJsonValue(source.default, `${path}.default`),
    values: optionalStringArray(source.values, `${path}.values`),
    minimum: optionalNumber(source.minimum, `${path}.minimum`),
    maximum: optionalNumber(source.maximum, `${path}.maximum`),
    step: optionalNumber(source.step, `${path}.step`),
    multiline: optionalBoolean(source.multiline, `${path}.multiline`),
    secret: optionalBoolean(source.secret, `${path}.secret`),
    content_types: optionalStringArray(source.content_types, `${path}.content_types`),
    value_schema: source.value_schema === undefined ? undefined : decodeCatalogValueSchema(source.value_schema, `${path}.value_schema`),
  };
}

function decodeCatalogProvider(value: unknown, path: string): CatalogProvider {
  const source = recordValue(value, path);
  return {
    id: stringValue(source.id, `${path}.id`),
    version: optionalString(source.version, `${path}.version`),
    catalog_sha256: optionalString(source.catalog_sha256, `${path}.catalog_sha256`),
  };
}

function decodeCatalogTraits(value: unknown, path: string): CatalogEntry['traits'] {
  if (value === undefined) return undefined;
  const traits = recordValue(value, path);
  return {
    cacheable: optionalBoolean(traits.cacheable, `${path}.cacheable`),
    deterministic: optionalBoolean(traits.deterministic, `${path}.deterministic`),
    supports_progress: optionalBoolean(traits.supports_progress, `${path}.supports_progress`),
    supports_previews: optionalBoolean(traits.supports_previews, `${path}.supports_previews`),
    side_effects: optionalString(traits.side_effects, `${path}.side_effects`),
  };
}

function decodeCatalogRequirements(value: unknown, path: string): CatalogEntry['requirements'] {
  if (value === undefined) return undefined;
  const requirements = recordValue(value, path);
  return {
    accelerator_backends: optionalStringArray(requirements.accelerator_backends, `${path}.accelerator_backends`),
    model_ids: optionalStringArray(requirements.model_ids, `${path}.model_ids`),
  };
}

function decodeCatalogPresentation(value: unknown, path: string): CatalogEntry['presentation'] {
  if (value === undefined) return undefined;
  const presentation = recordValue(value, path);
  if (presentation.style !== 'material') return invalid(`${path}.style`, 'material');
  return {
    style: 'material',
    primary_argument: optionalString(presentation.primary_argument, `${path}.primary_argument`),
  };
}

export function decodeCatalogEntry(value: unknown, path = 'catalog entry'): CatalogEntry {
  const source = recordValue(value, path);
  return {
    kind: stringValue(source.kind, `${path}.kind`),
    title: stringValue(source.title, `${path}.title`),
    description: optionalString(source.description, `${path}.description`),
    category: optionalString(source.category, `${path}.category`),
    provider: optionalDecoded(source.provider, decodeCatalogProvider, `${path}.provider`),
    inputs: decodeArray(source.inputs, decodeCatalogField, `${path}.inputs`),
    outputs: decodeArray(source.outputs, decodeCatalogField, `${path}.outputs`),
    traits: decodeCatalogTraits(source.traits, `${path}.traits`),
    requirements: decodeCatalogRequirements(source.requirements, `${path}.requirements`),
    presentation: decodeCatalogPresentation(source.presentation, `${path}.presentation`),
  };
}

function decodeGraphInput(value: unknown, path: string): GraphInputDefinition {
  const source = recordValue(value, path);
  return {
    type: decodeFieldType(source.type, `${path}.type`),
    required: optionalBoolean(source.required, `${path}.required`),
    values: optionalStringArray(source.values, `${path}.values`),
    description: optionalString(source.description, `${path}.description`),
    default: source.default === undefined ? undefined : decodeJsonValue(source.default, `${path}.default`),
    minimum: optionalNumber(source.minimum, `${path}.minimum`),
    maximum: optionalNumber(source.maximum, `${path}.maximum`),
    step: optionalNumber(source.step, `${path}.step`),
    multiline: optionalBoolean(source.multiline, `${path}.multiline`),
  };
}

function decodeGraphReference(value: unknown, path: string): GraphReference {
  const source = decodeJsonObject(value, path);
  return { ...source, $ref: stringValue(source.$ref, `${path}.$ref`) };
}

function decodeWorkflowNode(value: unknown, path: string): WorkflowNode {
  const source = recordValue(value, path);
  const execution = source.execution === undefined ? undefined : recordValue(source.execution, `${path}.execution`);
  const cache = execution?.cache;
  if (cache !== undefined && cache !== 'auto' && cache !== 'never' && cache !== 'refresh') {
    return invalid(`${path}.execution.cache`, 'auto, never, or refresh');
  }
  return {
    id: stringValue(source.id, `${path}.id`),
    kind: stringValue(source.kind, `${path}.kind`),
    provider: optionalString(source.provider, `${path}.provider`),
    arguments: decodeRecord(source.arguments, decodeJsonValue, `${path}.arguments`),
    depends_on: optionalStringArray(source.depends_on, `${path}.depends_on`),
    execution: execution ? {
      cache,
      max_attempts: optionalNumber(execution.max_attempts, `${path}.execution.max_attempts`),
      timeout_seconds: optionalNumber(execution.timeout_seconds, `${path}.execution.timeout_seconds`),
    } : undefined,
  };
}

export function decodeWorkflowGraph(value: unknown, path = 'workflow graph'): WorkflowGraph {
  const source = recordValue(value, path);
  if (source.schema_version !== 1) return invalid(`${path}.schema_version`, '1');
  if (source.kind !== 'mere.run/workflow-graph') return invalid(`${path}.kind`, 'mere.run/workflow-graph');
  const execution = source.execution === undefined ? undefined : recordValue(source.execution, `${path}.execution`);
  return {
    schema_version: 1,
    kind: 'mere.run/workflow-graph',
    name: stringValue(source.name, `${path}.name`),
    inputs: decodeRecord(source.inputs, decodeGraphInput, `${path}.inputs`),
    execution: execution ? { max_parallel_nodes: optionalNumber(execution.max_parallel_nodes, `${path}.execution.max_parallel_nodes`) } : undefined,
    nodes: decodeArray(source.nodes, decodeWorkflowNode, `${path}.nodes`),
    outputs: decodeRecord(source.outputs, decodeGraphReference, `${path}.outputs`),
    metadata: source.metadata === undefined ? undefined : decodeJsonObject(source.metadata, `${path}.metadata`),
  };
}

function decodeWorkflowModule(value: unknown, path: string): WorkflowModule {
  const source = recordValue(value, path);
  return {
    parameters: stringArray(source.parameters, `${path}.parameters`),
    nodes: decodeArray(source.nodes, decodeWorkflowNode, `${path}.nodes`),
    outputs: decodeRecord(source.outputs, decodeGraphReference, `${path}.outputs`),
  };
}

function decodeProgramStep(value: unknown, path: string): WorkflowProgramStep {
  const source = recordValue(value, path);
  const map = source.map === undefined ? undefined : recordValue(source.map, `${path}.map`);
  return {
    id: stringValue(source.id, `${path}.id`),
    module: stringValue(source.module, `${path}.module`),
    arguments: decodeRecord(source.arguments, decodeJsonValue, `${path}.arguments`),
    when: source.when === undefined ? undefined : decodeJsonValue(source.when, `${path}.when`),
    map: map ? {
      item: stringValue(map.item, `${path}.map.item`),
      values: decodeJsonValue(map.values, `${path}.map.values`),
    } : undefined,
  };
}

export function decodeWorkflowProgram(value: unknown, path = 'workflow program'): WorkflowProgram {
  const source = recordValue(value, path);
  if (source.schema_version !== 1) return invalid(`${path}.schema_version`, '1');
  if (source.kind !== 'mere.run/workflow-program') return invalid(`${path}.kind`, 'mere.run/workflow-program');
  const execution = source.execution === undefined ? undefined : recordValue(source.execution, `${path}.execution`);
  return {
    schema_version: 1,
    kind: 'mere.run/workflow-program',
    name: stringValue(source.name, `${path}.name`),
    inputs: decodeRecord(source.inputs, decodeGraphInput, `${path}.inputs`),
    variables: source.variables === undefined ? undefined : decodeJsonObject(source.variables, `${path}.variables`),
    imports: source.imports === undefined ? undefined : decodeRecord(source.imports, stringValue, `${path}.imports`),
    modules: decodeRecord(source.modules, decodeWorkflowModule, `${path}.modules`),
    steps: decodeArray(source.steps, decodeProgramStep, `${path}.steps`),
    outputs: decodeRecord(source.outputs, decodeGraphReference, `${path}.outputs`),
    execution: execution ? { max_parallel_nodes: optionalNumber(execution.max_parallel_nodes, `${path}.execution.max_parallel_nodes`) } : undefined,
    metadata: source.metadata === undefined ? undefined : decodeJsonObject(source.metadata, `${path}.metadata`),
  };
}

function decodeNodeState(value: unknown, path: string): EditorNodeState {
  const source = recordValue(value, path);
  return {
    x: numberValue(source.x, `${path}.x`),
    y: numberValue(source.y, `${path}.y`),
    collapsed: optionalBoolean(source.collapsed, `${path}.collapsed`),
    color: optionalString(source.color, `${path}.color`),
  };
}

function decodeGroupState(value: unknown, path: string): EditorGroupState {
  const source = recordValue(value, path);
  return {
    ...decodeNodeState(source, path),
    title: stringValue(source.title, `${path}.title`),
    width: numberValue(source.width, `${path}.width`),
    height: numberValue(source.height, `${path}.height`),
    node_ids: stringArray(source.node_ids, `${path}.node_ids`),
  };
}

function decodeNoteState(value: unknown, path: string): EditorNoteState {
  const source = recordValue(value, path);
  return {
    ...decodeNodeState(source, path),
    text: stringValue(source.text, `${path}.text`),
    width: numberValue(source.width, `${path}.width`),
    height: numberValue(source.height, `${path}.height`),
  };
}

function decodeSelection(value: unknown, path: string): EditorSelectionSet {
  const source = recordValue(value, path);
  return { node_ids: stringArray(source.node_ids, `${path}.node_ids`) };
}

function decodePromotion(value: unknown, path: string): EditorPromotionState {
  const source = recordValue(value, path);
  const position = recordValue(source.consumer_position, `${path}.consumer_position`);
  return {
    consumer_id: stringValue(source.consumer_id, `${path}.consumer_id`),
    argument_name: stringValue(source.argument_name, `${path}.argument_name`),
    consumer_position: {
      x: numberValue(position.x, `${path}.consumer_position.x`),
      y: numberValue(position.y, `${path}.consumer_position.y`),
    },
  };
}

function decodeAppField(value: unknown, path: string): EditorAppField {
  const source = recordValue(value, path);
  return {
    hidden: optionalBoolean(source.hidden, `${path}.hidden`),
    locked: optionalBoolean(source.locked, `${path}.locked`),
    label: optionalString(source.label, `${path}.label`),
    order: optionalNumber(source.order, `${path}.order`),
  };
}

function decodeAppConfig(value: unknown, path: string): EditorAppConfig {
  const source = recordValue(value, path);
  return {
    title: optionalString(source.title, `${path}.title`),
    tagline: optionalString(source.tagline, `${path}.tagline`),
    fields: source.fields === undefined ? undefined : decodeRecord(source.fields, decodeAppField, `${path}.fields`),
  };
}

export function decodeEditorSidecar(value: unknown, path = 'editor sidecar'): EditorSidecar {
  const source = recordValue(value, path);
  if (source.schema_version !== 1) return invalid(`${path}.schema_version`, '1');
  if (source.kind !== 'mere.run/workflow-editor') return invalid(`${path}.kind`, 'mere.run/workflow-editor');
  const viewport = recordValue(source.viewport, `${path}.viewport`);
  return {
    schema_version: 1,
    kind: 'mere.run/workflow-editor',
    viewport: {
      x: numberValue(viewport.x, `${path}.viewport.x`),
      y: numberValue(viewport.y, `${path}.viewport.y`),
      zoom: numberValue(viewport.zoom, `${path}.viewport.zoom`),
    },
    nodes: decodeRecord(source.nodes, decodeNodeState, `${path}.nodes`),
    inputs: optionalDecoded(source.inputs, (item, itemPath) => decodeRecord(item, decodeNodeState, itemPath), `${path}.inputs`),
    outputs: optionalDecoded(source.outputs, (item, itemPath) => decodeRecord(item, decodeNodeState, itemPath), `${path}.outputs`),
    groups: optionalDecoded(source.groups, (item, itemPath) => decodeRecord(item, decodeGroupState, itemPath), `${path}.groups`),
    notes: optionalDecoded(source.notes, (item, itemPath) => decodeRecord(item, decodeNoteState, itemPath), `${path}.notes`),
    selection_sets: optionalDecoded(
      source.selection_sets,
      (item, itemPath) => decodeRecord(item, decodeSelection, itemPath),
      `${path}.selection_sets`,
    ),
    promotions: optionalDecoded(
      source.promotions,
      (item, itemPath) => decodeRecord(item, decodePromotion, itemPath),
      `${path}.promotions`,
    ),
    app: optionalDecoded(source.app, decodeAppConfig, `${path}.app`),
  };
}

export function decodeStudioDocument(value: unknown, path = 'studio document'): StudioDocument {
  const source = recordValue(value, path);
  return {
    graph: decodeWorkflowGraph(source.graph, `${path}.graph`),
    inputs: decodeJsonObject(source.inputs, `${path}.inputs`),
    sidecar: decodeEditorSidecar(source.sidecar, `${path}.sidecar`),
    program: source.program === undefined ? undefined : decodeWorkflowProgram(source.program, `${path}.program`),
  };
}

export function decodeStudioProject(value: unknown, path = 'studio project'): StudioProject {
  const source = recordValue(value, path);
  return { path: stringValue(source.path, `${path}.path`), ...decodeStudioDocument(source, path) };
}

export function decodeStudioProjectPackage(value: unknown, path = 'project package'): StudioProjectPackage {
  const source = recordValue(value, path);
  if (source.contract_version !== 'mere.run/graph-studio-project.v1') {
    return invalid(`${path}.contract_version`, 'mere.run/graph-studio-project.v1');
  }
  return { contract_version: 'mere.run/graph-studio-project.v1', ...decodeStudioDocument(source, path) };
}

export function decodeCommandDocument<T>(value: unknown, resultDecoder: Decoder<T>, path = 'command document'): CommandDocument<T> {
  const source = recordValue(value, path);
  return {
    exit_code: numberValue(source.exit_code, `${path}.exit_code`),
    result: source.result === null ? null : resultDecoder(source.result, `${path}.result`),
    stdout: stringValue(source.stdout, `${path}.stdout`),
    stderr: stringValue(source.stderr, `${path}.stderr`),
  };
}

export function decodeProjectSummary(value: unknown, path = 'project summary'): ProjectSummary {
  const source = recordValue(value, path);
  return {
    path: stringValue(source.path, `${path}.path`),
    name: stringValue(source.name, `${path}.name`),
    modified_at: stringValue(source.modified_at, `${path}.modified_at`),
  };
}

export function decodeTemplateEntry(value: unknown, path = 'template'): TemplateEntry {
  const source = recordValue(value, path);
  return {
    id: stringValue(source.id, `${path}.id`),
    title: stringValue(source.title, `${path}.title`),
    description: stringValue(source.description, `${path}.description`),
    tags: stringArray(source.tags, `${path}.tags`),
  };
}

export function decodeRunEvent(value: unknown, path = 'run event'): RunEvent {
  const source = decodeJsonObject(value, path);
  return {
    ...source,
    sequence: optionalNumber(source.sequence, `${path}.sequence`),
    type: optionalString(source.type, `${path}.type`),
    message: optionalString(source.message, `${path}.message`),
    phase: optionalString(source.phase, `${path}.phase`),
    state: optionalString(source.state, `${path}.state`),
    node_id: optionalString(source.node_id, `${path}.node_id`),
    progress: source.progress == null ? undefined : typeof source.progress === 'number'
      ? numberValue(source.progress, `${path}.progress`) : decodeJsonObject(source.progress, `${path}.progress`),
    metric: source.metric,
  };
}

function decodeRunArtifact(value: unknown, path: string): RunArtifact {
  const source = recordValue(value, path);
  return {
    name: stringValue(source.name, `${path}.name`),
    kind: stringValue(source.kind, `${path}.kind`),
    path: stringValue(source.path, `${path}.path`),
    content_type: optionalString(source.content_type, `${path}.content_type`),
    size_bytes: optionalNumber(source.size_bytes, `${path}.size_bytes`),
    sha256: optionalString(source.sha256, `${path}.sha256`),
  };
}

function decodeRunNodeDetail(value: unknown, path: string): RunNodeDetail {
  const source = recordValue(value, path);
  return {
    id: stringValue(source.id, `${path}.id`),
    directory: optionalString(source.directory, `${path}.directory`),
    preflight: source.preflight === undefined ? undefined : decodeJsonValue(source.preflight, `${path}.preflight`),
    stdout: optionalString(source.stdout, `${path}.stdout`),
    stderr: optionalString(source.stderr, `${path}.stderr`),
  };
}

function decodeRunHistory(value: unknown, path: string): RunHistoryEntry {
  const source = recordValue(value, path);
  return {
    created_at: stringValue(source.created_at, `${path}.created_at`),
    kind: stringValue(source.kind, `${path}.kind`),
    message: stringValue(source.message, `${path}.message`),
    details: source.details === undefined ? undefined : decodeJsonObject(source.details, `${path}.details`),
  };
}

export function decodeStudioRun(value: unknown, path = 'studio run'): StudioRun {
  const source = recordValue(value, path);
  return {
    id: stringValue(source.id, `${path}.id`),
    executor: stringValue(source.executor, `${path}.executor`),
    run_directory: stringValue(source.run_directory, `${path}.run_directory`),
    state: stringValue(source.state, `${path}.state`),
    created_at: stringValue(source.created_at, `${path}.created_at`),
    updated_at: stringValue(source.updated_at, `${path}.updated_at`),
    exit_code: nullableNumber(source.exit_code, `${path}.exit_code`),
    result: decodeJsonValue(source.result, `${path}.result`),
    stderr: stringValue(source.stderr, `${path}.stderr`),
    remote_reference: nullableString(source.remote_reference, `${path}.remote_reference`),
    events: optionalArray(source.events, decodeRunEvent, `${path}.events`),
    manifest: source.manifest === undefined ? undefined : decodeJsonValue(source.manifest, `${path}.manifest`),
    actions: optionalArray(source.actions, decodeJsonObject, `${path}.actions`),
    artifacts: optionalArray(source.artifacts, decodeRunArtifact, `${path}.artifacts`),
    node_details: optionalArray(source.node_details, decodeRunNodeDetail, `${path}.node_details`),
    history: optionalArray(source.history, decodeRunHistory, `${path}.history`),
  };
}

function modelPullState(value: unknown, path: string): ModelPullState {
  if (value === 'preparing' || value === 'downloading' || value === 'installing' || value === 'installed' || value === 'failed') return value;
  return invalid(path, 'a model pull state');
}

export function decodeModelPull(value: unknown, path = 'model pull'): ModelPull {
  const source = recordValue(value, path);
  return {
    model: stringValue(source.model, `${path}.model`),
    state: modelPullState(source.state, `${path}.state`),
    percent: nullableNumber(source.percent, `${path}.percent`),
    received_bytes: nullableNumber(source.received_bytes, `${path}.received_bytes`),
    total_bytes: nullableNumber(source.total_bytes, `${path}.total_bytes`),
    detail: nullableString(source.detail, `${path}.detail`),
    install_path: nullableString(source.install_path, `${path}.install_path`),
    stderr: stringValue(source.stderr, `${path}.stderr`),
    updated_at: stringValue(source.updated_at, `${path}.updated_at`),
  };
}

export function decodeBytes(value: unknown, path = 'binary response'): Uint8Array<ArrayBuffer> {
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return Uint8Array.from(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
  const bytes = decodeArray(value, numberValue, path);
  if (bytes.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 255)) return invalid(path, 'bytes from 0 to 255');
  return Uint8Array.from(bytes);
}
