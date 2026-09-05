import { useCallback, useEffect, useState, type ReactElement } from 'react';
import {
  ArrowRight,
  Braces,
  CheckCircle2,
  CloudCog,
  Command,
  Cpu,
  Download,
  FileOutput,
  GitBranch,
  History,
  LayoutTemplate,
  Lock,
  Monitor,
  Network,
  PenLine,
  Play,
  ShieldCheck,
  Sparkles,
  SlidersHorizontal,
  Workflow,
} from 'lucide-react';
import {
  Background,
  BackgroundVariant,
  MarkerType,
  ReactFlow,
  useNodesState,
  type Edge,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { WorkflowNode, type WorkflowFlowNode } from './WorkflowNode';
import type { StudioMode } from '../ui';
import type { CatalogEntry, JsonValue } from '../types';

const SHOWCASE_CATALOG: CatalogEntry[] = [
  {
    kind: 'text.value',
    title: 'Prompt',
    category: 'text',
    provider: { id: 'mere.run' },
    presentation: { style: 'material', primary_argument: 'value' },
    inputs: [{ name: 'value', type: 'string', required: true, multiline: true }],
    outputs: [{ name: 'text', type: 'string' }],
  },
  {
    kind: 'seed.value',
    title: 'Seed',
    category: 'values',
    provider: { id: 'mere.run' },
    presentation: { style: 'material', primary_argument: 'seed' },
    inputs: [{ name: 'seed', type: 'integer', required: true }],
    outputs: [{ name: 'seed', type: 'integer' }],
  },
  {
    kind: 'image.generate',
    title: 'Generate image',
    category: 'image',
    provider: { id: 'mere.run' },
    inputs: [
      { name: 'prompt', type: 'string', required: true, multiline: true },
      { name: 'aspect_ratio', type: 'enum', values: ['1:1', '16:9'], default: '16:9' },
      { name: 'guidance_scale', type: 'number', minimum: 0, maximum: 20, default: 7.5 },
      { name: 'seed', type: 'integer', default: 0 },
    ],
    outputs: [{ name: 'image', type: 'asset' }],
  },
  {
    kind: 'image.upscale',
    title: 'Upscale image',
    category: 'image',
    provider: { id: 'mere.run' },
    inputs: [
      { name: 'image', type: 'asset', required: true },
      { name: 'scale', type: 'integer', minimum: 1, maximum: 4, default: 2 },
    ],
    outputs: [{ name: 'image', type: 'asset' }],
  },
  {
    kind: 'video.generate',
    title: 'Generate video',
    category: 'video',
    provider: { id: 'mere.run' },
    inputs: [
      { name: 'prompt', type: 'string', required: true, multiline: true },
      { name: 'image', type: 'asset', required: false },
      { name: 'duration_seconds', type: 'number', minimum: 1, maximum: 10, default: 4 },
    ],
    outputs: [{ name: 'video', type: 'asset' }],
  },
];

function entryFor(kind: string): CatalogEntry | undefined {
  return SHOWCASE_CATALOG.find((entry) => entry.kind === kind);
}

const SHOWCASE_VALUES: {
  id: string;
  kind: string;
  position: { x: number; y: number };
  arguments: Record<string, JsonValue>;
}[] = [
  {
    id: 'prompt',
    kind: 'text.value',
    position: { x: 0, y: 40 },
    arguments: { value: 'A tidal observatory at dawn, volumetric fog, 35mm' },
  },
  {
    id: 'seed',
    kind: 'seed.value',
    position: { x: 0, y: 410 },
    arguments: { seed: 11 },
  },
  {
    id: 'frame',
    kind: 'image.generate',
    position: { x: 390, y: 130 },
    arguments: {
      prompt: { $ref: 'nodes.prompt.outputs.text' },
      aspect_ratio: '16:9',
      guidance_scale: 7.5,
      seed: { $ref: 'nodes.seed.outputs.seed' },
    },
  },
  {
    id: 'detail',
    kind: 'image.upscale',
    position: { x: 780, y: 20 },
    arguments: { image: { $ref: 'nodes.frame.outputs.image' }, scale: 2 },
  },
  {
    id: 'motion',
    kind: 'video.generate',
    position: { x: 1170, y: 130 },
    arguments: {
      prompt: { $ref: 'nodes.prompt.outputs.text' },
      image: { $ref: 'nodes.detail.outputs.image' },
      duration_seconds: 4,
    },
  },
];

const SHOWCASE_EDGES: Edge[] = [
  { id: 'prompt-frame', source: 'prompt', sourceHandle: 'text', target: 'frame', targetHandle: 'prompt', className: 'edge-t-text' },
  { id: 'prompt-motion', source: 'prompt', sourceHandle: 'text', target: 'motion', targetHandle: 'prompt', className: 'edge-t-text' },
  { id: 'seed-frame', source: 'seed', sourceHandle: 'seed', target: 'frame', targetHandle: 'seed', className: 'edge-t-number' },
  { id: 'frame-detail', source: 'frame', sourceHandle: 'image', target: 'detail', targetHandle: 'image', className: 'edge-t-asset' },
  { id: 'detail-motion', source: 'detail', sourceHandle: 'image', target: 'motion', targetHandle: 'image', className: 'edge-t-asset' },
].map((edge) => ({
  ...edge,
  type: 'smoothstep',
  markerEnd: { type: MarkerType.ArrowClosed, width: 13, height: 13 },
}));

const nodeTypes = { workflow: WorkflowNode };

function ShowcaseCanvas() {
  const [mode, setMode] = useState<StudioMode>('easy');
  const [nodes, setNodes, onNodesChange] = useNodesState<WorkflowFlowNode>([]);

  const buildNodes = useCallback((currentMode: StudioMode) => {
    setNodes((existing) =>
      SHOWCASE_VALUES.map((value, index) => {
        const previous = existing.find((node) => node.id === value.id);
        const previousValue = previous?.data.value;
        return {
          id: value.id,
          type: 'workflow' as const,
          position: previous?.position ?? value.position,
          data: {
            value: previousValue ?? { id: value.id, kind: value.kind, arguments: value.arguments },
            entry: entryFor(value.kind),
            ordinal: index + 1,
            mode: currentMode,
            onArgumentChange: (name: string, argument: JsonValue | undefined) => {
              setNodes((current) =>
                current.map((node) =>
                  node.id === value.id
                    ? {
                        ...node,
                        data: {
                          ...node.data,
                          value: {
                            ...node.data.value,
                            arguments:
                              argument === undefined
                                ? Object.fromEntries(Object.entries(node.data.value.arguments).filter(([key]) => key !== name))
                                : { ...node.data.value.arguments, [name]: argument },
                          },
                        },
                      }
                    : node,
                ),
              );
            },
          },
        };
      }),
    );
  }, [setNodes]);

  useEffect(() => buildNodes('easy'), [buildNodes]);

  const switchMode = (next: StudioMode) => {
    setMode(next);
    setNodes((current) => current.map((node) => ({ ...node, data: { ...node.data, mode: next } })));
  };

  return (
    <section className="cloud-window" aria-label="Graph Studio canvas">
      <div className="cloud-window-bar">
        <span className="dot" /><span className="dot" /><span className="dot" />
        <strong>studio.mere.run</strong>
        <div className="cloud-window-modes" role="radiogroup" aria-label="Editor mode">
          <button role="radio" aria-checked={mode === 'easy'} className={mode === 'easy' ? 'active easy' : ''} onClick={() => switchMode('easy')}>
            <Sparkles size={12} /> Easy
          </button>
          <button role="radio" aria-checked={mode === 'pro'} className={mode === 'pro' ? 'active pro' : ''} onClick={() => switchMode('pro')}>
            <SlidersHorizontal size={12} /> Pro
          </button>
        </div>
      </div>
      <div className="cloud-window-canvas">
        <ReactFlow<WorkflowFlowNode>
          nodes={nodes}
          edges={SHOWCASE_EDGES}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          fitView
          fitViewOptions={{ padding: 0.1 }}
          minZoom={0.1}
          maxZoom={1.2}
          nodesConnectable={false}
          zoomOnScroll={false}
          zoomOnPinch={false}
          zoomOnDoubleClick={false}
          panOnDrag={false}
          panOnScroll={false}
          preventScrolling={false}
          deleteKeyCode={null}
          proOptions={{ hideAttribution: true }}
          colorMode="dark"
        >
          <Background variant={BackgroundVariant.Dots} gap={22} size={1.4} color="var(--canvas-dot)" />
        </ReactFlow>
      </div>
      <div className="cloud-window-status">
        <span className="status-ready"><i /> Example workflow</span>
        <span>5 nodes · 5 connections</span>
        <span className="status-hint">Edit the prompt value or drag a node to explore the canvas.</span>
        <span className="status-mode">{mode === 'easy' ? 'Easy mode' : 'Pro mode'}</span>
      </div>
    </section>
  );
}

const CAPABILITIES = [
  {
    icon: Workflow,
    title: 'Typed canvas',
    body: 'Connect nodes with compatible input and output types. Arguments support fixed values, output references, and named secret references. To edit the workflow document, open JSON.',
  },
  {
    icon: PenLine,
    title: 'Reusable values',
    body: 'Use value nodes to share prompts, seeds, numbers, and choices across a workflow. To create a value node, select a supported constant in the inspector.',
  },
  {
    icon: GitBranch,
    title: 'Programs',
    body: 'Create reusable programs with map and branch steps. In Program, compile the program and inspect the resulting workflow before you run it.',
  },
  {
    icon: CloudCog,
    title: 'Preflight',
    body: 'Before you run a workflow, check its requirements against an executor or compare multiple executors. Review missing models and other proposed actions in Prepare.',
  },
  {
    icon: Play,
    title: 'Run inspection',
    body: 'Inspect recorded attempts, logs, cache information, and operation receipts for each run. Preview supported image, video, and audio outputs in the run details or on their nodes.',
  },
  {
    icon: LayoutTemplate,
    title: 'Templates and ComfyUI import',
    body: 'With workflow tools configured, load or publish a template, or import a ComfyUI API prompt. Import reports identify ComfyUI nodes without a supported mapping.',
  },
  {
    icon: FileOutput,
    title: 'Project files',
    body: 'Export a .meregraph.json project file with the workflow, input values, program, and editor settings. Import the file to continue editing on another machine.',
  },
  {
    icon: History,
    title: 'Editing and recovery',
    body: 'Undo and redo document changes, track unsaved edits, and recover local work after an interruption. Use the command palette to find actions and nodes.',
  },
];

const STEPS = [
  {
    title: 'Author',
    body: 'Add nodes to the canvas or load a template. To check the workflow against the runtime schema, select Validate in Pro mode or Check in Easy mode.',
  },
  {
    title: 'Prepare',
    body: 'Choose an executor and select Preflight. Review the reported capabilities, resource requirements, and model actions before you run the workflow.',
  },
  {
    title: 'Run',
    body: 'In the desktop app, run workflows locally, over SSH, or through Relay. In the hosted editor, use Relay. Inspect returned artifacts, hashes, and receipts in Runs.',
  },
];

export function CloudLanding(): ReactElement {
  return (
    <main className="cloud-site">
      <nav className="cloud-nav">
        <a className="cloud-brand" href="/"><span className="cloud-brand-mark"><img src="/brand/mark.svg" alt="" /></span><strong>mere.run</strong><span>Graph Studio</span></a>
        <div className="cloud-nav-actions">
          <a className="cloud-link" href="https://docs.mere.run/workflows">Documentation</a>
          <a className="cloud-button quiet" href="https://docs.mere.run/graph/studio#desktop-studio"><Download size={15} /> Desktop app</a>
          <a className="cloud-button" href="/auth/start?return_to=%2Fapp">Open Graph Studio <ArrowRight size={15} /></a>
        </div>
      </nav>

      <section className="cloud-hero">
        <div className="cloud-eyebrow"><span /> Graph Studio</div>
        <h1>Build AI workflows <em>on your machines</em></h1>
        <p>
          Connect image, video, audio, and text nodes to create mere.run workflows.
          Use the desktop app to run workflows on your workstation or over SSH.
          To run workflows from the browser, connect your machines through Relay.
        </p>
        <div className="cloud-hero-actions">
          <a className="cloud-button large" href="/auth/start?return_to=%2Fapp">Open Graph Studio <ArrowRight size={17} /></a>
          <a className="cloud-button quiet large" href="https://docs.mere.run/graph/studio#desktop-studio"><Download size={16} /> Download the desktop app</a>
        </div>
        <div className="cloud-proof">
          <span><ShieldCheck size={15} /> Projects saved to your account</span>
          <span><Cpu size={15} /> Models run on your machines</span>
          <span><Monitor size={15} /> Desktop app works offline</span>
        </div>
      </section>

      <ShowcaseCanvas />

      <section className="cloud-modes" aria-label="Easy and Pro modes">
        <header className="cloud-section-heading">
          <h2>Easy mode and Pro mode</h2>
          <p>Choose how many settings the editor displays. Both modes use the same workflow format.</p>
        </header>
        <div className="cloud-modes-grid">
          <article className="cloud-mode-card easy">
            <h3><Sparkles size={16} /> Easy</h3>
            <p>Use templates and essential settings with descriptive labels. Connected inputs show the source node and output.</p>
            <ul>
              <li><CheckCircle2 size={13} /> Templates with input forms</li>
              <li><CheckCircle2 size={13} /> Essential settings with expandable advanced options</li>
              <li><CheckCircle2 size={13} /> Run controls and execution target in the toolbar</li>
            </ul>
          </article>
          <article className="cloud-mode-card pro">
            <h3><SlidersHorizontal size={16} /> Pro</h3>
            <p>Inspect argument names and types, edit references, and configure cache and retry settings. Use JSON to edit the workflow document.</p>
            <ul>
              <li><CheckCircle2 size={13} /> Program, JSON, and Prepare views</li>
              <li><CheckCircle2 size={13} /> Groups, notes, saved selections, and automatic layout</li>
              <li><CheckCircle2 size={13} /> Compare preflight results across executors</li>
            </ul>
          </article>
        </div>
      </section>

      <section className="cloud-caps" aria-label="Capabilities">
        <header className="cloud-section-heading">
          <h2>Workflow tools</h2>
          <p>Build, validate, run, and inspect workflows in one workspace.</p>
        </header>
        <div className="cloud-caps-grid">
          {CAPABILITIES.map((capability) => (
            <article className="cloud-cap" key={capability.title}>
              <span className="cloud-cap-icon"><capability.icon size={16} /></span>
              <h3>{capability.title}</h3>
              <p>{capability.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="cloud-steps" aria-label="How a run works">
        <header className="cloud-section-heading">
          <h2>How a run works</h2>
          <p>Keep the workflow, input values, and editor settings in separate documents. Editor settings control the layout without changing execution.</p>
        </header>
        <div className="cloud-steps-grid">
          {STEPS.map((step, index) => (
            <article className="cloud-step" key={step.title}>
              <span>{String(index + 1).padStart(2, '0')}</span>
              <h3>{step.title}</h3>
              <p>{step.body}</p>
            </article>
          ))}
        </div>
        <div className="cloud-trust">
          <span><Lock size={13} /> Sign in to manage saved projects</span>
          <span><ShieldCheck size={13} /> Workflows use named secret references</span>
          <span><Braces size={13} /> Submitted jobs are immutable</span>
          <span><Network size={13} /> Relay reports connected node catalogs</span>
        </div>
      </section>

      <section className="cloud-split" aria-label="Desktop and hosted">
        <article className="cloud-split-card">
          <h3><Monitor size={16} /> Desktop</h3>
          <p>
            Create and run workflows on macOS, Windows, and Linux with the installed
            <code> mere.run</code> executable. Local workflows require no account.
            Offline runs require the models, files, and dependencies to be available on your computer.
          </p>
          <a className="cloud-button quiet" href="https://docs.mere.run/graph/studio#desktop-studio"><Download size={15} /> Download the desktop app</a>
        </article>
        <article className="cloud-split-card">
          <h3><Command size={16} /> Hosted</h3>
          <p>
            Sign in with Mere World to save projects to your account.
            To run a workflow, select a machine connected through Relay.
            Models run on connected machines, not in the browser.
          </p>
          <a className="cloud-button" href="/auth/start?return_to=%2Fapp">Open Graph Studio <ArrowRight size={15} /></a>
        </article>
      </section>

      <section className="cloud-cta">
        <h2>Choose where to build your workflow</h2>
        <div className="cloud-hero-actions">
          <a className="cloud-button large" href="/auth/start?return_to=%2Fapp">Open Graph Studio <ArrowRight size={17} /></a>
          <a className="cloud-button quiet large" href="https://docs.mere.run/workflows">Read the workflow documentation</a>
        </div>
      </section>

      <footer className="cloud-footer">
        <span>Graph Studio is part of mere.run</span>
        <a href="https://mere.run">mere.run</a>
        <a href="https://mere.world">Mere World</a>
        <a href="https://docs.mere.run">Documentation</a>
      </footer>
    </main>
  );
}
