import { useState, useEffect, useRef, useCallback } from 'react';
import { getOrFetch, keepFresh, stopKeepingFresh } from '../services/apiCache';

/**
 * useCachedQuery
 *
 * Wraps the already-solid SWR engine in services/apiCache.js (fresh/stale
 * tiers, inflight dedup, idle-time keep-fresh sweep) in a React hook so
 * pages stop hand-rolling their own `loading`/`error`/`data` state plus a
 * manual `keepFresh`/`stopKeepingFresh` effect — see
 * FRONTEND_ARCHITECTURE_REVIEW.md §3/§7 (the "100% opt-in, undocumented at
 * call sites" finding).
 *
 * Usage:
 *   const { data, loading, error, refetch } = useCachedQuery(
 *     CK.bgs(orgId),
 *     () => api.get('/organizations/business-groups').then(r => r.data?.data || []),
 *     { staleMs: 30 * 60 * 1000 }
 *   );
 *
 * @param {string|null} key        Cache key (CK.* factory). Pass null/undefined
 *                                 to skip fetching (e.g. while a dependency
 *                                 like orgId isn't ready yet).
 * @param {() => Promise<any>} fetchFn
 * @param {object} [opts]
 * @param {number} [opts.staleMs]  Custom eviction window passed through to apiCache
 * @param {boolean} [opts.keepFresh=true]  Register this query with the
 *                                 background keep-fresh sweep so it never
 *                                 goes cold even without re-navigation.
 * @returns {{ data: any, loading: boolean, error: any, refetch: () => Promise<void> }}
 */
export function useCachedQuery(key, fetchFn, opts = {}) {
  const { staleMs, keepFresh: shouldKeepFresh = true } = opts;
  const [state, setState] = useState({ data: undefined, loading: !!key, error: null });
  const fetchFnRef = useRef(fetchFn);
  fetchFnRef.current = fetchFn;

  const run = useCallback(() => {
    if (!key) return Promise.resolve();
    setState((s) => ({ ...s, loading: true, error: null }));
    return getOrFetch(key, () => fetchFnRef.current(), staleMs)
      .then((data) => setState({ data, loading: false, error: null }))
      .catch((error) => setState((s) => ({ ...s, loading: false, error })));
  }, [key, staleMs]);

  useEffect(() => {
    let alive = true;
    if (!key) {
      setState({ data: undefined, loading: false, error: null });
      return;
    }
    setState((s) => ({ ...s, loading: true, error: null }));
    getOrFetch(key, () => fetchFnRef.current(), staleMs)
      .then((data) => { if (alive) setState({ data, loading: false, error: null }); })
      .catch((error) => { if (alive) setState((s) => ({ ...s, loading: false, error })); });

    if (shouldKeepFresh) keepFresh(key, () => fetchFnRef.current());

    return () => {
      alive = false;
      if (shouldKeepFresh) stopKeepingFresh(key);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, staleMs, shouldKeepFresh]);

  return { ...state, refetch: run };
}
