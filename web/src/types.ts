export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export type FieldType =
  | 'string'
  | 'integer'
  | 'number'
  | 'boolean'
  | 'enum'
  | 'json'
  | 'asset'
  | 'asset_directory'
  | 'asset_array'
  | 'asset_collection';

export interface CatalogValueSchema {
  type: 'object' | 'array' | 'string' | 'integer' | 'number' | 'boolean' | 'enum' | 'json';
  title?: string;
  description?: string;
  default?: JsonValue;
  values?: string[];
  properties?: Record<string, CatalogValueSchema>;
  required?: string[];
  items?: CatalogValueSchema;
  additional_properties?: CatalogValueSchema;
  minimum?: number;
  maximum?: number;
  step?: number;
  multiline?: boolean;
}

export interface CatalogField {
  name: string;
  type: FieldType;
  required?: boolean;
  optional?: boolean;
  description?: string;
  default?: JsonValue;
  values?: string[];
  minimum?: number;
  maximum?: number;
  step?: number;
  multiline?: boolean;
  secret?: boolean;
  content_types?: string[];
  value_schema?: CatalogValueSchema;
}

export interface CatalogProvider {
  id: string;
  version?: string;
  catalog_sha256?: string;
}

export interface CatalogEntry {
  kind: string;
  title: string;
  description?: string;
  category?: string;
  provider?: CatalogProvider;
  inputs: CatalogField[];
  outputs: CatalogField[];
  traits?: {
    cacheable?: boolean;
    deterministic?: boolean;
    supports_progress?: boolean;
    supports_previews?: boolean;
    side_effects?: string;
  };
  requirements?: {
    accelerator_backends?: string[];
    model_ids?: string[];
  };
  presentation?: {
    style: 'material';
    primary_argument?: string;
  };
}

export interface GraphInputDefinition {
  type: FieldType;
  required?: boolean;
  values?: string[];
  description?: string;
  default?: JsonValue;
  minimum?: number;
  maximum?: number;
  step?: number;
  multiline?: boolean;
}

export interface GraphReference extends Record<string, JsonValue> {
  $ref: string;
}

export interface SecretReference extends Record<string, JsonValue> {
  $secret: string;
}

export interface NodeExecution {
  cache?: 'auto' | 'never' | 'refresh';
  max_attempts?: number;
  timeout_seconds?: number;
}

export interface WorkflowNode {
  id: string;
  kind: string;
  provider?: string;
  arguments: Record<string, JsonValue>;
  depends_on?: string[];
  execution?: NodeExecution;
}

export interface WorkflowGraph {
  schema_version: 1;
  kind: 'mere.run/workflow-graph';
  name: string;
  inputs: Record<string, GraphInputDefinition>;
  execution?: { max_parallel_nodes?: number };
  nodes: WorkflowNode[];
  outputs: Record<string, GraphReference>;
  metadata?: JsonObject;
}

export interface WorkflowModule {
  parameters: string[];
  nodes: WorkflowNode[];
  outputs: Record<string, GraphReference>;
}

export interface WorkflowProgramStep {
  id: string;
  module: string;
  arguments: Record<string, JsonValue>;
  when?: JsonValue;
  map?: { item: string; values: JsonValue };
}

export interface WorkflowProgram {
  schema_version: 1;
  kind: 'mere.run/workflow-program';
  name: string;
  inputs: Record<string, GraphInputDefinition>;
  variables?: JsonObject;
  imports?: Record<string, string>;
  modules: Record<string, WorkflowModule>;
  steps: WorkflowProgramStep[];
  outputs: Record<string, GraphReference>;
  execution?: { max_parallel_nodes?: number };
  metadata?: JsonObject;
}

export interface EditorNodeState {
  x: number;
  y: number;
  collapsed?: boolean;
  color?: string;
}

export interface EditorGroupState extends EditorNodeState {
  title: string;
  width: number;
  height: number;
  node_ids: string[];
}

