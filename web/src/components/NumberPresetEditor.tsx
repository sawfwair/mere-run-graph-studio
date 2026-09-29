import { useState, type ReactElement } from 'react';

import type { CatalogField, JsonValue } from '../types';
import { friendlyLabel } from '../ui';

export function NumberPresetEditor({ field, presets, value, onChange, className }: {
  field: CatalogField;
  presets: number[];
  value: JsonValue | undefined;
  onChange: (value: number | undefined) => void;
  className?: string;
}): ReactElement {
  const [custom, setCustom] = useState(false);
  const label = friendlyLabel(field.name);
  const numeric = typeof value === 'number' ? value : undefined;
  const isCustom = custom || (numeric !== undefined && !presets.includes(numeric));
  const selected = isCustom ? 'custom' : numeric === undefined ? '' : String(numeric);
  return <div className="number-preset-editor">
    <select className={className} aria-label={label} value={selected} onChange={(event) => {
      const next = event.target.value;
      setCustom(next === 'custom');
      if (next !== 'custom') onChange(next === '' ? undefined : Number(next));
    }}>
      <option value="">Use default</option>
      {presets.map((preset) => <option value={preset} key={preset}>{preset}</option>)}
      <option value="custom">Custom…</option>
    </select>
    {isCustom ? <input className={className} type="number" aria-label={`Custom ${label.toLowerCase()}`}
      value={numeric ?? ''} min={field.minimum} max={field.maximum}
      step={field.step ?? (field.type === 'integer' ? 1 : 'any')}
      onChange={(event) => {
        const raw = event.target.value;
        if (!raw) onChange(undefined);
        else {
          const next = field.type === 'integer' ? Number.parseInt(raw, 10) : Number(raw);
          if (Number.isFinite(next)) onChange(next);
        }
      }} /> : null}
  </div>;
}
