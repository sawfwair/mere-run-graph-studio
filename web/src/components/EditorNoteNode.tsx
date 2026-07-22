import { StickyNote } from 'lucide-react';
import { NodeResizer, type Node, type NodeProps } from '@xyflow/react';
import type { CSSProperties, ReactElement } from 'react';

import type { EditorNoteState } from '../types';

interface EditorNoteNodeData extends Record<string, unknown> {
  name: string;
  value: EditorNoteState;
  onResize: (width: number, height: number) => void;
  onSelect: () => void;
}

export type EditorNoteFlowNode = Node<EditorNoteNodeData, 'editor-note'>;

type NoteStyle = CSSProperties & { '--note-color'?: string };

export function EditorNoteNode({ data, selected }: NodeProps<EditorNoteFlowNode>): ReactElement {
  const style: NoteStyle = { '--note-color': data.value.color };
  return (
    <article
      className={`editor-note-node ${selected ? 'selected' : ''}`}
      style={style}
      role="button"
      tabIndex={0}
      onClick={(event) => {
        event.stopPropagation();
        data.onSelect();
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        event.stopPropagation();
        data.onSelect();
      }}
    >
      <NodeResizer
        color={data.value.color ?? '#D4A54E'}
        isVisible={selected}
        minWidth={120}
        minHeight={80}
        onResizeEnd={(_event, size) => data.onResize(size.width, size.height)}
      />
      <header><StickyNote size={13} /><strong>Note</strong></header>
      <p>{data.value.text}</p>
    </article>
  );
}
