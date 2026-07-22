import { useEffect, useMemo, useState, type ReactElement, type ReactNode } from 'react';
import {
  Braces,
  ChevronDown,
  ChevronRight,
  Cpu,
  Image,
  Link2,
  LockKeyhole,
  Music,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  ScanSearch,
  Settings2,
  Sparkles,
  Type,
  Trash2,
  Unlink,
  Video,
  Workflow,
} from 'lucide-react';

import {
  catalogEntryFor,
  compatibleTypes,
  defaultSchemaValue,
  defaultFieldValue,
  editorGroupName,
  editorNoteName,
  isGraphReference,
  isSecretReference,
  referencesIn,
  schemaFieldType,
} from '../graph';
import { decodeFieldType, parseJsonValue } from '../decode';
import {
  categoryKey,
  categoryTitle,
  describeReference,
  friendlyLabel,
  friendlyType,
  isLongTextField,
  isSliderField,
  splitFieldsForMode,
  textValue,
  type StudioMode,
} from '../ui';
import type {
  CatalogEntry,
  CatalogField,
  CatalogValueSchema,
  EditorGroupState,
  EditorNoteState,
  EditorSidecar,
  FieldType,
  JsonObject,
  JsonValue,
  WorkflowGraph,
  WorkflowNode,
} from '../types';

interface InspectorProps {
  graph: WorkflowGraph;
  inputs: JsonObject;
  sidecar: EditorSidecar;
  catalog: CatalogEntry[];
  selectedNodeId: string | null;
  selectedNodeIds: string[];
  selectedInputName: string | null;
  selectedOutputName: string | null;
  selectedEditorItemId: string | null;
  mode: StudioMode;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  onGraphChange: (graph: WorkflowGraph) => void;
  onInputsChange: (inputs: JsonObject) => void;
  onUpdateNode: (node: WorkflowNode) => void;
  onPromoteArgument: (nodeId: string, argumentName: string) => void;
  onInlineMaterial: (nodeId: string, consumerNodeId?: string) => void;
  onRenameNode: (nodeId: string, desired: string) => void;
  onDeleteNode: (nodeId: string) => void;
  onRenameInput: (name: string, desired: string) => void;
  onDeleteInput: (name: string) => void;
  onAddOutput: (nodeId: string, outputName: string) => void;
  onRenameOutput: (name: string, desired: string) => void;
  onDeleteOutput: (name: string) => void;
  onSidecarChange: (sidecar: EditorSidecar) => void;
  onSelectNodes: (ids: string[]) => void;
  onDeleteEditorItem: (id: string) => void;
}

interface ReferenceOption {
  value: string;
  label: string;
}

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

function referenceOptions(
  graph: WorkflowGraph,
  catalog: CatalogEntry[],
  node: WorkflowNode,
  fieldType: FieldType,
): ReferenceOption[] {
  const options: ReferenceOption[] = [];
  for (const [name, definition] of Object.entries(graph.inputs)) {
    if (compatibleTypes(definition.type, fieldType)) options.push({ value: `inputs.${name}`, label: `Input / ${name}` });
  }
  for (const candidate of graph.nodes) {
    if (candidate.id === node.id) continue;
    const entry = catalogEntryFor(candidate, catalog);
    for (const output of entry?.outputs ?? []) {
      if (compatibleTypes(output.type, fieldType)) {
        options.push({ value: `nodes.${candidate.id}.outputs.${output.name}`, label: `${candidate.id} / ${output.name}` });
      }
    }
  }
  return options;
}

function JsonEditor({ value, onChange }: { value: JsonValue; onChange: (value: JsonValue) => void }) {
  const [text, setText] = useState(() => JSON.stringify(value, null, 2));
  const [valid, setValid] = useState(true);
  useEffect(() => setText(JSON.stringify(value, null, 2)), [value]);
  return (
    <textarea
      className={valid ? '' : 'invalid'}
      value={text}
      rows={5}
      onChange={(event) => {
        setText(event.target.value);
        try {
          onChange(parseJsonValue(event.target.value, 'inspector JSON'));
          setValid(true);
        } catch {
          setValid(false);
        }
      }}
    />
  );
}

interface ConstantEditorProps {
  field: CatalogField;
  value: JsonValue | undefined;
  onChange: (value: JsonValue) => void;
  referenceOptionsForType?: (type: FieldType) => ReferenceOption[];
}

