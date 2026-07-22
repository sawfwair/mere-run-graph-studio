import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import {
  Box,
  Braces,
  Cpu,
  FileInput,
  GripVertical,
  Image,
  LayoutTemplate,
  Music,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  ScanSearch,
  Search,
  Sparkles,
  Type,
  Upload,
  Video,
} from 'lucide-react';

import { catalogKey, providerId } from '../graph';
import { categoryKey, categoryTitle, friendlyType, type CategoryKey, type StudioMode } from '../ui';
import { NODE_DRAG_TYPE } from './GraphCanvas';
import type { CatalogEntry, TemplateEntry, WorkflowGraph } from '../types';

interface LibraryProps {
  catalog: CatalogEntry[];
  graph: WorkflowGraph;
  templates: TemplateEntry[];
  workflowToolsAvailable: boolean;
  mode: StudioMode;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  onAddNode: (entry: CatalogEntry) => void;
  onAddInput: () => void;
  onSelectInput: (name: string) => void;
  onLoadTemplate: (templateId: string) => void;
  onImportComfy: () => void;
  onPublishTemplate: () => void;
}

const categoryIcons = {
  values: Braces,
  text: Type,
  audio: Music,
  dataset: ScanSearch,
  image: Image,
  model: Cpu,
  video: Video,
  other: Sparkles,
} satisfies Record<CategoryKey, typeof Box>;
const categoryOrder: CategoryKey[] = ['values', 'text', 'image', 'video', 'audio', 'model', 'dataset', 'other'];

type LibraryTab = 'nodes' | 'inputs' | 'templates';

