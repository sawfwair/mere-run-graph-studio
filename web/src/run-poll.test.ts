import { afterEach, describe, expect, it, vi } from 'vitest';

import { pollRun } from './runtime';
import { closeChoice } from './use-close-guard';
import type { StudioRun } from './types';

function run(state: string, stderr = ''): StudioRun {
  return {
    id: 'run-1', executor: 'local', run_directory: 'runs/run-1', state,
    created_at: '2026-11-06T00:00:00Z', updated_at: '2026-11-06T00:00:00Z',
    exit_code: null, result: null, stderr, remote_reference: null,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('pollRun', () => {
  it('reports only changed runs and slows down while nothing changes', async () => {
    vi.useFakeTimers();
    const sequence = [run('running'), run('running'), run('running'), run('running', 'step 2'), run('finished', 'step 2')];
    const calls: number[] = [];
    const inspect = () => {
      calls.push(Date.now());
      return Promise.resolve(sequence[Math.min(calls.length - 1, sequence.length - 1)] as StudioRun);
    };
    const seen: string[] = [];
    const done = pollRun(inspect, (value) => seen.push(`${value.state}:${value.stderr}`), new AbortController().signal, { fastMs: 100, slowMs: 200 });
    await vi.runAllTimersAsync();
    await done;
    expect(seen).toEqual(['running:', 'running:step 2', 'finished:step 2']);
    const gaps = calls.slice(1).map((time, index) => time - (calls[index] ?? 0));
    expect(gaps).toEqual([100, 150, 200, 100]);
  });

  it('stops without reporting once aborted', async () => {
    const controller = new AbortController();
    const seen: StudioRun[] = [];
    const done = pollRun(() => {
      controller.abort();
      return Promise.resolve(run('running'));
    }, (value) => seen.push(value), controller.signal, { fastMs: 100, slowMs: 200 });
    await done;
    expect(seen).toEqual([]);
  });
});

describe('closeChoice', () => {
  it('maps the native dialog buttons and treats anything else as cancel', () => {
    expect(closeChoice('Save')).toBe('save');
    expect(closeChoice("Don't Save")).toBe('discard');
    expect(closeChoice('Cancel')).toBe('cancel');
    expect(closeChoice('Yes')).toBe('cancel');
  });
});
