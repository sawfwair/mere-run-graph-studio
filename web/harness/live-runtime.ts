import { jsonRecord } from '../src/canvas-execution';
import { sha256Canonical } from '../src/cloud-contract';
import type { StudioRuntime } from '../src/runtime';
import type { JsonObject, StudioRun, WorkflowGraph } from '../src/types';

// This timeline exercises canvas behavior without starting inference or contacting Relay.
export function liveRuntime(base: StudioRuntime, fail = false, faults = false): StudioRuntime {
  const runs = new Map<string, StudioRun>();
  let sequence = 0;
  let disconnect = faults;
  let rejectCancel = faults;
  const advance = (id: string, stage: number) => {
    const prior = runs.get(id);
    if (!prior || prior.state === 'cancelled') return prior;
    const now = new Date().toISOString();
    const manifest = jsonRecord(prior.manifest);
    const render = imageNode(stage, prior.created_at, now);
    const clip = videoNode(stage, fail, prior.created_at, now);
    const next: StudioRun = { ...prior, state: finalState(stage, fail), updated_at: now,
      manifest: { ...manifest, nodes: [render, clip] },
      artifacts: [publishedImage(stage)],
      events: liveEvents(stage, prior.created_at, now),
    };
    runs.set(id, next); return next;
  };
  return { ...base,
    listRuns: async () => ({ runs: [...runs.values()].reverse() }),
    startRun: async (graph: WorkflowGraph, inputs: JsonObject) => {
      const id = `live-${++sequence}`;
      const now = new Date().toISOString();
      const run: StudioRun = { id, executor: 'relay:fleet', state: 'queued', created_at: now, updated_at: now,
        exit_code: null, run_directory: '', remote_reference: id, result: null, stderr: '',
        manifest: { source_graph_fingerprint: await sha256Canonical(graph), source_input_fingerprint: await sha256Canonical(inputs), nodes: [] } };
      runs.set(id, run); return run;
    },
    inspectRun: async (id) => { const run = runs.get(id); if (!run) throw Error('Run unavailable'); return run; },
    watchRun: async (id, onRun, signal) => {
      if (disconnect) { disconnect = false; throw Error('Harness disconnection'); }
      for (let stage = 1; stage <= 3 && !signal.aborted; stage++) {
        await new Promise<void>((resolve) => {
          const finish = () => { window.clearTimeout(timer); signal.removeEventListener('abort', finish); resolve(); };
          const timer = window.setTimeout(finish, stage === 1 ? 300 : 1800);
          signal.addEventListener('abort', finish, { once: true });
        });
        if (signal.aborted) return;
        const run = advance(id, stage); if (run) onRun(run);
      }
    },
    cancelRun: async (id) => {
      if (rejectCancel) { rejectCancel = false; throw Error('Harness cancellation failure'); }
      const prior = runs.get(id); if (!prior) throw Error('Run unavailable');
      const next = { ...prior, state: 'cancelled', updated_at: new Date().toISOString() }; runs.set(id, next); return next;
    },
    artifactBlob: async (id) => new Blob([`<svg xmlns="http://www.w3.org/2000/svg" width="640" height="380"><rect width="640" height="380" fill="${id === 'live-1' ? '#284859' : '#4a355a'}"/><circle cx="470" cy="110" r="54" fill="#e9d499"/><path d="M0 340L210 90 430 340Z" fill="#789b9b"/><path d="M180 380L420 140 640 380Z" fill="#557681"/><text x="24" y="354" fill="white" font-family="sans-serif" font-size="22">Harness output ${id}</text></svg>`], { type: 'image/svg+xml' }),
  };
}

function finalState(stage: number, fail: boolean): string {
  if (stage < 3) return 'running';
  return fail ? 'failed' : 'finished';
}
function imageNode(stage: number, started: string, now: string): JsonObject {
  return { id: 'render', state: stage >= 2 ? 'finished' : 'running', started_at: started, completed_at: stage >= 2 ? now : null,
    artifacts: [publishedImage(stage)], outputs: [], models: [{ id: 'image-example' }] };
}
function videoNode(stage: number, fail: boolean, started: string, now: string): JsonObject {
  const state = stage >= 2 ? finalState(stage, fail) : 'planned';
  return { id: 'clip', state, started_at: stage >= 2 ? started : null, completed_at: stage >= 3 ? now : null,
    outputs: stage >= 3 && !fail ? [{ name: 'summary', value: 'Video render complete' }] : [] };
}
function liveEvents(stage: number, started: string, now: string): StudioRun['events'] {
  if (stage === 1) return [{ sequence: 1, type: 'node_started', node_id: 'render', state: 'running', created_at: started },
    { sequence: 2, type: 'node_progress', node_id: 'render', state: 'running', progress: { phase: 'generating', current: 7, total: 20, unit: 'steps' }, created_at: now }];
  if (stage === 2) return [{ sequence: 3, type: 'node_started', node_id: 'clip', state: 'running', created_at: now },
    { sequence: 4, type: 'node_progress', node_id: 'clip', state: 'running', progress: { phase: 'encoding' }, created_at: now }];
  return [];
}

function publishedImage(stage: number) {
  const digest = (stage >= 2 ? 'a' : 'b').repeat(64);
  return { name: `_live-render-${digest}`, path: `.relay-publications/${digest}`,
    sha256: digest, content_type: 'image/svg+xml', kind: stage >= 2 ? 'graph.node-output' : 'graph.preview' };
}
