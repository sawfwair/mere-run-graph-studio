import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, CheckCircle2, Cpu, Download, FileText, HardDrive, Loader2, ShieldAlert, X } from 'lucide-react';

import { formatBytes, pullFraction, summarizeModelPreflight, type ModelPreflightSummary } from '../model-install';
import type { CommandDocument, ModelPull } from '../types';

export interface ModelInstallSheetProps {
  model: string;
  scope: 'local' | 'cloud';
  /** Preflight document, or null while it is still loading. */
  preflight: CommandDocument | null;
  preflightError: string | null;
  /** Live pull record once install has started, else null. */
  pull: ModelPull | null;
  /** True while the start request is in flight. */
  starting: boolean;
  onConfirm: (options: { acceptLicense: boolean; allowUnsupported: boolean }) => void;
  onClose: () => void;
}

const ACTIVE_STATES = new Set(['preparing', 'downloading', 'installing']);

interface InstallChoice {
  acceptLicense: boolean;
  allowUnsupported: boolean;
}

function ProgressIcon({ done, failed }: { done: boolean; failed: boolean }): ReactElement {
  if (done) return <CheckCircle2 size={16} />;
  if (failed) return <AlertTriangle size={16} />;
  return <Loader2 size={16} className="spin" />;
}

function progressTitle(pull: ModelPull): string {
  if (pull.state === 'installed') return 'Installed';
  if (pull.state === 'failed') return 'Install failed';
  return pull.state === 'installing' ? 'Finishing install…' : 'Downloading…';
}

function ProgressBar({ fraction, visible }: { fraction: number | null; visible: boolean }): ReactElement | null {
  if (!visible) return null;
  return <div className={`model-install-bar ${fraction === null ? 'indeterminate' : ''}`}>
    <span style={fraction === null ? undefined : { width: `${Math.max(3, fraction * 100)}%` }} />
  </div>;
}

function ProgressDetail({ pull, visible }: { pull: ModelPull; visible: boolean }): ReactElement | null {
  if (pull.total_bytes && pull.received_bytes !== null && visible) {
    return <span className="model-install-detail">
      {formatBytes(pull.received_bytes)} / {formatBytes(pull.total_bytes)}
    </span>;
  }
  return pull.detail ? <span className="model-install-detail" title={pull.detail}>{pull.detail}</span> : null;
}

function InstallProgress({ pull }: { pull: ModelPull }): ReactElement {
  const done = pull.state === 'installed';
  const failed = pull.state === 'failed';
  const fraction = pullFraction(pull.received_bytes, pull.total_bytes, pull.percent);
  const percentLabel = fraction === null ? null : `${Math.round(fraction * 100)}%`;
  const showProgress = !done && !failed;
  return (
    <div className={`model-install-progress ${pull.state}`}>
      <div className="model-install-progress-head">
        <span className="model-install-progress-icon"><ProgressIcon done={done} failed={failed} /></span>
        <strong>{progressTitle(pull)}</strong>
        {percentLabel && showProgress ? <span className="model-install-pct">{percentLabel}</span> : null}
      </div>
      <ProgressBar fraction={fraction} visible={showProgress} />
      <ProgressDetail pull={pull} visible={showProgress} />
    </div>
  );
}

function PreflightSummary({ summary, choice, onChoice }: {
  summary: ModelPreflightSummary;
  choice: InstallChoice;
  onChoice: (choice: InstallChoice) => void;
}): ReactElement {
  return (
    <div className="model-install-body">
      {summary.summary ? <p className="model-install-summary">{summary.summary}</p> : null}
      {summary.installed ? <p className="model-install-summary"><CheckCircle2 size={14} /> Already installed.</p> : null}
      <div className="model-install-facts">
        {summary.downloadBytes !== null ? <span className="model-install-fact"><Download size={13} /> {formatBytes(summary.downloadBytes)} download</span> : null}
        {summary.availableBytes !== null ? <span className="model-install-fact"><HardDrive size={13} /> {formatBytes(summary.availableBytes)} free</span> : null}
      </div>
      {summary.blockers.map((blocker) => (
        <p className="model-install-blocker" key={blocker}><AlertTriangle size={14} /> {blocker}</p>
      ))}
      {summary.notes.map((note) => <p className="model-install-note" key={note}>{note}</p>)}
      {summary.usageTerms.length ? (
        <label className="model-install-check">
          <input
            type="checkbox"
            checked={choice.acceptLicense}
            onChange={(event) => onChoice({ ...choice, acceptLicense: event.target.checked })}
          />
          <span><FileText size={13} /> I accept the model’s usage terms: {summary.usageTerms.join('; ')}</span>
        </label>
      ) : null}
      {!summary.supported ? (
        <label className="model-install-check">
          <input
            type="checkbox"
            checked={choice.allowUnsupported}
            onChange={(event) => onChoice({ ...choice, allowUnsupported: event.target.checked })}
          />
          <span><ShieldAlert size={13} /> This model isn’t verified for this hardware — install anyway.</span>
        </label>
      ) : null}
    </div>
  );
}

