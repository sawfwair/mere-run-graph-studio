import { memo } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { AlertTriangle, Box, Braces, Cpu, Download, Image, Layers, Link2, Lock, Music, ScanSearch, Sparkles, Type, Video, Zap } from 'lucide-react';

import {
  argumentPathHandle,
  fieldTypeAtArgumentPath,
  isGraphReference,
  ORDER_INPUT_HANDLE,
  ORDER_OUTPUT_HANDLE,
} from '../graph';
import { parseJsonValue } from '../decode';
import { candidateModels, modelFieldFor } from '../models';
import { argumentSummaries, categoryKey, categoryTitle, friendlyLabel, friendlyType, portTypeKey, splitFieldsForMode, textValue, type StudioMode } from '../ui';
import type { NodeRunPreview } from '../run-preview';
import type { NodeExecutionState } from '../canvas-execution';
import { NodeExecution } from './CanvasRunBar';
import { NodeOutputPanel } from './NodeOutputPanel';
import type {
  CatalogEntry,
  CatalogField,
  CatalogValueSchema,
  FieldType,
  JsonValue,
  WorkflowNode as WorkflowNodeValue,
} from '../types';

export interface WorkflowNodeData extends Record<string, unknown> {
  value: WorkflowNodeValue;
  entry?: CatalogEntry;
  ordinal: number;
  mode: StudioMode;
  onArgumentChange?: (name: string, value: JsonValue | undefined) => void;
  preview?: NodeRunPreview;
  execution?: NodeExecutionState;
  pinnedPreview?: NodeRunPreview;
  onPinPreview?: () => void;
  onUnpinPreview?: () => void;
  artifactBlob?: (runId: string, path: string, contentType?: string) => Promise<Blob>;
  availableModels?: string[];
  onRaceModels?: (nodeId: string, models: string[]) => void;
  canInstallModels?: boolean;
  onInstallModel?: (model: string) => void;
}

export type WorkflowFlowNode = Node<WorkflowNodeData, 'workflow'>;

const categoryIcons = {
  values: Braces,
  text: Type,
  audio: Music,
  dataset: ScanSearch,
  image: Image,
  model: Cpu,
  video: Video,
  other: Sparkles,
};

interface NestedPort {
  path: string[];
  label: string;
  type: FieldType;
  value: JsonValue | undefined;
}

function nestedPorts(field: CatalogField, value: JsonValue | undefined): NestedPort[] {
  const ports: NestedPort[] = [];
  const visit = (
    schema: CatalogValueSchema | undefined,
    current: JsonValue | undefined,
    path: string[],
    label: string,
  ) => {
    if (!schema) return;
    if (schema.type === 'array') {
      if (Array.isArray(current)) {
        current.forEach((item, index) => visit(schema.items, item, [...path, String(index)], `${label} ${index + 1}`));
      }
      return;
    }
    if (schema.type === 'object') {
      const currentObject: Record<string, JsonValue> =
        current && typeof current === 'object' && !Array.isArray(current) ? current : {};
      const keys = new Set([...Object.keys(schema.properties ?? {}), ...Object.keys(currentObject)]);
      for (const key of keys) {
        visit(
          schema.properties?.[key] ?? schema.additional_properties,
          currentObject[key],
          [...path, key],
          key,
        );
      }
      return;
    }
    const type = fieldTypeAtArgumentPath(field, path.slice(1));
    if (type) ports.push({ path, label, type, value: current });
  };
  visit(field.value_schema, value, [field.name], field.name);
  return ports;
}

interface MaterialEditorContentProps {
  field: CatalogField;
  value: WorkflowNodeValue;
  current: JsonValue | undefined;
  onArgumentChange: (name: string, value: JsonValue | undefined) => void;
}

const materialInputClass = 'material-input nodrag nowheel';

