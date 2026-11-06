function sameDataValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Whether a canvas node's data still shows the same thing.
 *
 * Values compare by content and other functions by identity. The keys in
 * `boundCallbacks` hold callbacks that bind only the node id and call through
 * the canvas's latest handlers, so any two of them for the same node are
 * interchangeable and only their presence matters.
 */
export function sameNodeData(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
  boundCallbacks: ReadonlySet<string>,
): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].every((key) => boundCallbacks.has(key)
    ? typeof a[key] === typeof b[key]
    : sameDataValue(a[key], b[key]));
}
