import { useCallback, useMemo, useState } from 'react';

/**
 * Editable text derived from a source value. The draft belongs to the source
 * it was typed against: when the source changes (an apply, undo, or another
 * editor), the text falls back to the freshly formatted source instead of an
 * effect copying it in after render.
 */
export function useDraft<T>(source: T, format: (value: T) => string): [string, (text: string) => void] {
  const formatted = useMemo(() => format(source), [format, source]);
  const [draft, setDraft] = useState<{ source: T; text: string } | null>(null);
  const text = draft && draft.source === source ? draft.text : formatted;
  const setText = useCallback((next: string) => setDraft({ source, text: next }), [source]);
  return [text, setText];
}

export function prettyJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

interface JsonDraft {
  text: string;
  /** Canonical JSON of the value the user was editing when they typed. */
  base: string;
  /** Canonical JSON of the typed text, or null while it does not parse. */
  parsed: string | null;
}

export type JsonDraftEdit<T> = { ok: true; value: T } | { ok: false };

/**
 * Text editing for a JSON value that keeps the user's own text (spacing,
 * cursor position, half-typed input) while it still describes the current
 * value, and shows the freshly formatted value after an outside change such
 * as undo or another editor.
 */
export function useJsonDraft<T>(
  value: T,
  parse: (text: string) => T,
  indent?: number,
): { text: string; valid: boolean; edit: (text: string) => JsonDraftEdit<T> } {
  const canonical = JSON.stringify(value);
  const [draft, setDraft] = useState<JsonDraft | null>(null);
  const current = draft && (draft.base === canonical || draft.parsed === canonical) ? draft : null;
  const edit = useCallback((text: string): JsonDraftEdit<T> => {
    try {
      const parsed = parse(text);
      setDraft({ text, base: canonical, parsed: JSON.stringify(parsed) });
      return { ok: true, value: parsed };
    } catch {
      setDraft({ text, base: canonical, parsed: null });
      return { ok: false };
    }
  }, [canonical, parse]);
  return {
    text: current ? current.text : JSON.stringify(value, null, indent) ?? '',
    valid: !current || current.parsed !== null,
    edit,
  };
}
