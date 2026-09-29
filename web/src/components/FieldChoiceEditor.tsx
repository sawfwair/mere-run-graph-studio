import type { ReactElement } from 'react';

import type { CatalogField, JsonValue } from '../types';
import { friendlyLabel } from '../ui';
import { FiniteSelect } from './FiniteSelect';

export function FieldChoiceEditor({ field, choices, value, onChange, className, label }: {
  field: CatalogField;
  choices: (string | number)[];
  value: JsonValue | undefined;
  onChange: (value: JsonValue | undefined) => void;
  className?: string;
  label?: string;
}): ReactElement {
  const current = typeof value === 'string' || typeof value === 'number' ? value : undefined;
  return <FiniteSelect choices={choices} value={current} onChange={onChange} className={className}
    ariaLabel={label ?? friendlyLabel(field.name)} emptyLabel={field.required ? 'Choose an option' : 'Use default'} />;
}
