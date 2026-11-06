import { useEffect, useRef, useState } from 'react';

export interface ObjectUrlState {
  url: string | null;
  failed: boolean;
  loading: boolean;
}

const IDLE: ObjectUrlState = { url: null, failed: false, loading: false };
const LOADING: ObjectUrlState = { url: null, failed: false, loading: true };

/**
 * Loads a blob for `key` and exposes it as an object URL, revoked when the key
 * changes or the component unmounts. Results are tied to the key they were
 * loaded for, so a new key never shows the previous media while it loads.
 *
 * The loader is read from a ref: callers may pass an inline function without
 * re-downloading on every render. Only a change of `key` (or `null` to skip
 * loading) starts a new request, so the key must identify the media.
 */
export function useObjectUrl(key: string | null, load: () => Promise<Blob>): ObjectUrlState {
  const loader = useRef(load);
  useEffect(() => {
    loader.current = load;
  });
  const [state, setState] = useState<{ key: string } & ObjectUrlState>({ key: '', ...IDLE });
  useEffect(() => {
    if (key === null) return undefined;
    let live = true;
    let objectUrl: string | null = null;
    void loader.current().then((blob) => {
      if (!live) return;
      objectUrl = URL.createObjectURL(blob);
      setState({ key, url: objectUrl, failed: false, loading: false });
    }).catch(() => {
      if (live) setState({ key, url: null, failed: true, loading: false });
    });
    return () => {
      live = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [key]);
  if (key === null) return IDLE;
  return state.key === key ? state : LOADING;
}

/** A stable key for one artifact or asset request. */
export function mediaKey(...parts: (string | null | undefined)[]): string {
  return JSON.stringify(parts);
}
