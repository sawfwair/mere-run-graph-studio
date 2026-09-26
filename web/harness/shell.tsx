import { createRoot } from 'react-dom/client';
import { ReactFlowProvider } from '@xyflow/react';

import { CloudLanding } from '../src/components/CloudLanding';
import { liveRuntime } from './live-runtime';
import { SharingRuntime } from './sharing-runtime';
import { NODE_FIXTURE } from './node-fixture';
import { Workspace } from '../src/App';
import { DesktopSetup } from '../src/components/DesktopSetup';
import { DesktopTools } from '../src/components/DesktopTools';
import type { DesktopStatus, NativeRuntime } from '../src/runtime';
import { createMockRuntime, HARNESS_PROJECT } from './mock-runtime';
import '../src/styles.css';

// Entry point for the visual harness. State is driven by URL query params so the
// screenshot script (shoot.mjs) can capture many states without editing code:
//   ?left=1        collapse the library rail
//   ?right=1       collapse the inspector rail
//   ?mode=pro      start in Pro mode (default: easy)
//   ?empty=1       start with an empty graph (default: a 2-node / 1-link graph)

const params = new URLSearchParams(window.location.search);
const set = (key: string, value: string) => { try { window.localStorage.setItem(key, value); } catch { /* private mode */ } };

set('mere-studio-mode', params.get('mode') === 'pro' ? 'pro' : 'easy');
set('mere-studio-left-collapsed', params.get('left') === '1' ? '1' : '0');
set('mere-studio-right-collapsed', params.get('right') === '1' ? '1' : '0');
set('mere-studio-canvas-focus', params.get('focus') === '0' ? '0' : '1');
if (params.get('empty') === '1') {
  try { window.localStorage.removeItem('mere.graph-studio.recovery.v1'); } catch { /* ignore */ }
} else {
  const project = structuredClone(params.has('example') ? NODE_FIXTURE : HARNESS_PROJECT);
  if (params.has('sharing')) project.graph.outputs = { image: { $ref: 'nodes.render.outputs.image' } };
  if (params.has('video-unwired')) delete project.graph.nodes[1]?.arguments.image;
  set('mere.graph-studio.recovery.v1', JSON.stringify(project));
}

const mock = createMockRuntime(params.has('example'), params.has('template'));
const timeline = params.has('live') ? liveRuntime(mock, params.get('live') === 'failed', params.get('live') === 'faults') : mock;
const runtime = params.has('sharing') ? new SharingRuntime(timeline) : timeline;
const desktopStatus: DesktopStatus = {
  app_version: '0.3.0', platform: 'macos', architecture: 'arm64',
  config_path: '/Users/creator/Library/Application Support/Mere Graph Studio/config.json',
  workspace: '/Users/creator/Graph Studio', onboarding_complete: true,
  mere_run: { path: '/Applications/MereRun.app/Contents/Helpers/mere.run', available: true, version: '0.56.0', error: null },
  workflow_tools: { path: '/Users/creator/.local/bin/mere-dataset-tools', available: true, version: '0.4.0', error: null },
};
const desktopTools: Pick<NativeRuntime, 'plugins' | 'setupPlugin' | 'verifyLocal' | 'discoverTools' | 'openRuntimeDownloads'> = {
  plugins: async () => ({ exit_code: 0, result: { plugins: [
    { id: 'mere-workflow-tools', name: 'Workflow tools', installed: true, verified: true },
    { id: 'mere-image-compose', name: 'Image compose', installed: false, verified: false },
  ] }, stdout: '', stderr: '' }),
  setupPlugin: async () => ({ exit_code: 0, result: null, stdout: 'Install signed image compose bundle after publisher and hash verification.', stderr: '' }),
  verifyLocal: async () => ({ verified: true, run_directory: '/Users/creator/Graph Studio/runs/local-verification-abc' }),
  discoverTools: async () => desktopStatus,
  openRuntimeDownloads: async () => ({ opened: true }),
};
const setupStatus: DesktopStatus = params.get('setup') === 'missing'
  ? { ...desktopStatus, onboarding_complete: false, mere_run: { path: null, available: false, version: null, error: 'Command has not been configured.' },
      workflow_tools: { path: null, available: false, version: null, error: null } }
  : desktopStatus;

createRoot(document.getElementById('root')!).render(
  <ReactFlowProvider>
    {params.has('setup') ? <DesktopSetup status={setupStatus} settings={setupStatus.onboarding_complete} saving={false} error={null} onSave={() => {}}
      tools={<DesktopTools runtime={desktopTools} status={setupStatus} onStatus={() => {}} />} />
      : params.has('landing') ? <CloudLanding /> : <Workspace runtime={runtime} />}
  </ReactFlowProvider>,
);
