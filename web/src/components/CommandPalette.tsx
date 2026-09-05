import { useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react';
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

export function CommandPalette({ open, placeholder, groups, onClose }: CommandPaletteProps): ReactElement | null {
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return groups
      .map((group) => ({ ...group, items: group.items.filter((item) => matches(item, tokens)) }))
      .filter((group) => group.items.length);
  }, [groups, query]);

  const flat = useMemo(() => filtered.flatMap((group) => group.items), [filtered]);
  const active = flat[Math.min(highlight, Math.max(flat.length - 1, 0))];

  useEffect(() => {
    if (open) {
      setQuery('');
      setHighlight(0);
      window.setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  useEffect(() => setHighlight(0), [query]);

  useEffect(() => {
    const selected = listRef.current?.querySelector('[data-active="true"]');
    selected?.scrollIntoView({ block: 'nearest' });
  }, [highlight, filtered]);

  if (!open) return null;

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
            ref={inputRef}
            value={query}
            placeholder={placeholder} aria-label="Search commands"
            onChange={(event) => setQuery(event.target.value)}
            spellCheck={false}
          />
          <span className="palette-return"><CornerDownLeft size={13} /></span>
        </label>
        <div className="palette-results" ref={listRef}>
          {filtered.map((group) => (
            <section key={group.title}>
              <h3>{group.title}</h3>
              {group.items.map((item) => {
                const isActive = item === active;
                return (
                  <button
                    type="button"
                    key={item.id}
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
