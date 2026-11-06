import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { StudioDocument } from './types';
import { decodeStudioDocument, parseJsonValue } from './decode';

const RECOVERY_KEY = 'mere.graph-studio.recovery.v1';
const HISTORY_LIMIT = 100;

export interface DocumentHistory {
  past: StudioDocument[];
  present: StudioDocument;
  future: StudioDocument[];
  savedKey: string;
}

export interface DocumentHistoryController {
  document: StudioDocument;
  commit: (update: StudioDocument | ((current: StudioDocument) => StudioDocument)) => void;
  /** The most recently rendered document, for handlers that resume after an await. */
  latest: () => StudioDocument;
  replace: (document: StudioDocument, saved: boolean) => void;
  markSaved: (savedDocument?: StudioDocument) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  dirty: boolean;
}

// The viewport is where the user is looking, not an edit: panning or zooming
// must not create an undo step or mark the document unsaved. It is still
// stored in the sidecar so the next save and recovery restore the view.
export function documentKey(document: StudioDocument): string {
  const { viewport: _viewport, ...sidecar } = document.sidecar;
  return JSON.stringify({ ...document, sidecar });
}

function withViewport(document: StudioDocument, source: StudioDocument): StudioDocument {
  return document.sidecar.viewport === source.sidecar.viewport
    ? document
    : { ...document, sidecar: { ...document.sidecar, viewport: source.sidecar.viewport } };
}

export function commitHistory(current: DocumentHistory, next: StudioDocument): DocumentHistory {
  if (next === current.present) return current;
  if (documentKey(next) === documentKey(current.present)) return { ...current, present: next };
  return {
    past: [...current.past, current.present].slice(-HISTORY_LIMIT),
    present: next,
    future: [],
    savedKey: current.savedKey,
  };
}

export function undoHistory(current: DocumentHistory): DocumentHistory {
  const previous = current.past.at(-1);
  if (!previous) return current;
  return {
    past: current.past.slice(0, -1),
    present: withViewport(previous, current.present),
    future: [current.present, ...current.future],
    savedKey: current.savedKey,
  };
}

export function redoHistory(current: DocumentHistory): DocumentHistory {
  const next = current.future[0];
  if (!next) return current;
  return {
    past: [...current.past, current.present].slice(-HISTORY_LIMIT),
    present: withViewport(next, current.present),
    future: current.future.slice(1),
    savedKey: current.savedKey,
  };
}

export function loadRecoveredDocument(): StudioDocument | null {
  try {
    const raw = window.localStorage.getItem(RECOVERY_KEY);
    if (!raw) return null;
    return decodeStudioDocument(parseJsonValue(raw, 'recovery document'));
  } catch {
    return null;
  }
}

/** Forget the recovery copy, for when the user chose to discard their changes. */
export function discardRecovery(): void {
  try {
    window.localStorage.removeItem(RECOVERY_KEY);
  } catch {
    // Recovery is best effort when browser storage is unavailable.
  }
}

export function useDocumentHistory(initial: StudioDocument, initialSaved: boolean): DocumentHistoryController {
  const [history, setHistory] = useState<DocumentHistory>(() => ({
    past: [],
    present: initial,
    future: [],
    savedKey: initialSaved ? documentKey(initial) : '',
  }));
  const presentKey = useMemo(() => documentKey(history.present), [history.present]);
  const dirty = presentKey !== history.savedKey;

  const commit = useCallback((update: StudioDocument | ((current: StudioDocument) => StudioDocument)) => {
    setHistory((current) => commitHistory(current, typeof update === 'function' ? update(current.present) : update));
  }, []);
  const latestDocument = useRef(history.present);
  useEffect(() => {
    latestDocument.current = history.present;
  }, [history.present]);
  const latest = useCallback(() => latestDocument.current, []);

  const replace = useCallback((document: StudioDocument, saved: boolean) => {
    setHistory({
      past: [],
      present: document,
      future: [],
      savedKey: saved ? documentKey(document) : '',
    });
  }, []);

  const markSaved = useCallback((savedDocument?: StudioDocument) => {
    setHistory((current) => ({
      ...current,
      savedKey: documentKey(savedDocument ?? current.present),
    }));
  }, []);

  const undo = useCallback(() => setHistory(undoHistory), []);
  const redo = useCallback(() => setHistory(redoHistory), []);

  useEffect(() => {
    try {
      if (dirty) window.localStorage.setItem(RECOVERY_KEY, JSON.stringify(history.present));
      else window.localStorage.removeItem(RECOVERY_KEY);
    } catch {
      // Recovery is best effort when browser storage is unavailable.
    }
  }, [dirty, history.present]);

  useEffect(() => {
    const warnBeforeClose = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
    };
    window.addEventListener('beforeunload', warnBeforeClose);
    return () => window.removeEventListener('beforeunload', warnBeforeClose);
  }, [dirty]);

  return {
    document: history.present,
    commit,
    latest,
    replace,
    markSaved,
    undo,
    redo,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    dirty,
  };
}
