import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { canonicalJson, sha256Canonical } from './cloud-contract';
import { jsonRecord, jsonRecords, mergeRunUpdate, nodeExecution, runActive, type RunSource, type NodeExecutionState } from './canvas-execution';
import { nodePreviews, runMatchesSource, type NodeRunPreview } from './run-preview';
import type { StudioRuntime } from './runtime';
import type { JsonObject, StudioRun, WorkflowGraph } from './types';

export interface CanvasRunController {
  runId: string | undefined; run: StudioRun | null; matchingRun: StudioRun | null; active: boolean; matches: boolean;
  previews: Record<string, NodeRunPreview>; execution: Record<string, NodeExecutionState>;
  pins: Record<string, NodeRunPreview>; pin: (id: string) => void; unpin: (id: string) => void;
  track: (run: StudioRun, source?: RunSource) => void; reset: () => void;
  cancel: () => Promise<void>; streamError: string | null; reconnect: () => void;
}
export function useCanvasRun(graph: WorkflowGraph, inputs: JsonObject, runs: StudioRun[], runtime: StudioRuntime): CanvasRunController {
  const [run, setRun] = useState<StudioRun | null>(null);
  const [source, setSource] = useState<RunSource | null>(null);
  const [pins, setPins] = useState<Record<string, NodeRunPreview>>({});
  const [streamError, setStreamError] = useState<string | null>(null);
  const [watchVersion, setWatchVersion] = useState(0);
  const [epoch, setEpoch] = useState(0);
  const generation = useRef(0);
  const graphJson = useMemo(() => canonicalJson(graph), [graph]);
  const inputsJson = useMemo(() => canonicalJson(inputs), [inputs]);
  const [hashes, setHashes] = useState({ graphJson: '', inputsJson: '', graphHash: '', inputHash: '' });
  useEffect(() => {
    let live = true;
    void Promise.all([sha256Canonical(graph), sha256Canonical(inputs)]).then(([graphHash, inputHash]) => {
      if (live) setHashes({ graphJson, inputsJson, graphHash, inputHash });
    });
    return () => { live = false; };
  }, [graph, inputs, graphJson, inputsJson]);

  useEffect(() => {
    if (run || hashes.graphJson !== graphJson || hashes.inputsJson !== inputsJson) return undefined;
    let live = true;
    const currentGeneration = generation.current;
    void (async () => {
      for (const summary of runs.slice(0, 8)) {
        try {
          const detail = await runtime.inspectRun(summary.id);
          if (!live || generation.current !== currentGeneration) return;
          if (runMatchesSource(detail, hashes.graphHash, hashes.inputHash)) {
            setRun(detail);
            return;
          }
        } catch { /* Unavailable history must not prevent authoring. */ }
      }
    })();
    return () => { live = false; };
  }, [run, hashes, graphJson, inputsJson, runs, runtime, epoch]);

  const id = run?.id;
  const active = run ? runActive(run.state) : false;
  useEffect(() => {
    if (!id || !active) return undefined;
    const controller = new AbortController();
    setStreamError(null);
    void runtime.watchRun(id, (update) => {
      if (!controller.signal.aborted) setRun((previous) => mergeRunUpdate(previous, update));
    }, controller.signal).catch(() => {
      if (!controller.signal.aborted) setStreamError('Updates disconnected. Reconnect to check the run.');
    });
    return () => controller.abort();
  }, [id, active, runtime, watchVersion]);

  const track = useCallback((next: StudioRun, captured?: RunSource) => {
    generation.current += 1;
    setSource((current) => captured ?? (next.id === id ? current : null));
    setRun(next);
    setStreamError(null);
  }, [id]);
  const reset = useCallback(() => {
    generation.current += 1;
    setRun(null); setSource(null); setPins({}); setStreamError(null); setEpoch((value) => value + 1);
  }, []);
  const matches = source ? source.graphJson === graphJson && source.inputsJson === inputsJson
    : Boolean(run && hashes.graphJson === graphJson && hashes.inputsJson === inputsJson && runMatchesSource(run, hashes.graphHash, hashes.inputHash));
  const previews = useMemo(() => {
    if (!run) return {};
    const values = nodePreviews(run);
    const manifestNodes = jsonRecords(jsonRecord(run.manifest).nodes);
    for (const [nodeId, preview] of Object.entries(values)) {
      const model = jsonRecords(manifestNodes.find((node) => node.id === nodeId)?.models)[0]?.id;
      preview.context = { ...source?.nodes[nodeId], ...(typeof model === 'string' ? { model } : {}) };
      preview.previous = !matches;
    }
    return values;
  }, [run, source, matches]);
  const execution = useMemo(() => run && matches ? nodeExecution(run, graph.nodes.map((node) => node.id)) : {}, [run, matches, graph.nodes]);
  const pin = useCallback((nodeId: string) => {
    const preview = previews[nodeId];
    if (preview && !preview.intermediate && preview.state === 'finished') setPins((current) => ({ ...current, [nodeId]: structuredClone(preview) }));
  }, [previews]);
  const unpin = useCallback((nodeId: string) => {
    setPins((current) => { const next = { ...current }; delete next[nodeId]; return next; });
  }, []);
  const cancel = useCallback(async () => {
    if (!run) return;
    try {
      const update = await runtime.cancelRun(run.id);
      setRun((current) => current?.id === update.id ? mergeRunUpdate(current, update) : current);
    } catch { setStreamError('Cancellation failed. Reconnect to check the run, then try again.'); }
  }, [run, runtime]);
  const reconnect = useCallback(() => setWatchVersion((value) => value + 1), []);
  return { runId: id, run, matchingRun: matches ? run : null, active, matches, previews, execution, pins, pin, unpin, track, reset, cancel, streamError, reconnect };
}
