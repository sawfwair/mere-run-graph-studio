import { useEffect, useState, type ReactElement } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { CheckCircle2, FolderOpen, HardDrive, Network, TerminalSquare, X } from 'lucide-react';

import type { DesktopConfiguration, DesktopStatus } from '../runtime';

interface DesktopSetupProps {
  status: DesktopStatus;
  settings?: boolean;
  saving: boolean;
  error: string | null;
  onSave: (configuration: DesktopConfiguration) => void;
  onCancel?: () => void;
}

function SetupHeading({ status, settings, onCancel }: Pick<DesktopSetupProps, 'status' | 'settings' | 'onCancel'>) {
  return (
    <div className="setup-heading">
      <span className="setup-mark"><Network size={28} /></span>
      <div>
        <span className="setup-eyebrow">Mere Graph Studio {status.app_version}</span>
        <h1 id="setup-title">{settings ? 'Desktop settings' : 'Set up Graph Studio'}</h1>
        <p>{settings ? 'Choose a workspace folder and the command-line tools that Graph Studio uses.' : `Graph Studio runs on ${status.platform} ${status.architecture}. Your workspace stores workflows and run records on this computer.`}</p>
      </div>
      {onCancel ? <button className="icon-button setup-close" onClick={onCancel} title="Close settings" aria-label="Close settings"><X size={16} /></button> : null}
    </div>
  );
}

function CommandPathField({ title, description, path, placeholder, available, configuredPath, version, optional, onPath, onChoose }: {
  title: string;
  description: string;
  path: string;
  placeholder: string;
  available: boolean;
  configuredPath?: string | null;
  version?: string | null;
  optional?: boolean;
  onPath: (path: string) => void;
  onChoose: () => void;
}) {
  const valid = available && path === configuredPath;
  return (
    <label className={`setup-field ${optional ? 'optional' : ''}`}>
      <span><TerminalSquare size={16} /><strong>{title}</strong><small>{description}</small></span>
      <div><input value={path} onChange={(event) => onPath(event.target.value)} placeholder={placeholder} /><button onClick={onChoose} type="button"><FolderOpen size={15} /> Choose</button></div>
      {valid ? <em className="setup-valid"><CheckCircle2 size={13} /> {version}</em> : null}
    </label>
  );
}

function submitLabel(saving: boolean, settings: boolean): string {
  if (saving) return 'Checking configuration';
  return settings ? 'Save settings' : 'Open Graph Studio';
}

function SetupFooter({ saving, settings, workspace, mereRun, onSubmit }: {
  saving: boolean;
  settings: boolean;
  workspace: string;
  mereRun: string;
  onSubmit: () => void;
}) {
  return (
    <footer className="setup-footer">
      <div><strong>Local workspace</strong><small>Graph Studio uses the mere.run command-line tools. Workflows store secret reference names, not secret values.</small></div>
      <button className="command-button primary setup-continue" disabled={saving || !workspace.trim() || !mereRun.trim()} onClick={onSubmit}>
        {submitLabel(saving, settings)}
      </button>
    </footer>
  );
}

export function DesktopSetup({ status, settings = false, saving, error, onSave, onCancel }: DesktopSetupProps): ReactElement {
  const [workspace, setWorkspace] = useState(status.workspace);
  const [mereRun, setMereRun] = useState(status.mere_run.path ?? '');
  const [workflowTools, setWorkflowTools] = useState(status.workflow_tools.path ?? '');

  useEffect(() => {
    setWorkspace(status.workspace);
    setMereRun(status.mere_run.path ?? '');
    setWorkflowTools(status.workflow_tools.path ?? '');
  }, [status]);

  const chooseWorkspace = async () => {
    const selected = await open({ directory: true, multiple: false, title: 'Choose a Graph Studio workspace' });
    if (typeof selected === 'string') setWorkspace(selected);
  };

  const chooseCommand = async (title: string, update: (path: string) => void) => {
    const selected = await open({ directory: false, multiple: false, title });
    if (typeof selected === 'string') update(selected);
  };

  const submit = () => onSave({
    workspace: workspace.trim(),
    mere_run_command: mereRun.trim(),
    workflow_tools_command: workflowTools.trim(),
    onboarding_complete: true,
  });

  return (
    <main className="desktop-setup">
      <section className="setup-card" aria-labelledby="setup-title">
        <SetupHeading status={status} settings={settings} onCancel={onCancel} />

        <div className="setup-grid">
          <label className="setup-field">
            <span><HardDrive size={16} /><strong>Workspace</strong><small>Projects, editor settings, and run records</small></span>
            <div><input value={workspace} onChange={(event) => setWorkspace(event.target.value)} /><button onClick={() => void chooseWorkspace()} type="button"><FolderOpen size={15} /> Choose</button></div>
          </label>
          <CommandPathField title="mere.run" description="Required to validate and run workflows" path={mereRun} placeholder="Select the mere.run executable" available={status.mere_run.available} configuredPath={status.mere_run.path} version={status.mere_run.version} onPath={setMereRun} onChoose={() => void chooseCommand('Choose the mere.run executable', setMereRun)} />
          <CommandPathField title="Workflow tools" description="Optional support for templates, programs, and ComfyUI import" path={workflowTools} placeholder="Optional mere-dataset-tools executable" available={status.workflow_tools.available} configuredPath={status.workflow_tools.path} version={status.workflow_tools.version} optional onPath={setWorkflowTools} onChoose={() => void chooseCommand('Choose workflow tools', setWorkflowTools)} />
        </div>

        {error ? <div className="setup-error" role="alert">{error}</div> : null}

        <SetupFooter saving={saving} settings={settings} workspace={workspace} mereRun={mereRun} onSubmit={submit} />
      </section>
    </main>
  );
}
