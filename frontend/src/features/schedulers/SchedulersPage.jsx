import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { Search, RefreshCw, AlertTriangle, X, Clock, Zap, Activity, Power, CheckSquare, Square, Key } from 'lucide-react';
import cronstrue from 'cronstrue';
import Select from '../../components/ui/Select';
import TableHeader from '../../components/ui/TableHeader';
import { applyBgFilter } from '../../components/shared/BgFilterModal';
import { applyEnvFilter } from '../../components/shared/EnvFilterModal';
import { getBusinessGroups, getEnvironments, getAllSchedulers, runCloudhub1SchedulerNow, runCloudhub2SchedulerNow, setCloudhub1SchedulerEnabled, setCloudhub2SchedulerEnabled } from '../../services/applicationsService';
import { getCachedSWR, setCached, bustCache, keepFresh, stopKeepingFresh } from '../../services/apiCache';
import { CK } from '../../services/cacheKeys';
import { ENV_BADGE } from '../../utils/appUtils';
import { ENV_TAG_COLOR } from '../../utils/accentColors';
import { getErrorMessage } from '../../services/http';
import { useBgEnvFilter } from '../../hooks/useBgEnvFilter';
import { useDebounce } from '../../hooks/useDebounce';
import { mapWithConcurrency } from '../../utils/concurrencyPool';
import { StatTile, MetaTag, PulseDot, getNextCronRun, SchedulerConfirmModal, SchedulerToggleConfirmModal, BulkSchedulerToggleConfirmModal } from '../applications/shared';

// Caps concurrent /applications/schedulers/{orgId} requests when "All
// Organizations" fans out across many BGs. Each of those backend requests
// ALSO fans out up to 8 concurrent per-app calls internally (see backend's
// SCHEDULERS_FAN_OUT_CONCURRENCY) — without this cap, total in-flight
// Anypoint calls scaled as (visible BG count) × 8, unbounded.
const BG_FAN_OUT_CONCURRENCY = 4;

// ── Cache TTL constants ──────────────────────────────────────────────────
// Mirrors ApplicationsPage's APP_STALE_MS reasoning — FRESH_MS (3 min) is
// fixed inside apiCache.js; this is the hard eviction window.
const SCHED_STALE_MS = 20 * 60 * 1000; // 20 min eviction

/**
 * Standalone fetch helper mirroring ApplicationsPage's _fetchAndCacheApps —
 * fetches the aggregate scheduler list for every BG id, merges + dedupes,
 * stores in cache, and returns the merged array. Does NOT touch React state.
 */
async function _fetchAndCacheSchedulers(bgId, bgIds, cacheKey) {
  const results = await mapWithConcurrency(bgIds, BG_FAN_OUT_CONCURRENCY, (id) => getAllSchedulers(id));
  const merged = [];
  const errors = [];
  const seen = new Set();
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      (r.value.data.data || []).forEach((s) => {
        // rowId (not schedulerKey) — schedulerKey can legitimately collide
        // between two distinct schedulers in the same app (e.g. the same
        // flow scheduled twice); deduping on it would silently drop one of
        // them instead of just failing to disambiguate which action it maps to.
        const key = `${bgIds[i]}|${s.envId}|${s.appId}|${s.rowId}`;
        if (!seen.has(key)) { seen.add(key); merged.push({ ...s, _bgId: bgIds[i] }); }
      });
      if (r.value.data._errors?.length) errors.push(...r.value.data._errors);
    } else {
      errors.push(`BG ${bgIds[i]}: ${r.reason?.message || 'fetch failed'}`);
    }
  });
  setCached(cacheKey, merged, SCHED_STALE_MS);
  return { merged, errors };
}

/**
 * Memoized table row — cronstrue.toString() + getNextCronRun() are
 * non-trivial parsing work (see shared.jsx's hand-rolled cron evaluator)
 * that used to re-run for every visible row on every re-render of
 * SchedulersPage, including ones triggered by unrelated state (toast
 * auto-dismiss timers, filter dropdowns, other rows' loading flags...).
 * Extracting the row + wrapping in React.memo, with the expensive values
 * computed via useMemo keyed only on this row's own cron/enabled state,
 * means a row only redoes that work when ITS OWN data actually changes.
 * All callback props are stable references (useState setters / useCallback)
 * so React.memo's shallow prop comparison actually skips re-renders.
 */