function InstallBody({ model, pull, preflightError, summary, choice, onChoice }: {
  model: string;
  pull: ModelPull | null;
  preflightError: string | null;
  summary: ModelPreflightSummary | null;
  choice: InstallChoice;
  onChoice: (choice: InstallChoice) => void;
}): ReactElement {
  if (pull) return <InstallProgress pull={pull} />;
  if (preflightError) return <div className="model-install-body"><p className="model-install-blocker"><AlertTriangle size={14} /> {preflightError}</p></div>;
  if (!summary) return <div className="model-install-body loading"><Loader2 size={18} className="spin" /> <span>Inspecting {model}…</span></div>;
  return <PreflightSummary summary={summary} choice={choice} onChoice={onChoice} />;
}

function confirmTitle(model: string, termsUnmet: boolean, hardBlocked: boolean): string {
  if (termsUnmet) return 'Accept the usage terms first';
  if (hardBlocked) return 'Resolve the blocker first';
  return `Install ${model}`;
}

function InstallActions({ model, pull, installing, starting, disabled, termsUnmet, hardBlocked, choice, onConfirm, onClose }: {
  model: string;
  pull: ModelPull | null;
  installing: boolean;
  starting: boolean;
  disabled: boolean;
  termsUnmet: boolean;
  hardBlocked: boolean;
  choice: InstallChoice;
  onConfirm: (choice: InstallChoice) => void;
  onClose: () => void;
}): ReactElement {
  const done = pull?.state === 'installed';
  const failed = pull?.state === 'failed';
  if (done || failed) {
    return <footer className="model-install-actions">
      {failed ? <button className="command-button subtle" onClick={() => onConfirm(choice)}>Try again</button> : null}
      <button className="command-button" onClick={onClose}>Done</button>
    </footer>;
  }
  if (installing) return <footer className="model-install-actions"><span className="model-install-hint">Installing in the background — you can keep working.</span></footer>;
  return <footer className="model-install-actions">
    <button className="command-button subtle" onClick={onClose} disabled={starting}>Cancel</button>
    <button
      className="command-button"
      onClick={() => onConfirm(choice)}
      disabled={disabled}
      title={confirmTitle(model, termsUnmet, hardBlocked)}
    >
      {starting ? <Loader2 size={13} className="spin" /> : <Download size={13} />} Install
    </button>
  </footer>;
}

function installDisabled(
  starting: boolean,
  summary: ModelPreflightSummary | null,
  termsUnmet: boolean,
  unsupportedBlocked: boolean,
  hardBlocked: boolean,
): boolean {
  return starting || !summary || termsUnmet || unsupportedBlocked || hardBlocked;
}

function installGuards(summary: ModelPreflightSummary | null, choice: InstallChoice, starting: boolean) {
  const termsUnmet = Boolean(summary?.usageTerms.length) && !choice.acceptLicense;
  const unsupportedBlocked = Boolean(summary && !summary.supported && !choice.allowUnsupported);
  const hardBlocked = Boolean(summary && summary.blocked && !choice.allowUnsupported);
  return {
    termsUnmet,
    hardBlocked,
    disabled: installDisabled(starting, summary, termsUnmet, unsupportedBlocked, hardBlocked),
  };
}

export function ModelInstallSheet(props: ModelInstallSheetProps): ReactElement {
  const { model, scope, preflight, preflightError, pull, starting, onConfirm, onClose } = props;
  const summary = useMemo(
    () => (preflight ? summarizeModelPreflight(model, preflight) : null),
    [model, preflight],
  );
  const [acceptLicense, setAcceptLicense] = useState(false);
  const [allowUnsupported, setAllowUnsupported] = useState(false);

  const installing = pull !== null && ACTIVE_STATES.has(pull.state);
  const closable = !installing;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && closable) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [closable, onClose]);

  const choice = { acceptLicense, allowUnsupported };
  const guards = installGuards(summary, choice, starting);
  const setChoice = (next: InstallChoice) => {
    setAcceptLicense(next.acceptLicense);
    setAllowUnsupported(next.allowUnsupported);
  };

  return createPortal(
    <div
      className="model-install-scrim"
      role="dialog"
      aria-modal="true"
      aria-label={`Install ${model}`}
      onMouseDown={() => { if (closable) onClose(); }}
    >
      <div className="model-install-sheet" onMouseDown={(event) => event.stopPropagation()}>
        <header className="model-install-head">
          <span className="model-install-badge"><Cpu size={16} /></span>
          <div className="model-install-title">
            <strong>{model}</strong>
            <small>{scope === 'cloud' ? 'Install on your fleet' : 'Install on this machine'}</small>
          </div>
          {closable ? (
            <button className="icon-button small" onClick={onClose} aria-label="Close"><X size={16} /></button>
          ) : null}
        </header>

        <InstallBody
          model={model}
          pull={pull}
          preflightError={preflightError}
          summary={summary}
          choice={choice}
          onChoice={setChoice}
        />
        <InstallActions
          model={model}
          pull={pull}
          installing={installing}
          starting={starting}
          disabled={guards.disabled}
          termsUnmet={guards.termsUnmet}
          hardBlocked={guards.hardBlocked}
          choice={choice}
          onConfirm={onConfirm}
          onClose={onClose}
        />
      </div>
    </div>,
    document.body,
  );
}
