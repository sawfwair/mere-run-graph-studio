import { useEffect, useRef, useState, type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, Columns2, Expand, FileText, Pin, PinOff, X } from 'lucide-react';
import type { NodeRunPreview, NodeRunPreviewItem } from '../run-preview';
import type { OutputContext } from '../canvas-execution';

export type ArtifactLoader = (runId: string, path: string, contentType?: string) => Promise<Blob>;

function useArtifactUrl(preview: NodeRunPreview, item: NodeRunPreviewItem | undefined, load?: ArtifactLoader) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const path = item?.artifact?.path;
  const mime = item?.artifact?.content_type;
  useEffect(() => {
    setUrl(null); setError(false);
    if (!path || !load) return undefined;
    let live = true;
    let objectUrl: string | null = null;
    let timer: number | undefined;
    let attempts = 0;
    const request = async () => {
      try {
        const blob = await load(preview.runId, path, mime);
        if (!live) return;
        objectUrl = URL.createObjectURL(blob); setUrl(objectUrl); setError(false);
      } catch {
        if (!live) return;
        setError(true);
        if (attempts++ < 8) timer = window.setTimeout(() => void request(), 2000);
      }
    };
    void request();
    return () => { live = false; window.clearTimeout(timer); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [path, mime, load, preview.runId, preview.updatedAt, retry]);
  return { url, error, retry: () => setRetry((value) => value + 1) };
}
function ArtifactMedia({ item, url }: { item: NodeRunPreviewItem; url: string }) {
  const type = item.artifact?.content_type ?? '';
  if (type.startsWith('image/')) return <img src={url} alt={item.artifact?.name ?? 'Generated image'} />;
  if (type.startsWith('video/')) return <video src={url} controls playsInline preload="metadata" />;
  if (type.startsWith('audio/')) return <audio src={url} controls />;
  return <a className="preview-file" href={url} download={item.artifact?.name}>Download output</a>;
}
function PreviewContent({ item, url }: { item: NodeRunPreviewItem; url: string | null }) {
  if (item.value !== undefined) {
    const text = typeof item.value === 'string' ? item.value : JSON.stringify(item.value, null, 2);
    return <div className="preview-scalar-value"><FileText size={13} /><span>{text}</span></div>;
  }
  return url ? <ArtifactMedia item={item} url={url} /> : <div className="preview-file">Loading output</div>;
}
function OutputMetadata({ context, runId }: { context?: OutputContext; runId: string }) {
  return <details className="output-metadata nodrag nopan">
    <summary>Run settings</summary>
    <dl><dt>Prompt</dt><dd>{context?.prompt ?? 'Not recorded'}</dd>
      <dt>Model</dt><dd>{context?.model ?? 'Not reported'}</dd>
      <dt>Seed</dt><dd>{context?.seed ?? 'Not reported'}</dd>
      <dt>Run</dt><dd>{runId}</dd></dl>
  </details>;
}
function OutputDialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactElement }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return createPortal(<dialog className="output-comparison nodrag nopan" ref={dialog} onClose={onClose} aria-label={title}>
    <header><h2>{title}</h2><button onClick={() => dialog.current?.close()} aria-label="Close output dialog"><X size={18} /></button></header>
    {children}
  </dialog>, document.body);
}
function GalleryControls({ index, count, name, onIndex, onExpand }: {
  index: number; count: number; name: string; onIndex: (value: number) => void; onExpand?: () => void;
}) {
  return <div className="canvas-preview-bar"><small>{name}</small><span>{index + 1} / {count}</span>
    {count > 1 ? <><button onClick={() => onIndex((index - 1 + count) % count)} aria-label="Previous output"><ChevronLeft size={12} /></button>
      <button onClick={() => onIndex((index + 1) % count)} aria-label="Next output"><ChevronRight size={12} /></button></> : null}
    {onExpand ? <button onClick={onExpand} aria-label="Open generated output"><Expand size={12} /></button> : null}
  </div>;
}
function previewCaption(preview: NodeRunPreview): string {
  if (preview.previous) return 'Previous run';
  return preview.intermediate ? 'Intermediate preview' : 'Run output';
}
function CanvasRunPreview({ preview, artifactBlob, expanded = false }: { preview: NodeRunPreview; artifactBlob?: ArtifactLoader; expanded?: boolean }) {
  const [index, setIndex] = useState(0);
  const [open, setOpen] = useState(false);
  const selectedIndex = Math.min(index, preview.items.length - 1);
  const item = preview.items[selectedIndex];
  const media = useArtifactUrl(preview, item, artifactBlob);
  useEffect(() => { setIndex(0); setOpen(false); }, [preview.runId]);
  if (!item) return null;
  return <>
    <div className="output-caption">{previewCaption(preview)}</div>
    <div className={`canvas-run-preview ${item.artifact ? 'artifact' : 'scalar'}`}>
      <div className="preview-media-frame">
        <PreviewContent item={item} url={media.url} />
        {media.error ? <div className="preview-load-error">Result not available yet. <button onClick={media.retry}>Retry preview</button></div> : null}
      </div>
      <GalleryControls index={selectedIndex} count={preview.items.length} name={item.outputName ?? 'Output'} onIndex={setIndex} onExpand={expanded ? undefined : () => setOpen(true)} />
    </div>
    <OutputMetadata context={preview.context} runId={preview.runId} />
    {open ? <OutputDialog title="Generated outputs" onClose={() => setOpen(false)}><div className="expanded-output"><CanvasRunPreview preview={preview} artifactBlob={artifactBlob} expanded /></div></OutputDialog> : null}
  </>;
}
function OutputTools({ preview, pinned, onPin, onUnpin, onCompare }: {
  preview?: NodeRunPreview; pinned?: NodeRunPreview; onPin?: () => void; onUnpin?: () => void; onCompare: () => void;
}) {
  return <div className="node-output-tools">
    {preview && !preview.intermediate && preview.state === 'finished' && onPin ? <button onClick={onPin} title="Keep this output for comparison during this session"><Pin size={11} />{pinned ? 'Replace pin' : 'Pin output'}</button> : null}
    {pinned ? <><button disabled={!preview} onClick={onCompare}><Columns2 size={11} /> Compare outputs</button><button onClick={onUnpin} aria-label="Unpin output"><PinOff size={11} /></button></> : null}
  </div>;
}
function Comparison({ pinned, preview, load, onClose }: { pinned?: NodeRunPreview; preview?: NodeRunPreview; load?: ArtifactLoader; onClose: () => void }) {
  if (!pinned || !preview) return null;
  return <OutputDialog title="Compare outputs" onClose={onClose}><div className="output-comparison-grid">
    <section><h3><Pin size={14} /> Pinned output</h3><CanvasRunPreview preview={pinned} artifactBlob={load} expanded /></section>
    <section><h3>Current output</h3><CanvasRunPreview preview={preview} artifactBlob={load} expanded /></section>
  </div></OutputDialog>;
}
export function NodeOutputPanel({ preview, pinned, artifactBlob, onPin, onUnpin }: {
  preview?: NodeRunPreview; pinned?: NodeRunPreview; artifactBlob?: ArtifactLoader;
  onPin?: () => void; onUnpin?: () => void;
}): ReactElement | null {
  const [comparing, setComparing] = useState(false);
  if (!preview && !pinned) return null;
  return <div className="node-output-panel nodrag nopan nowheel">
    {preview ? <CanvasRunPreview preview={preview} artifactBlob={artifactBlob} /> : <div className="pinned-waiting"><Pin size={13} /> Pinned output saved for comparison</div>}
    <OutputTools preview={preview} pinned={pinned} onPin={onPin} onUnpin={onUnpin} onCompare={() => setComparing(true)} />
    {comparing ? <Comparison pinned={pinned} preview={preview} load={artifactBlob} onClose={() => setComparing(false)} /> : null}
  </div>;
}
