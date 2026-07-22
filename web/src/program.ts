import { catalogEntryFor, clone, isGraphReference, uniqueId } from './graph';
import type { CatalogEntry, GraphReference, JsonValue, WorkflowGraph, WorkflowModule, WorkflowProgram } from './types';

function parameterize(value: JsonValue, selectedNodeIds: Set<string>, parameters: Set<string>): JsonValue {
  if (Array.isArray(value)) return value.map((item) => parameterize(item, selectedNodeIds, parameters));
  if (!value || typeof value !== 'object') return value;
  if (isGraphReference(value)) {
    const input = /^inputs\.([a-z][a-z0-9-]*)$/.exec(value.$ref);
    if (input) {
      parameters.add(input[1]);
      return { $param: input[1] };
    }
    const node = /^nodes\.([a-z][a-z0-9-]*)\.outputs\./.exec(value.$ref);
    if (node && !selectedNodeIds.has(node[1])) {
      throw new Error(`Selection depends on node outside the module: ${node[1]}`);
    }
    return clone(value);
  }
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, parameterize(item, selectedNodeIds, parameters)]));
}

function moduleForNodes(graph: WorkflowGraph, catalog: CatalogEntry[], nodeIds: string[]): WorkflowModule {
  const selected = new Set(nodeIds);
  const parameters = new Set<string>();
  const nodes = graph.nodes.filter((node) => selected.has(node.id)).map((node) => {
    const next = clone(node);
    const externalDependency = (next.depends_on ?? []).find((dependency) => !selected.has(dependency));
    if (externalDependency) throw new Error(`Selection has an ordering dependency outside the module: ${externalDependency}`);
    next.arguments = Object.fromEntries(
      Object.entries(next.arguments).map(([name, value]) => [name, parameterize(value, selected, parameters)]),
    );
    return next;
  });
  if (!nodes.length) throw new Error('Select at least one node to create a module.');
  const outputs: Record<string, GraphReference> = {};
  for (const node of nodes) {
    for (const output of catalogEntryFor(node, catalog)?.outputs ?? []) {
      const name = uniqueId(`${node.id}-${output.name}`, Object.keys(outputs));
      outputs[name] = { $ref: `nodes.${node.id}.outputs.${output.name}` };
    }
  }
  if (!Object.keys(outputs).length) throw new Error('Selected nodes do not expose catalog outputs.');
  return { parameters: [...parameters].sort(), nodes, outputs };
}

export function createProgramFromGraph(graph: WorkflowGraph): WorkflowProgram {
  const parameters = new Set(Object.keys(graph.inputs));
  const selected = new Set(graph.nodes.map((node) => node.id));
  const module: WorkflowModule = {
    parameters: [...parameters],
    nodes: graph.nodes.map((node) => ({
      ...clone(node),
      arguments: Object.fromEntries(
        Object.entries(node.arguments).map(([name, value]) => [name, parameterize(value, selected, parameters)]),
      ),
    })),
    outputs: clone(graph.outputs),
  };
  const moduleId = 'workflow';
  const stepId = 'workflow';
  return {
    schema_version: 1,
    kind: 'mere.run/workflow-program',
    name: graph.name,
    inputs: clone(graph.inputs),
    variables: {},
    modules: { [moduleId]: module },
    steps: [{
      id: stepId,
      module: moduleId,
      arguments: Object.fromEntries(module.parameters.map((name) => [name, { $ref: `inputs.${name}` }])),
    }],
    outputs: Object.fromEntries(
      Object.keys(module.outputs).map((name) => [name, { $ref: `steps.${stepId}.outputs.${name}` }]),
    ),
    execution: clone(graph.execution ?? { max_parallel_nodes: 1 }),
    metadata: { source: 'mere-run-graph-studio' },
  };
}

export function addModuleFromSelection(
  program: WorkflowProgram,
  graph: WorkflowGraph,
  catalog: CatalogEntry[],
  nodeIds: string[],
): { program: WorkflowProgram; moduleId: string } {
  const next = clone(program);
  const moduleId = uniqueId('module', Object.keys(next.modules));
  next.modules[moduleId] = moduleForNodes(graph, catalog, nodeIds);
  return { program: next, moduleId };
}

export function addProgramStep(program: WorkflowProgram, moduleId: string): WorkflowProgram {
  const module = program.modules[moduleId];
  if (!module) throw new Error(`Unknown module: ${moduleId}`);
  const next = clone(program);
  const stepId = uniqueId(moduleId, next.steps.map((step) => step.id));
  next.steps.push({
    id: stepId,
    module: moduleId,
    arguments: Object.fromEntries(module.parameters.map((name) => [
      name,
      name in next.inputs ? { $ref: `inputs.${name}` } : null,
    ])),
  });
  return next;
}
