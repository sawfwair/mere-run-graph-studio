import { describe, expect, it } from 'vitest';

import { nodePreviews, runMatchesSource } from './run-preview';
import type { StudioRun } from './types';

const run: StudioRun = {
  id: 'run-1',
  executor: 'local',
  run_directory: '/tmp/run-1',
  state: 'finished',
  created_at: '2026-07-19T12:00:00Z',
  updated_at: '2026-07-19T12:01:00Z',
  exit_code: 0,
  result: null,
  stderr: '',
  remote_reference: null,
  manifest: {
    source_graph_fingerprint: 'graph-source',
    source_input_fingerprint: 'input-source',
    nodes: [
      {
        id: 'prompt',
        state: 'finished',
        outputs: [{ name: 'text', type: 'string', value: 'A luminous garden' }],
      },
      {
        id: 'image',
        state: 'finished',
        outputs: [{
          name: 'image',
          type: 'asset',
          path: 'nodes/02-image/image.png',
          content_type: 'image/png',
          size_bytes: 42,
          sha256: 'abc',
        }],
      },
      {
        id: 'gallery',
        state: 'finished',
        outputs: [
          { name: 'first', path: 'nodes/03-gallery/first.png', content_type: 'image/png' },
          { name: 'second', path: 'nodes/03-gallery/second.png', content_type: 'image/png' },
        ],
        artifacts: [
          { name: 'first-copy', path: 'nodes/03-gallery/first.png', content_type: 'image/png' },
          { name: 'contact-sheet', path: 'nodes/03-gallery/contact.jpg', content_type: 'image/jpeg' },
        ],
      },
      { id: 'failed', state: 'failed', outputs: [] },
    ],
  },
};

describe('run-correlated canvas previews', () => {
  it('requires both source fingerprints so edited graphs never show stale results', () => {
    expect(runMatchesSource(run, 'graph-source', 'input-source')).toBe(true);
    expect(runMatchesSource(run, 'edited-graph', 'input-source')).toBe(false);
    expect(runMatchesSource(run, 'graph-source', 'edited-inputs')).toBe(false);
  });

  it('extracts scalar and artifact output previews per finished node', () => {
    expect(nodePreviews(run)).toEqual({
      prompt: {
        runId: 'run-1',
        state: 'finished',
        items: [{
          outputName: 'text',
          value: 'A luminous garden',
        }],
      },
      image: {
        runId: 'run-1',
        state: 'finished',
        items: [{
          outputName: 'image',
          artifact: {
            name: 'image',
            kind: 'file',
            path: 'nodes/02-image/image.png',
            content_type: 'image/png',
            size_bytes: 42,
            sha256: 'abc',
          },
        }],
      },
      gallery: {
        runId: 'run-1',
        state: 'finished',
        items: [
          {
            outputName: 'first',
            artifact: {
              name: 'first',
              kind: 'file',
              path: 'nodes/03-gallery/first.png',
              content_type: 'image/png',
              size_bytes: undefined,
              sha256: undefined,
            },
          },
          {
            outputName: 'second',
            artifact: {
              name: 'second',
              kind: 'file',
              path: 'nodes/03-gallery/second.png',
              content_type: 'image/png',
              size_bytes: undefined,
              sha256: undefined,
            },
          },
          {
            outputName: 'contact-sheet',
            artifact: {
              name: 'contact-sheet',
              kind: 'file',
              path: 'nodes/03-gallery/contact.jpg',
              content_type: 'image/jpeg',
              size_bytes: undefined,
              sha256: undefined,
            },
          },
        ],
      },
    });
  });
});
