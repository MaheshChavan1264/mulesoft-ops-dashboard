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
import { getCached, getCachedSWR, setCached, bustCache, keepFresh, stopKeepingFresh } from '../../services/apiCache';
import { CK } from '../../services/cacheKeys';
import { ENV_BADGE } from '../../utils/appUtils';
import { ENV_TAG_COLOR } from '../../utils/accentColors';
import { getErrorMessage } from '../../services/http';
import { useBgEnvFilter } from '../../hooks/useBgEnvFilter';
import { useDebounce } from '../../hooks/useDebounce';
import { mapWithConcurrency } from '../../utils/concurrencyPool';
import { getResolvedSchedule, rememberResolvedSchedule } from '../../services/cpsCronResolutionCache';
import { resolveSchedulerCpsPropsForApps, resolvePlaceholder } from '../../utils/resolveSchedulerCpsCrons';
import { useCpsCredentialStore } from '../../context/CpsCredentialStoreContext';
import { StatTile, MetaTag, PulseDot, getNextCronRun, getNextRunTzLabel, SchedulerConfirmModal, SchedulerToggleConfirmModal, BulkSchedulerToggleConfirmModal, BulkSchedulerRunConfirmModal } from '../applications/shared';

// Caps concurrent /applications/schedulers/{orgId} requests when "All
// Organizations" fans out across many BGs. Each of those backend requests
// ALSO fans out up to SCHEDULERS_FAN_OUT_CONCURRENCY (20, see backend)
// concurrent per-app calls internally — without this cap, total in-flight
// Anypoint calls would scale as (visible BG count) × 20, unbounded.
// At 6 (not 4) this still comfortably fits the Anypoint agent's maxSockets
// (150 — see anypointClient.js) alongside the per-org fan-out below.
const BG_FAN_OUT_CONCURRENCY = 6;

// ── Cache TTL constants ──────────────────────────────────────────────────
// Mirrors ApplicationsPage's APP_STALE_MS reasoning — FRESH_MS (3 min) is
// fixed inside apiCache.js; this is the hard eviction window.
const SCHED_STALE_MS = 20 * 60 * 1000; // 20 min eviction

/**
 * Standalone fetch helper mirroring ApplicationsPage's _fetchAndCacheApps —
 * fetches the aggregate scheduler list AND the environments list for every
 * BG id, merges + dedupes both, stores the pair together under one cache
 * entry, and returns them. Does NOT touch React state.
 *
 * Bundling environments with schedulers (rather than fetching them
 * separately only on a cold miss, as this used to do) matters: on a cache
 * HIT the component must still be able to populate its `environments`
 * state — otherwise the env dropdown ends up empty and the global
 * env-visibility filter silently stops applying, because both read from
 * `environments` state which would otherwise only ever get set on a cold
 * fetch. See ApplicationsPage.jsx's `_fetchAndCacheApps` for the same
 * `{ apps, envs }` pairing pattern this mirrors.
 *
 * @param {string}   bgId
 * @param {string[]} bgIds
 * @param {string[]|null} envIds  optional env-filter scope — forwarded to
 *   the backend so it only fans out requests for apps in these envs.
 * @param {string}   cacheKey
 */
// Normalizes one BG's getAllSchedulers settlement into deduped rows + error
// strings. Dedup is scoped to THIS bgId only (rowId, not schedulerKey — see
// inline comment below) — safe to call independently per BG as each one
// settles, since every row's key is prefixed with its own bgId and can
// never collide with a row from a different BG.
function _processOneSchedResult(bgId, r) {
  const rows = [];
  const errors = [];
  const seen = new Set();
  if (r.status === 'fulfilled') {
    (r.value.data.data || []).forEach((s) => {
      // rowId (not schedulerKey) — schedulerKey can legitimately collide
      // between two distinct schedulers in the same app (e.g. the same
      // flow scheduled twice); deduping on it would silently drop one of
      // them instead of just failing to disambiguate which action it maps to.
      const key = `${bgId}|${s.envId}|${s.appId}|${s.rowId}`;
      if (!seen.has(key)) { seen.add(key); rows.push({ ...s, _bgId: bgId }); }
    });
    if (r.value.data._errors?.length) errors.push(...r.value.data._errors);
  } else {
    errors.push(`BG ${bgId}: ${r.reason?.message || 'fetch failed'}`);
  }
  return { rows, errors };
}

/**
 * @param {(rows: object[], errors: string[]) => void} [onBgSettled] optional
 *   streaming hook — invoked once per BG as soon as ITS OWN getAllSchedulers
 *   call settles (not waiting for the slowest BG in the batch). Lets callers
 *   render rows incrementally on "All Organizations" instead of blocking the
 *   whole table behind the single slowest BG.
 */