export interface EditorNoteState extends EditorNodeState {
  text: string;
  width: number;
  height: number;
}

export interface EditorSelectionSet {
  node_ids: string[];
}

export interface EditorAppField {
  hidden?: boolean;
  locked?: boolean;
  label?: string;
  order?: number;
}

export interface EditorAppConfig {
  title?: string;
  tagline?: string;
  fields?: Record<string, EditorAppField>;
}

export interface EditorPromotionState {
  consumer_id: string;
  argument_name: string;
  consumer_position: { x: number; y: number };
}

export interface EditorSidecar {
  schema_version: 1;
  kind: 'mere.run/workflow-editor';
  viewport: { x: number; y: number; zoom: number };
  nodes: Record<string, EditorNodeState>;
  inputs?: Record<string, EditorNodeState>;
  outputs?: Record<string, EditorNodeState>;
  groups?: Record<string, EditorGroupState>;
  notes?: Record<string, EditorNoteState>;
  selection_sets?: Record<string, EditorSelectionSet>;
  promotions?: Record<string, EditorPromotionState>;
  app?: EditorAppConfig;
}

export interface StudioDocument {
  graph: WorkflowGraph;
  inputs: JsonObject;
  sidecar: EditorSidecar;
  program?: WorkflowProgram;
}

export interface CommandDocument<T = JsonValue> {
  exit_code: number;
  result: T | null;
  stdout: string;
  stderr: string;
}

export interface StudioProject {
  path: string;
  graph: WorkflowGraph;
  inputs: JsonObject;
  sidecar: EditorSidecar;
  program?: WorkflowProgram;
}

export interface StudioProjectPackage {
  contract_version: 'mere.run/graph-studio-project.v1';
  graph: WorkflowGraph;
  inputs: JsonObject;
  sidecar: EditorSidecar;
  program?: WorkflowProgram;
}

export interface ProjectSummary {
  path: string;
  name: string;
  modified_at: string;
}

export interface TemplateEntry {
  id: string;
  title: string;
  description: string;
  tags: string[];
}

export interface RunEvent {
  [key: string]: JsonValue | undefined;
  sequence?: number;
  type?: string;
  message?: string;
  phase?: string;
  state?: string;
  node_id?: string;
  progress?: JsonObject | number;
  metric?: JsonValue;
}

export interface RunArtifact {
  name: string;
  kind: string;
  path: string;
  content_type?: string;
  size_bytes?: number;
  sha256?: string;
}

export interface RunNodeDetail {
  id: string;
  directory?: string;
  preflight?: JsonValue;
  stdout?: string;
  stderr?: string;
}

export interface RunHistoryEntry {
  created_at: string;
  kind: string;
  message: string;
  details?: JsonObject;
}

export interface StudioRun {
  id: string;
  executor: string;
  run_directory: string;
  state: string;
  created_at: string;
  updated_at: string;
  exit_code: number | null;
  result: JsonValue;
  stderr: string;
  remote_reference: string | null;
  events?: RunEvent[];
  manifest?: JsonValue;
  actions?: JsonObject[];
  artifacts?: RunArtifact[];
  node_details?: RunNodeDetail[];
  history?: RunHistoryEntry[];
}

export type ModelPullState = 'preparing' | 'downloading' | 'installing' | 'installed' | 'failed';

/** Tracking record for a local (or fleet) model install, polled after start. */
export interface ModelPull {
  model: string;
  state: ModelPullState;
  percent: number | null;
  received_bytes: number | null;
  total_bytes: number | null;
  detail: string | null;
  install_path: string | null;
  stderr: string;
  updated_at: string;
}

export interface ModelPullOptions {
  acceptLicense?: boolean;
  allowUnsupported?: boolean;
  force?: boolean;
}

export interface Diagnostic {
  severity: 'info' | 'warning' | 'blocker' | 'success';
  title: string;
  message: string;
  nodeId?: string;
}
