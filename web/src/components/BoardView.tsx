import { useEffect, useState, type ReactElement } from 'react';
import { Check, Download, Image as ImageIcon, Trash2, Undo2 } from 'lucide-react';
import type { EditorBoardItem } from '../types';

type ArtifactLoader = (runId: string, path: string, contentType?: string) => Promise<Blob>;

function BoardMedia({ item, artifactBlob }: { item: EditorBoardItem; artifactBlob: ArtifactLoader }): ReactElement {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    let objectUrl: string | null = null;
    setUrl(null); setFailed(false);
    void artifactBlob(item.run_id, item.path, item.content_type).then((blob) => {
      if (!live) return;
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    }).catch(() => { if (live) setFailed(true); });
    return () => { live = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [artifactBlob, item.content_type, item.path, item.run_id]);
  if (failed) return <div className="board-unavailable">This run artifact is unavailable on this executor.</div>;
  if (!url) return <div className="board-loading">Loading result…</div>;
  if (item.content_type?.startsWith('image/')) return <img src={url} alt={item.name} />;
  if (item.content_type?.startsWith('video/')) return <video src={url} controls playsInline preload="metadata" />;
  if (item.content_type?.startsWith('audio/')) return <audio src={url} controls />;
  return <a href={url} download={item.name}><Download size={15} /> Download {item.name}</a>;
}

function BoardCard({ item, selected, artifactBlob, onToggle, onRemove, onUse }: {
  item: EditorBoardItem; selected: boolean; artifactBlob: ArtifactLoader;
  onToggle: () => void; onRemove: () => void; onUse?: () => void;
}): ReactElement {
  return <article className={`board-card ${selected ? 'selected' : ''}`}>
    <div className="board-media"><BoardMedia item={item} artifactBlob={artifactBlob} /></div>
    <div className="board-card-body">
      <strong title={item.name}>{item.name}</strong>
      <dl><dt>Node</dt><dd>{item.node_id}</dd><dt>Model</dt><dd>{item.model ?? 'Not recorded'}</dd>
        <dt>Seed</dt><dd>{item.seed ?? 'Not recorded'}</dd><dt>Run</dt><dd>{item.run_id}</dd></dl>
      <div className="board-card-actions">
        <button className="command-button" onClick={onToggle} aria-pressed={selected}><Check size={13} /> {selected ? 'Selected' : 'Compare'}</button>
        {onUse ? <button className="command-button" onClick={onUse}><Undo2 size={13} /> Use as input</button> : null}
        <button className="icon-button small" onClick={onRemove} title="Remove from board" aria-label={`Remove ${item.name} from board`}><Trash2 size={13} /></button>
      </div>
    </div>
  </article>;
}

export function BoardView({ items, artifactBlob, onRemove, onUse }: {
  items: EditorBoardItem[]; artifactBlob: ArtifactLoader;
  onRemove: (id: string) => void; onUse?: (item: EditorBoardItem) => void;
}): ReactElement {
  const [selected, setSelected] = useState<string[]>([]);
  const active = selected.filter((id) => items.some((item) => item.id === id));
  const shown = active.length === 2 ? items.filter((item) => active.includes(item.id)) : items;
  const toggle = (id: string) => setSelected((current) => current.includes(id)
    ? current.filter((value) => value !== id) : [...current.slice(-1), id]);
  return <section className="board-view" aria-label="Comparison board">
    <header className="board-heading"><div><span className="workspace-eyebrow">Creative review</span><h2>Comparison board</h2>
      <p>Save completed node outputs, then select two to compare their media and run settings.</p></div>
      {active.length === 2 ? <button className="command-button" onClick={() => setSelected([])}>Show all</button> : null}</header>
    {items.length ? <div className={`board-grid ${active.length === 2 ? 'comparing' : ''}`}>
      {shown.map((item) => <BoardCard key={item.id} item={item} selected={active.includes(item.id)}
        artifactBlob={artifactBlob} onToggle={() => toggle(item.id)} onRemove={() => onRemove(item.id)}
        onUse={onUse ? () => onUse(item) : undefined} />)}
    </div> : <div className="board-empty"><ImageIcon size={28} /><strong>No saved outputs yet</strong>
      <p>Run a workflow and choose “Save to board” on a completed node output.</p></div>}
  </section>;
}