const SchedulerRow = React.memo(function SchedulerRow({
  s, rowKeyStr, isChecked, isTriggering, isToggling, envType,
  onToggleSelect, onRequestToggle, onRequestTrigger, onNavigateToApp,
}) {
  const active = s.enabled !== false;
  const { decodedCron, computedNextRun } = useMemo(() => {
    if (!s.cron || s.unresolvedPlaceholder) return { decodedCron: '', computedNextRun: null };
    let decoded = '';
    try { decoded = cronstrue.toString(s.cron, { throwExceptionOnParseError: true }); } catch { /* ignore */ }
    return { decodedCron: decoded, computedNextRun: active ? getNextCronRun(s.cron) : null };
  }, [s.cron, s.unresolvedPlaceholder, active]);
  // appStatus always comes through backend's normalizeStatus() (see
  // appHelpers.js), which already canonicalizes STARTED -> RUNNING before
  // this ever reaches the frontend — no need to check both.
  const appRunning = (s.appStatus || '').toUpperCase() === 'RUNNING';

  return (
    <tr className={`group hover:bg-sfpurple-50/40 dark:hover:bg-sfpurple-500/[0.08] transition-colors ${isChecked ? 'bg-sfpurple-50/60 dark:bg-sfpurple-500/[0.12]' : ''}`}>
      <td className="px-4 py-3.5" onClick={() => onToggleSelect(rowKeyStr)}>
        <div className="cursor-pointer flex items-center justify-center">
          {isChecked ? <CheckSquare size={14} className="text-sfpurple-600 dark:text-sfpurple-400" /> : <Square size={14} className="text-gray-300 dark:text-gray-600" />}
        </div>
      </td>
      <td className="px-4 py-3.5">
        <div className="flex items-center gap-2">
          <PulseDot active={active} />
          <div className="min-w-0">
            <p className="text-gray-900 dark:text-gray-100 font-semibold text-xs truncate max-w-[180px]">{s.appName}</p>
            <span className={`text-[10px] px-1.5 py-0.5 rounded-md font-semibold ${
              s.deploymentType === 'CloudHub 2.0' ? 'bg-sf-50 text-sf-700 dark:bg-sf-500/15 dark:text-sf-300' : 'bg-sfpurple-50 text-sfpurple-700 dark:bg-sfpurple-500/15 dark:text-sfpurple-300'
            }`}>{s.deploymentType === 'CloudHub 2.0' ? 'CH2' : 'CH1'}</span>
          </div>
        </div>
      </td>
      <td className="px-4 py-3.5">
        <div className="flex items-center gap-1.5">
          <span className={`w-2 h-2 rounded-full flex-shrink-0 ring-2 ring-white dark:ring-gray-800 ${ENV_BADGE[envType] || 'bg-gray-400'}`} />
          <span className="text-gray-600 dark:text-gray-400 text-xs">{s.envName}</span>
        </div>
      </td>
      <td className="px-4 py-3.5">
        <p className="font-mono text-xs text-gray-800 dark:text-gray-200 break-all max-w-[180px]">{s.flowName}</p>
        <span className={`inline-flex items-center text-[10px] px-1.5 py-0.5 rounded-md font-semibold mt-1 ${active ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500'}`}>
          {active ? 'Enabled' : 'Disabled'}
        </span>
        {s.ambiguousKey && (
          <span title="Another scheduler in this app shares the same identifier — Run Now/Toggle are disabled to avoid acting on the wrong one"
            className="inline-flex items-center text-[10px] px-1.5 py-0.5 rounded-md font-semibold mt-1 ml-1 bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400">
            ⚠ ambiguous
          </span>
        )}
      </td>
      <td className="px-4 py-3.5 max-w-[220px]">
        {s.cron ? (
          <div className="space-y-1">
            <div className="flex items-center gap-1.5 flex-wrap">
              <MetaTag color={s.unresolvedPlaceholder ? 'gray' : 'cyan'}>{s.cron}</MetaTag>
              {s.timeZone && <span className="text-[10px] text-sfteal-600 dark:text-sfteal-400">🕐 {s.timeZone}</span>}
            </div>
            {decodedCron && <p className="text-[11px] text-gray-600 dark:text-gray-300">{decodedCron}</p>}
            {s.unresolvedPlaceholder && (
              <button
                onClick={() => onNavigateToApp(s._bgId, s.envId, s.appId)}
                title="Open this app's Infrastructure tab to resolve the cron value from CPS properties"
                className="flex items-center gap-1 text-[10px] text-amber-600 dark:text-amber-400 hover:text-amber-700 dark:hover:text-amber-300 hover:underline">
                <Key size={9} /> Resolve from CPS →
              </button>
            )}
          </div>
        ) : s.frequency != null ? (
          <MetaTag color="blue">{s.frequency}{s.timeUnit ? ` ${s.timeUnit}` : ''}</MetaTag>
        ) : <span className="text-gray-400 dark:text-gray-600 text-xs">—</span>}
      </td>
      <td className="px-4 py-3.5 text-xs">
        {computedNextRun ? (
          <>
            <span className="text-sfpurple-700 dark:text-sfpurple-300 font-mono font-semibold">{computedNextRun.toLocaleDateString()}</span>
            <p className="text-sfpurple-500 dark:text-sfpurple-400 text-[10px] font-mono">{computedNextRun.toLocaleTimeString()}</p>
          </>
        ) : <span className="text-gray-400 dark:text-gray-600">—</span>}
      </td>
      <td className="px-4 py-3.5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-center gap-1.5">
          <button
            onClick={() => onRequestToggle({ schedulerKey: rowKeyStr, nextEnabled: !active })}
            disabled={isToggling || s.ambiguousKey}
            title={s.ambiguousKey ? 'Ambiguous scheduler identifier — another scheduler in this app shares the same name/flow, so this action is disabled to avoid toggling the wrong one' : (active ? 'Disable' : 'Enable')}
            className={`flex items-center gap-1 px-2 py-1.5 text-[10px] font-semibold rounded-lg border transition-all disabled:opacity-40 ${
              active
                ? 'bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-300 border-red-200/60 dark:border-red-400/20 hover:bg-red-600 hover:text-white'
                : 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-200/60 dark:border-emerald-400/20 hover:bg-emerald-600 hover:text-white'
            }`}>
            {isToggling ? <RefreshCw size={11} className="animate-spin" /> : <Power size={11} />}
          </button>
          <button
            onClick={() => onRequestTrigger(rowKeyStr)}
            disabled={isTriggering || !appRunning || s.ambiguousKey}
            title={s.ambiguousKey ? 'Ambiguous scheduler identifier — another scheduler in this app shares the same name/flow, so this action is disabled to avoid triggering the wrong one' : (!appRunning ? 'App must be running to trigger' : 'Run now')}
            className="flex items-center gap-1 px-2 py-1.5 text-[10px] font-semibold rounded-lg border transition-all disabled:opacity-40 bg-sfpurple-50 dark:bg-sfpurple-500/10 text-sfpurple-700 dark:text-sfpurple-300 border-sfpurple-200/60 dark:border-sfpurple-400/20 hover:bg-sfpurple-600 hover:text-white">
            {isTriggering ? <RefreshCw size={11} className="animate-spin" /> : <Zap size={11} />}
          </button>
        </div>
      </td>
    </tr>
  );
});

