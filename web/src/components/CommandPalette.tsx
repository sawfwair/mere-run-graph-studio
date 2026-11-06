import { useEffect, useId, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { CornerDownLeft, Search } from 'lucide-react';

export interface PaletteItem {
  id: string;
  title: string;
  subtitle?: string;
  hint?: string;
  icon?: ReactNode;
  keywords?: string;
  run: () => void;
}

export interface PaletteGroup {
  title: string;
  items: PaletteItem[];
}

interface CommandPaletteProps {
  open: boolean;
  placeholder: string;
  groups: PaletteGroup[];
  onClose: () => void;
}

function matches(item: PaletteItem, tokens: string[]): boolean {
  if (!tokens.length) return true;
  const haystack = `${item.title} ${item.subtitle ?? ''} ${item.keywords ?? ''}`.toLowerCase();
  return tokens.every((token) => haystack.includes(token));
}

export function CommandPalette({ open, ...props }: CommandPaletteProps): ReactElement | null {
  // Mounting the body on open starts every session with an empty query and the
  // first result highlighted, without an effect resetting state after render.
  return open ? <PaletteDialog {...props} /> : null;
}

function PaletteDialog({ placeholder, groups, onClose }: Omit<CommandPaletteProps, 'open'>): ReactElement {
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const filtered = useMemo(() => {
    const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return groups
      .map((group) => ({ ...group, items: group.items.filter((item) => matches(item, tokens)) }))
      .filter((group) => group.items.length);
  }, [groups, query]);

  const flat = useMemo(() => filtered.flatMap((group) => group.items), [filtered]);
  const active = flat[Math.min(highlight, Math.max(flat.length - 1, 0))];
  const optionId = (item: PaletteItem) => `${listId}-${flat.indexOf(item)}`;

  // Return focus to whatever opened the palette once it closes, unless the
  // chosen command already moved focus somewhere new (such as a dialog).
  useEffect(() => {
    const opener = document.activeElement;
    return () => {
      const lost = !document.activeElement || document.activeElement === document.body;
      if (lost && opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);

  useEffect(() => {
    const selected = listRef.current?.querySelector('[data-active="true"]');
    selected?.scrollIntoView({ block: 'nearest' });
  }, [highlight, filtered]);

  const runItem = (item: PaletteItem | undefined) => {
    if (!item) return;
    onClose();
    item.run();
  };

  return (
    <div className="overlay-scrim top" onMouseDown={onClose} role="presentation">
      <div
        className="command-palette"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setHighlight((value) => Math.min(value + 1, flat.length - 1));
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setHighlight((value) => Math.max(value - 1, 0));
          } else if (event.key === 'Enter') {
            event.preventDefault();
            runItem(active);
          } else if (event.key === 'Escape') {
            event.preventDefault();
            onClose();
          }
        }}
      >
        <label className="palette-input">
          <Search size={16} />
          <input
            // Focus during the opening commit, so keys typed right after the
            // shortcut reach the search instead of the page behind it.
            autoFocus
            value={query}
            placeholder={placeholder}
            aria-label="Search commands"
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={active ? optionId(active) : undefined}
            onChange={(event) => {
              setQuery(event.target.value);
              setHighlight(0);
            }}
            spellCheck={false}
          />
          <span className="palette-return"><CornerDownLeft size={13} /></span>
        </label>
        <div className="palette-results" ref={listRef} id={listId} role="listbox" aria-label="Results">
          {filtered.map((group) => (
            <section key={group.title} role="group" aria-label={group.title}>
              <h3 aria-hidden="true">{group.title}</h3>
              {group.items.map((item) => {
                const isActive = item === active;
                return (
                  <button
                    type="button"
                    key={item.id}
                    id={optionId(item)}
                    role="option"
                    aria-selected={isActive}
                    tabIndex={-1}
                    className={`palette-item ${isActive ? 'active' : ''}`}
                    data-active={isActive || undefined}
                    onMouseEnter={() => setHighlight(flat.indexOf(item))}
                    onClick={() => runItem(item)}
                  >
                    {item.icon ? <span className="palette-icon">{item.icon}</span> : null}
                    <span className="palette-copy">
                      <strong>{item.title}</strong>
                      {item.subtitle ? <small>{item.subtitle}</small> : null}
                    </span>
                    {item.hint ? <span className="palette-key">{item.hint}</span> : null}
                  </button>
                );
              })}
            </section>
          ))}
          {!flat.length ? <div className="empty-state">No results for "{query}". Try another search.</div> : null}
        </div>
      </div>
    </div>
  );
}
