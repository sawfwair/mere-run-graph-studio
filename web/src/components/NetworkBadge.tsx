import type { CatalogEntry } from '../types';
import type { ReactElement } from 'react';
import { networkRequirement } from '../network';

export function NetworkBadge({ entry }: { entry?: CatalogEntry }): ReactElement {
  const requirement = networkRequirement(entry);
  return <small className={`network-badge ${requirement.state}`} title={requirement.detail}>{requirement.label}</small>;
}