export function Library({
  catalog,
  graph,
  templates,
  workflowToolsAvailable,
  mode,
  collapsed,
  onCollapsedChange,
  onAddNode,
  onAddInput,
  onSelectInput,
  onLoadTemplate,
  onImportComfy,
  onPublishTemplate,
}: LibraryProps): ReactElement {
  const [tab, setTab] = useState<LibraryTab>('nodes');
  const [query, setQuery] = useState('');
  const userPicked = useRef(false);
  const searchInput = useRef<HTMLInputElement>(null);
  const [focusSearchIntent, setFocusSearchIntent] = useState(false);

  useEffect(() => {
    if (userPicked.current) return;
    setTab(mode === 'easy' && templates.length ? 'templates' : 'nodes');
  }, [mode, templates.length]);

  // When search is opened from the collapsed rail, focus the field once the
  // panel has expanded onto the Nodes tab.
  useEffect(() => {
    if (focusSearchIntent && !collapsed && tab === 'nodes') {
      searchInput.current?.focus();
      setFocusSearchIntent(false);
    }
  }, [focusSearchIntent, collapsed, tab]);

  const openSearch = () => { pickTab('nodes'); onCollapsedChange(false); setFocusSearchIntent(true); };

  const pickTab = (next: LibraryTab) => {
    userPicked.current = true;
    setTab(next);
  };

  const groups = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const filtered = catalog.filter((entry) =>
      [entry.kind, entry.title, entry.description, entry.category, providerId(entry)].some((value) =>
        String(value ?? '').toLowerCase().includes(normalized),
      ),
    );
    return filtered.reduce((result, entry) => {
      const category = categoryKey(entry.category);
      const entries = result.get(category) ?? [];
      entries.push(entry);
      result.set(category, entries);
      return result;
    }, new Map<CategoryKey, CatalogEntry[]>());
  }, [catalog, query]);

  const tabIcons: Record<LibraryTab, typeof Box> = { templates: LayoutTemplate, nodes: Box, inputs: FileInput };
  const tabs: { id: LibraryTab; label: string }[] =
    mode === 'easy'
      ? [
          { id: 'templates', label: 'Templates' },
          { id: 'nodes', label: 'Nodes' },
          { id: 'inputs', label: 'Inputs' },
        ]
      : [
          { id: 'nodes', label: 'Nodes' },
          { id: 'inputs', label: 'Inputs' },
          { id: 'templates', label: 'Templates' },
        ];

  if (collapsed) {
    return (
      <aside className="library-rail" aria-label="Library">
        <button className="rail-btn" title="Expand library" aria-label="Expand library" onClick={() => onCollapsedChange(false)}>
          <PanelLeftOpen size={17} />
        </button>
        <span className="rail-divider" />
        <button className="rail-btn" title="Search nodes" aria-label="Search nodes" onClick={openSearch}>
          <Search size={17} />
        </button>
        {tabs.map((item) => {
          const Icon = tabIcons[item.id];
          return (
            <button
              key={item.id}
              className={`rail-btn ${tab === item.id ? 'active' : ''}`}
              title={item.label}
              aria-label={`Open ${item.label}`}
              onClick={() => { pickTab(item.id); onCollapsedChange(false); }}
            >
              <Icon size={17} />
            </button>
          );
        })}
      </aside>
    );
  }

  return (
    <aside className="library-panel">
      <div className="panel-tabs" role="tablist">
        {tabs.map((item) => (
          <button
            key={item.id}
            role="tab"
            aria-selected={tab === item.id}
            className={tab === item.id ? 'active' : ''}
            onClick={() => pickTab(item.id)}
          >
            {item.label}
          </button>
        ))}
        <button className="panel-collapse" title="Collapse library" aria-label="Collapse library" onClick={() => onCollapsedChange(true)}>
          <PanelLeftClose size={15} />
        </button>
      </div>
      {tab === 'nodes' ? (
        <div className="library-body">
          <label className="search-field">
            <Search size={14} />
            <input ref={searchInput} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search nodes…" />
          </label>
          <div className="catalog-list">
            {[...groups.entries()]
              .sort(([left], [right]) => categoryOrder.indexOf(left) - categoryOrder.indexOf(right))
              .map(([category, entries]) => {
                const Icon = categoryIcons[category];
                return (
                  <section className={`catalog-group cat-${category}`} key={category}>
                    <h3>
                      <span>{categoryTitle(category)}</span>
                      <small>{entries.length}</small>
                    </h3>
                    {entries.map((entry) => (
                      <button
                        className={`catalog-item ${mode === 'easy' ? 'roomy' : ''}`}
                        key={catalogKey(entry)}
                        draggable
                        onDragStart={(event) => {
                          event.dataTransfer.setData(NODE_DRAG_TYPE, catalogKey(entry));
                          event.dataTransfer.effectAllowed = 'copy';
                        }}
                        onClick={() => onAddNode(entry)}
                        title={mode === 'easy' ? 'Click to add, or drag onto the canvas' : entry.kind}
                      >
                        <span className="catalog-icon"><Icon size={15} strokeWidth={1.9} /></span>
                        <span className="catalog-copy">
                          <strong>{entry.title}</strong>
                          {mode === 'easy' ? (
                            entry.description ? <small className="clamp">{entry.description}</small> : null
                          ) : (
                            <small>
                              {entry.kind}
                              {providerId(entry) !== 'mere.run' ? <em className="provider-chip">{providerId(entry)}</em> : null}
                            </small>
                          )}
                        </span>
                        <span className="catalog-actions">
                          <GripVertical size={13} className="drag-hint" />
                          <Plus size={14} className="add-hint" />
                        </span>
                      </button>
                    ))}
                  </section>
                );
              })}
            {!catalog.length ? <div className="empty-state"><Cpu size={18} /> Catalog unavailable</div> : null}
            {catalog.length && ![...groups.values()].some((entries) => entries.length) ? (
              <div className="empty-state">No nodes match “{query}”</div>
            ) : null}
          </div>
        </div>
      ) : tab === 'inputs' ? (
        <div className="library-body">
          <div className="panel-heading">
            <strong>Graph inputs</strong>
            <button className="icon-button small" onClick={onAddInput} title="Add input" aria-label="Add input"><Plus size={15} /></button>
          </div>
          <div className="input-list">
            {Object.entries(graph.inputs).map(([name, definition]) => (
              <button className="input-item" key={name} onClick={() => onSelectInput(name)}>
                <Box size={14} />
                <span className="catalog-copy">
                  <strong>{name}</strong>
                  <small>{mode === 'easy' ? friendlyType(definition.type) : definition.type}</small>
                </span>
                {definition.required ? <em className="required-chip">required</em> : null}
              </button>
            ))}
            {!Object.keys(graph.inputs).length ? (
              <div className="empty-state">
                {mode === 'easy'
                  ? 'Inputs are the blanks a workflow asks you to fill in before running.'
                  : 'No graph inputs'}
              </div>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="library-body">
          <div className="panel-heading">
            <strong>{mode === 'easy' ? 'Start from a template' : 'Workflow templates'}</strong>
            <span className="panel-actions">
              {mode === 'pro' ? (
                <button
                  className="icon-button small"
                  onClick={onPublishTemplate}
                  disabled={!workflowToolsAvailable || !graph.nodes.length}
                  title="Publish workflow template"
                  aria-label="Publish workflow template"
                ><Upload size={15} /></button>
              ) : null}
              <button
                className="icon-button small"
                onClick={onImportComfy}
                disabled={!workflowToolsAvailable}
                title="Import ComfyUI workflow"
                aria-label="Import ComfyUI workflow"
              ><FileInput size={15} /></button>
            </span>
          </div>
          <div className="template-list">
            {templates.map((template) => (
              <button key={template.id} onClick={() => onLoadTemplate(template.id)}>
                <span className="template-icon"><LayoutTemplate size={15} /></span>
                <span className="catalog-copy">
                  <strong>{template.title}</strong>
                  <small className="clamp">{template.description}</small>
                  {template.tags.length ? (
                    <span className="tag-row">
                      {template.tags.slice(0, 3).map((tag) => <em key={tag}>{tag}</em>)}
                    </span>
                  ) : null}
                </span>
              </button>
            ))}
            {!workflowToolsAvailable ? <div className="empty-state">Workflow tools unavailable — templates and ComfyUI import are disabled.</div> : null}
            {workflowToolsAvailable && !templates.length ? <div className="empty-state">No templates</div> : null}
          </div>
        </div>
      )}
    </aside>
  );
}