function ChoiceMaterialEditor({ field, value, current, onArgumentChange }: MaterialEditorContentProps) {
  const options = Array.isArray(value.arguments.options)
    ? value.arguments.options.filter((item): item is string => typeof item === 'string')
    : [];
  return (
    <select className={materialInputClass} aria-label={`${friendlyLabel(field.name)} for ${value.id}`} value={textValue(current)} onChange={(event) => onArgumentChange(field.name, event.target.value)}>
      {options.map((option) => <option key={option}>{option}</option>)}
    </select>
  );
}

function ScalarMaterialEditor({ field, value, current, onArgumentChange }: MaterialEditorContentProps) {
  if (field.type === 'boolean') {
    return (
      <label className="material-switch nodrag">
        <input type="checkbox" aria-label={`${friendlyLabel(field.name)} for ${value.id}`} checked={Boolean(current)} onChange={(event) => onArgumentChange(field.name, event.target.checked)} />
        <span>{current ? 'On' : 'Off'}</span>
      </label>
    );
  }
  if (field.type === 'integer' || field.type === 'number') {
    return (
      <input
        className={materialInputClass} aria-label={`${friendlyLabel(field.name)} for ${value.id}`}
        type="number"
        value={typeof current === 'number' ? current : ''}
        onChange={(event) => {
          if (!event.target.value && !field.required) onArgumentChange(field.name, undefined);
          else {
            const next = field.type === 'integer'
              ? Number.parseInt(event.target.value, 10)
              : Number(event.target.value);
            if (Number.isFinite(next)) onArgumentChange(field.name, next);
          }
        }}
      />
    );
  }
  if (field.multiline || value.kind === 'text.template') {
    return (
      <textarea
        className={materialInputClass} aria-label={`${friendlyLabel(field.name)} for ${value.id}`}
        rows={3}
        value={typeof current === 'string' ? current : ''}
        onChange={(event) => onArgumentChange(field.name, event.target.value)}
      />
    );
  }
  return <input className={materialInputClass} aria-label={`${friendlyLabel(field.name)} for ${value.id}`} value={typeof current === 'string' ? current : ''} onChange={(event) => onArgumentChange(field.name, event.target.value)} />;
}

function StructuredMaterialEditor({ field, value, current, onArgumentChange }: MaterialEditorContentProps) {
  if (field.type.startsWith('asset')) {
    const connected = isGraphReference(current);
    return (
      <input
        className={materialInputClass} aria-label={`${friendlyLabel(field.name)} for ${value.id}`}
        value={connected ? 'Connected media' : typeof current === 'string' ? current : ''}
        disabled={connected}
        placeholder="Choose or connect media"
        onChange={(event) => onArgumentChange(field.name, event.target.value)}
      />
    );
  }
  if (value.kind === 'text.join' && Array.isArray(current)) {
    return (
      <div className="material-list">
        {current.map((item, index) => (
          <input
            className={materialInputClass} aria-label={`${friendlyLabel(field.name)} for ${value.id}`}
            key={index}
            value={typeof item === 'string' ? item : isGraphReference(item) ? 'Connected value' : ''}
            disabled={isGraphReference(item)}
            onChange={(event) => {
              const next = [...current];
              next[index] = event.target.value;
              onArgumentChange(field.name, next);
            }}
          />
        ))}
      </div>
    );
  }
  return (
    <textarea
      className={materialInputClass} aria-label={`${friendlyLabel(field.name)} for ${value.id}`}
      rows={3}
      defaultValue={JSON.stringify(current ?? {}, null, 2)}
      onBlur={(event) => {
        try {
          onArgumentChange(field.name, parseJsonValue(event.target.value, 'node argument JSON'));
        } catch {
          // Keep the last valid document; the full inspector reports malformed JSON.
        }
      }}
    />
  );
}

