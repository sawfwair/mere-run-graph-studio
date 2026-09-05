import { Keyboard, MousePointerClick, X } from 'lucide-react';
import type { ReactElement } from 'react';

import type { StudioMode } from '../ui';

interface ShortcutRow {
  keys: string[];
  label: string;
  proOnly?: boolean;
}

const KEYBOARD_SHORTCUTS: ShortcutRow[] = [
  { keys: ['⌘', 'K'], label: 'Search actions, nodes, and templates' },
  { keys: ['⌘', 'S'], label: 'Save workflow' },
  { keys: ['⌘', 'Z'], label: 'Undo' },
  { keys: ['⇧', '⌘', 'Z'], label: 'Redo' },
  { keys: ['⌘', '⏎'], label: 'Run workflow' },
  { keys: ['1'], label: 'Canvas view' },
  { keys: ['2'], label: 'Program view', proOnly: true },
  { keys: ['3'], label: 'JSON view', proOnly: true },
  { keys: ['4'], label: 'Prepare view', proOnly: true },
  { keys: ['5'], label: 'Runs view' },
  { keys: ['⌫'], label: 'Delete selected canvas items' },
  { keys: ['?'], label: 'Open shortcuts and tips' },
];

const POINTER_TIPS: ShortcutRow[] = [
  { keys: [], label: 'To add a node, drag it from the library onto the canvas.' },
  { keys: [], label: 'In the desktop app, drop files onto the canvas to create workflow inputs.' },
  { keys: [], label: 'To add a node at a specific position, double-click an empty area of the canvas.' },
  { keys: [], label: 'To connect nodes, drag from an output port to a compatible input port.' },
  { keys: [], label: 'To zoom, scroll or use the zoom controls. To pan, drag an empty area of the canvas.' },
];

export function HelpOverlay({ open, mode, onClose }: { open: boolean; mode: StudioMode; onClose: () => void }): ReactElement | null {
  if (!open) return null;
  const shortcuts = KEYBOARD_SHORTCUTS.filter((row) => !row.proOnly || mode === 'pro');
  return (
    <div className="overlay-scrim" onMouseDown={onClose} role="presentation">
      <section className="help-overlay" role="dialog" aria-label="Keyboard shortcuts" onMouseDown={(event) => event.stopPropagation()}>
        <header className="help-heading">
          <strong>Shortcuts and tips</strong>
          <button className="icon-button small ghost" onClick={onClose} aria-label="Close help">
            <X size={15} />
          </button>
        </header>
        <div className="help-columns">
          <div>
            <h3><Keyboard size={13} /> Keyboard</h3>
            {shortcuts.map((row) => (
              <div className="help-row" key={row.label}>
                <span className="help-keys">
                  {row.keys.map((key) => <kbd key={key}>{key}</kbd>)}
                </span>
                <span>{row.label}</span>
              </div>
            ))}
          </div>
          <div>
            <h3><MousePointerClick size={13} /> Canvas</h3>
            {POINTER_TIPS.map((row) => (
              <div className="help-row wide" key={row.label}>
                <span>{row.label}</span>
              </div>
            ))}
            <p className="help-note">
              {mode === 'easy'
                ? 'Easy mode shows templates and essential settings. The execution target stays visible in the toolbar.'
                : 'Pro mode adds Program, Prepare, and JSON views, layout tools, cache settings, references, and secret references.'}
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
