import { Keyboard, MousePointerClick, X } from 'lucide-react';
import type { ReactElement } from 'react';

import type { StudioMode } from '../ui';

interface ShortcutRow {
  keys: string[];
  label: string;
  proOnly?: boolean;
}

const KEYBOARD_SHORTCUTS: ShortcutRow[] = [
  { keys: ['⌘', 'K'], label: 'Command palette — search actions, nodes, and templates' },
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
  { keys: ['?'], label: 'Show this overlay' },
];

const POINTER_TIPS: ShortcutRow[] = [
  { keys: [], label: 'Drag a node from the library and drop it anywhere on the canvas' },
  { keys: [], label: 'Desktop: drop files to create visual, wireable graph inputs' },
  { keys: [], label: 'Double-click empty canvas to add a node right there' },
  { keys: [], label: 'Drag from an output port to a compatible input port to connect steps' },
  { keys: [], label: 'Scroll to zoom, drag empty space to pan' },
];

export function HelpOverlay({ open, mode, onClose }: { open: boolean; mode: StudioMode; onClose: () => void }): ReactElement | null {
  if (!open) return null;
  const shortcuts = KEYBOARD_SHORTCUTS.filter((row) => !row.proOnly || mode === 'pro');
  return (
    <div className="overlay-scrim" onMouseDown={onClose} role="presentation">
      <section className="help-overlay" role="dialog" aria-label="Keyboard shortcuts" onMouseDown={(event) => event.stopPropagation()}>
        <header className="help-heading">
          <strong>Shortcuts &amp; tips</strong>
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
                ? 'Easy mode keeps templates and essential settings in reach while the selected execution target stays visible.'
                : 'Pro mode adds Program, Prepare, JSON, layout tools, cache control, references, and secrets.'}
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