function MaterialEditor({
  entry,
  value,
  onArgumentChange,
}: {
  entry: CatalogEntry;
  value: WorkflowNodeValue;
  onArgumentChange?: (name: string, value: JsonValue | undefined) => void;
}) {
  const primaryName = entry.presentation?.primary_argument;
  const field = entry.inputs.find((candidate) => candidate.name === primaryName);
  if (!field || !onArgumentChange) return null;
  const props = { field, value, current: value.arguments[field.name], onArgumentChange };
  if (value.kind === 'choice.value') return <ChoiceMaterialEditor {...props} />;
  if (field.type === 'boolean' || field.type === 'integer' || field.type === 'number' || field.type === 'string') {
    return <ScalarMaterialEditor {...props} />;
  }
  return <StructuredMaterialEditor {...props} />;
}

function visibleInputs(entry: CatalogEntry | undefined, value: WorkflowNodeValue, mode: StudioMode): CatalogField[] {
  const allInputs = entry?.inputs ?? [];
  if (mode === 'pro') return allInputs;
  const names = new Set(splitFieldsForMode(allInputs, mode).primary.map((field) => field.name));
  for (const field of allInputs) {
    const nested = nestedPorts(field, value.arguments[field.name]);
    if (isGraphReference(value.arguments[field.name]) || nested.some((port) => isGraphReference(port.value))) {
      names.add(field.name);
    }
  }
  return allInputs.filter((field) => names.has(field.name));
}

function InstallModelButton({ data, currentModel, missing }: {
  data: WorkflowNodeData;
  currentModel: JsonValue | undefined;
  missing: boolean;
}) {
  if (!missing || !data.canInstallModels || !data.onInstallModel || typeof currentModel !== 'string') return null;
  return <button
    type="button"
    className="node-model-install nodrag"
    title={`Install ${currentModel}`}
    aria-label={`Install ${currentModel}`}
    onClick={() => data.onInstallModel?.(currentModel)}
  ><Download size={11} /></button>;
}

function RaceModelsButton({ data, nodeId, models }: { data: WorkflowNodeData; nodeId: string; models: string[] }) {
  if (!data.onRaceModels || models.length < 2) return null;
  const raceModels = models.slice(0, 6);
  return <button
    type="button"
    className="node-model-race nodrag"
    title={`Compare the first ${raceModels.length} models on the selected executor`}
    aria-label="Compare models"
    onClick={() => data.onRaceModels?.(nodeId, raceModels)}
  ><Layers size={11} /></button>;
}

function NodeModelSelector({ data, entry, value }: {
  data: WorkflowNodeData;
  entry: CatalogEntry | undefined;
  value: WorkflowNodeValue;
}) {
  const modelField = modelFieldFor(entry);
  const currentModel = modelField ? value.arguments[modelField] : undefined;
  const models = modelField ? candidateModels(entry, currentModel, data.availableModels) : [];
  if (!modelField || !models.length) return null;
  const available = data.availableModels ?? [];
  const missing = typeof currentModel === 'string' && available.length > 0 && !available.includes(currentModel);
  return <div className={`node-model nodrag ${missing ? 'missing' : ''}`}>
    <span className="node-model-icon" title={missing ? `${String(currentModel)} is not installed on the selected executor` : undefined}>
      {missing ? <AlertTriangle size={11} /> : <Cpu size={11} />}
    </span>
    <select
      className="nodrag"
      value={typeof currentModel === 'string' ? currentModel : ''}
      onChange={(event) => data.onArgumentChange?.(modelField, event.target.value)}
      aria-label="Model"
      title={`Model: ${typeof currentModel === 'string' ? currentModel : 'default'}`}
    >
      {typeof currentModel !== 'string' ? <option value="">Default model</option> : null}
      {models.map((model) => <option key={model} value={model}>{model}</option>)}
    </select>
    <InstallModelButton data={data} currentModel={currentModel} missing={missing} />
    <RaceModelsButton data={data} nodeId={value.id} models={models} />
  </div>;
}

function inlinePromptField(entry: CatalogEntry | undefined, value: WorkflowNodeValue): CatalogField | undefined {
  if (entry?.presentation?.style === 'material') return undefined;
  const field = entry?.inputs.find((candidate) => candidate.name === 'prompt' && candidate.type === 'string' && !candidate.secret);
  if (!field || (value.arguments[field.name] !== undefined && typeof value.arguments[field.name] !== 'string')) return undefined;
  return field;
}

