import { memo, type ReactElement } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { LogOut } from 'lucide-react';

import { GRAPH_OUTPUT_HANDLE } from '../graph';
import type { GraphReference } from '../types';

export interface GraphOutputNodeData extends Record<string, unknown> {
  name: string;
  reference: GraphReference;
  onSelect: () => void;
}

export type GraphOutputFlowNode = Node<GraphOutputNodeData, 'graph-output'>;

function GraphOutputNodeView({ data, selected }: NodeProps<GraphOutputFlowNode>): ReactElement {
  return (
    <article
      className={`graph-output-node ${selected ? 'selected' : ''}`}
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
      <Handle
        type="target"
        position={Position.Left}
        id={GRAPH_OUTPUT_HANDLE}
        className="port-handle graph-output-handle"
      />
      <span className="graph-output-icon"><LogOut size={14} /></span>
      <span>
        <strong>{data.name}</strong>
        <small>{data.reference.$ref}</small>
      </span>
    </article>
  );
}

export const GraphOutputNode = memo(GraphOutputNodeView);
