import { useCallback, useEffect, useMemo, useState } from 'react';

import type { StudioDocument } from './types';
import { decodeStudioDocument, parseJsonValue } from './decode';

const RECOVERY_KEY = 'mere.graph-studio.recovery.v1';
const HISTORY_LIMIT = 100;

interface DocumentHistory {
  past: StudioDocument[];
  present: StudioDocument;
  future: StudioDocument[];
  savedKey: string;
}

export interface DocumentHistoryController {
  document: StudioDocument;
  commit: (update: StudioDocument | ((current: StudioDocument) => StudioDocument)) => void;
  replace: (document: StudioDocument, saved: boolean) => void;
  markSaved: (savedDocument?: StudioDocument) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  dirty: boolean;
}

function documentKey(document: StudioDocument): string {
  return JSON.stringify(document);
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
    setHistory((current) => {
      const next = typeof update === 'function' ? update(current.present) : update;
      if (documentKey(next) === documentKey(current.present)) return current;
      return {
        past: [...current.past, current.present].slice(-HISTORY_LIMIT),
        present: next,
        future: [],
        savedKey: current.savedKey,
      };
    });
  }, []);

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

  const undo = useCallback(() => {
    setHistory((current) => {
      const previous = current.past.at(-1);
      if (!previous) return current;
      return {
        past: current.past.slice(0, -1),
        present: previous,
        future: [current.present, ...current.future],
        savedKey: current.savedKey,
      };
    });
  }, []);

  const redo = useCallback(() => {
    setHistory((current) => {
      const next = current.future[0];
      if (!next) return current;
      return {
        past: [...current.past, current.present].slice(-HISTORY_LIMIT),
        present: next,
        future: current.future.slice(1),
        savedKey: current.savedKey,
      };
    });
  }, []);

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
    replace,
    markSaved,
    undo,
    redo,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    dirty,
  };
}