function SchemaValueEditor({
  schema,
  value,
  onChange,
  referenceOptionsForType,
}: {
  schema: CatalogValueSchema;
  value: JsonValue | undefined;
  onChange: (value: JsonValue) => void;
  referenceOptionsForType?: (type: FieldType) => ReferenceOption[];
}) {
  const options = referenceOptionsForType?.(schemaFieldType(schema)) ?? [];
  const reference = isGraphReference(value);
  return (
    <div className="schema-value-editor">
      {options.length ? <div className="argument-mode compact">
        <button className={!reference ? 'active' : ''} onClick={() => onChange(defaultSchemaValue(schema))} title="Constant">
          <Braces size={12} />
        </button>
        <button className={reference ? 'active' : ''} onClick={() => onChange({ $ref: options[0].value })} title="Reference">
          <Link2 size={12} />
        </button>
      </div> : null}
      {reference ? (
        <select value={value.$ref} onChange={(event) => onChange({ $ref: event.target.value })}>
          {options.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
        </select>
      ) : (
        <SchemaConstantEditor
          schema={schema}
          value={value ?? defaultSchemaValue(schema)}
          onChange={onChange}
          referenceOptionsForType={referenceOptionsForType}
        />
      )}
    </div>
  );
}

function SchemaConstantEditor({
  schema,
  value,
  onChange,
  referenceOptionsForType,
}: {
  schema: CatalogValueSchema;
  value: JsonValue;
  onChange: (value: JsonValue) => void;
  referenceOptionsForType?: (type: FieldType) => ReferenceOption[];
}) {
  if (schema.type === 'object') {
    const objectValue = value && typeof value === 'object' && !Array.isArray(value) && !isGraphReference(value)
      ? value
      : {};
    const declared = new Set(Object.keys(schema.properties ?? {}));
    const additionalSchema = schema.additional_properties;
    const additionalEntries = Object.entries(objectValue).filter(([name]) => !declared.has(name));
    const renameAdditional = (from: string, to: string) => {
      if (!to || to === from || to in objectValue) return;
      onChange(Object.fromEntries(
        Object.entries(objectValue).map(([name, item]) => [name === from ? to : name, item]),
      ));
    };
    return (
      <div className="schema-object">
        {Object.entries(schema.properties ?? {}).map(([name, property]) => (
          <div className="schema-property" key={name}>
            <div className="field-heading">
              <span>{property.title ?? name}{schema.required?.includes(name) ? ' *' : ''}</span>
              <small>{property.type}</small>
            </div>
            <SchemaValueEditor
              schema={property}
              value={objectValue[name]}
              onChange={(next) => onChange({ ...objectValue, [name]: next })}
              referenceOptionsForType={referenceOptionsForType}
            />
            {property.description ? <small className="field-description">{property.description}</small> : null}
          </div>
        ))}
        {additionalSchema ? additionalEntries.map(([name, item]) => (
          <div className="schema-property additional" key={name}>
            <div className="field-heading">
              <input
                className="schema-key"
                value={name}
                aria-label="Variable name"
                onChange={(event) => renameAdditional(name, event.target.value)}
              />
              <button
                className="icon-button small danger"
                title="Remove property"
                onClick={() => onChange(Object.fromEntries(
                  Object.entries(objectValue).filter(([candidate]) => candidate !== name),
                ))}
              ><Trash2 size={13} /></button>
            </div>
            <SchemaValueEditor
              schema={additionalSchema}
              value={item}
              onChange={(next) => onChange({ ...objectValue, [name]: next })}
              referenceOptionsForType={referenceOptionsForType}
            />
          </div>
        )) : null}
        {additionalSchema ? (
          <button
            className="command-button compact"
            onClick={() => {
              let index = additionalEntries.length + 1;
              let name = `value_${index}`;
              while (name in objectValue) {
                index += 1;
                name = `value_${index}`;
              }
              onChange({ ...objectValue, [name]: defaultSchemaValue(additionalSchema) });
            }}
          ><Plus size={13} /> Add property</button>
        ) : null}
      </div>
    );
  }
  if (schema.type === 'array') {
    const values = Array.isArray(value) ? value : [];
    const itemSchema = schema.items ?? { type: 'string' };
    return (
      <div className="schema-array">
        {values.map((item, index) => (
          <div className="schema-array-item" key={index}>
            <span className="schema-array-index">{index + 1}</span>
            <SchemaValueEditor
              schema={itemSchema}
              value={item}
              onChange={(next) => onChange(values.map((current, itemIndex) => itemIndex === index ? next : current))}
              referenceOptionsForType={referenceOptionsForType}
            />
            <button className="icon-button small danger" title="Remove item" onClick={() => onChange(values.filter((_, itemIndex) => itemIndex !== index))}>
              <Trash2 size={13} />
            </button>
          </div>
        ))}
        <button className="command-button compact" onClick={() => onChange([...values, defaultSchemaValue(itemSchema)])}>
          <Plus size={13} /> Add item
        </button>
      </div>
    );
  }
  return (
    <ConstantEditor
      field={{
        name: schema.title ?? 'value',
        type: schemaFieldType(schema),
        values: schema.values,
        minimum: schema.minimum,
        maximum: schema.maximum,
        step: schema.step,
        multiline: schema.multiline,
      }}
      value={value}
      onChange={onChange}
    />
  );
}

function SliderEditor({ field, value, onChange }: Pick<ConstantEditorProps, 'field' | 'value' | 'onChange'>) {
  const minimum = field.minimum ?? 0;
  const maximum = field.maximum ?? 100;
  const step = field.step ?? (field.type === 'integer' ? 1 : (maximum - minimum) / 100);
  const current = typeof value === 'number' ? value : minimum;
  const parse = (raw: string) => {
    const numeric = field.type === 'integer' ? Number.parseInt(raw, 10) : Number(raw);
    return Number.isFinite(numeric) ? numeric : minimum;
  };
  return (
    <div className="slider-row">
      <input type="range" min={minimum} max={maximum} step={step} value={current} onChange={(event) => onChange(parse(event.target.value))} />
      <input
        className="slider-value"
        type="number"
        min={minimum}
        max={maximum}
        step={step}
        value={typeof value === 'number' ? value : ''}
        onChange={(event) => onChange(parse(event.target.value))}
      />
    </div>
  );
}

function ConstantEditor({ field, value, onChange, referenceOptionsForType }: ConstantEditorProps) {
  if (field.value_schema) {
    return <SchemaValueEditor schema={field.value_schema} value={value} onChange={onChange} referenceOptionsForType={referenceOptionsForType} />;
  }
  if (field.type === 'boolean') {
    return (
      <label className="switch-row">
        <input type="checkbox" checked={Boolean(value)} onChange={(event) => onChange(event.target.checked)} />
        <span className="switch-track" aria-hidden><span className="switch-thumb" /></span>
        <span>{value ? 'On' : 'Off'}</span>
      </label>
    );
  }
  if (field.type === 'enum') {
    return (
      <select value={textValue(value)} onChange={(event) => onChange(event.target.value)}>
        {(field.values ?? []).map((item) => <option key={item}>{item}</option>)}
      </select>
    );
  }
  if (field.type === 'integer' || field.type === 'number') {
    if (isSliderField(field)) return <SliderEditor field={field} value={value} onChange={onChange} />;
    return (
      <input
        type="number"
        min={field.minimum}
        max={field.maximum}
        step={field.step ?? (field.type === 'integer' ? 1 : 'any')}
        value={typeof value === 'number' ? value : ''}
        onChange={(event) => {
          const numeric = field.type === 'integer' ? Number.parseInt(event.target.value, 10) : Number(event.target.value);
          onChange(Number.isFinite(numeric) ? numeric : (field.minimum ?? 0));
        }}
      />
    );
  }
  if (field.type === 'json' || field.type === 'asset_collection' || field.type === 'asset_array') {
    return <JsonEditor value={value ?? (field.type === 'json' ? {} : [])} onChange={onChange} />;
  }
  if (isLongTextField(field)) {
    return <textarea rows={4} className="prompt-editor" value={textValue(value)} onChange={(event) => onChange(event.target.value)} />;
  }
  return <input type="text" value={textValue(value)} onChange={(event) => onChange(event.target.value)} />;
}

function Section({
  title,
  count,
  defaultOpen = true,
  children,
}: {
  title: ReactNode;
  count?: number;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={`inspector-section ${open ? '' : 'closed'}`}>
      <button className="section-toggle" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        <h3>{title}</h3>
        {count !== undefined ? <small>{count}</small> : null}
      </button>
      {open ? <div className="section-body">{children}</div> : null}
    </section>
  );
}

function ArgumentField({
  graph,
  catalog,
  node,
  field,
  mode,
  onUpdate,
  onPromote,
}: {
  graph: WorkflowGraph;
  catalog: CatalogEntry[];
  node: WorkflowNode;
  field: CatalogField;
  mode: StudioMode;
  onUpdate: (name: string, value: JsonValue | undefined) => void;
  onPromote?: (name: string) => void;
}) {
  const value = node.arguments[field.name];
  const argumentMode = argumentSource(field, value);
  const optionsForType = (type: FieldType) => referenceOptions(graph, catalog, node, type);
  const options = optionsForType(field.type);
  const label = mode === 'easy' ? friendlyLabel(field.name) : field.name;
  const promotable = promotableArgument(field, value, onPromote);

  return (
    <div className="field" key={field.name}>
      <div className="field-heading">
        <span>{label}{field.required ? <b className="required-mark" title="Required">*</b> : null}</span>
        <span className="field-heading-actions">
          <small>{mode === 'easy' ? friendlyType(field.type) : field.type}</small>
          {promotable ? (
            <button
              className="icon-button tiny"
              title="Promote constant to a reusable material node"
              aria-label={`Promote ${field.name}`}
              onClick={() => onPromote?.(field.name)}
            ><Workflow size={12} /></button>
          ) : null}
        </span>
      </div>
      <ArgumentModeButtons {...{ field, mode, argumentMode, options, onUpdate }} />
      <ArgumentValueEditor {...{ field, mode, argumentMode, value, options, optionsForType, onUpdate }} />
      {field.description ? <small className="field-description">{field.description}</small> : null}
    </div>
  );
}

type ArgumentSource = 'constant' | 'reference' | 'secret';

function argumentSource(field: CatalogField, value: JsonValue | undefined): ArgumentSource {
  if (isGraphReference(value)) return 'reference';
  if (isSecretReference(value) || field.secret) return 'secret';
  return 'constant';
}

function promotableArgument(
  field: CatalogField,
  value: JsonValue | undefined,
  onPromote: ((name: string) => void) | undefined,
): boolean {
  if (!onPromote || field.secret || value === undefined || isGraphReference(value) || isSecretReference(value)) return false;
  return !['asset', 'asset_directory', 'asset_array', 'asset_collection'].includes(field.type);
}

interface ArgumentValueProps {
  field: CatalogField;
  mode: StudioMode;
  argumentMode: ArgumentSource;
  value: JsonValue | undefined;
  options: ReferenceOption[];
  optionsForType: (type: FieldType) => ReferenceOption[];
  onUpdate: (name: string, value: JsonValue | undefined) => void;
}

function ArgumentModeButtons({ field, mode, argumentMode, options, onUpdate }: Omit<ArgumentValueProps, 'value' | 'optionsForType'>) {
  if (mode !== 'pro') return null;
  return (
    <div className="argument-mode" role="group" aria-label={`${field.name} source`}>
      {!field.secret ? (
        <button
          className={argumentMode === 'constant' ? 'active' : ''}
          onClick={() => onUpdate(field.name, defaultFieldValue({ ...field, secret: false }) ?? '')}
          title="Constant value"
        ><Braces size={12} /></button>
      ) : null}
      {!field.secret ? (
        <button
          className={argumentMode === 'reference' ? 'active' : ''}
          onClick={() => onUpdate(field.name, { $ref: options[0]?.value ?? '' })}
          title="Reference"
        ><Link2 size={12} /></button>
      ) : null}
      {field.secret ? <button className="active" title="Secret"><LockKeyhole size={12} /></button> : null}
    </div>
  );
}

function ReferenceArgumentEditor({ field, mode, value, options, onUpdate }: Omit<ArgumentValueProps, 'argumentMode' | 'optionsForType'>) {
  if (mode === 'easy') {
    return (
      <div className="linked-chip">
        <Link2 size={12} />
        <span>Linked to <strong>{isGraphReference(value) ? describeReference(value.$ref) : ''}</strong></span>
        <button
          className="icon-button small ghost"
          title="Unlink and use a fixed value"
          aria-label="Unlink"
          onClick={() => onUpdate(field.name, defaultFieldValue({ ...field, secret: false }) ?? '')}
        ><Unlink size={12} /></button>
      </div>
    );
  }
  return (
    <select value={isGraphReference(value) ? value.$ref : ''} onChange={(event) => onUpdate(field.name, { $ref: event.target.value })}>
      {!options.length ? <option value="">No compatible references</option> : null}
      {options.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
    </select>
  );
}

function ArgumentValueEditor(props: ArgumentValueProps) {
  const { field, argumentMode, value, onUpdate, optionsForType } = props;
  if (argumentMode === 'reference') return <ReferenceArgumentEditor {...props} />;
  if (argumentMode === 'secret') {
    return (
      <div className="secret-field">
        <LockKeyhole size={13} />
        <input
          type="text"
          value={isSecretReference(value) ? value.$secret : ''}
          placeholder="secret-name"
          onChange={(event) => onUpdate(field.name, { $secret: event.target.value })}
        />
      </div>
    );
  }
  return <ConstantEditor field={field} value={value} onChange={(next) => onUpdate(field.name, next)} referenceOptionsForType={optionsForType} />;
}

const literalMaterialKinds = new Set([
  'text.value', 'integer.value', 'number.value', 'boolean.value', 'json.value', 'seed.value', 'choice.value',
]);

type UpdateArgument = (name: string, value: JsonValue | undefined) => void;

function promoteHandler(entry: CatalogEntry | undefined, nodeId: string, promote: InspectorProps['onPromoteArgument']) {
  return entry?.presentation?.style === 'material' ? undefined : (name: string) => promote(nodeId, name);
}

function NodeIdentity({ mode, node, nodeId, onNodeId, onRename }: {
  mode: StudioMode;
  node: WorkflowNode;
  nodeId: string;
  onNodeId: (value: string) => void;
  onRename: InspectorProps['onRenameNode'];
}) {
  if (mode !== 'pro') return null;
  return <Section title="Identity">
    <label className="field"><span>Node ID</span><input
      value={nodeId}
      onChange={(event) => onNodeId(event.target.value)}
      onBlur={() => nodeId !== node.id && onRename(node.id, nodeId)}
      onKeyDown={(event) => event.key === 'Enter' && event.currentTarget.blur()}
    /></label>
    <label className="field"><span>Kind</span><input value={node.kind} disabled /></label>
    {node.provider ? <label className="field"><span>Provider</span><input value={node.provider} disabled /></label> : null}
  </Section>;
}

function ArgumentList({ fields, entry, graph, catalog, node, mode, update, promote }: {
  fields: CatalogField[];
  entry: CatalogEntry | undefined;
  graph: WorkflowGraph;
  catalog: CatalogEntry[];
  node: WorkflowNode;
  mode: StudioMode;
  update: UpdateArgument;
  promote: InspectorProps['onPromoteArgument'];
}) {
  const onPromote = promoteHandler(entry, node.id, promote);
  return <>
    {fields.map((field) => <ArgumentField key={field.name} graph={graph} catalog={catalog} node={node} field={field} mode={mode} onUpdate={update} onPromote={onPromote} />)}
    {!fields.length ? <div className="empty-state small">Nothing to configure. Connect the ports on the canvas.</div> : null}
    {!entry ? <div className="empty-state small">Catalog entry unavailable</div> : null}
  </>;
}

function AdvancedArguments({ fields, show, onShow, ...props }: {
  fields: CatalogField[];
  show: boolean;
  onShow: () => void;
} & Omit<Parameters<typeof ArgumentList>[0], 'fields'>) {
  if (props.mode !== 'easy' || !fields.length) return null;
  return <div className="advanced-block">
    <button className="advanced-toggle" onClick={onShow} aria-expanded={show}>
      <Settings2 size={13} />
      <span>{show ? 'Hide advanced options' : `More options (${fields.length})`}</span>
      {show ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
    </button>
    {show ? <ArgumentList fields={fields} {...props} /> : null}
  </div>;
}

function NodeExecution({ mode, node, onUpdate }: { mode: StudioMode; node: WorkflowNode; onUpdate: InspectorProps['onUpdateNode'] }) {
  if (mode !== 'pro') return null;
  return <Section title="Execution" defaultOpen={false}>
    <label className="field"><span>Cache</span><select
      value={node.execution?.cache ?? 'auto'}
      onChange={(event) => {
        const cache = event.target.value;
        if (cache === 'auto' || cache === 'never' || cache === 'refresh') onUpdate({ ...node, execution: { ...node.execution, cache } });
      }}
    ><option>auto</option><option>never</option><option>refresh</option></select></label>
    <div className="field-grid">
      <label className="field"><span>Attempts</span><input type="number" min={1} max={10} value={node.execution?.max_attempts ?? 1} onChange={(event) => onUpdate({ ...node, execution: { ...node.execution, max_attempts: Number(event.target.value) } })} /></label>
      <label className="field"><span>Timeout (s)</span><input type="number" min={1} value={node.execution?.timeout_seconds ?? ''} onChange={(event) => onUpdate({ ...node, execution: { ...node.execution, timeout_seconds: Number(event.target.value) || undefined } })} /></label>
    </div>
  </Section>;
}

function MaterialSection({ graph, node, onInline }: { graph: WorkflowGraph; node: WorkflowNode; onInline: InspectorProps['onInlineMaterial'] }) {
  if (!literalMaterialKinds.has(node.kind)) return null;
  const consumers = graph.nodes.filter((candidate) => candidate.id !== node.id && Object.values(candidate.arguments).some(
    (value) => referencesIn(value).some((reference) => reference.startsWith(`nodes.${node.id}.outputs.`)),
  ));
  return <Section title="Material" count={consumers.length} defaultOpen>
    {consumers.map((consumer) => <button className="command-button compact" key={consumer.id} onClick={() => onInline(node.id, consumer.id)}><Unlink size={13} /> Inline into {consumer.id}</button>)}
    <button className="command-button compact" disabled={!consumers.length} onClick={() => onInline(node.id)}><Unlink size={13} /> Inline everywhere</button>
    {!consumers.length ? <small className="field-description">This material has no node consumers.</small> : null}
  </Section>;
}

function NodeOutputs({ mode, entry, node, onAdd }: { mode: StudioMode; entry: CatalogEntry | undefined; node: WorkflowNode; onAdd: InspectorProps['onAddOutput'] }) {
  if (mode !== 'pro') return null;
  const outputs = entry?.outputs ?? [];
  return <Section title="Outputs" count={outputs.length} defaultOpen={false}>
    {outputs.map((output) => <div className="output-row" key={output.name}>
      <span><strong>{output.name}</strong><small>{output.type}</small></span>
      <button className="icon-button small" title="Expose as graph output" aria-label={`Expose ${output.name} as graph output`} onClick={() => onAdd(node.id, output.name)}><Plus size={14} /></button>
    </div>)}
  </Section>;
}

function NodeInspector({ graph, catalog, node, mode, onUpdateNode, onPromoteArgument, onInlineMaterial, onRenameNode, onDeleteNode, onAddOutput }: Pick<
  InspectorProps,
  'graph' | 'catalog' | 'mode' | 'onUpdateNode' | 'onPromoteArgument' | 'onInlineMaterial' | 'onRenameNode' | 'onDeleteNode' | 'onAddOutput'
> & { node: WorkflowNode }) {
  const entry = catalogEntryFor(node, catalog);
  const [nodeId, setNodeId] = useState(node.id);
  const [showAdvanced, setShowAdvanced] = useState(false);
  useEffect(() => setNodeId(node.id), [node.id]);
  useEffect(() => setShowAdvanced(false), [node.id]);
  const { primary, advanced } = splitFieldsForMode(entry?.inputs ?? [], mode);
  const updateArgument: UpdateArgument = (name, value) => {
    if (value === undefined) {
      const nextArguments = { ...node.arguments };
      delete nextArguments[name];
      onUpdateNode({ ...node, arguments: nextArguments });
      return;
    }
    onUpdateNode({ ...node, arguments: { ...node.arguments, [name]: value } });
  };
  const argumentProps = { entry, graph, catalog, node, mode, update: updateArgument, promote: onPromoteArgument };
  return <>
    {mode === 'easy' && entry?.description ? <div className="inspector-about">{entry.description}</div> : null}
    <NodeIdentity mode={mode} node={node} nodeId={nodeId} onNodeId={setNodeId} onRename={onRenameNode} />
    <Section title={mode === 'easy' ? 'Settings' : 'Arguments'} count={primary.length}>
      <ArgumentList fields={primary} {...argumentProps} />
      <AdvancedArguments fields={advanced} show={showAdvanced} onShow={() => setShowAdvanced((value) => !value)} {...argumentProps} />
    </Section>
    <NodeExecution mode={mode} node={node} onUpdate={onUpdateNode} />
    <MaterialSection graph={graph} node={node} onInline={onInlineMaterial} />
    <NodeOutputs mode={mode} entry={entry} node={node} onAdd={onAddOutput} />
    <div className="inspector-footer"><button className="command-button danger" onClick={() => onDeleteNode(node.id)}><Trash2 size={14} /> {mode === 'easy' ? 'Remove step' : 'Delete node'}</button></div>
  </>;
}

function OutputInspector({
  graph,
  catalog,
  name,
  onGraphChange,
  onRenameOutput,
  onDeleteOutput,
}: Pick<InspectorProps, 'graph' | 'catalog' | 'onGraphChange' | 'onRenameOutput' | 'onDeleteOutput'> & {
  name: string;
}) {
  const [outputName, setOutputName] = useState(name);
  useEffect(() => setOutputName(name), [name]);
  const reference = graph.outputs[name];
  if (!reference) return null;
  const options: ReferenceOption[] = [];
  for (const node of graph.nodes) {
    for (const output of catalogEntryFor(node, catalog)?.outputs ?? []) {
      options.push({ value: `nodes.${node.id}.outputs.${output.name}`, label: `${node.id} / ${output.name}` });
    }
  }

  return (
    <>
      <section className="inspector-section">
        <label className="field"><span>Output ID</span><input
          value={outputName}
          onChange={(event) => setOutputName(event.target.value)}
          onBlur={() => outputName !== name && onRenameOutput(name, outputName)}
          onKeyDown={(event) => event.key === 'Enter' && event.currentTarget.blur()}
        /></label>
        <label className="field"><span>Source</span><select
          value={reference.$ref}
          onChange={(event) => onGraphChange({
            ...graph,
            outputs: { ...graph.outputs, [name]: { $ref: event.target.value } },
          })}
        >
          {options.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
        </select></label>
      </section>
      <section className="inspector-section danger-zone">
        <button className="command-button danger" onClick={() => onDeleteOutput(name)}><Trash2 size={14} /> Delete output</button>
      </section>
    </>
  );
}

function InputInspector({
  graph,
  inputs,
  name,
  mode,
  onGraphChange,
  onInputsChange,
  onRenameInput,
  onDeleteInput,
}: Pick<InspectorProps, 'graph' | 'inputs' | 'mode' | 'onGraphChange' | 'onInputsChange' | 'onRenameInput' | 'onDeleteInput'> & {
  name: string;
}) {
  const definition = graph.inputs[name];
  const [inputName, setInputName] = useState(name);
  useEffect(() => setInputName(name), [name]);
  if (!definition) return null;
  const setDefinition = (update: Partial<typeof definition>) =>
    onGraphChange({ ...graph, inputs: { ...graph.inputs, [name]: { ...definition, ...update } } });

  return (
    <>
      {mode === 'pro' ? (
        <Section title="Definition">
          <label className="field"><span>Input ID</span><input
            value={inputName}
            onChange={(event) => setInputName(event.target.value)}
            onBlur={() => inputName !== name && onRenameInput(name, inputName)}
            onKeyDown={(event) => event.key === 'Enter' && event.currentTarget.blur()}
          /></label>
          <label className="field"><span>Type</span><select
            value={definition.type}
            onChange={(event) => setDefinition({ type: decodeFieldType(event.target.value) })}
          >
            {['string', 'integer', 'number', 'boolean', 'enum', 'asset', 'asset_directory'].map((type) => <option key={type}>{type}</option>)}
          </select></label>
          <label className="switch-row"><input
            type="checkbox"
            checked={definition.required ?? false}
            onChange={(event) => setDefinition({ required: event.target.checked })}
          /><span className="switch-track" aria-hidden><span className="switch-thumb" /></span><span>Required</span></label>
        </Section>
      ) : definition.description ? <div className="inspector-about">{definition.description}</div> : null}
      <Section title="Value">
        <ConstantEditor
          field={{ name, type: definition.type, values: definition.values, multiline: definition.type === 'string' }}
          value={inputs[name]}
          onChange={(value) => onInputsChange({ ...inputs, [name]: value })}
        />
        {mode === 'easy' && definition.required ? <small className="field-description">This value is required before running.</small> : null}
      </Section>
      <div className="inspector-footer">
        <button className="command-button danger" onClick={() => onDeleteInput(name)}><Trash2 size={14} /> Delete input</button>
      </div>
    </>
  );
}

function EditorItemInspector({
  sidecar,
  itemId,
  onSidecarChange,
  onDeleteEditorItem,
}: Pick<InspectorProps, 'sidecar' | 'onSidecarChange' | 'onDeleteEditorItem'> & { itemId: string }) {
  const groupName = editorGroupName(itemId);
  const noteName = editorNoteName(itemId);
  const group = groupName ? sidecar.groups?.[groupName] : undefined;
  const note = noteName ? sidecar.notes?.[noteName] : undefined;
  if (group && groupName) {
    return <EditorGroupInspector {...{ sidecar, groupName, group, itemId, onSidecarChange, onDeleteEditorItem }} />;
  }
  if (note && noteName) {
    return <EditorNoteInspector {...{ sidecar, noteName, note, itemId, onSidecarChange, onDeleteEditorItem }} />;
  }
  return <div className="empty-state">Editor item unavailable</div>;
}

interface EditorGroupInspectorProps extends Pick<InspectorProps, 'sidecar' | 'onSidecarChange' | 'onDeleteEditorItem'> {
  groupName: string;
  group: EditorGroupState;
  itemId: string;
}

function EditorGroupInspector({ sidecar, groupName, group, itemId, onSidecarChange, onDeleteEditorItem }: EditorGroupInspectorProps) {
  const update = (values: Partial<EditorGroupState>) => onSidecarChange({
    ...sidecar,
    groups: { ...sidecar.groups, [groupName]: { ...group, ...values } },
  });
  return (
    <>
      <section className="inspector-section">
        <label className="field"><span>Title</span><input value={group.title} onChange={(event) => update({ title: event.target.value })} /></label>
        <label className="color-field"><span>Color</span><input type="color" value={group.color ?? '#5F8F7B'} onChange={(event) => update({ color: event.target.value })} /></label>
        <div className="field-grid">
          <label className="field"><span>Width</span><input type="number" min={120} value={group.width} onChange={(event) => update({ width: Number(event.target.value) })} /></label>
          <label className="field"><span>Height</span><input type="number" min={80} value={group.height} onChange={(event) => update({ height: Number(event.target.value) })} /></label>
        </div>
      </section>
      <section className="inspector-section">
        <h3>Members</h3>
        {group.node_ids.map((nodeId) => <code className="member-row" key={nodeId}>{nodeId}</code>)}
      </section>
      <section className="inspector-section danger-zone">
        <button className="command-button danger" onClick={() => onDeleteEditorItem(itemId)}><Trash2 size={14} /> Delete group</button>
      </section>
    </>
  );
}

interface EditorNoteInspectorProps extends Pick<InspectorProps, 'sidecar' | 'onSidecarChange' | 'onDeleteEditorItem'> {
  noteName: string;
  note: EditorNoteState;
  itemId: string;
}

function EditorNoteInspector({ sidecar, noteName, note, itemId, onSidecarChange, onDeleteEditorItem }: EditorNoteInspectorProps) {
  const update = (values: Partial<EditorNoteState>) => onSidecarChange({
    ...sidecar,
    notes: { ...sidecar.notes, [noteName]: { ...note, ...values } },
  });
  return (
    <>
      <section className="inspector-section">
        <label className="field"><span>Note</span><textarea rows={7} value={note.text} onChange={(event) => update({ text: event.target.value })} /></label>
        <label className="color-field"><span>Color</span><input type="color" value={note.color ?? '#D4A54E'} onChange={(event) => update({ color: event.target.value })} /></label>
        <div className="field-grid">
          <label className="field"><span>Width</span><input type="number" min={120} value={note.width} onChange={(event) => update({ width: Number(event.target.value) })} /></label>
          <label className="field"><span>Height</span><input type="number" min={80} value={note.height} onChange={(event) => update({ height: Number(event.target.value) })} /></label>
        </div>
      </section>
      <section className="inspector-section danger-zone">
        <button className="command-button danger" onClick={() => onDeleteEditorItem(itemId)}><Trash2 size={14} /> Delete note</button>
      </section>
    </>
  );
}

function MultiSelectionInspector({ selectedNodeIds }: Pick<InspectorProps, 'selectedNodeIds'>) {
  return (
    <section className="inspector-section">
      <h3>{selectedNodeIds.length} selected nodes</h3>
      {selectedNodeIds.map((nodeId) => <code className="member-row" key={nodeId}>{nodeId}</code>)}
    </section>
  );
}

function GraphInspector({
  graph,
  sidecar,
  mode,
  onGraphChange,
  onSidecarChange,
  onSelectNodes,
}: Pick<InspectorProps, 'graph' | 'sidecar' | 'mode' | 'onGraphChange' | 'onSidecarChange' | 'onSelectNodes'>) {
  const edgeCount = useMemo(
    () => graph.nodes.reduce(
      (count, node) => count + Object.values(node.arguments).filter(
        (value) => isGraphReference(value) && value.$ref.startsWith('nodes.'),
      ).length,
      0,
    ),
    [graph.nodes],
  );
  return (
    <>
      <Section title={mode === 'easy' ? 'Workflow' : 'Graph'}>
        <label className="field"><span>Name</span><input value={graph.name} onChange={(event) => onGraphChange({ ...graph, name: event.target.value })} /></label>
        {mode === 'pro' ? (
          <label className="field"><span>Parallel nodes</span><input
            type="number"
            min={1}
            max={64}
            value={graph.execution?.max_parallel_nodes ?? 1}
            onChange={(event) => onGraphChange({ ...graph, execution: { ...graph.execution, max_parallel_nodes: Number(event.target.value) } })}
          /></label>
        ) : null}
        <div className="stat-strip" role="group" aria-label="Workflow summary">
          <span><strong>{graph.nodes.length}</strong> {graph.nodes.length === 1 ? 'step' : 'steps'}</span>
          <span><strong>{edgeCount}</strong> {edgeCount === 1 ? 'link' : 'links'}</span>
          <span><strong>{Object.keys(graph.inputs).length}</strong> in</span>
          <span><strong>{Object.keys(graph.outputs).length}</strong> out</span>
        </div>
      </Section>
      {mode === 'pro' ? (
        <>
          <Section title="Nodes" count={graph.nodes.length}>
            {graph.nodes.map((node) => (
              <div className="output-row" key={node.id}>
                <button className="text-command" onClick={() => onSelectNodes([node.id])}>
                  <strong>{node.id}</strong><small>{node.kind}</small>
                </button>
              </div>
            ))}
            {!graph.nodes.length ? <div className="empty-state small">No nodes</div> : null}
          </Section>
          <Section title="Graph outputs" count={Object.keys(graph.outputs).length}>
            {Object.entries(graph.outputs).map(([name, reference]) => (
              <div className="output-row" key={name}>
                <span><strong>{name}</strong><small>{reference.$ref}</small></span>
                <button
                  className="icon-button small danger"
                  title="Remove output"
                  aria-label={`Remove output ${name}`}
                  onClick={() => {
                    const outputs = { ...graph.outputs };
                    delete outputs[name];
                    onGraphChange({ ...graph, outputs });
                  }}
                ><Trash2 size={14} /></button>
              </div>
            ))}
            {!Object.keys(graph.outputs).length ? <div className="empty-state small">No graph outputs</div> : null}
          </Section>
          <Section title="Saved selections" count={Object.keys(sidecar.selection_sets ?? {}).length}>
            {Object.entries(sidecar.selection_sets ?? {}).map(([name, selection]) => (
              <div className="output-row" key={name}>
                <button className="text-command" onClick={() => onSelectNodes(selection.node_ids)}>
                  <strong>{name}</strong><small>{selection.node_ids.length} nodes</small>
                </button>
                <button className="icon-button small danger" title="Remove selection" onClick={() => {
                  const selectionSets = { ...sidecar.selection_sets };
                  delete selectionSets[name];
                  onSidecarChange({ ...sidecar, selection_sets: selectionSets });
                }}><Trash2 size={14} /></button>
              </div>
            ))}
            {!Object.keys(sidecar.selection_sets ?? {}).length ? <div className="empty-state small">No saved selections</div> : null}
          </Section>
        </>
      ) : (
        <div className="inspector-tip"><Sparkles size={13} /><span>Select a step to tune it, or choose a template from the library.</span></div>
      )}
    </>
  );
}

function selectedEditorLabel(itemId: string | null): string | null {
  if (!itemId) return null;
  if (editorGroupName(itemId)) return 'Group';
  if (editorNoteName(itemId)) return 'Note';
  return 'Editor item';
}

function inspectorTitle(props: InspectorProps, node: WorkflowNode | undefined, entry: CatalogEntry | undefined, editorLabel: string | null): string {
  if (node) return entry?.title ?? node.kind;
  if (props.selectedNodeIds.length > 1) return `${props.selectedNodeIds.length} selected`;
  if (props.selectedInputName) return friendlyLabel(props.selectedInputName);
  return props.selectedOutputName ?? editorLabel ?? 'Workflow';
}

function inspectorSubtitle(props: InspectorProps, node: WorkflowNode | undefined, entry: CatalogEntry | undefined, editorLabel: string | null): string {
  if (node) return props.mode === 'easy' ? categoryTitle(entry?.category) : node.id;
  if (props.selectedInputName) return 'Graph input';
  if (props.selectedOutputName) return 'Graph output';
  return editorLabel ?? props.graph.name;
}

function InspectorContent({ props, node }: { props: InspectorProps; node: WorkflowNode | undefined }) {
  if (node) return <NodeInspector {...props} node={node} />;
  if (props.selectedNodeIds.length > 1) return <MultiSelectionInspector selectedNodeIds={props.selectedNodeIds} />;
  if (props.selectedInputName) return <InputInspector {...props} name={props.selectedInputName} />;
  if (props.selectedOutputName) return <OutputInspector {...props} name={props.selectedOutputName} />;
  if (props.selectedEditorItemId) return <EditorItemInspector {...props} itemId={props.selectedEditorItemId} />;
  return <GraphInspector {...props} />;
}

export function Inspector(props: InspectorProps): ReactElement {
  const node = useMemo(
    () => props.graph.nodes.find((candidate) => candidate.id === props.selectedNodeId),
    [props.graph.nodes, props.selectedNodeId],
  );
  const editorLabel = selectedEditorLabel(props.selectedEditorItemId);
  const entry = node ? catalogEntryFor(node, props.catalog) : undefined;
  const category = categoryKey(entry?.category);
  const Icon = node ? categoryIcons[category] : props.selectedInputName ? Braces : Workflow;
  const headingTitle = inspectorTitle(props, node, entry, editorLabel);
  const headingSubtitle = inspectorSubtitle(props, node, entry, editorLabel);
  if (props.collapsed) {
    return (
      <aside className="inspector-rail" aria-label="Inspector">
        <button className="rail-btn" title="Expand inspector" aria-label="Expand inspector" onClick={() => props.onCollapsedChange(false)}>
          <PanelRightOpen size={17} />
        </button>
        <span className={`rail-icon ${node ? `cat-${category}` : ''}`}><Icon size={16} strokeWidth={1.9} /></span>
      </aside>
    );
  }

  return (
    <aside className="inspector-panel">
      <div className={`panel-heading inspector-heading ${node ? `cat-${category}` : ''}`}>
        <span className="heading-icon"><Icon size={14} strokeWidth={1.9} /></span>
        <span className="heading-copy"><strong>{headingTitle}</strong><small>{headingSubtitle}</small></span>
        <button className="panel-collapse" title="Collapse inspector" aria-label="Collapse inspector" onClick={() => props.onCollapsedChange(true)}>
          <PanelRightClose size={15} />
        </button>
      </div>
      <div className="inspector-body">
        <InspectorContent props={props} node={node} />
      </div>
    </aside>
  );
}
