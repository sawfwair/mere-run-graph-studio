import { useEffect, useMemo, useState, type ReactElement } from 'react';
import {
  Ban,
  CheckCircle2,
  Clock3,
  Download,
  ExternalLink,
  FileCode2,
  FolderOpen,
  Image,
  Play,
  RefreshCw,
  RotateCcw,
  TerminalSquare,
} from 'lucide-react';

import type { JsonObject, RunArtifact, StudioRun } from '../types';
import { textValue } from '../ui';

interface RunsViewProps {
  runs: StudioRun[];
  selected: StudioRun | null;
  onSelect: (id: string) => void;
  onRefresh: () => void;
  onCancel: (id: string) => void;
  onFetch: (id: string, allArtifacts: boolean, artifactNames: string[]) => void;
  onRetry: (id: string) => void;
  onResume: (id: string) => void;
  artifactBlob: (id: string, path: string, contentType?: string) => Promise<Blob>;
}

function eventLabel(event: NonNullable<StudioRun['events']>[number]): string {
  return String(event.message ?? event.phase ?? event.state ?? '');
}

function formatBytes(value?: number): string {
  if (value === undefined) return 'Size unavailable';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size >= 10 || unit === 0 ? size.toFixed(0) : size.toFixed(1)} ${units[unit]}`;
}

function record(value: StudioRun['manifest']): JsonObject | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function manifestNodes(run: StudioRun): JsonObject[] {
  const manifest = record(run.manifest);
  return Array.isArray(manifest?.nodes) ? manifest.nodes.filter((item): item is JsonObject => Boolean(record(item))) : [];
}

function ArtifactPreview({ run, artifact, load }: {
  run: StudioRun;
  artifact: RunArtifact;
  load: (id: string, path: string, contentType?: string) => Promise<Blob>;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    let objectUrl: string | null = null;
    void load(run.id, artifact.path, artifact.content_type).then((blob) => {
      if (!live) return;
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    }).catch((reason: unknown) => {
      if (live) setError(reason instanceof Error ? reason.message : String(reason));
    });
    return () => {
      live = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [artifact.content_type, artifact.path, load, run.id]);

  if (error) return <div className="artifact-preview-empty">{error}</div>;
  if (!url) return <div className="artifact-preview-empty">Loading preview</div>;
  if (artifact.content_type?.startsWith('image/')) return <img src={url} alt={artifact.name} />;
  if (artifact.content_type?.startsWith('video/')) return <video src={url} controls />;
  if (artifact.content_type?.startsWith('audio/')) return <audio src={url} controls />;
  return <div className="artifact-preview-empty"><FileCode2 size={18} /> Preview unavailable for this format</div>;
}

function RunList({ runs, selected, onSelect, onRefresh }: Pick<RunsViewProps, 'runs' | 'selected' | 'onSelect' | 'onRefresh'>): ReactElement {
  return <div className="run-list">
    <div className="run-list-heading">
      <strong>Runs</strong>
      <button className="icon-button small" onClick={onRefresh} title="Refresh runs" aria-label="Refresh runs"><RefreshCw size={14} /></button>
    </div>
    {runs.map((run) => (
      <button className={`run-item ${selected?.id === run.id ? 'selected' : ''}`} onClick={() => onSelect(run.id)} key={run.id}>
        <span className={`run-state ${run.state}`} />
        <span><strong>{run.executor}</strong><small>{run.id}</small></span>
        <time>{new Date(run.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>
      </button>
    ))}
    {!runs.length ? <div className="empty-state">No runs</div> : null}
  </div>;
}

function RunDetailHeader({ run, artifactNames, onCancel, onFetch, onRetry, onResume }: {
  run: StudioRun;
  artifactNames: string[];
  onCancel: RunsViewProps['onCancel'];
  onFetch: RunsViewProps['onFetch'];
  onRetry: RunsViewProps['onRetry'];
  onResume: RunsViewProps['onResume'];
}): ReactElement {
  const terminal = ['finished', 'failed', 'cancelled'].includes(run.state);
  const canResume = !run.remote_reference && ['failed', 'cancelled'].includes(run.state);
  return <header className="run-detail-header">
    <div><h2>{run.executor}</h2><code>{run.id}</code></div>
    <span className={`status-pill ${run.state}`}>{run.state}</span>
    {!terminal ? <button className="command-button danger" onClick={() => onCancel(run.id)}><Ban size={14} /> Cancel</button> : null}
    {run.remote_reference && terminal ? <button className="command-button" onClick={() => onRetry(run.id)}><RotateCcw size={14} /> Retry</button> : null}
    {canResume ? <button className="command-button" onClick={() => onResume(run.id)}><Play size={14} /> Resume</button> : null}
    {run.remote_reference ? <button className="command-button" onClick={() => onFetch(run.id, false, artifactNames)}><Download size={14} /> {artifactNames.length ? `Fetch ${artifactNames.length}` : 'Fetch outputs'}</button> : null}
  </header>;
}

function ExecutionSection({ nodes, node, run, onSelectNode }: {
  nodes: JsonObject[];
  node: JsonObject | null;
  run: StudioRun;
  onSelectNode: (id: string) => void;
}): ReactElement {
  const detail = run.node_details?.find((item) => item.id === node?.id);
  const fingerprint = node ? textValue(node.fingerprint) : '';
  return <section className="run-section">
    <div className="section-heading"><h3>Execution</h3><span>{nodes.length} nodes</span></div>
    <div className="node-strip">
      {nodes.map((item) => (
        <button key={textValue(item.id)} className={item.id === node?.id ? 'selected' : ''} onClick={() => onSelectNode(textValue(item.id))}>
          <span className={`run-state ${textValue(item.state, 'planned')}`} />
          <span><strong>{textValue(item.id)}</strong><small>{textValue(item.kind)}</small></span>
          <span className="node-attempt">{textValue(item.attempt, '0')}/{textValue(item.max_attempts, '1')}</span>
        </button>
      ))}
    </div>
    {node ? <div className="node-inspection">
      <div className="node-summary">
        <span><CheckCircle2 size={14} /> {textValue(node.state, 'planned')}</span>
        <span>Attempt {textValue(node.attempt, '0')}</span>
        {fingerprint ? <code title={fingerprint}>{fingerprint.slice(0, 12)}</code> : null}
      </div>
      {detail?.stdout || detail?.stderr ? <pre>{[detail.stdout, detail.stderr].filter(Boolean).join('\n')}</pre> : <div className="empty-state">No node log output</div>}
    </div> : null}
  </section>;
}

function ArtifactsSection({ run, selectedNames, preview, onToggle, onPreview, onFetch, artifactBlob }: {
  run: StudioRun;
  selectedNames: string[];
  preview: RunArtifact | null;
  onToggle: (name: string) => void;
  onPreview: (artifact: RunArtifact) => void;
  onFetch: RunsViewProps['onFetch'];
  artifactBlob: RunsViewProps['artifactBlob'];
}): ReactElement {
  const artifacts = run.artifacts ?? [];
  return <section className="run-section">
    <div className="section-heading">
      <h3>Artifacts</h3>
      {run.remote_reference ? <button className="text-button" onClick={() => onFetch(run.id, true, [])}>Fetch all artifacts</button> : null}
    </div>
    <div className="artifact-workspace">
      <div className="artifact-list">
        {artifacts.map((artifact) => (
          <div className="artifact-row" key={`${artifact.name}-${artifact.path}`}>
            {run.remote_reference ? <input type="checkbox" aria-label={`Select ${artifact.name}`} checked={selectedNames.includes(artifact.name)} onChange={() => onToggle(artifact.name)} /> : <span className="artifact-select-spacer" />}
            <Image size={14} />
            <button className="artifact-name" onClick={() => onPreview(artifact)}><strong>{artifact.name}</strong><small>{artifact.path}</small></button>
            <span>{formatBytes(artifact.size_bytes)}</span>
            <code title={artifact.sha256}>{artifact.sha256?.slice(0, 10) ?? 'no hash'}</code>
          </div>
        ))}
        {!artifacts.length ? <div className="empty-state">No declared artifacts</div> : null}
      </div>
      <div className="artifact-preview">
        {preview ? <ArtifactPreview run={run} artifact={preview} load={artifactBlob} /> : <div className="artifact-preview-empty"><Image size={18} /> Select an artifact</div>}
      </div>
    </div>
  </section>;
}

function RunLowerGrid({ run }: { run: StudioRun }): ReactElement {
  const events = run.events ?? [];
  const history = run.history ?? [];
  return <div className="run-lower-grid">
    <section className="run-section">
      <h3>Timeline</h3>
      <div className="event-list">
        {events.map((event, index) => (
          <div className="event-row" key={`${String(event.sequence ?? index)}-${String(event.type ?? '')}`}>
            <span>#{String(event.sequence ?? index)}</span><strong>{String(event.type ?? '')}</strong><span>{eventLabel(event)}</span>
          </div>
        ))}
        {!events.length ? <div className="empty-state">No events</div> : null}
      </div>
    </section>
    <section className="run-section">
      <h3>Operations</h3>
      <div className="history-list">
        {history.map((item, index) => (
          <div key={`${item.created_at}-${index}`}><TerminalSquare size={13} /><span><strong>{item.message}</strong><small>{new Date(item.created_at).toLocaleString()}</small></span></div>
        ))}
        {!history.length ? <div className="empty-state">No operation receipts</div> : null}
      </div>
    </section>
  </div>;
}

function RunDetail({ run, onCancel, onFetch, onRetry, onResume, artifactBlob }: {
  run: StudioRun;
  onCancel: RunsViewProps['onCancel'];
  onFetch: RunsViewProps['onFetch'];
  onRetry: RunsViewProps['onRetry'];
  onResume: RunsViewProps['onResume'];
  artifactBlob: RunsViewProps['artifactBlob'];
}): ReactElement {
  const [artifactNames, setArtifactNames] = useState<string[]>([]);
  const [preview, setPreview] = useState<RunArtifact | null>(null);
  const [nodeId, setNodeId] = useState<string | null>(null);
  const nodes = useMemo(() => manifestNodes(run), [run]);
  const node = nodes.find((item) => item.id === nodeId) ?? nodes[0] ?? null;
  const manifestError = record(run.manifest)?.error;
  const toggleArtifact = (name: string) => setArtifactNames((current) => (
    current.includes(name) ? current.filter((item) => item !== name) : [...current, name]
  ));
  return <>
    <RunDetailHeader run={run} artifactNames={artifactNames} onCancel={onCancel} onFetch={onFetch} onRetry={onRetry} onResume={onResume} />
    <div className="run-facts">
      <div><FolderOpen size={14} /><span><small>Run directory</small><code>{run.run_directory}</code></span></div>
      <div><Clock3 size={14} /><span><small>Updated</small><time>{new Date(run.updated_at).toLocaleString()}</time></span></div>
      {run.remote_reference ? <div><ExternalLink size={14} /><span><small>Remote reference</small><code>{run.remote_reference}</code></span></div> : null}
    </div>
    {run.stderr || typeof manifestError === 'string' ? <div className="run-error"><TerminalSquare size={14} /><pre>{[textValue(manifestError), run.stderr].filter(Boolean).join('\n')}</pre></div> : null}
    <ExecutionSection nodes={nodes} node={node} run={run} onSelectNode={setNodeId} />
    <ArtifactsSection run={run} selectedNames={artifactNames} preview={preview} onToggle={toggleArtifact} onPreview={setPreview} onFetch={onFetch} artifactBlob={artifactBlob} />
    <RunLowerGrid run={run} />
  </>;
}

export function RunsView({ runs, selected, onSelect, onRefresh, ...detailProps }: RunsViewProps): ReactElement {
  return (
    <div className="runs-view">
      <RunList runs={runs} selected={selected} onSelect={onSelect} onRefresh={onRefresh} />
      <div className="run-detail">
        {selected ? <RunDetail key={selected.id} run={selected} {...detailProps} /> : <div className="empty-state">No run selected</div>}
      </div>
    </div>
  );
}
