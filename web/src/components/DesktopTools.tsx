import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { Download, RefreshCw, ShieldCheck } from 'lucide-react';
import { arrayValue, booleanValue, recordValue, stringValue } from '../decode';
import type { DesktopStatus, NativeRuntime } from '../runtime';
import type { JsonObject, JsonValue } from '../types';

interface Plugin { id: string; name: string; installed: boolean; verified: boolean }
type SetupRuntime = Pick<NativeRuntime, 'plugins' | 'setupPlugin' | 'verifyLocal' | 'discoverTools' | 'openRuntimeDownloads'>;

export function setupPlugins(value: JsonValue): Plugin[] {
  const root = recordValue(value, 'Plugin catalog');
  return arrayValue(root.plugins, 'Plugin catalog.plugins').map((item) => {
    const plugin = recordValue(item, 'Plugin');
    return { id: stringValue(plugin.id, 'Plugin.id'), name: stringValue(plugin.name, 'Plugin.name'),
      installed: booleanValue(plugin.installed, 'Plugin.installed'), verified: booleanValue(plugin.verified, 'Plugin.verified') };
  });
}

function PluginRows({ plugins, busy, onPlan }: { plugins: Plugin[]; busy: boolean; onPlan: (id: string) => void }) {
  return <div className="setup-plugins">{plugins.map((plugin) => <div key={plugin.id}>
    <span><strong>{plugin.name}</strong><small>{plugin.verified ? 'Installed and verified' : plugin.installed ? 'Installed; verification needed' : 'Not installed'}</small></span>
    <button className="command-button" disabled={busy || plugin.verified} onClick={() => onPlan(plugin.id)}><Download size={13} /> Review installation</button>
  </div>)}</div>;
}

export function DesktopTools({ runtime, status, onStatus }: { runtime: SetupRuntime; status: DesktopStatus; onStatus: (status: DesktopStatus) => void }): ReactElement {
  const [plugins, setPlugins] = useState<Plugin[]>([]);
  const [plan, setPlan] = useState<{ id: string; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [verification, setVerification] = useState<JsonObject | null>(null);

  const loadPlugins = useCallback(async () => {
    const document = await runtime.plugins();
    if (document.exit_code !== 0) throw Error(document.stderr || 'Could not read plugin catalog');
    setPlugins(setupPlugins(document.result));
  }, [runtime]);
  useEffect(() => {
    if (status.mere_run.available) void loadPlugins().catch((reason: unknown) => setError(String(reason)));
  }, [loadPlugins, status.mere_run.path, status.mere_run.available]);

  const action = async (label: string, operation: () => Promise<void>) => {
    setBusy(label); setError(null);
    try { await operation(); } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(null); }
  };
  const review = async (id: string) => {
    const document = await runtime.setupPlugin(id, false);
    if (document.exit_code !== 0) throw Error(document.stderr || 'Installation plan failed');
    setPlan({ id, text: document.stdout || document.stderr });
  };
  const install = async () => {
    if (!plan) return;
    const document = await runtime.setupPlugin(plan.id, true);
    if (document.exit_code !== 0) throw Error(document.stderr || document.stdout || 'Installation failed');
    setPlan(null); await loadPlugins(); onStatus(await runtime.discoverTools());
  };

  return <section className="desktop-tools" aria-label="Local execution setup">
    <div className="section-heading"><h2>Run on this computer</h2><span>No account or Relay required</span></div>
    <p>Install the official mere.run package, then find its tools. On macOS, Studio also detects the CLI inside MereRun.app. Save changed paths before installing plugins or verifying local execution.</p>
    {status.mere_run.error ? <div className="setup-error">{status.mere_run.error}</div> : null}
    <div className="setup-tool-actions">
      <button className="command-button" disabled={!!busy} onClick={() => void action('Opening downloads', async () => { await runtime.openRuntimeDownloads(); })}><Download size={14} /> Get mere.run</button>
      <button className="command-button" disabled={!!busy} onClick={() => void action('Finding tools', async () => { onStatus(await runtime.discoverTools()); })}><RefreshCw size={14} /> Find tools</button>
      <button className="command-button" disabled={!!busy || !status.mere_run.available} onClick={() => void action('Verifying local execution', async () => { setVerification(await runtime.verifyLocal()); })}><ShieldCheck size={14} /> Verify local execution</button>
    </div>
    <p>Models: open Studio, choose a model on a node, and select its download button. Studio shows the download preflight and any license terms before starting. Installed models stay on this computer.</p>
    {status.mere_run.available ? <details><summary>Optional plugins <small>{plugins.filter((plugin) => plugin.verified).length} verified</small></summary>
      <PluginRows plugins={plugins} busy={!!busy} onPlan={(id) => void action('Reviewing installation', () => review(id))} />
    </details> : null}
    {plan ? <div className="setup-install-plan"><strong>Install {plan.id}</strong><pre>{plan.text}</pre><p>This uses the runtime's official installer and needs internet access. Review its installation method above.</p>
      <div className="setup-tool-actions"><button className="command-button" disabled={!!busy} onClick={() => setPlan(null)}>Cancel</button><button className="command-button primary" disabled={!!busy} onClick={() => void action('Installing plugin', install)}>Install plugin</button></div>
    </div> : null}
    {busy ? <p role="status">{busy}…</p> : null}
    {error ? <div className="setup-error" role="alert">{error}</div> : null}
    {verification ? <div className="setup-verification" role="status"><ShieldCheck size={18} /><span><strong>Local execution verified</strong><small>Three connected nodes completed and their output matched.</small><code>{typeof verification.run_directory === 'string' ? verification.run_directory : ''}</code></span></div> : null}
  </section>;
}
