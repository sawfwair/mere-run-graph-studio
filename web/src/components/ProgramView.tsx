import { useEffect, useState, type ReactElement } from 'react';
import { Boxes, Braces, GitBranch, ListPlus, PlayCircle, Repeat2, Trash2 } from 'lucide-react';

import { addModuleFromSelection, addProgramStep, createProgramFromGraph } from '../program';
import { parseJsonValue } from '../decode';
import type { CatalogEntry, JsonValue, WorkflowGraph, WorkflowProgram, WorkflowProgramStep } from '../types';

interface ProgramViewProps {
  program: WorkflowProgram | undefined;
  graph: WorkflowGraph;
  catalog: CatalogEntry[];
  selectedNodeIds: string[];
  busy: boolean;
  onChange: (program: WorkflowProgram) => void;
  onCompile: () => void;
  onError: (title: string, error: unknown) => void;
}

function JsonInlineEditor({ value, onChange }: { value: JsonValue; onChange: (value: JsonValue) => void }) {
  const [text, setText] = useState(() => JSON.stringify(value));
  const [valid, setValid] = useState(true);
  useEffect(() => setText(JSON.stringify(value)), [value]);
  return <input
    className={valid ? 'json-inline' : 'json-inline invalid'}
    value={text}
    onChange={(event) => {
      setText(event.target.value);
      try {
        onChange(parseJsonValue(event.target.value, 'program JSON'));
        setValid(true);
      } catch {
        setValid(false);
      }
    }}
  />;
}

function branchMode(step: WorkflowProgramStep): 'always' | 'include' | 'exclude' | 'expression' {
  if (step.when === undefined) return 'always';
  if (step.when === true) return 'include';
  if (step.when === false) return 'exclude';
  return 'expression';
}

export function ProgramView({ program, graph, catalog, selectedNodeIds, busy, onChange, onCompile, onError }: ProgramViewProps): ReactElement {
  if (!program) {
    return (
      <div className="program-empty">
        <Boxes size={26} />
        <strong>No workflow program</strong>
        <button className="command-button primary" disabled={!graph.nodes.length} onClick={() => onChange(createProgramFromGraph(graph))}>
          <Braces size={14} /> Create from workflow
        </button>
      </div>
    );
  }

  const updateStep = (stepId: string, update: (step: WorkflowProgramStep) => WorkflowProgramStep) => onChange({
    ...program,
    steps: program.steps.map((step) => step.id === stepId ? update(step) : step),
  });
  const addModule = () => {
    try {
      onChange(addModuleFromSelection(program, graph, catalog, selectedNodeIds).program);
    } catch (error) {
      onError('Module creation failed', error);
    }
  };
  const addStep = (moduleId: string) => {
    try {
      onChange(addProgramStep(program, moduleId));
    } catch (error) {
      onError('Step creation failed', error);
    }
  };

  return (
    <div className="program-view">
      <header className="program-toolbar">
        <label className="field"><span>Program name</span><input value={program.name} onChange={(event) => onChange({ ...program, name: event.target.value })} /></label>
        <button className="command-button" disabled={!selectedNodeIds.length} onClick={addModule}><ListPlus size={14} /> Create module from selection</button>
        <button className="command-button primary" disabled={busy || !program.steps.length} onClick={onCompile}><PlayCircle size={14} /> Compile workflow</button>
      </header>
      <div className="program-columns">
        <section className="program-lane">
          <div className="program-lane-heading"><Boxes size={14} /><strong>Modules</strong><span>{Object.keys(program.modules).length}</span></div>
          {Object.entries(program.modules).map(([moduleId, module]) => (
            <article className="program-row" key={moduleId}>
              <header><strong>{moduleId}</strong><button className="icon-button small" title="Add step" onClick={() => addStep(moduleId)}><ListPlus size={13} /></button></header>
              <div className="program-metrics"><span>{module.nodes.length} nodes</span><span>{module.parameters.length} parameters</span><span>{Object.keys(module.outputs).length} outputs</span></div>
              {module.parameters.length ? <code>{module.parameters.join(', ')}</code> : null}
            </article>
          ))}
        </section>
        <section className="program-lane steps">
          <div className="program-lane-heading"><GitBranch size={14} /><strong>Program steps</strong><span>{program.steps.length}</span></div>
          {program.steps.map((step) => {
            const module = program.modules[step.module];
            const mode = branchMode(step);
            return (
              <article className="program-row step" key={step.id}>
                <header>
                  <span><strong>{step.id}</strong><small>{step.module}</small></span>
                  <span className="step-badges">
                    {step.map ? <b><Repeat2 size={11} /> map</b> : null}
                    {mode !== 'always' ? <b><GitBranch size={11} /> {mode}</b> : null}
                  </span>
                  <button className="icon-button small danger" title="Delete step" onClick={() => onChange({ ...program, steps: program.steps.filter((candidate) => candidate.id !== step.id) })}><Trash2 size={13} /></button>
                </header>
                <div className="step-controls">
                  <label className="field"><span>Branch</span><select value={mode} onChange={(event) => updateStep(step.id, (current) => {
                    const next = { ...current };
                    const value = event.target.value;
                    if (value === 'always') delete next.when;
                    else next.when = value === 'include' ? true : value === 'exclude' ? false : { equals: [1, 1] };
                    return next;
                  })}><option value="always">always</option><option value="include">include</option><option value="exclude">exclude</option><option value="expression">expression</option></select></label>
                  <label className="toggle-row"><input type="checkbox" checked={Boolean(step.map)} onChange={(event) => updateStep(step.id, (current) => {
                    const next = { ...current };
                    if (event.target.checked) next.map = { item: 'item', values: [] };
                    else delete next.map;
                    return next;
                  })} /><span>Map</span></label>
                </div>
                {mode === 'expression' && step.when !== undefined ? <div className="field"><span>Condition</span><JsonInlineEditor value={step.when} onChange={(value) => updateStep(step.id, (current) => ({ ...current, when: value }))} /></div> : null}
                {step.map ? <div className="field-grid">
                  <label className="field"><span>Item</span><input value={step.map.item} onChange={(event) => updateStep(step.id, (current) => ({ ...current, map: { item: event.target.value, values: current.map?.values ?? [] } }))} /></label>
                  <div className="field"><span>Values</span><JsonInlineEditor value={step.map.values} onChange={(value) => updateStep(step.id, (current) => ({ ...current, map: { item: current.map?.item ?? 'item', values: value } }))} /></div>
                </div> : null}
                {(module?.parameters ?? []).map((parameter) => <div className="field program-argument" key={parameter}><span>{parameter}</span><JsonInlineEditor value={step.arguments[parameter] ?? null} onChange={(value) => updateStep(step.id, (current) => ({ ...current, arguments: { ...current.arguments, [parameter]: value } }))} /></div>)}
              </article>
            );
          })}
        </section>
      </div>
    </div>
  );
}
