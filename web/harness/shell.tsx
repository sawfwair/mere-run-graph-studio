import { createRoot } from 'react-dom/client';
import { ReactFlowProvider } from '@xyflow/react';

import { Workspace } from '../src/App';
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
if (params.get('empty') === '1') {
  try { window.localStorage.removeItem('mere.graph-studio.recovery.v1'); } catch { /* ignore */ }
} else {
  set('mere.graph-studio.recovery.v1', JSON.stringify(HARNESS_PROJECT));
}

createRoot(document.getElementById('root')!).render(
  <ReactFlowProvider>
    <Workspace runtime={createMockRuntime()} />
  </ReactFlowProvider>,
);
