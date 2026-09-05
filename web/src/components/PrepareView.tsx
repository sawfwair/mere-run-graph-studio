import { CloudCog, ListChecks, Server, ShieldCheck } from 'lucide-react';
import type { ReactElement } from 'react';

import type { CommandDocument, JsonObject, JsonValue } from '../types';
import { textValue } from '../ui';

interface Comparison {
  executor: string;
  document: CommandDocument<JsonValue>;
}

interface PrepareViewProps {
  executor: string;
  executors: string[];
  document: CommandDocument<JsonValue> | null;
  comparisons: Comparison[];
  busy: boolean;
  onCompare: () => void;
}

function recordsNamed(value: JsonValue, key: string, found: JsonObject[] = []): JsonObject[] {
  if (Array.isArray(value)) value.forEach((item) => recordsNamed(item, key, found));
  else if (value && typeof value === 'object') {
    Object.entries(value).forEach(([name, item]) => {
      if (name === key && Array.isArray(item)) {
        item.forEach((entry) => {
          if (entry && typeof entry === 'object' && !Array.isArray(entry)) found.push(entry);
        });
      } else recordsNamed(item, key, found);
    });
  }
  return found;
}

function summary(document: CommandDocument<JsonValue>): string {
  if (document.exit_code !== 0) return 'Blocked';
  const diagnostics = recordsNamed(document.result, 'diagnostics');
  return diagnostics.some((item) => item.severity === 'error' || item.severity === 'blocker') ? 'Blocked' : 'Ready';
}

function ReadinessBand({ document, diagnostics }: { document: CommandDocument<JsonValue> | null; diagnostics: JsonObject[] }) {
  return (
    <section className="prepare-band">
      <div className={`readiness-mark ${document && summary(document) === 'Ready' ? 'ready' : 'blocked'}`}><ShieldCheck size={20} /><span><strong>{document ? summary(document) : 'Not checked'}</strong><small>Selected executor</small></span></div>
      <div className="diagnostic-summary">
        {diagnostics.map((item, index) => <div key={index}><span className={`severity-dot ${textValue(item.severity, 'info')}`} /><span><strong>{textValue(item.title, 'Diagnostic')}</strong><small>{textValue(item.message)}</small></span></div>)}
        {!diagnostics.length ? <div className="empty-state">{document ? 'No diagnostics returned.' : <>To check workflow requirements, select <strong>Preflight</strong> in the toolbar.</>}</div> : null}
      </div>
    </section>
  );
}

function ExecutorComparison({ executor, document, comparisons }: Pick<PrepareViewProps, 'executor' | 'document' | 'comparisons'>) {
  const items = comparisons.length ? comparisons : document ? [{ executor, document }] : [];
  return (
    <section className="prepare-section">
      <div className="section-heading"><h3>Executor comparison</h3><span>{items.length} checked</span></div>
      <div className="executor-comparison">
        {items.map((item) => (
          <div className="executor-lane" key={item.executor}>
            <div><Server size={15} /><span><strong>{item.executor}</strong><small>{summary(item.document)}</small></span></div>
            <code>exit {item.document.exit_code}</code>
          </div>
        ))}
        {!document ? <div className="empty-state">Run preflight to compare readiness</div> : null}
      </div>
    </section>
  );
}

function ActionReview({ actions }: { actions: JsonObject[] }) {
  return (
    <section className="prepare-section">
      <div className="section-heading"><h3>Proposed actions</h3><span>Review only</span></div>
      <div className="action-review">
        {actions.map((action, index) => <div key={textValue(action.id, String(index))}><ListChecks size={14} /><span><strong>{textValue(action.label, textValue(action.id, 'Action'))}</strong><small>{textValue(action.disabled_reason, textValue(action.kind, 'Proposed action'))}</small></span><code>{textValue(action.kind)}</code></div>)}
        {!actions.length ? <div className="empty-state">No proposed actions</div> : null}
      </div>
    </section>
  );
}

export function PrepareView({ executor, executors, document, comparisons, busy, onCompare }: PrepareViewProps): ReactElement {
  const actions = document ? recordsNamed(document.result, 'actions') : [];
  const diagnostics = document ? recordsNamed(document.result, 'diagnostics') : [];
  return (
    <div className="prepare-view">
      <header className="prepare-header">
        <div><CloudCog size={18} /><span><h2>Prepare a run</h2><small>{executor}</small></span></div>
        <button className="command-button" disabled={busy || executors.length < 2} onClick={onCompare}><Server size={14} /> Compare executors</button>
      </header>
      <ReadinessBand document={document} diagnostics={diagnostics} />
      <ExecutorComparison executor={executor} document={document} comparisons={comparisons} />
      <ActionReview actions={actions} />
    </div>
  );
}
