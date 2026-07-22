import type { ReactElement } from 'react';

import type { JsonObject, JsonValue, WorkflowGraph } from '../types';
import { textValue } from '../ui';

interface TemplateFormProps {
  graph: WorkflowGraph;
  values: JsonObject;
  onChange: (values: JsonObject) => void;
}

function NumberInput({ definition, value, onChange }: {
  definition: WorkflowGraph['inputs'][string];
  value: JsonValue | undefined;
  onChange: (value: JsonValue) => void;
}) {
  return <input
    type="number"
    min={definition.minimum}
    max={definition.maximum}
    step={definition.step ?? (definition.type === 'integer' ? 1 : 'any')}
    value={typeof value === 'number' ? value : ''}
    onChange={(event) => {
      if (!event.target.value) return;
      onChange(definition.type === 'integer' ? Number.parseInt(event.target.value, 10) : Number(event.target.value));
    }}
  />;
}

function inputValue(definition: WorkflowGraph['inputs'][string], value: JsonValue | undefined, onChange: (value: JsonValue) => void) {
  if (definition.type === 'boolean') {
    return (
      <label className="toggle-row">
        <input type="checkbox" checked={Boolean(value)} onChange={(event) => onChange(event.target.checked)} />
        <span>Enabled</span>
      </label>
    );
  }
  if (definition.type === 'enum') {
    return (
      <select value={textValue(value, definition.values?.[0])} onChange={(event) => onChange(event.target.value)}>
        {(definition.values ?? []).map((item) => <option key={item}>{item}</option>)}
      </select>
    );
  }
  if (definition.type === 'integer' || definition.type === 'number') {
    return <NumberInput definition={definition} value={value} onChange={onChange} />;
  }
  if (definition.multiline) {
    return <textarea rows={4} value={textValue(value)} onChange={(event) => onChange(event.target.value)} />;
  }
  return <input type="text" value={textValue(value)} onChange={(event) => onChange(event.target.value)} />;
}

export function TemplateForm({ graph, values, onChange }: TemplateFormProps): ReactElement {
  return (
    <div className="template-form">
      {Object.entries(graph.inputs).map(([name, definition]) => (
        <label className="field" key={name}>
          <div className="field-heading"><span>{name}{definition.required ? ' *' : ''}</span><small>{definition.type}</small></div>
          {inputValue(definition, values[name] ?? definition.default, (value) => onChange({ ...values, [name]: value }))}
          {definition.description ? <small className="field-description">{definition.description}</small> : null}
        </label>
      ))}
      {!Object.keys(graph.inputs).length ? <div className="empty-state">No parameters</div> : null}
    </div>
  );
}
