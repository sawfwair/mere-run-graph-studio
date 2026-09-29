import type { ReactElement } from 'react';

import { choicesWithCurrent } from '../field-choices';

interface FiniteSelectProps<T extends string | number> {
  choices: T[];
  value: T | undefined;
  onChange: (value: T | undefined) => void;
  ariaLabel?: string;
  className?: string;
  emptyLabel?: string;
  unavailableLabel?: string;
}

export function FiniteSelect<T extends string | number>({
  choices, value, onChange, ariaLabel, className, emptyLabel = 'Use default', unavailableLabel = 'not available',
}: FiniteSelectProps<T>): ReactElement {
  const options = choicesWithCurrent(choices, value);
  const selected = value === undefined ? '' : String(options.indexOf(value) + 1);
  return <select className={className} aria-label={ariaLabel} value={selected} disabled={!options.length}
    onChange={(event) => {
      const index = Number(event.target.value) - 1;
      onChange(index < 0 ? undefined : options[index]);
    }}>
    <option value="">{options.length ? emptyLabel : 'No choices available'}</option>
    {options.map((option, index) => <option key={`${typeof option}:${option}`} value={String(index + 1)}>
      {String(option)}{choices.includes(option) ? '' : ` (${unavailableLabel})`}
    </option>)}
  </select>;
}
