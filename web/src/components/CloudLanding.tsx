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
    title: 'Animate to video',
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
    position: { x: 0, y: 330 },
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
  { id: 'prompt-frame', source: 'prompt', sourceHandle: 'text', target: 'frame', targetHandle: 'prompt', className: 'edge-t-text', animated: true },
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
          minZoom={0.35}
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
        <span className="status-ready"><i /> Ready</span>
        <span>5 nodes · 5 links</span>
        <span className="status-hint">Live editor components. Type in the prompt card; it feeds both generators.</span>
        <span className="status-mode">{mode === 'easy' ? 'EASY MODE' : 'PRO MODE'}</span>
      </div>
    </section>
  );
}

const CAPABILITIES = [
  {
    icon: Workflow,
    title: 'Typed canvas',
    body: 'Ports carry types; incompatible connections don’t attach. Any argument can hold a constant, a reference to another node’s output, or a named secret. The same document is editable as JSON, one tab over.',
  },
  {
    icon: PenLine,
    title: 'Creative materials',
    body: 'Prompts, seeds, numbers, and choices can live as cards on the canvas and feed several nodes at once. Promote any argument to a material with one action, and inline it back the same way.',
  },
  {
    icon: GitBranch,
    title: 'Programs',
    body: 'Reusable programs with map and branch compile down to plain graphs. The Program view shows what they expand into before anything runs.',
  },
  {
    icon: CloudCog,
    title: 'Preflight',
    body: 'Check a workflow against an executor before running it, or compare several side by side. Missing models appear as actions you approve; nothing downloads on its own.',
  },
  {
    icon: Play,
    title: 'Run inspection',
    body: 'Each run keeps a per-node timeline with attempts, logs, cache evidence, and receipts. Image, video, and audio artifacts preview inline, and results appear on the node that produced them.',
  },
  {
    icon: LayoutTemplate,
    title: 'Templates and Comfy import',
    body: 'Start from a template with a fill-in form, publish your own locally, or import a ComfyUI API prompt. Comfy nodes that don’t map are listed by name instead of guessed at.',
  },
  {
    icon: FileOutput,
    title: 'One-file projects',
    body: 'A project exports as a single .meregraph.json holding the graph, inputs, program, and editor state. Importing it elsewhere reproduces the workspace exactly.',
  },
  {
    icon: History,
    title: 'Editor fundamentals',
    body: 'Undo and redo across the whole document, dirty-state tracking, recovery after a crash, a ⌘K command palette, and keyboard access to everything.',
  },
];

const STEPS = [
  {
    title: 'Author',
    body: 'Wire nodes and material cards on the canvas, or open a template. Validation uses the same schemas the CLI enforces, so the editor can’t produce a file the runtime rejects.',
  },
  {
    title: 'Prepare',
    body: 'Pick an executor and preflight it. The report lists capability gaps, resource requirements, and the model actions a run would need, before anything is committed.',
  },
  {
    title: 'Run',
    body: 'Execute locally, over SSH, or through Relay, which leases the job to one paired Node. Artifacts, hashes, and receipts come back into the same timeline you authored in.',
  },
];

