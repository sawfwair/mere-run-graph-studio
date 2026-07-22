import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertTriangle,
  ArrowUpRight,
  ChevronDown,
  ChevronUp,
  Download,
  Eye,
  EyeOff,
  FileText,
  Image as ImageIcon,
  Layers,
  Lock,
  LockOpen,
  Pencil,
  Play,
  Settings2,
  Share2,
  Sparkles,
  X,
} from 'lucide-react';

import {
  appFields,
  appTagline,
  appTitle,
  defaultVariationField,
  outputResults,
  variationCandidates,
  type AppField,
  type OutputResult,
  type VariationCandidate,
} from '../app-mode';
import { friendlyType, portTypeKey, summarizeValue, textValue } from '../ui';
import type { NodeRunPreviewItem } from '../run-preview';
import type { EditorAppConfig, EditorSidecar, JsonObject, JsonValue, StudioRun, WorkflowGraph } from '../types';

export interface AppVariation {
  label: string;
  run: StudioRun;
}

interface AppViewProps {
  graph: WorkflowGraph;
  inputs: JsonObject;
  sidecar: EditorSidecar;
  latestRun: StudioRun | null;
  running: boolean;
  variations: AppVariation[];
  variationField: string | null;
  variationBusy: boolean;
  onInputsChange: (inputs: JsonObject) => void;
  onSidecarChange: (sidecar: EditorSidecar) => void;
  missingModels: string[];
  modelRoute: { model: string; executor: string } | null;
  onRun: () => void;
  onRunVariations: (candidate: VariationCandidate, count: number) => void;
  onClearVariations: () => void;
  onShare: () => void;
  onEditGraph: () => void;
  onRunOnExecutor: (executor: string) => void;
  canInstallModels: boolean;
  onInstallModel: (model: string) => void;
  artifactBlob: (runId: string, path: string, contentType?: string) => Promise<Blob>;
  inputAssetBlob: (path: string, contentType?: string) => Promise<Blob>;
}

const RUNNING_STATES = ['starting', 'running', 'submitting', 'queued', 'assigned'];
const isRunning = (run: StudioRun | null | undefined): boolean => Boolean(run && RUNNING_STATES.includes(run.state));

function mediaType(path: string): string | undefined {
  const extension = path.split('.').pop()?.toLowerCase() ?? '';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'heic'].includes(extension)) {
    return extension === 'jpg' ? 'image/jpeg' : `image/${extension}`;
  }
  if (['mp4', 'mov', 'webm', 'm4v'].includes(extension)) {
    if (extension === 'mov') return 'video/quicktime';
    return extension === 'webm' ? 'video/webm' : 'video/mp4';
  }
  if (['mp3', 'wav', 'ogg', 'm4a', 'flac'].includes(extension)) {
    return extension === 'mp3' ? 'audio/mpeg' : `audio/${extension}`;
  }
  return undefined;
}

