import { memo, useEffect, useState } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { Braces, File, Image, Music, Type, Video } from 'lucide-react';

import { GRAPH_INPUT_HANDLE } from '../graph';
import { friendlyType, portTypeKey, summarizeValue } from '../ui';
import type { GraphInputDefinition, JsonValue } from '../types';

export interface GraphInputNodeData extends Record<string, unknown> {
  name: string;
  definition: GraphInputDefinition;
  value?: JsonValue;
  assetBlob?: (path: string, contentType?: string) => Promise<Blob>;
  onSelect?: () => void;
}

export type GraphInputFlowNode = Node<GraphInputNodeData, 'graph-input'>;

const mediaTypes: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', heic: 'image/heic',
  mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', m4v: 'video/mp4',
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/m4a', flac: 'audio/flac',
};

function mediaType(path: string): string | undefined {
  const extension = path.split('.').pop()?.toLowerCase() ?? '';
  return mediaTypes[extension];
}

function inputIcon(contentType: string | undefined, isAsset: boolean, definition: GraphInputDefinition) {
  if (contentType?.startsWith('image/')) return Image;
  if (contentType?.startsWith('video/')) return Video;
  if (contentType?.startsWith('audio/')) return Music;
  if (isAsset) return File;
  return definition.type === 'string' ? Type : Braces;
}

function InputMedia({ path, assetBlob }: { path: string; assetBlob: NonNullable<GraphInputNodeData['assetBlob']> }) {
  const [url, setUrl] = useState<string | null>(null);
  const contentType = mediaType(path);
  useEffect(() => {
    if (!contentType) return undefined;
    let live = true;
    let objectUrl: string | null = null;
    void assetBlob(path, contentType).then((blob) => {
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
  }, [assetBlob, contentType, path]);

  if (!url || !contentType) return null;
  if (contentType.startsWith('image/')) return <img src={url} alt="" />;
  if (contentType.startsWith('video/')) return <video src={url} muted playsInline />;
  if (contentType.startsWith('audio/')) return <audio src={url} controls className="nodrag nowheel" />;
  return null;
}

function GraphInputNodeView({ data, selected }: NodeProps<GraphInputFlowNode>) {
  const { name, definition, value, assetBlob, onSelect } = data;
  const isAsset = definition.type.startsWith('asset');
  const path = typeof value === 'string' ? value : null;
  const contentType = path ? mediaType(path) : undefined;
  const Icon = inputIcon(contentType, isAsset, definition);
  const filename = path?.split('/').at(-1);

  return (
    <article
      className={`graph-input-node t-${portTypeKey(definition.type)} ${selected ? 'selected' : ''}`}
      role="button"
      tabIndex={0}
      onDoubleClick={onSelect}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        onSelect?.();
      }}
    >
      <header>
        <span className="graph-input-icon"><Icon size={15} /></span>
        <span>
          <strong>{name}</strong>
          <small>Workflow input · {friendlyType(definition.type)}</small>
        </span>
      </header>
      {isAsset && path && assetBlob ? (
        <div className="graph-input-media">
          <InputMedia path={path} assetBlob={assetBlob} />
          <span title={path}>{filename}</span>
        </div>
      ) : (
        <p title={summarizeValue(value, 120)}>{value === undefined ? 'No value provided' : summarizeValue(value, 72)}</p>
      )}
      <Handle
        type="source"
        position={Position.Right}
        id={GRAPH_INPUT_HANDLE}
        className={`port-handle graph-input-handle t-${portTypeKey(definition.type)}`}
        title={`Connect ${name}`}
      />
    </article>
  );
}

export const GraphInputNode = memo(GraphInputNodeView);