function NodePrompt({ data }: { data: WorkflowNodeData }) {
  const field = inlinePromptField(data.entry, data.value);
  if (!field) return null;
  return <label className="node-prompt nodrag nopan">
    <span><Type size={11} /> Prompt</span>
    <textarea
      className="nodrag nopan nowheel"
      aria-label={`Prompt for ${data.value.id}`}
      value={textValue(data.value.arguments[field.name])}
      placeholder="Describe the output"
      rows={3}
      readOnly={!data.onArgumentChange}
      onChange={(event) => data.onArgumentChange?.(field.name, event.target.value)}
    />
  </label>;
}

function inputRequired(field: CatalogField, value: WorkflowNodeValue, wired: boolean): boolean {
  return Boolean(field.required && !wired && field.default === undefined && value.arguments[field.name] === undefined);
}

function hiddenInputsLabel(count: number): string {
  return `${count} more ${count === 1 ? 'input' : 'inputs'} in the inspector`;
}

function InputPort({ field, value, mode }: { field: CatalogField; value: WorkflowNodeValue; mode: StudioMode }) {
  const nested = nestedPorts(field, value.arguments[field.name]);
  const wired = isGraphReference(value.arguments[field.name]) || nested.some((port) => isGraphReference(port.value));
  const required = inputRequired(field, value, wired);
  return <div className="port-stack">
    <div className={`port-row ${wired ? 'wired' : ''}`} title={mode === 'pro' ? `${field.name}: ${field.type}` : `${field.name} · ${friendlyType(field.type)}`}>
      <Handle type="target" position={Position.Left} id={field.name} className={`port-handle t-${portTypeKey(field.type)} ${isGraphReference(value.arguments[field.name]) ? 'wired' : ''}`} />
      <span className="port-name">{mode === 'easy' ? friendlyLabel(field.name) : field.name}</span>
      {wired ? <Link2 size={10} className="port-connected" aria-label="Connected input" /> : null}
      {required ? <b className="port-required">Required</b> : null}
    </div>
    {nested.map((port) => (
      <div className={`port-row nested ${isGraphReference(port.value) ? 'wired' : ''}`} key={argumentPathHandle(port.path)}>
        <Handle type="target" position={Position.Left} id={argumentPathHandle(port.path)} className={`port-handle t-${portTypeKey(port.type)} ${isGraphReference(port.value) ? 'wired' : ''}`} />
        <span className="port-name">{port.label}</span>
      </div>
    ))}
  </div>;
}

function NodePorts({ inputs, outputs, value, mode }: {
  inputs: CatalogField[];
  outputs: CatalogField[];
  value: WorkflowNodeValue;
  mode: StudioMode;
}) {
  return <div className="workflow-node-ports">
    <div className="port-column inputs">
      <div className="port-column-heading">Inputs <span>{inputs.length}</span></div>
      {inputs.map((field) => <InputPort field={field} value={value} mode={mode} key={field.name} />)}
    </div>
    <div className="port-column outputs">
      <div className="port-column-heading">Outputs <span>{outputs.length}</span></div>
      {outputs.map((field) => (
        <div className="port-row" key={field.name} title={mode === 'pro' ? `${field.name}: ${field.type}` : `${field.name} · ${friendlyType(field.type)}`}>
          <span className="port-name">{mode === 'easy' ? friendlyLabel(field.name) : field.name}</span>
          <small className="port-type">{friendlyType(field.type)}</small>
          <Handle type="source" position={Position.Right} id={field.name} className={`port-handle t-${portTypeKey(field.type)}`} />
        </div>
      ))}
    </div>
    {!inputs.length && !outputs.length ? <div className="node-empty-ports"><Box size={13} /> No ports</div> : null}
  </div>;
}