export function CloudLanding(): ReactElement {
  return (
    <main className="cloud-site">
      <nav className="cloud-nav">
        <a className="cloud-brand" href="/"><span className="cloud-brand-mark"><img src="/brand/mark.svg" alt="" /></span><strong>mere.run</strong><span>Graph Studio</span></a>
        <div className="cloud-nav-actions">
          <a className="cloud-link" href="https://docs.mere.run/workflows">Docs</a>
          <a className="cloud-button quiet" href="https://docs.mere.run/graph/studio#desktop-studio"><Download size={15} /> Desktop app</a>
          <a className="cloud-button" href="/auth/start?return_to=%2Fapp">Open Studio <ArrowRight size={15} /></a>
        </div>
      </nav>

      <section className="cloud-hero">
        <div className="cloud-eyebrow"><span /> Graph Studio</div>
        <h1>AI pipelines on a canvas,<br /><em>run on your own GPUs.</em></h1>
        <p>
          Graph Studio edits mere.run workflow documents: typed nodes for image, video,
          audio, and text, wired together visually. The file you author here runs unchanged
          on your workstation, over SSH, or on machines you’ve paired through Relay.
          Models never execute in the browser.
        </p>
        <div className="cloud-hero-actions">
          <a className="cloud-button large" href="/auth/start?return_to=%2Fapp">Open Studio <ArrowRight size={17} /></a>
          <a className="cloud-button quiet large" href="https://docs.mere.run/graph/studio#desktop-studio"><Download size={16} /> Download the desktop app</a>
        </div>
        <div className="cloud-proof">
          <span><ShieldCheck size={15} /> Projects scoped to your account</span>
          <span><Cpu size={15} /> Compute stays on your Nodes</span>
          <span><Monitor size={15} /> Desktop app works offline</span>
        </div>
      </section>

      <ShowcaseCanvas />

      <section className="cloud-modes" aria-label="Easy and Pro modes">
        <header className="cloud-section-heading">
          <h2>Easy mode and Pro mode</h2>
          <p>The toggle changes what’s on screen, not the document. Both modes read and write the same files, byte for byte.</p>
        </header>
        <div className="cloud-modes-grid">
          <article className="cloud-mode-card easy">
            <h3><Sparkles size={16} /> Easy</h3>
            <p>Templates, required settings, sliders, and plain labels. Wiring appears as “linked to” chips instead of reference paths.</p>
            <ul>
              <li><CheckCircle2 size={13} /> Template gallery with fill-in forms</li>
              <li><CheckCircle2 size={13} /> Required arguments up front, the rest behind one tap</li>
              <li><CheckCircle2 size={13} /> Run and the executor picker stay visible</li>
            </ul>
          </article>
          <article className="cloud-mode-card pro">
            <h3><SlidersHorizontal size={16} /> Pro</h3>
            <p>Every argument by its real name and type, references and secrets, cache and retry control, and the raw JSON one tab over.</p>
            <ul>
              <li><CheckCircle2 size={13} /> Program, JSON, and Prepare views</li>
              <li><CheckCircle2 size={13} /> Groups, notes, saved selections, auto-layout</li>
              <li><CheckCircle2 size={13} /> Preflight several executors side by side</li>
            </ul>
          </article>
        </div>
      </section>

      <section className="cloud-caps" aria-label="Capabilities">
        <header className="cloud-section-heading">
          <h2>In the current build</h2>
          <p>A partial list. The README keeps the complete one.</p>
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
          <p>Three files travel together: the workflow, its inputs, and an editor sidecar that never affects execution.</p>
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
          <span><Lock size={13} /> Tokens live in HttpOnly cookies</span>
          <span><ShieldCheck size={13} /> No provider credentials stored</span>
          <span><Braces size={13} /> Jobs are immutable once submitted</span>
          <span><Network size={13} /> Node catalogs reported live through Relay</span>
        </div>
      </section>

      <section className="cloud-split" aria-label="Desktop and hosted">
        <article className="cloud-split-card">
          <h3><Monitor size={16} /> Desktop</h3>
          <p>
            A native app for macOS, Windows, and Linux. Authoring, validation, preflight,
            and local runs work with no account and no network; Studio drives the
            <code> mere.run</code> binary you installed. Sign-in exists only for cloud
            features and is never triggered by local work.
          </p>
          <a className="cloud-button quiet" href="https://docs.mere.run/graph/studio#desktop-studio"><Download size={15} /> Download</a>
        </article>
        <article className="cloud-split-card">
          <h3><Command size={16} /> Hosted</h3>
          <p>
            The same editor at studio.mere.run. Mere World handles identity, projects
            persist per account, and runs are placed on Nodes you’ve paired. The
            website schedules work; it never executes models.
          </p>
          <a className="cloud-button" href="/auth/start?return_to=%2Fapp">Open Studio <ArrowRight size={15} /></a>
        </article>
      </section>

      <section className="cloud-cta">
        <h2>Build your first workflow in the browser, or take the desktop app.</h2>
        <div className="cloud-hero-actions">
          <a className="cloud-button large" href="/auth/start?return_to=%2Fapp">Open Studio <ArrowRight size={17} /></a>
          <a className="cloud-button quiet large" href="https://docs.mere.run/workflows">Read the docs</a>
        </div>
      </section>

      <footer className="cloud-footer">
        <span>Graph Studio is part of mere.run</span>
        <a href="https://mere.run">mere.run</a>
        <a href="https://mere.world">Mere World</a>
        <a href="https://docs.mere.run">Docs</a>
      </footer>
    </main>
  );
}
