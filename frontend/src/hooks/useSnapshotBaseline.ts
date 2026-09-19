import { useState } from "react";

/**
 * The previous snapshot of a query scope, for rendering deltas
 * («изменение с прошлого снапшота»).
 *
 * Semantics:
 * - The scope is a stable serializable value — pass the same query key object
 *   that owns the data. Changing scope (page/filter change) resets the
 *   baseline: comparing values across scopes would be noise, not a delta.
 * - The first snapshot in a scope produces no delta — there is nothing to
 *   compare against yet.
 * - A newer snapshot replaces the baseline only once it is displayed, so the
 *   delta stays visible between refreshes instead of flashing for one render.
 * - Placeholder data (`keepPreviousData` during a scope change) must be
 *   excluded by the caller: pass `undefined` while `isPlaceholderData` is true,
 *   otherwise a placeholder would be mistaken for the first real snapshot.
 */
export function useSnapshotBaseline<T>(scope: unknown, current: T | undefined): T | undefined {
  const [state, setState] = useState<{ scope: string; prev: T | undefined; ref: T | undefined }>(
    () => ({ scope: "", prev: undefined, ref: undefined }),
  );

  const scopeKey = JSON.stringify(scope);
  if (state.scope !== scopeKey) {
    // New query scope: the previous snapshot belongs to another page/filters.
    setState({ scope: scopeKey, prev: undefined, ref: undefined });
    return undefined;
  }
  if (current === undefined) {
    // Still loading: keep showing the last computed delta, if any.
    return state.prev;
  }
  if (current === state.ref) {
    // Same snapshot object as before (e.g. a `now`-driven re-render).
    return state.prev;
  }
  // A new snapshot arrived: it becomes the new baseline, and the previously
  // recorded snapshot is what the delta is measured against.
  setState({ scope: scopeKey, prev: state.ref, ref: current });
  return state.ref;
}