function NodeSummaries({ value, entry, mode }: { value: WorkflowNodeValue; entry: CatalogEntry | undefined; mode: StudioMode }) {
  const primary = entry?.presentation?.style === 'material' ? entry.presentation.primary_argument : undefined;
  const summaries = argumentSummaries(value, entry, mode === 'easy' ? 3 : 2).filter((summary) => summary.name !== inlinePromptField(entry, value)?.name && summary.name !== primary);
  if (!summaries.length) return null;
  return <div className="node-params">
    {summaries.map((summary) => (
      <span className={`param-chip ${summary.kind}`} key={summary.name} title={`${summary.label}: ${summary.text}`}>
        {summary.kind === 'secret' ? <Lock size={9} /> : summary.kind === 'reference' ? <Link2 size={9} /> : null}
        <em>{summary.label}</em><span>{summary.text}</span>
      </span>
    ))}
  </div>;
}

function NodeFooter({ entry, value, mode }: { entry: CatalogEntry | undefined; value: WorkflowNodeValue; mode: StudioMode }) {
  return <footer className="workflow-node-footer">
    <span className="node-provider"><Cpu size={11} /> {entry?.provider?.id ?? value.provider ?? 'mere.run'}</span>
    {mode === 'pro' ? <span className="node-kind-label" title={value.kind}>{value.kind}</span> : null}
    {value.execution?.cache === 'never' ? <span className="footer-flag"><Zap size={9} /> Cache off</span> : null}
  </footer>;
}

function WorkflowNodeView({ data, selected }: NodeProps<WorkflowFlowNode>) {
  const { entry, value, ordinal, mode, onArgumentChange, preview, artifactBlob } = data;
  const category = categoryKey(entry?.category);
  const Icon = categoryIcons[category];
  const allInputs = entry?.inputs ?? [];
  const inputs = visibleInputs(entry, value, mode);
  const hiddenInputCount = allInputs.length - inputs.length;
  const outputs = entry?.outputs ?? [];

  return (
    <article className={`workflow-node cat-${category} ${selected ? 'selected' : ''}`}>
      <span className="node-accent" aria-hidden />
      <Handle
        type="target"
        position={Position.Top}
        id={ORDER_INPUT_HANDLE}
        className="order-handle order-input"
        title="Ordering dependency"
      />
      <header className="workflow-node-header">
        <span className="node-kind-icon"><Icon size={20} strokeWidth={1.7} /></span>
        <span className="node-heading">
          <small className="node-category">{categoryTitle(category)}</small>
          <strong>{entry?.title ?? value.kind}</strong>
          <small className="node-id">{value.id}</small>
        </span>
        <span className="node-ordinal" title={`Node ${ordinal}`}><span>Node</span>{String(ordinal).padStart(2, '0')}</span>
      </header>
      <NodeExecution execution={data.execution} />
      <NodePrompt data={data} />
      <NodeModelSelector data={data} entry={entry} value={value} />
      {entry?.presentation?.style === 'material' ? (
        <div className="material-editor">
          <MaterialEditor entry={entry} value={value} onArgumentChange={onArgumentChange} />
        </div>
      ) : null}
      <NodeOutputPanel preview={preview} pinned={data.pinnedPreview} artifactBlob={artifactBlob} onPin={data.onPinPreview} onUnpin={data.onUnpinPreview} />
      <NodePorts inputs={inputs} outputs={outputs} value={value} mode={mode} />
      {hiddenInputCount ? <div className="node-hidden-inputs">{hiddenInputsLabel(hiddenInputCount)}</div> : null}
      <NodeSummaries value={value} entry={entry} mode={mode} />
      <NodeFooter entry={entry} value={value} mode={mode} />
      <Handle
        type="source"
        position={Position.Bottom}
        id={ORDER_OUTPUT_HANDLE}
        className="order-handle order-output"
        title="Ordering dependency"
      />
    </article>
  );
}

export const WorkflowNode = memo(WorkflowNodeView);
