import type { CatalogEntry } from './types';

export function networkRequirement(entry?: CatalogEntry): { label: string; detail: string; state: string } {
  const access = entry?.requirements?.network_access;
  if (access === true) return { label: 'Internet required', detail: 'The provider declares network access for this node.', state: 'required' };
  if (access === false) return { label: 'Local processing', detail: 'The provider declares no network access. Install its models and dependencies before going offline.', state: 'local' };
  return { label: 'Network unspecified', detail: 'The provider has not declared its network requirement. Check preflight before relying on offline execution.', state: 'unknown' };
}
