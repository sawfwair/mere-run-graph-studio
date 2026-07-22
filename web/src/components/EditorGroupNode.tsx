import { Frame } from 'lucide-react';
import { NodeResizer, type Node, type NodeProps } from '@xyflow/react';
import type { CSSProperties, ReactElement } from 'react';

import type { EditorGroupState } from '../types';

interface EditorGroupNodeData extends Record<string, unknown> {
  name: string;
  value: EditorGroupState;
  onResize: (width: number, height: number) => void;
  onSelect: () => void;
}

export type EditorGroupFlowNode = Node<EditorGroupNodeData, 'editor-group'>;

type GroupStyle = CSSProperties & { '--group-color'?: string };

export function EditorGroupNode({ data, selected }: NodeProps<EditorGroupFlowNode>): ReactElement {
  const style: GroupStyle = { '--group-color': data.value.color };
  return (
    <section
      className={`editor-group-node ${selected ? 'selected' : ''}`}
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
        color={data.value.color ?? '#5F8F7B'}
        isVisible={selected}
        minWidth={120}
        minHeight={80}
        onResizeEnd={(_event, size) => data.onResize(size.width, size.height)}
      />
      <header><Frame size={13} /><strong>{data.value.title}</strong><small>{data.value.node_ids.length} nodes</small></header>
    </section>
  );
}
