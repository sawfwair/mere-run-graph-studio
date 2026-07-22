import { describe, expect, it } from 'vitest';

import { formatBytes, pullFraction, summarizeModelPreflight } from './model-install';
import type { CommandDocument, JsonValue } from './types';

function doc(result: JsonValue | null, stderr = ''): CommandDocument {
  return { exit_code: 0, result, stdout: '', stderr };
}

describe('summarizeModelPreflight', () => {
  it('distils a native preflight envelope into a flat summary', () => {
    const envelope: JsonValue = {
      status: 'warning',
      summary: 'Ready to download image-krea2-raw.',
      result: {
        estimated_download_bytes: 260 * 1024 * 1024,
        model_store: { available_bytes: 40 * 1024 * 1024 * 1024 },
        models: [
          {
            id: 'image-krea2-raw',
            status: 'will_download',
            selected: true,
            supported: true,
            installed: false,
            estimated_download_bytes: 260 * 1024 * 1024,
            estimated_required_bytes: 520 * 1024 * 1024,
            usage_terms: ['Non-commercial research license'],
          },
        ],
      },
      diagnostics: [
        { severity: 'warning', title: 'Large download', message: 'This model is 260 MB.' },
        { severity: 'note', title: 'Companion', message: 'Pulls a companion VAE.' },
      ],
    };
    const summary = summarizeModelPreflight('image-krea2-raw', doc(envelope));
    expect(summary.status).toBe('warning');
    expect(summary.blocked).toBe(false);
    expect(summary.installed).toBe(false);
    expect(summary.downloadBytes).toBe(260 * 1024 * 1024);
    expect(summary.requiredBytes).toBe(520 * 1024 * 1024);
    expect(summary.availableBytes).toBe(40 * 1024 * 1024 * 1024);
    expect(summary.usageTerms).toEqual(['Non-commercial research license']);
    expect(summary.notes).toContain('Pulls a companion VAE.');
    expect(summary.cloud).toBe(false);
  });

  it('marks a blocked preflight and collects blockers', () => {
    const envelope: JsonValue = {
      status: 'blocked',
      result: { models: [{ id: 'video-ltx-av', supported: false, status: 'blocked_unsupported' }] },
      diagnostics: [{ severity: 'blocker', title: 'Unsupported', message: 'Requires unified memory.' }],
    };
    const summary = summarizeModelPreflight('video-ltx-av', doc(envelope));
    expect(summary.blocked).toBe(true);
    expect(summary.supported).toBe(false);
    expect(summary.blockers).toEqual(['Requires unified memory.']);
  });

  it('treats a stderr-only failure as blocking', () => {
    const summary = summarizeModelPreflight('image-missing', doc(null, 'unknown model id'));
    expect(summary.blocked).toBe(true);
    expect(summary.blockers).toEqual(['unknown model id']);
  });

  it('reads the cloud synthetic envelope', () => {
    const envelope: JsonValue = {
      status: 'ok',
      cloud: true,
      summary: 'Installs across your fleet.',
      result: { models: [{ id: 'image-krea2-raw', status: 'will_download', selected: true }] },
      diagnostics: [],
    };
    const summary = summarizeModelPreflight('image-krea2-raw', doc(envelope));
    expect(summary.cloud).toBe(true);
    expect(summary.summary).toBe('Installs across your fleet.');
    expect(summary.blocked).toBe(false);
  });
});

describe('formatBytes', () => {
  it('formats binary sizes and rejects unknowns', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(260 * 1024 * 1024)).toBe('260 MB');
    expect(formatBytes(1.5 * 1024 * 1024 * 1024)).toBe('1.5 GB');
    expect(formatBytes(null)).toBeNull();
    expect(formatBytes(-1)).toBeNull();
  });
});

describe('pullFraction', () => {
  it('prefers percent, falls back to bytes, else indeterminate', () => {
    expect(pullFraction(null, null, 45)).toBeCloseTo(0.45);
    expect(pullFraction(120, 240, null)).toBeCloseTo(0.5);
    expect(pullFraction(null, null, null)).toBeNull();
    expect(pullFraction(500, 0, null)).toBeNull();
    expect(pullFraction(null, null, 250)).toBe(1);
  });
});
