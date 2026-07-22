import { useMemo, useState, type ReactElement } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CircleAlert,
  CircleHelp,
  Command,
  Info,
} from 'lucide-react';

import type { StudioMode } from '../ui';
import type { Diagnostic } from '../types';

interface DiagnosticsDrawerProps {
  diagnostics: Diagnostic[];
  title: string;
  open: boolean;
  mode: StudioMode;
  nodeCount: number;
  edgeCount: number;
  executor: string;
  onToggle: () => void;
  onSelectNode: (nodeId: string) => void;
  onOpenHelp: () => void;
}

const icons = {
  blocker: CircleAlert,
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
};

type Filter = 'all' | Diagnostic['severity'];
const FILTERS: Filter[] = ['all', 'blocker', 'warning', 'info'];

interface DiagnosticCounts {
  blocker: number;
  warning: number;
  info: number;
}

function drawerSeverity(counts: DiagnosticCounts, diagnosticCount: number): string {
  if (counts.blocker) return 'blocker';
  if (counts.warning) return 'warning';
  return diagnosticCount ? 'success' : 'idle';
}

function filterLabel(filter: Filter, counts: DiagnosticCounts, total: number): string {
  if (filter === 'all') return `All (${total})`;
  if (filter === 'blocker') return `Blockers (${counts.blocker})`;
  if (filter === 'warning') return `Warnings (${counts.warning})`;
  return `Info (${counts.info})`;
}

function DiagnosticStatusbar({ open, title, severity, counts, mode, nodeCount, edgeCount, executor, onToggle, onFilter, onOpenHelp }: {
  open: boolean;
  title: string;
  severity: string;
  counts: DiagnosticCounts;
  mode: StudioMode;
  nodeCount: number;
  edgeCount: number;
  executor: string;
  onToggle: () => void;
  onFilter: (filter: Filter) => void;
  onOpenHelp: () => void;
}) {
  return (
    <div className="statusbar">
      <button className="statusbar-main" onClick={onToggle} aria-expanded={open} aria-label="Toggle diagnostics">
        <span className={`drawer-state ${severity}`} />
        <strong>{title}</strong>
        {open ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
      </button>
      <div className="statusbar-chips">
        {counts.blocker ? <button className="status-chip danger" onClick={() => onFilter('blocker')}><CircleAlert size={12} /> {counts.blocker}</button> : null}
        {counts.warning ? <button className="status-chip warning" onClick={() => onFilter('warning')}><AlertTriangle size={12} /> {counts.warning}</button> : null}
      </div>
      <div className="statusbar-stats">
        <span>{nodeCount} {nodeCount === 1 ? 'node' : 'nodes'}</span>
        <i />
        <span>{edgeCount} {edgeCount === 1 ? 'link' : 'links'}</span>
        {mode === 'pro' ? <><i /><span className="statusbar-executor">{executor}</span></> : null}
      </div>
      <div className="statusbar-right">
        <span className={`mode-flag ${mode}`}>{mode === 'easy' ? 'Easy mode' : 'Pro mode'}</span>
        <span className="kbd-hint" title="Command palette"><Command size={11} />K</span>
        <button className="icon-button small ghost" onClick={onOpenHelp} title="Shortcuts & tips" aria-label="Shortcuts and tips"><CircleHelp size={14} /></button>
      </div>
    </div>
  );
}

function DiagnosticList({ diagnostics, visible, filter, counts, onFilter, onSelectNode }: {
  diagnostics: Diagnostic[];
  visible: Diagnostic[];
  filter: Filter;
  counts: DiagnosticCounts;
  onFilter: (filter: Filter) => void;
  onSelectNode: (nodeId: string) => void;
}) {
  return (
    <div className="diagnostics-list">
      <div className="diagnostics-filters">
        {FILTERS.map((item) => <button key={item} className={filter === item ? 'active' : ''} onClick={() => onFilter(item)}>{filterLabel(item, counts, diagnostics.length)}</button>)}
      </div>
      {visible.map((diagnostic, index) => {
        const Icon = icons[diagnostic.severity];
        return (
          <div className={`diagnostic-row ${diagnostic.severity}`} key={`${diagnostic.title}-${index}`}>
            <Icon size={15} />
            <span className="catalog-copy"><strong>{diagnostic.title}</strong><small>{diagnostic.message}</small></span>
            {diagnostic.nodeId ? <button className="node-link" onClick={() => onSelectNode(diagnostic.nodeId!)}>{diagnostic.nodeId} <ArrowRight size={11} /></button> : null}
          </div>
        );
      })}
      {!visible.length ? <div className="empty-state">Nothing here — you’re all clear.</div> : null}
    </div>
  );
}

export function DiagnosticsDrawer({
  diagnostics,
  title,
  open,
  mode,
  nodeCount,
  edgeCount,
  executor,
  onToggle,
  onSelectNode,
  onOpenHelp,
}: DiagnosticsDrawerProps): ReactElement {
  const [filter, setFilter] = useState<Filter>('all');
  const counts = useMemo(
    () => ({
      blocker: diagnostics.filter((item) => item.severity === 'blocker').length,
      warning: diagnostics.filter((item) => item.severity === 'warning').length,
      info: diagnostics.filter((item) => item.severity === 'info' || item.severity === 'success').length,
    }),
    [diagnostics],
  );
  const severity = drawerSeverity(counts, diagnostics.length);
  const visible = filter === 'all' ? diagnostics : diagnostics.filter((item) => item.severity === filter);

  const pickFilter = (next: Filter) => {
    setFilter(next);
    if (!open) onToggle();
  };

  return (
    <section className={`diagnostics-drawer ${open ? 'open' : ''}`}>
      <DiagnosticStatusbar {...{ open, title, severity, counts, mode, nodeCount, edgeCount, executor, onToggle, onOpenHelp }} onFilter={pickFilter} />
      {open ? <DiagnosticList {...{ diagnostics, visible, filter, counts, onSelectNode }} onFilter={setFilter} /> : null}
    </section>
  );
}
