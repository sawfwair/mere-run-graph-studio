import { useEffect, useState, type ReactElement } from 'react';
import { AlertTriangle, CheckCircle2, Circle, Clock3, Loader2, Square, XCircle } from 'lucide-react';
import { elapsedLabel, runActive, runStateLabel, type NodeExecutionState } from '../canvas-execution';
import type { StudioRun } from '../types';

export function ElapsedTime({ start, end, active }: { start?: string; end?: string; active: boolean }): ReactElement | null {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!active) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active]);
  const text = elapsedLabel(start, end, now);
  return text ? <span className="run-elapsed"><Clock3 size={11} /> {text}</span> : null;
}

export function RunStateIcon({ state }: { state: string }): ReactElement {
  if (state === 'finished') return <CheckCircle2 size={13} />;
  if (state === 'failed') return <AlertTriangle size={13} />;
  if (state === 'cancelled') return <XCircle size={13} />;
  return state === 'running' ? <Loader2 size={13} className="spin" /> : <Circle size={11} />;
}

export function NodeExecution({ execution }: { execution?: NodeExecutionState }): ReactElement | null {
  if (!execution) return null;
  const active = runActive(execution.state);
  return <section className={`node-execution execution-${execution.state}`} aria-label="Node execution">
    <div className="node-execution-heading"><span><RunStateIcon state={execution.state} />{runStateLabel(execution.state)}</span>
      <ElapsedTime start={execution.startedAt} end={execution.completedAt} active={active} />
    </div>
    {active && execution.phase ? <div className="node-execution-phase">{execution.phase.replaceAll('_', ' ')}</div> : null}
    {active && execution.fraction !== undefined ? <div className="node-progress-row">
      <progress aria-label="Reported inference progress" max={1} value={execution.fraction} />
      <span>{Math.round(execution.fraction * 100)}%</span>
    </div> : null}
    {active && execution.detail ? <small>{execution.detail}</small> : null}
  </section>;
}

function cancelRequestKey(run: StudioRun | null, error: string | null): string {
  return JSON.stringify([run?.id, run?.state, error]);
}

export function CanvasRunBar({ run, previous, error, onCancel, onReconnect, onDetails }: {
  run: StudioRun | null; previous: boolean; error: string | null;
  onCancel: () => Promise<void>; onReconnect: () => void; onDetails: () => void;
}): ReactElement | null {
  // A cancel request belongs to the run state it was made in; any new state or
  // error re-enables the button without an effect resetting it.
  const cancelKey = cancelRequestKey(run, error);
  const [cancellingKey, setCancellingKey] = useState<string | null>(null);
  const cancelling = cancellingKey === cancelKey;
  if (!run) return null;
  const active = runActive(run.state);
  return <div className={`canvas-run-bar execution-${run.state}`} role="region" aria-label="Canvas run">
    <div className="canvas-run-summary"><RunStateIcon state={run.state} /><strong>{runStateLabel(run.state)}</strong>
      <ElapsedTime start={run.created_at} end={active ? undefined : run.updated_at} active={active} />
      {previous ? <span className="previous-run-label">Previous run · inputs changed</span> : null}
    </div>
    <div className="canvas-run-actions">
      <button onClick={onDetails}>Run details</button>
      {active ? <button disabled={cancelling} onClick={() => { setCancellingKey(cancelKey); void onCancel().finally(() => setCancellingKey(null)); }}><Square size={11} />{cancelling ? 'Cancelling' : 'Cancel run'}</button> : null}
    </div>
    {error ? <div className="canvas-stream-error" role="status">{error} <button onClick={onReconnect}>Reconnect</button></div> : null}
  </div>;
}
