import { describe, expect, it } from 'vitest';
import { decodeCatalogEntry } from './decode';
import { networkRequirement } from './network';

describe('provider network declarations', () => {
  it('preserves explicit false and does not certify missing declarations', () => {
    const node = { kind: 'example', title: 'Example', inputs: [], outputs: [], requirements: { network_access: false } };
    expect(networkRequirement(decodeCatalogEntry(node, 'node')).state).toBe('local');
    expect(networkRequirement(decodeCatalogEntry({ ...node, requirements: { network_access: true } }, 'node')).state).toBe('required');
    expect(networkRequirement(decodeCatalogEntry({ ...node, requirements: {} }, 'node')).state).toBe('unknown');
    expect(() => decodeCatalogEntry({ ...node, requirements: { network_access: 'false' } }, 'node')).toThrow('network_access');
  });
});
