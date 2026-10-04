import { useState, useMemo, useCallback } from 'react';

/**
 * usePendingPropertyChanges
 *
 * Shared "pending changes" reducer for CPS property editors — tracks
 * added/modified/deleted keys against a base `originalProps` map and
 * exposes `mergedProps`/`pendingCount` plus the mutator functions.
 *
 * This exact `{ added: {}, modified: {}, deleted: new Set() }` state shape
 * and its updateProperty/addProperty/markDeleted/discardChanges logic was
 * previously implemented 3 times (CpsManagerPage's main component,
 * CpsManagerPage's SecureGroupEditor, and GlobalCpsManagerPage) — see
 * FRONTEND_ARCHITECTURE_REVIEW.md §1 finding #6.
 *
 * @param {Record<string, any>} originalProps  Base property map (pre-edit)
 * @param {object} [opts]
 * @param {(prevPendingChanges: object) => void} [opts.onBeforeChange]
 *   Optional hook invoked with the pending-changes snapshot *before* each
 *   mutation — e.g. CpsManagerPage's main editor uses this to push an undo
 *   history entry prior to every edit. Callers that don't need undo/history
 *   tracking can simply omit it.
 */
export function usePendingPropertyChanges(originalProps, opts = {}) {
  const { onBeforeChange } = opts;
  const [pendingChanges, setPendingChanges] = useState({ added: {}, modified: {}, deleted: new Set() });

  const mergedProps = useMemo(() => {
    const m = { ...originalProps, ...pendingChanges.modified, ...pendingChanges.added };
    pendingChanges.deleted.forEach(k => delete m[k]);
    return m;
  }, [originalProps, pendingChanges]);

  const pendingCount = Object.keys(pendingChanges.added).length
    + Object.keys(pendingChanges.modified).length
    + pendingChanges.deleted.size;

  const hasPendingChanges = pendingCount > 0;

  const updateProperty = useCallback((key, newValue) => {
    setPendingChanges(prev => {
      onBeforeChange?.(prev);
      const next = { ...prev, added: { ...prev.added }, modified: { ...prev.modified }, deleted: new Set(prev.deleted) };
      if (key in prev.added) { next.added = { ...prev.added, [key]: newValue }; }
      else { next.modified = { ...prev.modified, [key]: newValue }; }
      return next;
    });
  }, [onBeforeChange]);

  const addProperty = useCallback((key, value) => {
    if (!key.trim()) return;
    setPendingChanges(prev => {
      onBeforeChange?.(prev);
      return {
        ...prev,
        added: { ...prev.added, [key.trim()]: value },
        deleted: (() => { const s = new Set(prev.deleted); s.delete(key.trim()); return s; })(),
      };
    });
  }, [onBeforeChange]);

  const markDeleted = useCallback((key) => {
    setPendingChanges(prev => {
      onBeforeChange?.(prev);
      const next = { ...prev, added: { ...prev.added }, modified: { ...prev.modified }, deleted: new Set(prev.deleted) };
      if (key in next.added) { delete next.added[key]; }
      else { next.deleted.add(key); delete next.modified[key]; }
      return next;
    });
  }, [onBeforeChange]);

  const discardChanges = useCallback(() => {
    setPendingChanges({ added: {}, modified: {}, deleted: new Set() });
  }, []);

  return {
    pendingChanges,
    setPendingChanges,
    mergedProps,
    pendingCount,
    hasPendingChanges,
    updateProperty,
    addProperty,
    markDeleted,
    discardChanges,
  };
}
