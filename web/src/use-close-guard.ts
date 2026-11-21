import { useEffect, useRef } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { message } from '@tauri-apps/plugin-dialog';

import { isNativeDesktop } from './runtime';

const SAVE = 'Save';
const DISCARD = "Don't Save";

export type CloseChoice = 'save' | 'discard' | 'cancel';

export function closeChoice(result: string): CloseChoice {
  if (result === SAVE) return 'save';
  if (result === DISCARD) return 'discard';
  return 'cancel';
}

interface CloseGuardOptions {
  dirty: boolean;
  /** Save the open workflow; resolves true only once it is on disk. */
  save: () => Promise<boolean>;
  /** Called when the user closes without saving. */
  discard: () => void;
}

/**
 * Asks before the desktop window closes with unsaved changes. `beforeunload`
 * never fires for a native window close, so the guard listens for the
 * window's close request instead. ⌘Q is routed to the same request by the
 * native menu (see `src-tauri/src/menu.rs`).
 */
export function useCloseGuard(options: CloseGuardOptions): void {
  const latest = useRef(options);
  useEffect(() => {
    latest.current = options;
  });
  useEffect(() => {
    if (!isNativeDesktop()) return undefined;
    let unlisten: (() => void) | null = null;
    let live = true;
    void getCurrentWindow().onCloseRequested(async (event) => {
      if (!latest.current.dirty) return;
      const result = await message('Your workflow has changes that are not saved.', {
        title: 'Save changes before closing?',
        kind: 'warning',
        buttons: { yes: SAVE, no: DISCARD, cancel: 'Cancel' },
      });
      const choice = closeChoice(result);
      if (choice === 'discard') {
        latest.current.discard();
      } else if (choice === 'cancel' || !(await latest.current.save())) {
        event.preventDefault();
      }
    }).then((stop) => {
      if (live) unlisten = stop;
      else stop();
    });
    return () => {
      live = false;
      unlisten?.();
    };
  }, []);
}