async function _fetchAndCacheSchedulers(bgId, bgIds, envIds, cacheKey, onBgSettled) {
  const schedPromise = mapWithConcurrency(
    bgIds, BG_FAN_OUT_CONCURRENCY, (id) => getAllSchedulers(id, envIds),
    onBgSettled && ((id, i, result) => {
      const { rows, errors } = _processOneSchedResult(bgIds[i], result);
      onBgSettled(rows, errors);
    })
  );
  const [schedResults, envResults] = await Promise.all([
    schedPromise,
    Promise.allSettled(bgIds.map((id) => getEnvironments(id))),
  ]);

  const merged = [];
  const errors = [];
  schedResults.forEach((r, i) => {
    const { rows, errors: errs } = _processOneSchedResult(bgIds[i], r);
    merged.push(...rows);
    errors.push(...errs);
  });

  const mergedEnvs = [];
  const seenEnvs = new Set();
  envResults.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      const envsForBg = r.value.data.data || [];
      // Opportunistically populate the per-BG env cache (CK.envs) too — not
      // read by this function itself, but lets a later "All Organizations"
      // fetch skip querying a BG whose cached envs are already known to have
      // zero overlap with an active env filter (see the bgIds filtering in
      // loadSchedulers below) without this fetch paying any extra cost to
      // provide that.
      setCached(CK.envs(bgIds[i]), envsForBg, 30 * 60 * 1000);
      envsForBg.forEach((e) => {
        if (!seenEnvs.has(e.id)) { seenEnvs.add(e.id); mergedEnvs.push(e); }
      });
    }
  });

  setCached(cacheKey, { schedulers: merged, environments: mergedEnvs }, SCHED_STALE_MS);
  return { merged, environments: mergedEnvs, errors };
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
  s, rowKeyStr, isChecked, isTriggering, isToggling, isResolving, envType, resolveVersion,
  onToggleSelect, onRequestToggle, onRequestTrigger, onResolveRow, onOpenApp,
}) {
  const active = s.enabled !== false;
  // If the user already resolved this exact app+scheduler's CPS placeholder(s)
  // on the Infrastructure tab (via "Resolve from CPS →") or via this page's
  // own "Resolve CPS Crons" button, show the real value(s) instead of the raw
  // `${cps.property}` placeholder this endpoint can't itself afford to
  // resolve. Display-time only — never mutates `s` or the underlying cache.
  // Checked independently for cron vs. timezone — a scheduler can have a
  // fully resolved cron but a still-unresolved `${...}` timezone (or vice
  // versa); gating the cache lookup on cron alone meant an unresolved
  // timezone was silently rendered as its raw placeholder string forever.
  // `resolveVersion` isn't read below — it exists purely so React.memo sees
  // a changed prop and re-renders this row after a bulk resolve completes
  // (getResolvedSchedule reads a module-level Map, not React state, so
  // nothing would otherwise tell this memoized row to re-check it).
  const resolved = (s.unresolvedPlaceholder || s.unresolvedTzPlaceholder)
    ? getResolvedSchedule(s.appId, s.schedulerKey)
    : null;
  const cron = resolved?.cron ?? s.cron;
  const unresolvedPlaceholder = resolved?.cron ? false : s.unresolvedPlaceholder;
  const timeZone = resolved?.timeZone ?? s.timeZone;
  const unresolvedTzPlaceholder = resolved?.timeZone ? false : s.unresolvedTzPlaceholder;
  const { decodedCron, computedNextRun } = useMemo(() => {
    if (!cron || unresolvedPlaceholder) return { decodedCron: '', computedNextRun: null };
    let decoded = '';
    try { decoded = cronstrue.toString(cron, { throwExceptionOnParseError: true }); } catch { /* ignore */ }
    // Only pass a REAL (resolved) timezone through — an unresolved
    // `${cps.property}` placeholder string would otherwise fail Intl's zone
    // lookup and silently fall back to the IST default anyway, but passing
    // `undefined` here makes that fallback explicit instead of incidental.
    const tzForCalc = unresolvedTzPlaceholder ? undefined : timeZone;
    return { decodedCron: decoded, computedNextRun: active ? getNextCronRun(cron, tzForCalc) : null };
  }, [cron, unresolvedPlaceholder, active, timeZone, unresolvedTzPlaceholder]);
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
            <button
              onClick={(e) => { e.stopPropagation(); onOpenApp(s._bgId, s.envId, s.appId); }}
              title={`Open ${s.appName} in Application Detail`}
              className="text-gray-900 dark:text-gray-100 font-semibold text-xs truncate max-w-[260px] block hover:text-sfpurple-600 dark:hover:text-sfpurple-400 hover:underline text-left">
              {s.appName}
            </button>
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
        <p title={s.flowName} className="font-mono text-xs text-gray-800 dark:text-gray-200 truncate max-w-[220px]">{s.flowName}</p>
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
        {cron ? (
          <div className="space-y-1">
            <div className="flex items-center gap-1.5 flex-wrap">
              <MetaTag color={unresolvedPlaceholder ? 'gray' : 'cyan'}>{cron}</MetaTag>
              {timeZone && (
                unresolvedTzPlaceholder ? (
                  <span title={`Unresolved CPS placeholder: ${timeZone}`}
                    className="text-[10px] text-amber-600 dark:text-amber-400 font-mono">⚠ {timeZone}</span>
                ) : (
                  <span className="text-[10px] text-sfteal-600 dark:text-sfteal-400">🕐 {timeZone}</span>
                )
              )}
            </div>
            {decodedCron && <p className="text-[11px] text-gray-600 dark:text-gray-300">{decodedCron}</p>}
            {(unresolvedPlaceholder || unresolvedTzPlaceholder) && (
              <button
                onClick={() => onResolveRow(s)}
                disabled={isResolving}
                title="Resolve this scheduler's cron/timezone value from this app's CPS properties, right here"
                className="flex items-center gap-1 text-[10px] text-amber-600 dark:text-amber-400 hover:text-amber-700 dark:hover:text-amber-300 hover:underline disabled:opacity-50 disabled:no-underline disabled:cursor-wait">
                {isResolving ? <RefreshCw size={9} className="animate-spin" /> : <Key size={9} />}
                {isResolving ? 'Resolving…' : 'Resolve from CPS'}
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
            <p className="text-sfpurple-500 dark:text-sfpurple-400 text-[10px] font-mono">
              {computedNextRun.toLocaleTimeString()} {getNextRunTzLabel(unresolvedTzPlaceholder ? undefined : timeZone)}
            </p>
          </>
        ) : <span className="text-gray-400 dark:text-gray-600">—</span>}
      </td>
      <td className="px-4 py-3.5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-center gap-2">
          <button
            onClick={() => onRequestToggle({ schedulerKey: rowKeyStr, nextEnabled: !active })}
            disabled={isToggling || s.ambiguousKey}
            title={s.ambiguousKey ? 'Ambiguous scheduler identifier — another scheduler in this app shares the same name/flow, so this action is disabled to avoid toggling the wrong one' : (active ? 'Disable' : 'Enable')}
            className={`flex items-center gap-1.5 px-3.5 py-2.5 text-xs font-semibold rounded-lg border transition-all disabled:opacity-40 ${
              active
                ? 'bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-300 border-red-200/60 dark:border-red-400/20 hover:bg-red-600 hover:text-white'
                : 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-200/60 dark:border-emerald-400/20 hover:bg-emerald-600 hover:text-white'
            }`}>
            {isToggling ? <RefreshCw size={14} className="animate-spin" /> : <Power size={14} />}
          </button>
          <button
            onClick={() => onRequestTrigger(rowKeyStr)}
            disabled={isTriggering || !appRunning || s.ambiguousKey}
            title={s.ambiguousKey ? 'Ambiguous scheduler identifier — another scheduler in this app shares the same name/flow, so this action is disabled to avoid triggering the wrong one' : (!appRunning ? 'App must be running to trigger' : 'Run now')}
            className="flex items-center gap-1.5 px-3.5 py-2.5 text-xs font-semibold rounded-lg border transition-all disabled:opacity-40 bg-sfpurple-50 dark:bg-sfpurple-500/10 text-sfpurple-700 dark:text-sfpurple-300 border-sfpurple-200/60 dark:border-sfpurple-400/20 hover:bg-sfpurple-600 hover:text-white">
            {isTriggering ? <RefreshCw size={14} className="animate-spin" /> : <Zap size={14} />}
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
  // Persisted the same way selectedBg is — without this, navigating away
  // (e.g. "Resolve from CPS" → Infrastructure tab) and back fully unmounts
  // this page, losing the selection and silently reverting to "All
  // Environments" even though the user had deliberately narrowed it down.
  const [filterEnv, setFilterEnv] = useState(
    () => localStorage.getItem('mule_schedulers_filter_env') || ''
  );
  useEffect(() => {
    if (filterEnv) localStorage.setItem('mule_schedulers_filter_env', filterEnv);
    else localStorage.removeItem('mule_schedulers_filter_env');
  }, [filterEnv]);
  const [filterStatus, setFilterStatus] = useState(''); // enabled/disabled
  const [filterType, setFilterType] = useState(''); // CloudHub 1.0 / 2.0
  // Toggle filter — narrows the table down to schedulers whose cron and/or
  // timezone is still a raw `${cps.property}` placeholder that hasn't been
  // resolved yet (per-row "Resolve from CPS", the bulk "Resolve CPS Crons"
  // button, or the Infrastructure tab). See the `filtered` useMemo below.
  const [filterUnresolved, setFilterUnresolved] = useState(false);

  const { bgFilterVersion, envFilterVersion, visibleEnvIds } = useBgEnvFilter();

  // The actual env scope to request from the backend: the single env picked
  // in this page's own dropdown takes priority; otherwise fall back to the
  // global env-visibility filter (EnvFilterModal) so "All Environments" here
  // still only fetches/shows envs the user hasn't hidden app-wide. Empty
  // Set / no selection = no restriction (fetch everything).
  const envIdsFilter = useMemo(() => {
    if (filterEnv) return [filterEnv];
    return visibleEnvIds.size > 0 ? [...visibleEnvIds] : null;
  }, [filterEnv, visibleEnvIds]);

  // Single-scheduler action state
  const [triggerLoadingSet, setTriggerLoadingSet] = useState(new Set());
  const [toggleLoadingSet, setToggleLoadingSet] = useState(new Set());
  const [schedulerConfirmKey, setSchedulerConfirmKey] = useState(null);
  const [schedulerToggleConfirm, setSchedulerToggleConfirm] = useState(null);
  const [triggerResult, setTriggerResult] = useState(null);

  // Bulk selection state
  const [selectedKeys, setSelectedKeys] = useState(new Set());
  const [bulkSchedulerToggleConfirm, setBulkSchedulerToggleConfirm] = useState(null);
  const [bulkSchedulerRunConfirm, setBulkSchedulerRunConfirm] = useState(null);
  const [bulkLoading, setBulkLoading] = useState(false);
  const [bulkRunLoading, setBulkRunLoading] = useState(false);

  // CPS cron resolution (global "Resolve CPS Crons" button)
  const { hasCredentials, getSecret, getAllCredentials } = useCpsCredentialStore();
  const [cpsResolveLoading, setCpsResolveLoading] = useState(false);
  // Bumped after a successful bulk resolve purely to bust SchedulerRow's
  // React.memo — see the comment on SchedulerRow's `resolveVersion` prop.
  const [cpsResolveVersion, setCpsResolveVersion] = useState(0);

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const keepFreshKeyRef = useRef(null);
  const isMounted = useRef(true);
  useEffect(() => {
    // React 18 StrictMode (dev only) double-invokes effects — mount, then
    // immediately simulate an unmount by running the cleanup below, then
    // mount again — to help surface effects that aren't idempotent. With a
    // mount body that did nothing (just `() => () => {...}`), that fake
    // "unmount" cleanup set isMounted.current = false and nothing ever set
    // it back to true on the real second mount, leaving every `if
    // (!isMounted.current) return;` guard in this file (toast display,
    // post-await setState after Resolve CPS Crons / toggle / trigger /
    // bulk actions) permanently short-circuited for the rest of the
    // component's actual lifetime in dev — the user-visible symptom being
    // that nothing appeared to refresh after any action finished. Setting
    // it back to true here on every mount (including the StrictMode replay)
    // fixes that while still correctly ending up false after a REAL unmount.
    isMounted.current = true;
    return () => {
      isMounted.current = false;
      // Unlike ApplicationsPage/_fetchAndCacheApps (cheap: a handful of
      // summary calls), this page's keepFresh job re-runs the FULL per-app
      // scheduler fan-out — one HTTP call per app, no bulk endpoint exists on
      // the Anypoint side — which for a large account can take 30-90+
      // seconds. Leaving that registered forever (the pattern other pages
      // use, to keep navigating back instantly fresh) means it silently
      // re-fires every ~3 min in the background for as long as the app stays
      // open, long after the user has left this page, competing for the same
      // connection pool as every other request. Stop it on unmount instead —
      // the cost of one cold re-fetch next time this page opens is far
      // cheaper than an unbounded recurring multi-thousand-app crawl.
      if (keepFreshKeyRef.current) stopKeepingFresh(keepFreshKeyRef.current);
    };
  }, []);

  // Single coordinated toast timer — every action handler used to schedule
  // its own independent `setTimeout(() => setTriggerResult(null), 6000)`.
  // Firing two actions within 6s meant the first timer could wipe out the
  // second action's toast early. Routing every toast through showToast()
  // clears any pending timer before arming a new one, so only the latest
  // toast's own timeout ever fires, and guards against setting state after
  // this page has unmounted.
  const toastTimeoutRef = useRef(null);
  useEffect(() => () => { if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current); }, []);
  const showToast = useCallback((result) => {
    if (!isMounted.current) return;
    setTriggerResult(result);
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    toastTimeoutRef.current = setTimeout(() => {
      if (isMounted.current) setTriggerResult(null);
      toastTimeoutRef.current = null;
    }, 6000);
  }, []);

  // Uses rowId (guaranteed unique within an app — see backend's
  // normalizeSchedulerRow) rather than schedulerKey, which can legitimately
  // collide when two schedulers in the same app share a derived name/flow.
  const rowKey = useCallback((s) => `${s._bgId}|${s.envId}|${s.appId}|${s.rowId}`, []);

  // Picks the BG to show on load: the saved preference if still valid,
  // otherwise the first real BG (NOT '__all__') when nothing is saved yet.
  // For an account with hundreds/thousands of apps spread across many BGs,
  // "All Organizations" is the single most expensive fetch this page can
  // make (one HTTP call per app, PER BG) — defaulting a brand-new user into
  // it means their very first page load pays that full cost before they've
  // even chosen to see it. "All Organizations" stays one dropdown click away.
  const pickDefaultBg = (groups, savedBg) => {
    const isValidSaved = savedBg && (savedBg === '__all__' || groups.some((g) => g.id === savedBg));
    if (isValidSaved) return savedBg;
    const visible = applyBgFilter(groups);
    return visible.length > 0 ? visible[0].id : '__all__';
  };

  const loadBusinessGroups = async () => {
    setBgLoading(true);
    try {
      const cacheKey = CK.bgs(orgId);
      const swr = getCachedSWR(cacheKey);
      if (swr) {
        setAllBusinessGroups(swr.data);
        const savedBg = localStorage.getItem('mule_schedulers_selected_bg');
        const newBg = pickDefaultBg(swr.data, savedBg);
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
      const newBg = pickDefaultBg(groups, savedBg);
      setSelectedBg(newBg);
      await loadSchedulers(newBg, false, groups);
    } catch {
      setSelectedBg(orgId);
    }
    setBgLoading(false);
  };

  const loadSchedulers = async (bgId, forceRefresh = false, bgsOverride) => {
    const visible = applyBgFilter(bgsOverride || allBusinessGroups);
    let bgIds = bgId === '__all__'
      ? (visible.length > 0 ? visible.map((g) => g.id) : [orgId])
      : [bgId];
    const envIds = envIdsFilter;

    // Opportunistic skip: when an env filter is active and "All
    // Organizations" is selected, drop any BG we already KNOW (from a
    // previously cached CK.envs(bgId) entry — see _fetchAndCacheSchedulers,
    // which populates it as a side effect) has zero environments matching
    // the filter. That BG's getAllSchedulers call would always return an
    // empty list anyway, so skipping it is a pure win — one fewer full
    // per-app fan-out, at zero correctness risk. Only acts on BGs with a
    // cached answer; a BG with no cached envs yet is always kept (never
    // blocks on fetching envs just to decide whether to skip).
    if (envIds && envIds.length > 0 && bgIds.length > 1) {
      const envIdSet = new Set(envIds);
      bgIds = bgIds.filter((id) => {
        const cachedEnvs = getCached(CK.envs(id));
        if (!cachedEnvs) return true; // unknown — never skip
        return cachedEnvs.some((e) => envIdSet.has(e.id));
      });
      if (bgIds.length === 0) bgIds = [orgId]; // all skipped — fall back rather than fetch nothing
    }

    const cacheKey = CK.allSchedulers(bgId, bgIds, envIds);

    // Registers (or re-registers) the proactive keep-fresh job for this exact
    // cache scope. Previously only ever called from the cold-fetch branch
    // below — both cache-HIT branches (fresh or stale) returned early before
    // reaching it, so revisiting this page while the cache was still warm
    // silently left no recurring background refresh running. That matters
    // more here than on most pages: this refresh is a full per-app fan-out
    // (no bulk endpoint exists on the Anypoint side), so once lost it could
    // stay un-refreshed for the full 20-min eviction window with no
    // self-healing in between.
    const registerKeepFresh = () => {
      if (keepFreshKeyRef.current && keepFreshKeyRef.current !== cacheKey) {
        stopKeepingFresh(keepFreshKeyRef.current);
      }
      keepFreshKeyRef.current = cacheKey;
      keepFresh(cacheKey, () =>
        _fetchAndCacheSchedulers(bgId, bgIds, envIds, cacheKey).then(({ merged: m, environments: e2, errors: e }) => {
          if (isMounted.current) { setSchedulers(m); setEnvironments(e2); setFetchErrors(e); }
          // Keep the shape consistent with what setCached stores internally
          // (apiCache's keepFresh sweep re-stores whatever this returns).
          return { schedulers: m, environments: e2 };
        })
      );
    };

    if (!forceRefresh) {
      const swr = getCachedSWR(cacheKey);
      if (swr) {
        // Bundled payload — see _fetchAndCacheSchedulers's doc comment for
        // why `environments` must always come from the SAME cache entry as
        // `schedulers` instead of only being set on a cold fetch.
        setSchedulers(swr.data.schedulers);
        setEnvironments(swr.data.environments);
        setError(swr.data.schedulers.length === 0 ? 'No schedulers found.' : '');
        setSelectedKeys(new Set());
        registerKeepFresh();
        if (swr.stale) {
          // Guard against setting state after unmount — the user may navigate
          // away before this background refresh resolves.
          _fetchAndCacheSchedulers(bgId, bgIds, envIds, cacheKey).then(({ merged, environments: envs, errors }) => {
            if (!isMounted.current) return;
            setSchedulers(merged);
            setEnvironments(envs);
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
      // Stream rows in as each BG's fan-out settles instead of blocking the
      // whole table behind the single slowest BG — on "All Organizations"
      // this can be dozens of independent per-BG fan-outs, each taking tens
      // of seconds for large accounts. The row `key` includes `_bgId`, so
      // chunks from different BGs can never collide — safe to append as they
      // arrive without waiting for a full cross-BG dedup pass.
      const accumulated = [];
      const accumulatedErrors = [];
      let firstChunkReceived = false;
      const { merged, environments: envs, errors } = await _fetchAndCacheSchedulers(
        bgId, bgIds, envIds, cacheKey,
        (rows, errs) => {
          if (!isMounted.current) return;
          accumulated.push(...rows);
          accumulatedErrors.push(...errs);
          setSchedulers([...accumulated]);
          if (!firstChunkReceived) { firstChunkReceived = true; setLoading(false); }
        }
      );
      if (!isMounted.current) return;
      setSchedulers(merged);
      setEnvironments(envs);
      setFetchErrors(errors);
      if (merged.length === 0) setError('No schedulers found.');
      registerKeepFresh();
    } catch (e) {
      if (isMounted.current) {
        setError(getErrorMessage(e, 'Failed to load schedulers.'));
        setSchedulers([]);
      }
    }
    if (isMounted.current) setLoading(false);
  };

  useEffect(() => { if (orgId) loadBusinessGroups(); }, [orgId]); // eslint-disable-line react-hooks/exhaustive-deps
  // Re-fetch whenever the BG selection OR the effective env scope changes —
  // filterEnv (this page's own dropdown) and envFilterVersion (the global
  // env-visibility filter, bumped via a window event when EnvFilterModal
  // saves) both change `envIdsFilter`, and since schedulers are now fetched
  // scoped to that env set server-side (not just filtered client-side
  // afterwards), a change there must trigger a real re-fetch. bgFilterVersion
  // (bumped when the global BG-visibility filter saves) must ALSO trigger a
  // re-fetch while on "All Organizations" — otherwise hiding a BG there only
  // updated the dropdown/labels (computed at render time) while the already-
  // fetched scheduler rows for that now-hidden BG kept showing until the next
  // manual refresh or BG re-selection.
  useEffect(() => {
    if (selectedBg && allBusinessGroups.length > 0) loadSchedulers(selectedBg);
  }, [selectedBg, filterEnv, envFilterVersion, bgFilterVersion]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setSelectedKeys(new Set()); }, [selectedBg]);

  /* ── Filtering ──────────────────────────────────────── */
  // Search/env/status/type filters only — kept separate from the
  // "Unresolved CPS" toggle below so unresolvedCount (used for both the
  // toggle button's own count badge and the "Resolve CPS Crons" badge) can
  // reflect "how many WOULD show if the toggle were on" regardless of its
  // current state, instead of collapsing to its own filtered.length once hit.
  const baseFiltered = useMemo(() => {
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

  // Still-unresolved count — re-derived whenever cpsResolveVersion bumps so
  // the "Resolve CPS Crons" / "Unresolved CPS" badges reflect rows the
  // resolution cache has already filled in, not just the static
  // server-computed `unresolvedPlaceholder`/`unresolvedTzPlaceholder` flags
  // (which never change). Counts a row as unresolved if EITHER its cron or
  // its timezone is still a raw placeholder and hasn't been cached yet.
  // Based on `baseFiltered` (NOT the final `filtered` below) so it stays
  // meaningful even while the "Unresolved CPS" toggle itself is active.
  const unresolvedCount = useMemo(
    () => baseFiltered.filter((s) =>
      (s.unresolvedPlaceholder || s.unresolvedTzPlaceholder) && !getResolvedSchedule(s.appId, s.schedulerKey)
    ).length,
    [baseFiltered, cpsResolveVersion]
  );

  // "Unresolved CPS" filter toggle — narrows the table (and, as a side
  // effect, what the bulk "Resolve CPS Crons" button processes, since that
  // button scopes to `filtered` too) down to schedulers whose cron and/or
  // timezone is still a raw `${cps.property}` placeholder that hasn't been
  // resolved yet. Re-evaluated on cpsResolveVersion so a row that gets
  // resolved (per-row or in bulk) drops out of this view immediately
  // instead of staying listed until the next full refetch.
  const filtered = useMemo(() => {
    if (!filterUnresolved) return baseFiltered;
    return baseFiltered.filter((s) =>
      (s.unresolvedPlaceholder || s.unresolvedTzPlaceholder) && !getResolvedSchedule(s.appId, s.schedulerKey)
    );
  }, [baseFiltered, filterUnresolved, cpsResolveVersion]);

  const { enabledCount, disabledCount } = useMemo(() => {
    const enabled = filtered.filter((s) => s.enabled !== false).length;
    return { enabledCount: enabled, disabledCount: filtered.length - enabled };
  }, [filtered]);

  // Reset to page 1 on an actual user-driven filter/search/BG change —
  // deliberately NOT keyed on `filtered.length`, which also changes on
  // every background keepFresh refresh (rows appearing/disappearing,
  // enabled/disabled counts shifting) and would otherwise yank the user
  // back to page 1 mid-session with no interaction from them.
  useEffect(() => {
    setCurrentPage(1);
  }, [search, filterEnv, filterStatus, filterType, filterUnresolved, selectedBg]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  // Correction (not a user-facing "reset"): clamp down if a background
  // refresh shrinks the result set below the page the user is currently on.
  useEffect(() => {
    setCurrentPage((p) => Math.min(p, totalPages));
  }, [totalPages]);
  const paginatedItems = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  // Precomputed so SchedulerRow gets a stable primitive (env type string)
  // instead of the whole `environments` array + an inline .find() per row.
  const envTypeById = useMemo(() => new Map(environments.map((e) => [e.id, e.type])), [environments]);
  // Plain "open this app" navigation (e.g. clicking the app name) — lands on
  // the normal default (Overview) tab.
  const onOpenApp = useCallback((bgId, envId, appId) => {
    navigate(`/applications/${bgId}/${envId}/${appId}`);
  }, [navigate]);

  // Per-row "Resolve from CPS" (table's own placeholder-resolve link) —
  // tracked by appId (not rowKey/schedulerKey) because resolving one app's
  // CPS properties resolves EVERY unresolved scheduler belonging to that
  // app in one shot, same as the bulk "Resolve CPS Crons" button does per
  // app internally. A Set (not a single appId) supports resolving several
  // different apps' rows concurrently without one click blocking another.
  const [resolvingAppIds, setResolvingAppIds] = useState(new Set());
  // Lets resolveAppCpsCrons read the latest scheduler list without needing
  // `schedulers` in its own dependency array — `schedulers` changes on
  // every keepFresh background refresh, which would otherwise churn this
  // callback's identity constantly and defeat SchedulerRow's React.memo.
  const schedulersRef = useRef(schedulers);
  useEffect(() => { schedulersRef.current = schedulers; }, [schedulers]);

  /**
   * Resolves CPS cron/timezone placeholders for ONE app, right here on the
   * Schedulers dashboard — previously this instead navigated the user away
   * to that app's Infrastructure tab to do the same resolution there. Reuses
   * the same per-app CPS fetch + resolvePlaceholder logic as the bulk
   * "Resolve CPS Crons" button (resolveCpsCrons below), just scoped to a
   * single app instead of every unresolved app currently visible.
   */
  const resolveAppCpsCrons = useCallback(async (s) => {
    const { appId, envId, _bgId: bgId, deploymentType, appName } = s;
    setResolvingAppIds((prev) => new Set(prev).add(appId));
    try {
      const propsByApp = await resolveSchedulerCpsPropsForApps(
        [{ appId, envId, bgId, deploymentType }],
        { hasCredentials, getSecret, getAllCredentials }
      );
      const entry = propsByApp.get(appId);
      if (!entry || entry.error) {
        showToast({ success: false, message: `✗ Failed to resolve CPS properties for ${appName}: ${entry?.error || 'unknown error'}` });
        return;
      }
      let resolvedCount = 0;
      schedulersRef.current.forEach((row) => {
        if (row.appId !== appId) return;
        if (!row.unresolvedPlaceholder && !row.unresolvedTzPlaceholder) return;
        const { resolved: cron, wasResolved: cronResolved } = resolvePlaceholder(row.cron, entry.props);
        const { resolved: timeZone, wasResolved: tzResolved } = resolvePlaceholder(row.timeZone, entry.props);
        if (cronResolved || tzResolved) {
          rememberResolvedSchedule(row.appId, row.schedulerKey, { cron, timeZone });
          resolvedCount++;
        }
      });
      if (!isMounted.current) return;
      setCpsResolveVersion((v) => v + 1); // force rows to re-check the resolution cache
      showToast({
        success: true,
        message: resolvedCount > 0
          ? `✓ Resolved ${resolvedCount} scheduler${resolvedCount !== 1 ? 's' : ''} on ${appName} from CPS`
          : `No crons could be resolved for ${appName} — property not found in CPS`,
      });
    } catch (e) {
      showToast({ success: false, message: `✗ Failed to resolve CPS crons for ${appName}: ${getErrorMessage(e)}` });
    } finally {
      if (isMounted.current) {
        setResolvingAppIds((prev) => { const n = new Set(prev); n.delete(appId); return n; });
      }
    }
  }, [hasCredentials, getSecret, getAllCredentials, showToast]);

  const visibleKeys = useMemo(() => filtered.map(rowKey), [filtered, rowKey]);
  // O(1) lookup map instead of findRow's old `schedulers.find(...)` — called
  // once per selected row in every bulk action (O(k·n) → O(k)), and reused
  // below for confirm-modal display labels.
  const rowByKey = useMemo(() => {
    const m = new Map();
    schedulers.forEach((s) => m.set(rowKey(s), s));
    return m;
  }, [schedulers, rowKey]);
  const selectedVisibleCount = useMemo(
    () => visibleKeys.filter((k) => selectedKeys.has(k)).length,
    [visibleKeys, selectedKeys]
  );
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
  const findRow = useCallback((key) => rowByKey.get(key), [rowByKey]);
  // Human-readable identifier for confirm-modal display — `key` here is the
  // internal cross-app rowKey (bgId|envId|appId|rowId), which must stay the
  // lookup/state identifier (schedulerKey alone can collide across apps),
  // but must NEVER be shown to the user directly. See shared.jsx's
  // SchedulerConfirmModal/SchedulerToggleConfirmModal `label` prop.
  const describeRow = useCallback((key) => {
    const row = findRow(key);
    return row ? `${row.schedulerKey} (${row.appName})` : undefined;
  }, [findRow]);

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
      showToast({ success: true, message: `✓ "${row.schedulerKey}" triggered on ${row.appName}` });
    } catch (e) {
      showToast({ success: false, message: `✗ Failed to trigger "${row.schedulerKey}": ${getErrorMessage(e)}` });
    } finally {
      if (isMounted.current) {
        setTriggerLoadingSet((prev) => { const n = new Set(prev); n.delete(key); return n; });
        setSchedulerConfirmKey(null);
      }
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
      if (isMounted.current) {
        setSchedulers((prev) => prev.map((s) => rowKey(s) === key ? { ...s, enabled: nextEnabled } : s));
      }
      bustCache(CK.PREFIX.allSchedulers);
      // The per-app Infrastructure tab caches its own scheduler list under
      // CK.schedulers(orgId, envId, appId) — bust it too, or toggling here
      // then opening that tab within the SWR freshness window shows the
      // pre-toggle state.
      bustCache(CK.schedulers(row._bgId, row.envId, row.appId));
      showToast({ success: true, message: `✓ "${row.schedulerKey}" ${nextEnabled ? 'enabled' : 'disabled'}` });
    } catch (e) {
      showToast({ success: false, message: `✗ Failed to ${nextEnabled ? 'enable' : 'disable'} "${row.schedulerKey}": ${getErrorMessage(e)}` });
    } finally {
      if (isMounted.current) {
        setToggleLoadingSet((prev) => { const n = new Set(prev); n.delete(key); return n; });
        setSchedulerToggleConfirm(null);
      }
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
    if (!isMounted.current) return;
    const succeeded = new Set(results.filter((r) => r.status === 'fulfilled').map((r) => r.value));
    setSchedulers((prev) => prev.map((s) => succeeded.has(rowKey(s)) ? { ...s, enabled: nextEnabled } : s));
    bustCache(CK.PREFIX.allSchedulers);
    // See executeToggle above — bust each affected app's per-app cache too.
    succeeded.forEach((key) => {
      const row = findRow(key);
      if (row) bustCache(CK.schedulers(row._bgId, row.envId, row.appId));
    });
    const failCount = schedulerKeys.length - succeeded.size;
    showToast({
      success: failCount === 0,
      message: failCount === 0
        ? `✓ ${succeeded.size} scheduler${succeeded.size !== 1 ? 's' : ''} ${nextEnabled ? 'enabled' : 'disabled'}`
        : `${succeeded.size} succeeded, ${failCount} failed`,
    });
    setBulkLoading(false);
    setBulkSchedulerToggleConfirm(null);
    setSelectedKeys(new Set());
  };

  const executeBulkRun = async () => {
    const state = bulkSchedulerRunConfirm;
    if (!state) return;
    const { schedulerKeys } = state;
    setBulkRunLoading(true);
    setTriggerLoadingSet((prev) => { const n = new Set(prev); schedulerKeys.forEach((k) => n.add(k)); return n; });
    const results = await Promise.allSettled(schedulerKeys.map(async (key) => {
      const row = findRow(key);
      if (!row) throw new Error('not found');
      // Same two reasons single-row Run Now is disabled: ambiguous identity,
      // or the app isn't running so the trigger would just fail server-side.
      if (row.ambiguousKey) throw new Error('ambiguous scheduler identifier — skipped');
      if ((row.appStatus || '').toUpperCase() !== 'RUNNING') throw new Error('app not running — skipped');
      if (row.deploymentType === 'CloudHub 2.0') {
        await runCloudhub2SchedulerNow(row._bgId, row.envId, row.appId, row.schedulerKey);
      } else {
        await runCloudhub1SchedulerNow(row.envId, row.appId, row.schedulerKey, row._bgId);
      }
      return key;
    }));
    if (!isMounted.current) return;
    const succeeded = results.filter((r) => r.status === 'fulfilled').length;
    const failCount = schedulerKeys.length - succeeded;
    showToast({
      success: failCount === 0,
      message: failCount === 0
        ? `✓ ${succeeded} scheduler${succeeded !== 1 ? 's' : ''} triggered`
        : `${succeeded} succeeded, ${failCount} failed/skipped`,
    });
    setTriggerLoadingSet((prev) => { const n = new Set(prev); schedulerKeys.forEach((k) => n.delete(k)); return n; });
    setBulkRunLoading(false);
    setBulkSchedulerRunConfirm(null);
    setSelectedKeys(new Set());
  };

  /**
   * Global "Resolve CPS Crons" — resolves every currently-filtered
   * scheduler's `${cps.property}` placeholder in one pass instead of
   * requiring the user to open each app's Infrastructure tab individually.
   * Scoped to `filtered` (respects search/env/status/type filters, same
   * set the table is showing) rather than literally every scheduler ever
   * loaded — a user filtering down to "Production" shouldn't pay the cost
   * (CPS fetch per app, needs credentials) of resolving apps they've
   * filtered out of view.
   */
  const resolveCpsCrons = async () => {
    const unresolvedApps = new Map(); // appId -> {appId, envId, bgId, deploymentType}
    filtered.forEach((s) => {
      // Scan for EITHER an unresolved cron OR an unresolved timezone — an
      // app with a fully-resolved cron but a still-placeholder timezone
      // was previously skipped entirely here, so its timezone could never
      // get resolved by this button.
      if ((s.unresolvedPlaceholder || s.unresolvedTzPlaceholder) && !unresolvedApps.has(s.appId)) {
        unresolvedApps.set(s.appId, { appId: s.appId, envId: s.envId, bgId: s._bgId, deploymentType: s.deploymentType });
      }
    });
    if (unresolvedApps.size === 0) return;

    setCpsResolveLoading(true);
    try {
      const propsByApp = await resolveSchedulerCpsPropsForApps(
        [...unresolvedApps.values()],
        { hasCredentials, getSecret, getAllCredentials }
      );

      let resolvedCount = 0;
      let failedApps = 0;
      propsByApp.forEach(({ props, error }) => {
        if (error) failedApps++;
      });

      filtered.forEach((s) => {
        if (!s.unresolvedPlaceholder && !s.unresolvedTzPlaceholder) return;
        const entry = propsByApp.get(s.appId);
        if (!entry || entry.error) return;
        const { resolved: cron, wasResolved: cronResolved } = resolvePlaceholder(s.cron, entry.props);
        const { resolved: timeZone, wasResolved: tzResolved } = resolvePlaceholder(s.timeZone, entry.props);
        if (cronResolved || tzResolved) {
          rememberResolvedSchedule(s.appId, s.schedulerKey, { cron, timeZone });
          resolvedCount++;
        }
      });

      if (!isMounted.current) return;
      setCpsResolveVersion((v) => v + 1); // force rows to re-check the resolution cache
      showToast({
        success: failedApps === 0,
        message: resolvedCount > 0
          ? `✓ Resolved ${resolvedCount} scheduler${resolvedCount !== 1 ? 's' : ''} from CPS${failedApps > 0 ? ` (${failedApps} app${failedApps !== 1 ? 's' : ''} failed)` : ''}`
          : failedApps > 0
            ? `✗ Failed to resolve CPS properties for ${failedApps} app${failedApps !== 1 ? 's' : ''}`
            : 'No crons could be resolved — property not found in CPS',
      });
    } catch (e) {
      showToast({ success: false, message: `✗ Failed to resolve CPS crons: ${getErrorMessage(e)}` });
    } finally {
      if (isMounted.current) setCpsResolveLoading(false);
    }
  };

  /* ── Select options ────────────────────────────────── */
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const visibleGroups = useMemo(() => applyBgFilter(allBusinessGroups), [allBusinessGroups, bgFilterVersion]);
  const filterActive = visibleGroups.length < allBusinessGroups.length;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const visibleEnvs = useMemo(() => applyEnvFilter(environments), [environments, envFilterVersion]);

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
      {/* `label`/`labels` resolve the internal cross-app rowKey(s) to a real
          schedulerKey + app name for display — see describeRow's comment. */}
      <SchedulerConfirmModal
        schedulerKey={schedulerConfirmKey}
        label={schedulerConfirmKey ? describeRow(schedulerConfirmKey) : undefined}
        onConfirm={executeTrigger}
        onCancel={() => setSchedulerConfirmKey(null)}
        loading={triggerLoadingSet.has(schedulerConfirmKey)}
      />
      <SchedulerToggleConfirmModal
        state={schedulerToggleConfirm ? { ...schedulerToggleConfirm, label: describeRow(schedulerToggleConfirm.schedulerKey) } : null}
        onConfirm={executeToggle}
        onCancel={() => setSchedulerToggleConfirm(null)}
        loading={toggleLoadingSet.has(schedulerToggleConfirm?.schedulerKey)}
      />
      <BulkSchedulerToggleConfirmModal
        state={bulkSchedulerToggleConfirm ? { ...bulkSchedulerToggleConfirm, labels: bulkSchedulerToggleConfirm.schedulerKeys.map(describeRow) } : null}
        onConfirm={executeBulkToggle}
        onCancel={() => setBulkSchedulerToggleConfirm(null)}
        loading={bulkLoading}
      />
      <BulkSchedulerRunConfirmModal
        state={bulkSchedulerRunConfirm ? { ...bulkSchedulerRunConfirm, labels: bulkSchedulerRunConfirm.schedulerKeys.map(describeRow) } : null}
        onConfirm={executeBulkRun}
        onCancel={() => setBulkSchedulerRunConfirm(null)}
        loading={bulkRunLoading}
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
              <button
                onClick={() => {
                  const keys = visibleKeys.filter((k) => selectedKeys.has(k));
                  const runnable = keys.filter((k) => {
                    const row = findRow(k);
                    return row && !row.ambiguousKey && (row.appStatus || '').toUpperCase() === 'RUNNING';
                  });
                  setBulkSchedulerRunConfirm({ schedulerKeys: runnable });
                }}
                title="Run the selected schedulers now (apps that aren't running or have an ambiguous identifier are skipped)"
                className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-xl border transition-all bg-sfpurple-50 dark:bg-sfpurple-500/10 text-sfpurple-700 dark:text-sfpurple-300 border-sfpurple-200/60 dark:border-sfpurple-400/20 hover:bg-sfpurple-600 hover:text-white hover:border-sfpurple-600">
                <Zap size={12} /> Run
              </button>
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
              <span className="w-px h-6 bg-gradient-to-b from-transparent via-gray-200 dark:via-gray-700 to-transparent mx-1 flex-shrink-0" />
            </>
          )}
          {unresolvedCount > 0 && (
            <button
              onClick={resolveCpsCrons}
              disabled={cpsResolveLoading}
              title="Resolve every ${cps.property} cron/timezone placeholder currently visible, by fetching each affected app's CPS properties"
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-xl border transition-all bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-200/60 dark:border-amber-400/20 hover:bg-amber-600 hover:text-white hover:border-amber-600 disabled:opacity-50">
              {cpsResolveLoading ? <RefreshCw size={12} className="animate-spin" /> : <Key size={12} />}
              Resolve CPS Crons ({unresolvedCount})
            </button>
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
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
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
            onChange={(v) => { setSelectedBg(v); setSearch(''); setFilterEnv(''); setFilterStatus(''); setFilterType(''); setFilterUnresolved(false); }}
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
        <div>
          <button
            onClick={() => setFilterUnresolved((v) => !v)}
            title="Show only schedulers whose cron and/or timezone is still a raw ${cps.property} placeholder that hasn't been resolved from CPS yet"
            aria-pressed={filterUnresolved}
            className={`w-full flex items-center justify-center gap-1.5 px-3 py-2.5 text-xs font-semibold rounded-xl border transition-all ${
              filterUnresolved
                ? 'bg-gradient-to-b from-amber-500 to-amber-600 border-amber-500 text-white shadow-sm shadow-amber-500/30'
                : 'bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400 border-gray-200 dark:border-gray-700 hover:text-amber-600 dark:hover:text-amber-400 hover:border-amber-300 dark:hover:border-amber-400/40 shadow-sm'
            }`}>
            <Key size={13} /> Unresolved CPS{unresolvedCount > 0 ? ` (${unresolvedCount})` : ''}
          </button>
        </div>
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
                    isResolving={resolvingAppIds.has(s.appId)}
                    envType={envTypeById.get(s.envId)}
                    resolveVersion={cpsResolveVersion}
                    onToggleSelect={toggleSelectOne}
                    onRequestToggle={setSchedulerToggleConfirm}
                    onRequestTrigger={setSchedulerConfirmKey}
                    onResolveRow={resolveAppCpsCrons}
                    onOpenApp={onOpenApp}
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