/** Loads an artifact blob into an object URL and renders it as media or a scalar. */
function ArtifactMedia({ runId, item, load, large, onOpen }: {
  runId: string;
  item: NodeRunPreviewItem;
  load: (runId: string, path: string, contentType?: string) => Promise<Blob>;
  large?: boolean;
  onOpen?: () => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const artifact = item.artifact;
  const contentType = artifact?.content_type ?? (artifact ? mediaType(artifact.path) : undefined);

  useEffect(() => {
    setUrl(null);
    if (!artifact) return undefined;
    let live = true;
    let objectUrl: string | null = null;
    void load(runId, artifact.path, contentType).then((blob) => {
      if (!live) return;
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    }).catch(() => {
      if (live) setUrl(null);
    });
    return () => {
      live = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [artifact, contentType, load, runId]);

  if (item.value !== undefined) {
    const text = typeof item.value === 'string' ? item.value : JSON.stringify(item.value, null, large ? 2 : undefined);
    return <div className={`app-scalar ${large ? 'large' : ''}`}><FileText size={large ? 18 : 13} /><span>{text}</span></div>;
  }
  if (!artifact) return <div className="app-media-empty"><ImageIcon size={16} /></div>;
  if (!url) return <div className="app-media-loading" aria-label="Loading result"><span /></div>;
  if (contentType?.startsWith('image/')) {
    return <button className="app-media-open" onClick={onOpen} aria-label={`Open ${artifact.name}`}><img src={url} alt={artifact.name} /></button>;
  }
  if (contentType?.startsWith('video/')) {
    return <video src={url} controls={large} muted={!large} playsInline loop={!large} autoPlay={!large} />;
  }
  if (contentType?.startsWith('audio/')) return <audio src={url} controls className="nodrag" />;
  return <a className="app-media-file" href={url} download={artifact.name}><ImageIcon size={15} /> {artifact.name}</a>;
}

function AssetPreview({ path, load }: { path: string; load: (path: string, contentType?: string) => Promise<Blob> }) {
  const [url, setUrl] = useState<string | null>(null);
  const contentType = mediaType(path);
  useEffect(() => {
    if (!contentType) return undefined;
    let live = true;
    let objectUrl: string | null = null;
    void load(path, contentType).then((blob) => {
      if (!live) return;
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    }).catch(() => { if (live) setUrl(null); });
    return () => { live = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [contentType, load, path]);
  const filename = path.split('/').at(-1);
  return (
    <div className="app-asset-preview">
      {url && contentType?.startsWith('image/') ? <img src={url} alt="" /> : null}
      {url && contentType?.startsWith('video/') ? <video src={url} muted playsInline /> : null}
      <span title={path}>{filename}</span>
    </div>
  );
}

type PatchApp = (mutate: (config: EditorAppConfig) => EditorAppConfig) => void;
type PatchField = (name: string, patch: Partial<NonNullable<EditorAppConfig['fields']>[string]>) => void;
type Lightbox = { runId: string; item: NodeRunPreviewItem; caption: string };

function AppHeader({ title, tagline, fieldCount, showSettings, onToggleSettings, onEditGraph, onShare }: {
  title: string;
  tagline: string;
  fieldCount: number;
  showSettings: boolean;
  onToggleSettings: () => void;
  onEditGraph: () => void;
  onShare: () => void;
}) {
  return (
    <header className="app-form-head">
      <div className="app-identity">
        <span className="app-badge"><Sparkles size={16} /></span>
        <div>
          <h1>{title}</h1>
          <p>{tagline || `${fieldCount} ${fieldCount === 1 ? 'input' : 'inputs'} · runs on your fleet`}</p>
        </div>
      </div>
      <div className="app-head-actions">
        <button className="icon-button small" title="App settings" aria-label="App settings" aria-pressed={showSettings} onClick={onToggleSettings}><Settings2 size={15} /></button>
        <button className="icon-button small" title="Edit the graph" aria-label="Edit the graph" onClick={onEditGraph}><Pencil size={15} /></button>
        <button className="icon-button small" title="Share as a portable file" aria-label="Share app" onClick={onShare}><Share2 size={15} /></button>
      </div>
    </header>
  );
}

function MissingModelsBanner({ missingModels, modelRoute, canInstallModels, onInstallModel, onRunOnExecutor, onEditGraph }:
  Pick<AppViewProps, 'missingModels' | 'modelRoute' | 'canInstallModels' | 'onInstallModel' | 'onRunOnExecutor' | 'onEditGraph'>) {
  if (!missingModels.length) return null;
  return (
    <div className="app-missing" role="status">
      <span className="app-missing-icon"><AlertTriangle size={15} /></span>
      <div className="app-missing-body">
        <strong>{missingModels.length === 1 ? 'This graph uses a model you haven’t installed' : `This graph uses ${missingModels.length} models you haven’t installed`}</strong>
        <p title={missingModels.join(', ')}>{missingModels.join(', ')}</p>
        <span className="app-missing-hint">Run anyway to let preflight decide, swap it on the canvas, or run where it’s installed.</span>
      </div>
      <div className="app-missing-actions">
        {canInstallModels ? (
          <button className="command-button" onClick={() => onInstallModel(missingModels[0])} title={`Install ${missingModels[0]}`}>
            <Download size={12} /> Install {missingModels.length > 1 ? `${missingModels[0]} +${missingModels.length - 1}` : missingModels[0]}
          </button>
        ) : null}
        {modelRoute ? (
          <button className="command-button subtle" onClick={() => onRunOnExecutor(modelRoute.executor)} title={`Run on ${modelRoute.executor}, which has ${modelRoute.model}`}>
            Run on {modelRoute.executor} <ArrowUpRight size={12} />
          </button>
        ) : null}
        <button className="command-button subtle" onClick={onEditGraph}>Swap on canvas</button>
      </div>
    </div>
  );
}

function AppSettingsRow({ name, config, patchField, moveField }: {
  name: string;
  config: NonNullable<EditorAppConfig['fields']>[string] | undefined;
  patchField: PatchField;
  moveField: (name: string, direction: -1 | 1) => void;
}) {
  const hidden = config?.hidden === true;
  const locked = config?.locked === true;
  return (
    <div className={`app-settings-row ${hidden ? 'is-hidden' : ''}`}>
      <FieldVisibilityButton hidden={hidden} onClick={() => patchField(name, { hidden: !hidden })} />
      <FieldLockButton locked={locked} onClick={() => patchField(name, { locked: !locked })} />
      <input className="app-settings-label" value={config?.label ?? ''} placeholder={name} onChange={(event) => patchField(name, { label: event.target.value })} />
      <div className="app-settings-move">
        <button className="icon-button tiny" title="Move up" aria-label="Move field up" onClick={() => moveField(name, -1)}><ChevronUp size={13} /></button>
        <button className="icon-button tiny" title="Move down" aria-label="Move field down" onClick={() => moveField(name, 1)}><ChevronDown size={13} /></button>
      </div>
    </div>
  );
}

function FieldVisibilityButton({ hidden, onClick }: { hidden: boolean; onClick: () => void }) {
  const title = hidden ? 'Show field' : 'Hide field';
  return <button className="icon-button tiny" title={title} aria-label={title} onClick={onClick}>{hidden ? <EyeOff size={13} /> : <Eye size={13} />}</button>;
}

function FieldLockButton({ locked, onClick }: { locked: boolean; onClick: () => void }) {
  const title = locked ? 'Unlock field' : 'Lock field';
  return <button className="icon-button tiny" title={title} aria-label={title} onClick={onClick}>{locked ? <Lock size={13} /> : <LockOpen size={13} />}</button>;
}

function AppSettings({ visible, graph, sidecar, title, patchApp, patchField, moveField }: {
  visible: boolean;
  graph: WorkflowGraph;
  sidecar: EditorSidecar;
  title: string;
  patchApp: PatchApp;
  patchField: PatchField;
  moveField: (name: string, direction: -1 | 1) => void;
}) {
  if (!visible) return null;
  const names = Object.keys(graph.inputs);
  return (
    <section className="app-settings" aria-label="App settings">
      <label className="field"><span>App title</span>
        <input value={sidecar.app?.title ?? ''} placeholder={title} onChange={(event) => patchApp((config) => ({ ...config, title: event.target.value }))} />
      </label>
      <label className="field"><span>Tagline</span>
        <input value={sidecar.app?.tagline ?? ''} placeholder="What this app makes" onChange={(event) => patchApp((config) => ({ ...config, tagline: event.target.value }))} />
      </label>
      <div className="app-settings-fields">
        <span className="app-settings-legend">Fields</span>
        {names.map((name) => <AppSettingsRow key={name} name={name} config={sidecar.app?.fields?.[name]} patchField={patchField} moveField={moveField} />)}
        {!names.length ? <p className="app-empty-hint">Add graph inputs on the canvas to expose fields here.</p> : null}
      </div>
    </section>
  );
}

function AppFields({ fields, inputs, onValue, inputAssetBlob, onEditGraph }: {
  fields: AppField[];
  inputs: JsonObject;
  onValue: (name: string, value: JsonValue) => void;
  inputAssetBlob: AppViewProps['inputAssetBlob'];
  onEditGraph: () => void;
}) {
  return (
    <div className="app-fields">
      {fields.map((field) => <AppFieldInput key={field.name} field={field} value={inputs[field.name] ?? field.definition.default} onChange={(value) => onValue(field.name, value)} inputAssetBlob={inputAssetBlob} />)}
      {!fields.length ? (
        <div className="app-no-fields">
          <Layers size={20} />
          <p>No inputs are exposed yet.</p>
          <button className="command-button" onClick={onEditGraph}><Pencil size={13} /> Add inputs on the canvas</button>
        </div>
      ) : null}
    </div>
  );
}

function AppRunDock({ busy, running, candidates, sweepName, sweepCount, sweepCandidate, onSweepName, onSweepCount, onRun, onRunVariations }: {
  busy: boolean;
  running: boolean;
  candidates: VariationCandidate[];
  sweepName: string;
  sweepCount: number;
  sweepCandidate: VariationCandidate | null;
  onSweepName: (name: string) => void;
  onSweepCount: (count: number) => void;
  onRun: () => void;
  onRunVariations: AppViewProps['onRunVariations'];
}) {
  return (
    <div className="app-run-dock">
      <button className="command-button primary app-run" disabled={busy} onClick={onRun}>
        <Play size={14} fill="currentColor" /> {running ? 'Running…' : 'Run'}
      </button>
      {candidates.length ? (
        <div className="app-sweep">
          <span className="app-sweep-label" title="Generate many at once — free on your own GPUs">Variations</span>
          <select value={sweepName} onChange={(event) => onSweepName(event.target.value)} aria-label="Dimension to vary">
            {candidates.map((candidate) => <option key={candidate.name} value={candidate.name}>{candidate.label}</option>)}
          </select>
          <input type="number" min={2} max={24} value={sweepCount} aria-label="Number of variations" onChange={(event) => onSweepCount(Math.max(2, Math.min(24, Number(event.target.value) || 2)))} />
          <button className="command-button" disabled={busy || !sweepCandidate} onClick={() => { if (sweepCandidate) onRunVariations(sweepCandidate, sweepCount); }}>
            <Layers size={13} /> Run ×{sweepCount}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function AppResultsPane({ variations, graph, variationField, outputs, latestRun, running, fieldCount, artifactBlob, onClearVariations, onOpen }: {
  variations: AppVariation[];
  graph: WorkflowGraph;
  variationField: string | null;
  outputs: OutputResult[];
  latestRun: StudioRun | null;
  running: boolean;
  fieldCount: number;
  artifactBlob: AppViewProps['artifactBlob'];
  onClearVariations: () => void;
  onOpen: (lightbox: Lightbox) => void;
}) {
  if (variations.length) {
    return <div className="app-result-pane"><VariationGrid variations={variations} graph={graph} field={variationField} busy={variations.some((variation) => isRunning(variation.run))} onClear={onClearVariations} artifactBlob={artifactBlob} onOpen={(runId, item, caption) => onOpen({ runId, item, caption })} /></div>;
  }
  if (outputs.some((output) => output.item)) {
    return (
      <div className="app-result-pane"><div className="app-results">
        <div className="app-results-head"><strong>Results</strong>{latestRun ? <small>run {latestRun.id.slice(0, 8)}</small> : null}</div>
        <div className="app-output-grid">
          {outputs.map((output) => <OutputCard key={output.name} output={output} runId={latestRun?.id ?? ''} artifactBlob={artifactBlob} onOpen={(item) => { if (latestRun) onOpen({ runId: latestRun.id, item, caption: output.name }); }} />)}
        </div>
      </div></div>
    );
  }
  return (
    <div className="app-result-pane"><div className="app-results-empty">
      <span className="app-empty-badge">{running ? <span className="app-spinner" /> : <Play size={22} />}</span>
      <h2>{running ? 'Working on it…' : 'Run to see results'}</h2>
      <p>{running ? 'Your fleet is generating. Outputs land here the moment they finish.' : `Fill in the ${fieldCount ? 'fields' : 'graph'} and press Run. No credits, no cap — iterate freely.`}</p>
    </div></div>
  );
}

function AppLightbox({ lightbox, artifactBlob, onClose }: { lightbox: Lightbox | null; artifactBlob: AppViewProps['artifactBlob']; onClose: () => void }) {
  if (!lightbox) return null;
  return createPortal(
    <div className="app-lightbox" role="dialog" aria-modal="true" aria-label="Result preview" onMouseDown={onClose}>
      <button className="app-lightbox-close" onClick={onClose} aria-label="Close preview"><X size={18} /></button>
      <div className="app-lightbox-body" onMouseDown={(event) => event.stopPropagation()}>
        <ArtifactMedia runId={lightbox.runId} item={lightbox.item} load={artifactBlob} large />
        <footer><strong>{lightbox.caption}</strong></footer>
      </div>
    </div>,
    window.document.body,
  );
}

export function AppView(props: AppViewProps): ReactElement {
  const {
    graph, inputs, sidecar, latestRun, running, variations, variationField, variationBusy,
    missingModels, modelRoute,
    onInputsChange, onSidecarChange, onRun, onRunVariations, onClearVariations, onShare, onEditGraph, onRunOnExecutor,
    canInstallModels, onInstallModel,
    artifactBlob, inputAssetBlob,
  } = props;

  const fields = useMemo(() => appFields(graph, sidecar), [graph, sidecar]);
  const title = appTitle(graph, sidecar);
  const tagline = appTagline(sidecar);
  const outputs = useMemo(() => outputResults(graph, latestRun), [graph, latestRun]);
  const candidates = useMemo(() => variationCandidates(graph), [graph]);
  const [showSettings, setShowSettings] = useState(false);
  const [sweepName, setSweepName] = useState<string>('');
  const [sweepCount, setSweepCount] = useState(6);
  const [lightbox, setLightbox] = useState<Lightbox | null>(null);

  useEffect(() => {
    const preferred = defaultVariationField(graph);
    setSweepName((current) => (candidates.some((candidate) => candidate.name === current) ? current : preferred?.name ?? ''));
  }, [candidates, graph]);

  const setValue = (name: string, value: JsonValue) => onInputsChange({ ...inputs, [name]: value });

  const patchApp = useCallback((mutate: (config: EditorAppConfig) => EditorAppConfig) => {
    onSidecarChange({ ...sidecar, app: mutate(sidecar.app ?? {}) });
  }, [onSidecarChange, sidecar]);

  const patchField = useCallback((name: string, patch: Partial<NonNullable<EditorAppConfig['fields']>[string]>) => {
    patchApp((config) => ({
      ...config,
      fields: { ...config.fields, [name]: { ...config.fields?.[name], ...patch } },
    }));
  }, [patchApp]);

  const moveField = useCallback((name: string, direction: -1 | 1) => {
    const ordered = appFields(graph, sidecar).map((field) => field.name);
    const index = ordered.indexOf(name);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= ordered.length) return;
    const next = [...ordered];
    next.splice(index, 1);
    next.splice(target, 0, name);
    patchApp((config) => ({
      ...config,
      fields: next.reduce<NonNullable<EditorAppConfig['fields']>>((accumulator, fieldName, position) => {
        accumulator[fieldName] = { ...config.fields?.[fieldName], order: position };
        return accumulator;
      }, { ...config.fields }),
    }));
  }, [graph, patchApp, sidecar]);

  const sweepCandidate = candidates.find((candidate) => candidate.name === sweepName) ?? null;
  const busy = running || variationBusy;
  return (
    <div className="app-view">
      <div className="app-form-pane">
        <AppHeader title={title} tagline={tagline} fieldCount={fields.length} showSettings={showSettings} onToggleSettings={() => setShowSettings((value) => !value)} onEditGraph={onEditGraph} onShare={onShare} />
        <MissingModelsBanner {...{ missingModels, modelRoute, canInstallModels, onInstallModel, onRunOnExecutor, onEditGraph }} />
        <AppSettings visible={showSettings} {...{ graph, sidecar, title, patchApp, patchField, moveField }} />
        <AppFields fields={fields} inputs={inputs} onValue={setValue} inputAssetBlob={inputAssetBlob} onEditGraph={onEditGraph} />
        <AppRunDock {...{ busy, running, candidates, sweepName, sweepCount, sweepCandidate, onRun, onRunVariations }} onSweepName={setSweepName} onSweepCount={setSweepCount} />
      </div>
      <AppResultsPane {...{ variations, graph, variationField, outputs, latestRun, running, artifactBlob, onClearVariations }} fieldCount={fields.length} onOpen={setLightbox} />
      <AppLightbox lightbox={lightbox} artifactBlob={artifactBlob} onClose={() => setLightbox(null)} />
    </div>
  );
}

interface AppFieldControlProps {
  field: AppField;
  value: JsonValue | undefined;
  onChange: (value: JsonValue) => void;
  inputAssetBlob: (path: string, contentType?: string) => Promise<Blob>;
}

function appNumberStep(field: AppField): number | 'any' {
  if (field.definition.step !== undefined) return field.definition.step;
  return field.definition.type === 'integer' ? 1 : 'any';
}

function appNumberValue(field: AppField, value: JsonValue | undefined): number {
  if (typeof value === 'number') return value;
  return Number(field.definition.default ?? field.definition.minimum ?? 0);
}

function parseAppNumber(field: AppField, text: string, rounded = false): number {
  if (field.definition.type !== 'integer') return Number(text);
  return rounded ? Math.round(Number(text)) : Number.parseInt(text, 10);
}

function AppNumberControl({ field, value, onChange }: Omit<AppFieldControlProps, 'inputAssetBlob'>) {
  const { definition } = field;
  const hasRange = definition.minimum !== undefined && definition.maximum !== undefined;
  const step = appNumberStep(field);
  return (
    <div className="app-number-row">
      {hasRange ? (
        <input type="range" min={definition.minimum} max={definition.maximum}
          step={step} value={appNumberValue(field, value)}
          onChange={(event) => onChange(parseAppNumber(field, event.target.value, true))} />
      ) : null}
      <input type="number" min={definition.minimum} max={definition.maximum}
        step={step}
        value={typeof value === 'number' ? value : ''}
        onChange={(event) => { if (event.target.value !== '') onChange(parseAppNumber(field, event.target.value)); }} />
    </div>
  );
}

function AppBooleanControl({ value, onChange }: Pick<AppFieldControlProps, 'value' | 'onChange'>) {
  return (
    <button type="button" className={`app-switch ${value ? 'on' : ''}`} role="switch" aria-checked={Boolean(value)} onClick={() => onChange(!value)}>
      <span /><small>{value ? 'On' : 'Off'}</small>
    </button>
  );
}

function AppChoiceControl({ field, value, onChange }: Omit<AppFieldControlProps, 'inputAssetBlob'>) {
  const { definition } = field;
  const selected = textValue(value, definition.values?.[0]);
  return (
    <div className="app-choice-row">
      {(definition.values ?? []).map((option) => <button type="button" key={option} className={`app-choice ${selected === option ? 'active' : ''}`} onClick={() => onChange(option)}>{option}</button>)}
    </div>
  );
}

function AppAssetControl({ value, inputAssetBlob }: Pick<AppFieldControlProps, 'value' | 'inputAssetBlob'>) {
  if (typeof value === 'string') return <AssetPreview path={value} load={inputAssetBlob} />;
  return <div className="app-asset-empty">Drop media on the canvas to fill this input.</div>;
}

function promptField(field: AppField): boolean {
  return field.definition.type === 'string' && (field.definition.multiline === true || /prompt/i.test(field.name));
}

function AppFieldControl(props: AppFieldControlProps) {
  const { field, value, onChange, inputAssetBlob } = props;
  const { definition, locked } = field;
  if (locked) return <div className="app-locked-value" title="Locked in this app">{summarizeValue(value, 96)}</div>;
  if (definition.type === 'boolean') return <AppBooleanControl value={value} onChange={onChange} />;
  if (definition.type === 'enum') return <AppChoiceControl {...props} />;
  if (definition.type === 'integer' || definition.type === 'number') return <AppNumberControl {...props} />;
  if (portTypeKey(definition.type) === 'asset') return <AppAssetControl value={value} inputAssetBlob={inputAssetBlob} />;
  if (promptField(field)) {
    const text = textValue(value);
    return (
      <div className="app-prompt">
        <textarea rows={4} value={text} placeholder="Describe what you want…" onChange={(event) => onChange(event.target.value)} />
        <small>{text.trim().length} chars</small>
      </div>
    );
  }
  return <input type="text" value={textValue(value)} onChange={(event) => onChange(event.target.value)} />;
}

function AppFieldInput(props: AppFieldControlProps) {
  const { field } = props;
  const { definition, label, locked } = field;
  const type = portTypeKey(definition.type);
  const isPrompt = promptField(field);

  return (
    <label className={`app-field t-${type} ${isPrompt ? 'is-prompt' : ''}`}>
      <div className="app-field-head">
        <span className="app-field-label">{isPrompt ? <Sparkles size={13} /> : null}{label}{definition.required ? <em>*</em> : null}</span>
        <small>{locked ? 'locked' : friendlyType(definition.type)}</small>
      </div>
      <AppFieldControl {...props} />
      {definition.description && !locked ? <small className="app-field-hint">{definition.description}</small> : null}
    </label>
  );
}

function OutputCard({ output, runId, artifactBlob, onOpen }: {
  output: OutputResult;
  runId: string;
  artifactBlob: (runId: string, path: string, contentType?: string) => Promise<Blob>;
  onOpen: (item: NodeRunPreviewItem) => void;
}) {
  const item = output.item;
  return (
    <figure className="app-output">
      <div className="app-output-media">
        {item ? <ArtifactMedia runId={runId} item={item} load={artifactBlob} onOpen={() => onOpen(item)} /> : <div className="app-media-empty"><ImageIcon size={16} /></div>}
      </div>
      <figcaption>{output.name}</figcaption>
    </figure>
  );
}

function VariationGrid({ variations, graph, field, busy, onClear, artifactBlob, onOpen }: {
  variations: AppVariation[];
  graph: WorkflowGraph;
  field: string | null;
  busy: boolean;
  onClear: () => void;
  artifactBlob: (runId: string, path: string, contentType?: string) => Promise<Blob>;
  onOpen: (runId: string, item: NodeRunPreviewItem, caption: string) => void;
}) {
  const done = variations.filter((variation) => variation.run.state === 'finished').length;
  return (
    <div className="app-results">
      <div className="app-results-head">
        <strong>Variations</strong>
        <small>{field ? `by ${field} · ` : ''}{done}/{variations.length} done{busy ? ' · running' : ''}</small>
        <button className="command-button subtle" onClick={onClear}>Clear</button>
      </div>
      <div className="app-variation-grid">
        {variations.map((variation) => {
          const [primary] = outputResults(graph, variation.run).filter((output) => output.item);
          const state = variation.run.state;
          return (
            <figure className="app-variation" key={variation.run.id}>
              <div className="app-output-media">
                {primary?.item ? (
                  <ArtifactMedia runId={variation.run.id} item={primary.item} load={artifactBlob} onOpen={() => primary.item && onOpen(variation.run.id, primary.item, variation.label)} />
                ) : state === 'failed' || state === 'cancelled' ? (
                  <div className="app-media-empty failed"><X size={16} /> {state}</div>
                ) : (
                  <div className="app-media-loading"><span /></div>
                )}
              </div>
              <figcaption title={variation.label}>{variation.label}</figcaption>
            </figure>
          );
        })}
      </div>
    </div>
  );
}
