import { useState, useEffect, useMemo } from 'react';
import {
  getVisibleBgIds, saveVisibleBgIds, applyBgFilter,
  getVisibleEnvIds, saveVisibleEnvIds, applyEnvFilter,
} from '../utils/filterUtils';

/**
 * useBgEnvFilter
 *
 * Collapses the "listen for bgFilterChanged/envFilterChanged, bump a dummy
 * version counter to force a re-render" pattern that was independently
 * copy-pasted into ApiManagerPage, ApplicationsPage, CpsManagerPage,
 * CpsComparisonPage, ExchangePage, and GlobalSearchPage (6 pages) — see
 * FRONTEND_ARCHITECTURE_REVIEW.md §1 finding #12 and §6.
 *
 * The underlying filter state (which BG/env IDs are visible) already lives
 * in localStorage and is shared across the whole app via the
 * `bgFilterChanged`/`envFilterChanged` window events dispatched by
 * utils/filterUtils.js — a React Context would only add a provider layer
 * on top of state that's already global outside React, so this is
 * implemented as a plain hook instead of introducing another context.
 *
 * Usage:
 *   const { visibleBgIds, visibleEnvIds, filterBgs, filterEnvs } = useBgEnvFilter();
 *   const visibleGroups = filterBgs(allBusinessGroups);
 *
 * @returns {{
 *   bgFilterVersion: number,
 *   envFilterVersion: number,
 *   visibleBgIds: Set<string>,
 *   visibleEnvIds: Set<string>,
 *   filterBgs: (groups: Array) => Array,
 *   filterEnvs: (envs: Array) => Array,
 * }}
 */
export function useBgEnvFilter() {
  const [bgFilterVersion, setBgFilterVersion] = useState(0);
  const [envFilterVersion, setEnvFilterVersion] = useState(0);

  useEffect(() => {
    const handler = () => setBgFilterVersion((v) => v + 1);
    window.addEventListener('bgFilterChanged', handler);
    return () => window.removeEventListener('bgFilterChanged', handler);
  }, []);

  useEffect(() => {
    const handler = () => setEnvFilterVersion((v) => v + 1);
    window.addEventListener('envFilterChanged', handler);
    return () => window.removeEventListener('envFilterChanged', handler);
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const visibleBgIds = useMemo(() => getVisibleBgIds(), [bgFilterVersion]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const visibleEnvIds = useMemo(() => getVisibleEnvIds(), [envFilterVersion]);

  const filterBgs = useMemo(() => (groups) => applyBgFilter(groups), [bgFilterVersion]);
  const filterEnvs = useMemo(() => (envs) => applyEnvFilter(envs), [envFilterVersion]);

  return {
    bgFilterVersion,
    envFilterVersion,
    visibleBgIds,
    visibleEnvIds,
    filterBgs,
    filterEnvs,
  };
}

export { saveVisibleBgIds, saveVisibleEnvIds };