export default function SchedulersPage() {
  const { orgId } = useAuth();
  const navigate = useNavigate();

  const [allBusinessGroups, setAllBusinessGroups] = useState([]);
  const [selectedBg, setSelectedBg] = useState(
    () => localStorage.getItem('mule_schedulers_selected_bg') || ''
  );
  useEffect(() => {
    if (selectedBg) localStorage.setItem('mule_schedulers_selected_bg', selectedBg);
  }, [selectedBg]);

  const [environments, setEnvironments] = useState([]);
  const [schedulers, setSchedulers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [bgLoading, setBgLoading] = useState(true);
  const [error, setError] = useState('');
  // Partial per-app/per-BG fetch failures surfaced from _fetchSchedulersSummary's
  // _errors — previously collected and silently discarded.
  const [fetchErrors, setFetchErrors] = useState([]);

  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 200);
  const [filterEnv, setFilterEnv] = useState('');
  const [filterStatus, setFilterStatus] = useState(''); // enabled/disabled
  const [filterType, setFilterType] = useState(''); // CloudHub 1.0 / 2.0

  const { bgFilterVersion, envFilterVersion } = useBgEnvFilter();

  // Single-scheduler action state
  const [triggerLoadingSet, setTriggerLoadingSet] = useState(new Set());
  const [toggleLoadingSet, setToggleLoadingSet] = useState(new Set());
  const [schedulerConfirmKey, setSchedulerConfirmKey] = useState(null);
  const [schedulerToggleConfirm, setSchedulerToggleConfirm] = useState(null);
  const [triggerResult, setTriggerResult] = useState(null);

  // Bulk selection state
  const [selectedKeys, setSelectedKeys] = useState(new Set());
  const [bulkSchedulerToggleConfirm, setBulkSchedulerToggleConfirm] = useState(null);
  const [bulkLoading, setBulkLoading] = useState(false);

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const keepFreshKeyRef = useRef(null);
  const isMounted = useRef(true);
  useEffect(() => () => { isMounted.current = false; }, []);

  // Uses rowId (guaranteed unique within an app — see backend's
  // normalizeSchedulerRow) rather than schedulerKey, which can legitimately
  // collide when two schedulers in the same app share a derived name/flow.
  const rowKey = useCallback((s) => `${s._bgId}|${s.envId}|${s.appId}|${s.rowId}`, []);

  const loadBusinessGroups = async () => {
    setBgLoading(true);
    try {
      const cacheKey = CK.bgs(orgId);
      const swr = getCachedSWR(cacheKey);
      if (swr) {
        setAllBusinessGroups(swr.data);
        const savedBg = localStorage.getItem('mule_schedulers_selected_bg');
        const isValidSaved = savedBg && (savedBg === '__all__' || swr.data.some((g) => g.id === savedBg));
        const newBg = isValidSaved ? savedBg : '__all__';
        setSelectedBg(newBg);
        setBgLoading(false);
        await loadSchedulers(newBg, false, swr.data);
        if (swr.stale) {
          getBusinessGroups()
            .then((r) => {
              const fresh = r.data.data || [];
              setCached(cacheKey, fresh, 30 * 60 * 1000);
              setAllBusinessGroups(fresh);
            })
            .catch(() => {});
        }
        return;
      }
      const groups = await getBusinessGroups().then((res) => res.data.data || []);
      setCached(cacheKey, groups, 30 * 60 * 1000);
      setAllBusinessGroups(groups);
      const savedBg = localStorage.getItem('mule_schedulers_selected_bg');
      const isValidSaved = savedBg && (savedBg === '__all__' || groups.some((g) => g.id === savedBg));
      const newBg = isValidSaved ? savedBg : '__all__';
      setSelectedBg(newBg);
      await loadSchedulers(newBg, false, groups);
    } catch {
      setSelectedBg(orgId);
    }
    setBgLoading(false);
  };

  const loadSchedulers = async (bgId, forceRefresh = false, bgsOverride) => {
    const visible = applyBgFilter(bgsOverride || allBusinessGroups);
    const bgIds = bgId === '__all__'
      ? (visible.length > 0 ? visible.map((g) => g.id) : [orgId])
      : [bgId];

    if (!forceRefresh) {
      const cacheKey = CK.allSchedulers(bgId, bgIds);
      const swr = getCachedSWR(cacheKey);
      if (swr) {
        setSchedulers(swr.data);
        setError(swr.data.length === 0 ? 'No schedulers found.' : '');
        setSelectedKeys(new Set());
        if (swr.stale) {
          // Guard against setting state after unmount — the user may navigate
          // away before this background refresh resolves.
          _fetchAndCacheSchedulers(bgId, bgIds, cacheKey).then(({ merged, errors }) => {
            if (!isMounted.current) return;
            setSchedulers(merged);
            setFetchErrors(errors);
            if (merged.length === 0) setError('No schedulers found.');
          }).catch(() => {});
        }
        return;
      }
    }

    setLoading(true);
    setError('');
    setSelectedKeys(new Set());
    try {
      const [envsResults] = await Promise.all([
        Promise.allSettled(bgIds.map((id) => getEnvironments(id))),
      ]);
      const mergedEnvs = [];
      const seenEnvs = new Set();
      envsResults.forEach((r) => {
        if (r.status === 'fulfilled') {
          (r.value.data.data || []).forEach((e) => {
            if (!seenEnvs.has(e.id)) { seenEnvs.add(e.id); mergedEnvs.push(e); }
          });
        }
      });
      setEnvironments(mergedEnvs);

      const cacheKey = CK.allSchedulers(bgId, bgIds);
      const { merged, errors } = await _fetchAndCacheSchedulers(bgId, bgIds, cacheKey);
      setSchedulers(merged);
      setFetchErrors(errors);
      if (merged.length === 0) setError('No schedulers found.');

      if (keepFreshKeyRef.current && keepFreshKeyRef.current !== cacheKey) {
        stopKeepingFresh(keepFreshKeyRef.current);
      }
      keepFreshKeyRef.current = cacheKey;
      keepFresh(cacheKey, () =>
        _fetchAndCacheSchedulers(bgId, bgIds, cacheKey).then(({ merged: m, errors: e }) => {
          if (isMounted.current) { setSchedulers(m); setFetchErrors(e); }
          return m;
        })
      );
    } catch (e) {
      setError(getErrorMessage(e, 'Failed to load schedulers.'));
      setSchedulers([]);
    }
    setLoading(false);
  };

  useEffect(() => { if (orgId) loadBusinessGroups(); }, [orgId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (selectedBg && allBusinessGroups.length > 0) loadSchedulers(selectedBg);
  }, [selectedBg]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setSelectedKeys(new Set()); }, [selectedBg]);

  /* ── Filtering ──────────────────────────────────────── */
  const filtered = useMemo(() => {
    const visEnvIds = new Set(applyEnvFilter(environments).map((e) => e.id));
    const envModalActive = environments.length > 0 && visEnvIds.size < environments.length;

    return schedulers.filter((s) => {
      if (envModalActive && !visEnvIds.has(s.envId)) return false;
      const matchSearch = !debouncedSearch
        || s.appName?.toLowerCase().includes(debouncedSearch.toLowerCase())
        || s.flowName?.toLowerCase().includes(debouncedSearch.toLowerCase())
        || s.cron?.toLowerCase().includes(debouncedSearch.toLowerCase());
      const matchEnv = !filterEnv || s.envId === filterEnv;
      const matchStatus = !filterStatus
        || (filterStatus === 'enabled' ? s.enabled !== false : s.enabled === false);
      const matchType = !filterType || s.deploymentType === filterType;
      return matchSearch && matchEnv && matchStatus && matchType;
    });
  }, [schedulers, environments, debouncedSearch, filterEnv, filterStatus, filterType, envFilterVersion]);

  const enabledCount = filtered.filter((s) => s.enabled !== false).length;
  const disabledCount = filtered.length - enabledCount;

  // Reset to page 1 whenever filters/search/BG change
  useEffect(() => {
    setCurrentPage(1);
  }, [search, filterEnv, filterStatus, filterType, selectedBg, filtered.length]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paginatedItems = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  // Precomputed so SchedulerRow gets a stable primitive (env type string)
  // instead of the whole `environments` array + an inline .find() per row.
  const envTypeById = useMemo(() => new Map(environments.map((e) => [e.id, e.type])), [environments]);
  const onNavigateToApp = useCallback((bgId, envId, appId) => {
    navigate(`/applications/${bgId}/${envId}/${appId}`);
  }, [navigate]);

  const visibleKeys = filtered.map(rowKey);
  const selectedVisibleCount = visibleKeys.filter((k) => selectedKeys.has(k)).length;
  const allVisibleSelected = visibleKeys.length > 0 && selectedVisibleCount === visibleKeys.length;

  const toggleSelectAll = () => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) visibleKeys.forEach((k) => next.delete(k));
      else visibleKeys.forEach((k) => next.add(k));
      return next;
    });
  };
  const toggleSelectOne = useCallback((key) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }, []);

  /* ── Actions ────────────────────────────────────────── */
  const findRow = (key) => schedulers.find((s) => rowKey(s) === key);

  const executeTrigger = async () => {
    const key = schedulerConfirmKey;
    if (!key) return;
    const row = findRow(key);
    if (!row) { setSchedulerConfirmKey(null); return; }
    setTriggerLoadingSet((prev) => new Set(prev).add(key));
    try {
      if (row.deploymentType === 'CloudHub 2.0') {
        await runCloudhub2SchedulerNow(row._bgId, row.envId, row.appId, row.schedulerKey);
      } else {
        await runCloudhub1SchedulerNow(row.envId, row.appId, row.schedulerKey, row._bgId);
      }
      setTriggerResult({ success: true, message: `✓ "${row.schedulerKey}" triggered on ${row.appName}` });
    } catch (e) {
      setTriggerResult({ success: false, message: `✗ Failed to trigger "${row.schedulerKey}": ${getErrorMessage(e)}` });
    } finally {
      setTriggerLoadingSet((prev) => { const n = new Set(prev); n.delete(key); return n; });
      setSchedulerConfirmKey(null);
      setTimeout(() => setTriggerResult(null), 6000);
    }
  };

  const setRowEnabled = async (row, enabled) => {
    if (row.deploymentType === 'CloudHub 2.0') {
      await setCloudhub2SchedulerEnabled(row._bgId, row.envId, row.appId, row.schedulerKey, enabled);
    } else {
      await setCloudhub1SchedulerEnabled(row.envId, row.appId, row.schedulerKey, row._bgId, enabled);
    }
  };

  const executeToggle = async () => {
    const state = schedulerToggleConfirm;
    if (!state) return;
    const { schedulerKey: key, nextEnabled } = state;
    const row = findRow(key);
    if (!row) { setSchedulerToggleConfirm(null); return; }
    setToggleLoadingSet((prev) => new Set(prev).add(key));
    try {
      await setRowEnabled(row, nextEnabled);
      setSchedulers((prev) => prev.map((s) => rowKey(s) === key ? { ...s, enabled: nextEnabled } : s));
      bustCache(CK.PREFIX.allSchedulers);
      // The per-app Infrastructure tab caches its own scheduler list under
      // CK.schedulers(orgId, envId, appId) — bust it too, or toggling here
      // then opening that tab within the SWR freshness window shows the
      // pre-toggle state.
      bustCache(CK.schedulers(row._bgId, row.envId, row.appId));
      setTriggerResult({ success: true, message: `✓ "${row.schedulerKey}" ${nextEnabled ? 'enabled' : 'disabled'}` });
    } catch (e) {
      setTriggerResult({ success: false, message: `✗ Failed to ${nextEnabled ? 'enable' : 'disable'} "${row.schedulerKey}": ${getErrorMessage(e)}` });
    } finally {
      setToggleLoadingSet((prev) => { const n = new Set(prev); n.delete(key); return n; });
      setSchedulerToggleConfirm(null);
      setTimeout(() => setTriggerResult(null), 6000);
    }
  };

  const executeBulkToggle = async () => {
    const state = bulkSchedulerToggleConfirm;
    if (!state) return;
    const { schedulerKeys, nextEnabled } = state;
    setBulkLoading(true);
    const results = await Promise.allSettled(schedulerKeys.map(async (key) => {
      const row = findRow(key);
      if (!row) throw new Error('not found');
      // Ambiguous rows share their schedulerKey with another scheduler in
      // the same app — same reasoning as the disabled per-row buttons.
      if (row.ambiguousKey) throw new Error('ambiguous scheduler identifier — skipped');
      await setRowEnabled(row, nextEnabled);
      return key;
    }));
    const succeeded = new Set(results.filter((r) => r.status === 'fulfilled').map((r) => r.value));
    setSchedulers((prev) => prev.map((s) => succeeded.has(rowKey(s)) ? { ...s, enabled: nextEnabled } : s));
    bustCache(CK.PREFIX.allSchedulers);
    // See executeToggle above — bust each affected app's per-app cache too.
    succeeded.forEach((key) => {
      const row = findRow(key);
      if (row) bustCache(CK.schedulers(row._bgId, row.envId, row.appId));
    });
    const failCount = schedulerKeys.length - succeeded.size;
    setTriggerResult({
      success: failCount === 0,
      message: failCount === 0
        ? `✓ ${succeeded.size} scheduler${succeeded.size !== 1 ? 's' : ''} ${nextEnabled ? 'enabled' : 'disabled'}`
        : `${succeeded.size} succeeded, ${failCount} failed`,
    });
    setBulkLoading(false);
    setBulkSchedulerToggleConfirm(null);
    setSelectedKeys(new Set());
    setTimeout(() => setTriggerResult(null), 6000);
  };

  /* ── Select options ────────────────────────────────── */
  const visibleGroups = applyBgFilter(allBusinessGroups);
  const filterActive = visibleGroups.length < allBusinessGroups.length;
  const visibleEnvs = applyEnvFilter(environments);

  const bgOptions = [
    { value: '__all__', label: 'All Organizations', tag: `${visibleGroups.length}`, tagColor: 'bg-gray-200 text-gray-600' },
    ...visibleGroups.map((g) => ({
      value: g.id, label: g.name, indent: !!g.parentId,
      tag: !g.parentId ? 'Root' : undefined, tagColor: 'bg-sf-100 text-sf-600',
    })),
  ];
  const envOptions = [
    { value: '', label: 'All Environments' },
    ...visibleEnvs.map((e) => ({
      value: e.id, label: e.name, badge: true,
      badgeColor: ENV_BADGE[e.type] || 'bg-gray-400',
      tag: e.type, tagColor: ENV_TAG_COLOR[e.type] || 'bg-gray-200 text-gray-500',
    })),
  ];
  const statusOptions = [
    { value: '', label: 'All Schedulers' },
    { value: 'enabled', label: `Enabled (${enabledCount})`, badge: true, badgeColor: 'bg-emerald-400' },
    { value: 'disabled', label: `Disabled (${disabledCount})`, badge: true, badgeColor: 'bg-gray-400' },
  ];
  const typeOptions = [
    { value: '', label: 'All Deployment Types' },
    { value: 'CloudHub 2.0', label: 'CloudHub 2.0', tag: 'CH2', tagColor: 'bg-sf-100 text-sf-600' },
    { value: 'CloudHub 1.0', label: 'CloudHub 1.0', tag: 'CH1', tagColor: 'bg-sfpurple-100 text-sfpurple-600' },
  ];

  const selectedBgName = selectedBg === '__all__'
    ? 'All Organizations'
    : visibleGroups.find((g) => g.id === selectedBg)?.name || 'Organization';

  return (
    <div className="h-full flex flex-col gap-5">
      <SchedulerConfirmModal
        schedulerKey={schedulerConfirmKey}
        onConfirm={executeTrigger}
        onCancel={() => setSchedulerConfirmKey(null)}
        loading={triggerLoadingSet.has(schedulerConfirmKey)}
      />
      <SchedulerToggleConfirmModal
        state={schedulerToggleConfirm}
        onConfirm={executeToggle}
        onCancel={() => setSchedulerToggleConfirm(null)}
        loading={toggleLoadingSet.has(schedulerToggleConfirm?.schedulerKey)}
      />
      <BulkSchedulerToggleConfirmModal
        state={bulkSchedulerToggleConfirm}
        onConfirm={executeBulkToggle}
        onCancel={() => setBulkSchedulerToggleConfirm(null)}
        loading={bulkLoading}
      />

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-lg font-bold text-gray-900 dark:text-gray-100">Schedulers</h1>
          <p className="text-xs text-gray-400 dark:text-gray-500">All scheduled flows across every application in {selectedBgName}</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {selectedVisibleCount > 0 && (
            <>
              <span className="text-[11px] text-sfpurple-700 dark:text-sfpurple-300 font-bold px-2 py-1 rounded-lg bg-sfpurple-50 dark:bg-sfpurple-500/10">{selectedVisibleCount} sel</span>
              <button onClick={() => setBulkSchedulerToggleConfirm({ schedulerKeys: visibleKeys.filter((k) => selectedKeys.has(k)), nextEnabled: true })}
                className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-xl border transition-all bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-200/60 dark:border-emerald-400/20 hover:bg-emerald-600 hover:text-white hover:border-emerald-600">
                <Power size={12} /> Enable
              </button>
              <button onClick={() => setBulkSchedulerToggleConfirm({ schedulerKeys: visibleKeys.filter((k) => selectedKeys.has(k)), nextEnabled: false })}
                className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-xl border transition-all bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-300 border-red-200/60 dark:border-red-400/20 hover:bg-red-600 hover:text-white hover:border-red-600">
                <Power size={12} /> Disable
              </button>
              <button onClick={() => setSelectedKeys(new Set())}
                className="text-[11px] text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 px-1">
                Clear
              </button>
            </>
          )}
          <button onClick={() => loadSchedulers(selectedBg, true)} disabled={loading || bgLoading}
            title="Refresh scheduler list"
            className="flex items-center justify-center w-9 h-9 rounded-xl text-gray-500 dark:text-gray-400 bg-white dark:bg-gray-800 hover:text-gray-900 dark:hover:text-gray-100 border border-gray-200 dark:border-gray-700 shadow-sm hover:shadow-md disabled:opacity-50 transition-all">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Stat tiles */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatTile icon={Clock} label="Total Schedulers" accent="purple" value={filtered.length} />
        <StatTile icon={Zap} label="Enabled" accent="emerald" value={enabledCount} sub={disabledCount > 0 ? `${disabledCount} disabled` : undefined} />
        <StatTile icon={Activity} label="Business Group" accent="blue" value={selectedBgName} />
      </div>

      {/* Toast */}
      {triggerResult && (
        <div className={`flex items-center justify-between px-4 py-3 rounded-xl border text-sm ${
          triggerResult.success ? 'bg-sfgreen-50/40 border-sfgreen-200/50 text-sfgreen-700' : 'bg-sfred-50/40 border-sfred-200/50 text-sfred-700'
        }`}>
          <span>{triggerResult.message}</span>
          <button onClick={() => setTriggerResult(null)} className="ml-4 opacity-60 hover:opacity-100"><X size={14} /></button>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2.5 bg-red-50 dark:bg-red-500/10 border border-red-200/80 dark:border-red-400/30 rounded-2xl px-4 py-3 text-red-700 dark:text-red-300 text-sm shadow-sm">
          <AlertTriangle size={15} className="flex-shrink-0" />
          {error}
        </div>
      )}

      {fetchErrors.length > 0 && (
        <div className="flex items-start gap-2.5 bg-amber-50 dark:bg-amber-500/10 border border-amber-200/80 dark:border-amber-400/30 rounded-2xl px-4 py-3 text-amber-700 dark:text-amber-300 text-xs shadow-sm">
          <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="font-semibold">{fetchErrors.length} app{fetchErrors.length !== 1 ? 's' : ''} failed to load schedulers — list may be incomplete</p>
            <ul className="mt-1 space-y-0.5 max-h-20 overflow-y-auto">
              {fetchErrors.map((e, i) => <li key={i} className="truncate">{e}</li>)}
            </ul>
          </div>
          <button onClick={() => setFetchErrors([])} className="opacity-60 hover:opacity-100 flex-shrink-0"><X size={13} /></button>
        </div>
      )}

      {/* Filters row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        <div className="sm:col-span-2 lg:col-span-1">
          <div className="relative group">
            <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500 group-focus-within:text-sf-500 pointer-events-none transition-colors" />
            <input value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Search app, flow, or cron…"
              className="w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl pl-10 pr-4 py-2.5 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 shadow-sm focus:outline-none focus:border-sf-500 dark:focus:border-sf-400 focus:ring-2 focus:ring-sf-500/15 dark:focus:ring-sf-400/15 transition-all" />
            {search && (
              <button onClick={() => setSearch('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors">
                <X size={13} />
              </button>
            )}
          </div>
        </div>
        <div className="lg:col-span-1">
          <Select
            value={selectedBg}
            onChange={(v) => { setSelectedBg(v); setSearch(''); setFilterEnv(''); setFilterStatus(''); setFilterType(''); }}
            options={bgOptions}
            placeholder="All Organizations…"
            searchable={visibleGroups.length > 5}
            disabled={bgLoading}
          />
          {filterActive && (
            <p className="text-[10px] text-sf-600 dark:text-sf-400 font-medium mt-1 pl-1">
              {visibleGroups.length}/{allBusinessGroups.length} shown
            </p>
          )}
        </div>
        <div><Select value={filterEnv} onChange={setFilterEnv} options={envOptions} placeholder="All Environments" searchable /></div>
        <div><Select value={filterStatus} onChange={setFilterStatus} options={statusOptions} placeholder="All Schedulers" /></div>
        <div><Select value={filterType} onChange={setFilterType} options={typeOptions} placeholder="All Types" /></div>
      </div>

      {loading ? (
        <div className="card-surface overflow-hidden flex-1 flex flex-col min-h-0">
          <table className="w-full text-sm">
            <TableHeader>
              <tr className="text-gray-500 dark:text-gray-400 text-xs uppercase tracking-wider">
                <th className="px-4 py-3 w-10" />
                <th className="text-left px-4 py-3">Application</th>
                <th className="text-left px-4 py-3">Flow</th>
                <th className="text-left px-4 py-3">Schedule</th>
                <th className="text-left px-4 py-3">Next Run</th>
                <th className="px-4 py-3 text-center">Actions</th>
              </tr>
            </TableHeader>
            <tbody>
              {[...Array(8)].map((_, i) => (
                <tr key={i} className="border-t border-gray-100 dark:border-gray-700/60 animate-pulse">
                  <td className="px-4 py-3.5"><div className="w-4 h-4 rounded bg-gray-100 dark:bg-gray-700" /></td>
                  <td className="px-4 py-3.5"><div className="h-3 rounded bg-gray-100 dark:bg-gray-700" style={{ width: `${100 + (i % 5) * 30}px` }} /></td>
                  <td className="px-4 py-3.5"><div className="h-3 w-32 rounded bg-gray-100 dark:bg-gray-700" /></td>
                  <td className="px-4 py-3.5"><div className="h-5 w-28 rounded-full bg-gray-100 dark:bg-gray-700" /></td>
                  <td className="px-4 py-3.5"><div className="h-3 w-20 rounded bg-gray-100 dark:bg-gray-700" /></td>
                  <td className="px-4 py-3.5"><div className="h-6 w-20 rounded-lg bg-gray-100 dark:bg-gray-700 mx-auto" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="relative card-surface overflow-hidden flex-1 flex flex-col min-h-0">
          <div className="overflow-y-auto flex-1">
          <table className="w-full text-sm">
            <TableHeader sticky>
              <tr className="text-gray-500 dark:text-gray-400 text-[11px] uppercase tracking-wider border-b border-gray-200 dark:border-white/[0.08]">
                <th className="px-4 py-3.5 w-10" onClick={toggleSelectAll}>
                  <div className="cursor-pointer flex items-center justify-center">
                    {allVisibleSelected ? <CheckSquare size={14} className="text-sfpurple-600 dark:text-sfpurple-400" /> : <Square size={14} className="text-gray-300 dark:text-gray-600" />}
                  </div>
                </th>
                <th className="text-left px-4 py-3.5 font-semibold">Application</th>
                <th className="text-left px-4 py-3.5 font-semibold">Environment</th>
                <th className="text-left px-4 py-3.5 font-semibold">Flow</th>
                <th className="text-left px-4 py-3.5 font-semibold">Schedule</th>
                <th className="text-left px-4 py-3.5 font-semibold">Next Run</th>
                <th className="px-4 py-3.5 font-semibold text-center">Actions</th>
              </tr>
            </TableHeader>
            <tbody className="divide-y divide-gray-100 dark:divide-white/[0.06]">
              {paginatedItems.map((s) => {
                const key = rowKey(s);
                return (
                  <SchedulerRow
                    key={key}
                    s={s}
                    rowKeyStr={key}
                    isChecked={selectedKeys.has(key)}
                    isTriggering={triggerLoadingSet.has(key)}
                    isToggling={toggleLoadingSet.has(key)}
                    envType={envTypeById.get(s.envId)}
                    onToggleSelect={toggleSelectOne}
                    onRequestToggle={setSchedulerToggleConfirm}
                    onRequestTrigger={setSchedulerConfirmKey}
                    onNavigateToApp={onNavigateToApp}
                  />
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-5 py-16 text-center">
                    <div className="flex flex-col items-center gap-2">
                      <div className="w-12 h-12 rounded-2xl bg-gray-100 dark:bg-gray-700/50 flex items-center justify-center mb-1">
                        <Clock size={20} className="text-gray-400 dark:text-gray-500" />
                      </div>
                      <p className="text-gray-500 dark:text-gray-400 text-sm">
                        {schedulers.length === 0 ? `No schedulers found in ${selectedBgName}.` : 'No schedulers match your filters.'}
                      </p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          </div>
        </div>
      )}

      {/* Pagination */}
      {!loading && filtered.length > 0 && (
        <div className="flex items-center justify-between flex-wrap gap-3 px-1 flex-shrink-0">
          <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
            {selectedVisibleCount > 0 && (
              <span className="text-sfpurple-700 dark:text-sfpurple-300 font-bold px-2 py-0.5 rounded-lg bg-sfpurple-50 dark:bg-sfpurple-500/10">{selectedVisibleCount} selected</span>
            )}
            <span>{filtered.length} scheduler{filtered.length !== 1 ? 's' : ''}</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
              <span>Rows</span>
              <div className="flex items-center gap-0.5 bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-0.5">
                {[25, 50, 100, 200].map((size) => (
                  <button key={size} onClick={() => { setPageSize(size); setCurrentPage(1); }}
                    className={`px-2.5 py-1 rounded-lg text-[10px] font-semibold transition-all ${
                      pageSize === size ? 'bg-white dark:bg-gray-900 text-sfpurple-700 dark:text-sfpurple-300 shadow-sm' : 'text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200'
                    }`}>
                    {size}
                  </button>
                ))}
              </div>
            </div>
            {totalPages > 1 && (
              <div className="flex items-center gap-1">
                <button onClick={() => setCurrentPage(1)} disabled={currentPage === 1}
                  className="px-2 py-1.5 text-[10px] text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 border border-gray-200 dark:border-gray-700 rounded-lg disabled:opacity-30 disabled:cursor-not-allowed shadow-sm transition-all">«</button>
                <button onClick={() => setCurrentPage((p) => Math.max(1, p - 1))} disabled={currentPage === 1}
                  className="px-2.5 py-1.5 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 border border-gray-200 dark:border-gray-700 rounded-lg disabled:opacity-30 disabled:cursor-not-allowed shadow-sm transition-all">‹</button>
                <span className="text-[10px] text-gray-400 dark:text-gray-500 px-1.5 tabular-nums">{currentPage} / {totalPages}</span>
                <button onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages}
                  className="px-2.5 py-1.5 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 border border-gray-200 dark:border-gray-700 rounded-lg disabled:opacity-30 disabled:cursor-not-allowed shadow-sm transition-all">›</button>
                <button onClick={() => setCurrentPage(totalPages)} disabled={currentPage === totalPages}
                  className="px-2 py-1.5 text-[10px] text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 border border-gray-200 dark:border-gray-700 rounded-lg disabled:opacity-30 disabled:cursor-not-allowed shadow-sm transition-all">»</button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
