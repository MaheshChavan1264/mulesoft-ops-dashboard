import React, { useMemo, useEffect } from 'react';
import { Clock, Zap, Activity, Key, RefreshCw, X, Search, Power, CheckSquare, Square, AlertTriangle, History, CalendarClock, Info } from 'lucide-react';
import cronstrue from 'cronstrue';
import { fetchCpsProperties, resolveAndPostCpsCredentials } from '../../../services/cpsService';
import { rememberResolvedSchedule } from '../../../services/cpsCronResolutionCache';
import { useCpsCredentialStore } from '../../../context/CpsCredentialStoreContext';
import { GlassCard, StatTile, PulseDot, MetaTag, getNextCronRun, getNextRunTzLabel } from '../shared';

/**
 * InfrastructureTab — ApplicationDetailPage's "Schedulers" (Infrastructure) tab.
 *
 * Extracted from pages/ApplicationDetailPage.jsx — see
 * FRONTEND_ARCHITECTURE_REVIEW.md §4 "god component" finding.
 */
export default function InfrastructureTab({
  appId, isCH1,
  allSchedulers, schedulers, isRunning, rStatus,
  cpsSchedulerProps, setCpsSchedulerProps, cpsBaseUrl, cpsClientId, effectiveCpsKey, effectiveCpsEnv, orgId,
  cpsSecureSchedulerLoading, setCpsSecureSchedulerLoading,
  triggerResult, setTriggerResult,
  schedulerSearch, setSchedulerSearch,
  allProps, cpsData,
  triggerLoadingSet, setSchedulerConfirmKey,
  toggleLoadingSet, setSchedulerToggleConfirm,
  selectedSchedulers, setSelectedSchedulers, setBulkSchedulerToggleConfirm, setBulkSchedulerRunConfirm,
}) {
  const { hasCredentials: hasCpsCsvCredentials, getSecret, getAllCredentials } = useCpsCredentialStore();

  const enabledCount = allSchedulers.filter(s => s.enabled !== false).length;
  const disabledCount = allSchedulers.length - enabledCount;

  // Best-effort Anypoint identifier. Two distinct schedulers CAN
  // legitimately share this (e.g. the same flow scheduled twice), so it
  // must never be used alone as a React key or Set-selection identity.
  // CH1's `/cloudhub/api/applications/{domain}/schedules` returns a stable
  // `id` (job id) that its own `/schedules/{id}/run` and PUT endpoints
  // require — `name`/`flow` are just display labels there and 404 when sent
  // as the path param (the "CH1 schedule trigger failed ... 404" bug). CH2's
  // AMC API has no such `id` field and expects `flowName` as the real
  // identifier instead — see backend's normalizeSchedulerRow for the mirror
  // of this same branch used by the aggregate Schedulers dashboard.
  const schedulerKeyOf = (s, i) => isCH1
    ? (s.id || s.name || s.flow || `scheduler-${i}`)
    : (s.flowName || s.name || s.schedulerName || s.flow || `scheduler-${i}`);

  // Computed over the full unfiltered list (not the search-filtered
  // `schedulers`) — a real collision between two schedulers in this app
  // shouldn't become invisible just because the search box hides one of them.
  const ambiguousKeySet = useMemo(() => {
    const counts = new Map();
    allSchedulers.forEach((s, i) => {
      const k = schedulerKeyOf(s, i);
      counts.set(k, (counts.get(k) || 0) + 1);
    });
    return new Set([...counts.entries()].filter(([, c]) => c > 1).map(([k]) => k));
  }, [allSchedulers]);

  // rowId guarantees per-row uniqueness (index-suffixed) for React keys and
  // selection, independent of whether schedulerKey itself collides.
  const rowIdOf = (s, i) => `${schedulerKeyOf(s, i)}::${i}`;

  const visibleKeys = schedulers.map((s, i) => rowIdOf(s, i));
  const selectedVisibleCount = visibleKeys.filter(k => selectedSchedulers.has(k)).length;
  const allVisibleSelected = visibleKeys.length > 0 && selectedVisibleCount === visibleKeys.length;

  // Bulk actions must send the real Anypoint identifier, not the
  // uniqueness-only rowId — and must skip ambiguous rows for the same
  // reason the per-row buttons are disabled on them.
  const rowIdToKey = new Map(schedulers.map((s, i) => [rowIdOf(s, i), schedulerKeyOf(s, i)]));
  const selectedSchedulerKeys = (keys) => keys
    .filter(k => selectedSchedulers.has(k) && !ambiguousKeySet.has(rowIdToKey.get(k)))
    .map(k => rowIdToKey.get(k));


  const toggleSelectAll = () => {
    setSelectedSchedulers(prev => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        visibleKeys.forEach(k => next.delete(k));
      } else {
        visibleKeys.forEach(k => next.add(k));
      }
      return next;
    });
  };

  const toggleSelectOne = (key) => {
    setSelectedSchedulers(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  // Precompute the expensive/pure per-row derivations once per actual data
  // change (schedulers list, resolved CPS/runtime props) instead of on every
  // render of this tab — cronstrue parsing + the cron next-run search (see
  // shared.jsx's getNextCronRun) are non-trivial work that doesn't need to
  // redo itself just because e.g. the search box text or a loading flag changed.
  const enrichedSchedulers = useMemo(() => schedulers.map((s, i) => {
    // CH2 uses s.schedule.expression; CH1 uses s.schedule.cronExpression or s.expression
    const rawCron = s.schedule?.cronExpression ||
                    s.schedule?.expression ||
                    s.expression ||
                    s.cronExpression;
    // Scheduler-configured timezone (CH2 returns this in schedule.timeZone)
    const rawTz = s.schedule?.timeZone || s.schedule?.timezone || s.timeZone || s.timezone || null;
    // Resolve ${...} placeholders in timezone value (same as cron expression)
    const schedulerTz = rawTz?.replace(/\$\{([^}]+)\}/g, (match, propName) =>
      allProps[propName] ||
      allProps[propName.toLowerCase()] ||
      cpsSchedulerProps[propName] ||
      cpsSchedulerProps[propName.toLowerCase()] ||
      cpsData?.nonSecure?.[propName] ||
      match
    ) || null;
    // Resolve ${propName} placeholders: check runtime props first, then CPS props
    const resolvedCron = rawCron?.replace(/\$\{([^}]+)\}/g, (match, propName) =>
      allProps[propName] ||
      allProps[propName.toLowerCase()] ||
      cpsSchedulerProps[propName] ||
      cpsSchedulerProps[propName.toLowerCase()] ||
      cpsData?.nonSecure?.[propName] ||
      match
    );
    const isUnresolvedPlaceholder = rawCron?.startsWith('${') && resolvedCron === rawCron;
    // Tracked independently of the cron placeholder above — a scheduler can
    // have a fully resolved cron but a timezone that's still a raw
    // `${cps.property}` placeholder (or vice versa). Without this, the
    // "Get Cron Expressions" button's hasUnresolved check (and the
    // Schedulers-dashboard sibling logic) only ever looked at the cron
    // field, so an unresolved timezone silently stayed as its raw
    // placeholder string with no way to trigger resolution.
    const isTzUnresolvedPlaceholder = rawTz?.startsWith('${') && schedulerTz === rawTz;
    const wasResolved = rawCron !== resolvedCron;
    const cron = resolvedCron; // display the resolved value
    let decodedCron = '';
    if (cron && !isUnresolvedPlaceholder) {
      try {
        decodedCron = cronstrue.toString(cron, { throwExceptionOnParseError: true });
      } catch (e) {
        // ignore parsing errors (e.g. non-standard crons)
      }
    }
    // Compute next run from cron expression (works for both CH1 and CH2 since
    // the Anypoint Platform schedulers API does not return nextRun reliably).
    // Only compute for ENABLED schedulers — a disabled scheduler has no next run.
    const active = s.enabled!==false;
    // Pass the scheduler's own (resolved) timezone through so the cron
    // fields are interpreted as wall-clock time in ITS zone, not whatever
    // timezone the viewer's browser happens to be in — falls back to the
    // IST org default (see shared.jsx's DEFAULT_SCHEDULER_TZ) when absent
    // or still an unresolved `${cps.property}` placeholder.
    const tzForCalc = isTzUnresolvedPlaceholder ? undefined : schedulerTz;
    const computedNextRun = (cron && !isUnresolvedPlaceholder && active) ? getNextCronRun(cron, tzForCalc) : null;
    // CH2 fixed-frequency: s.schedule.frequency; CH1: s.frequency or s.schedule.period.
    // Checked with ?? (not ||) so a legitimate frequency of 0 isn't
    // treated as absent and skipped in favor of the next fallback.
    const freq = s.frequency ?? s.schedule?.frequency ??
                 (s.schedule?.period > 0 ? s.schedule.period : null);
    const timeUnit = s.timeUnit || s.schedule?.timeUnit;
    const flowName = s.flowName||s.flow||s.name;
    const schedulerKey = schedulerKeyOf(s, i);
    const rowId = rowIdOf(s, i);
    const isAmbiguous = ambiguousKeySet.has(schedulerKey);

    // Lastrun lookup
    const lastRunCandidates = [
      s.lastRun, s.schedule?.lastRun, s.status?.lastRun,
      s.lastRunAt, s.schedule?.lastRunAt, s.status?.lastRunAt,
      s.lastFireAt, s.schedule?.lastFireAt, s.status?.lastFireAt,
      s.lastFiredAt, s.schedule?.lastFiredAt, s.status?.lastFiredAt,
      s.lastFired, s.schedule?.lastFired, s.status?.lastFired,
      s.lastRunTime, s.schedule?.lastRunTime, s.status?.lastRunTime,
      s.lastExecution, s.schedule?.lastExecution, s.status?.lastExecution,
      s.lastTriggerTime, s.schedule?.lastTriggerTime, s.stats?.lastRun,
      s.trigger?.lastFireTime, s.meta?.lastRun,
    ];
    const lastRunRaw = lastRunCandidates.find(v => v != null && v !== 0 && v !== '');

    return {
      s, i, active, schedulerTz, isUnresolvedPlaceholder, isTzUnresolvedPlaceholder, wasResolved, rawCron, cron, decodedCron,
      computedNextRun, freq, timeUnit, flowName, schedulerKey, rowId, isAmbiguous, lastRunRaw,
    };
  }), [schedulers, allProps, cpsSchedulerProps, cpsData, ambiguousKeySet]);

  // Drives the "Get Cron Expressions" button's visibility — true if ANY
  // scheduler for this app still has an unresolved cron OR timezone
  // placeholder, using the exact same resolution logic as `enrichedSchedulers`
  // below. Deliberately checked over `allSchedulers` (not the search-filtered
  // `schedulers`/`enrichedSchedulers`) — the button offers to resolve CPS
  // properties for the whole app, so it shouldn't disappear just because the
  // one unresolved scheduler happens to be filtered out of the search box.
  const hasUnresolved = useMemo(() => allSchedulers.some(s => {
    const rawCron = s.schedule?.cronExpression || s.schedule?.expression || s.expression || s.cronExpression;
    const rawTz = s.schedule?.timeZone || s.schedule?.timezone || s.timeZone || s.timezone || null;
    const resolve = (val) => val?.replace(/\$\{([^}]+)\}/g, (match, propName) =>
      allProps[propName] ||
      allProps[propName.toLowerCase()] ||
      cpsSchedulerProps[propName] ||
      cpsSchedulerProps[propName.toLowerCase()] ||
      cpsData?.nonSecure?.[propName] ||
      match
    );
    const cronUnresolved = rawCron?.startsWith('${') && resolve(rawCron) === rawCron;
    const tzUnresolved = rawTz?.startsWith('${') && resolve(rawTz) === rawTz;
    return cronUnresolved || tzUnresolved;
  }), [allSchedulers, allProps, cpsSchedulerProps, cpsData]);

  // Once a scheduler's cron/timezone has been resolved from a `${cps.property}`
  // placeholder to its real value (via the "Get Cron Expressions" flow below,
  // or because it was always resolvable from runtime props), remember it in
  // the cross-page cache — so the Schedulers dashboard (which can't afford to
  // fetch CPS secure properties for every app) shows the real value instead
  // of the raw placeholder after the user navigates back there.
  useEffect(() => {
    if (!appId) return;
    enrichedSchedulers.forEach(({ schedulerKey, rawCron, wasResolved, isUnresolvedPlaceholder, cron, schedulerTz }) => {
      if (rawCron?.startsWith('${') && wasResolved && !isUnresolvedPlaceholder) {
        rememberResolvedSchedule(appId, schedulerKey, { cron, timeZone: schedulerTz });
      }
    });
  }, [appId, enrichedSchedulers]);

  return (
    <div className="space-y-5">
      {/* Stat tiles */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatTile icon={Clock} label="Total Schedulers" accent="purple" value={allSchedulers.length} />
        <StatTile icon={Zap} label="Enabled" accent="emerald" value={enabledCount} sub={disabledCount > 0 ? `${disabledCount} disabled` : undefined} />
        <StatTile icon={Activity} label="App State" accent={isRunning ? 'emerald' : 'amber'} value={isRunning ? 'Running' : (rStatus || 'Unknown')} sub={isRunning ? 'Schedulers can fire' : 'Triggers unavailable'} />
      </div>

      <GlassCard icon={Clock} title="Scheduled Flows" count={allSchedulers.length} accent="purple" noPad>
        {/* Show "Get Cron Expressions" button when there are unresolved ${...} placeholders
            and CPS is configured for this app (even if cps.secure.properties wasn't auto-discovered) */}
        {hasUnresolved && cpsBaseUrl && (
          <div className="px-5 py-2.5 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between bg-sfpurple-50/50 dark:bg-sfpurple-500/5">
            <p className="text-[10px] text-sfpurple-600 dark:text-sfpurple-400 flex items-center gap-1.5 font-medium">
              <Key size={9} /> Some cron expressions may be in CPS properties
            </p>
            <button
              disabled={cpsSecureSchedulerLoading}
              onClick={async () => {
                setCpsSecureSchedulerLoading(true);
                try {
                  // Re-resolve/post CPS credentials on every click (not just
                  // once on page load) — the user may have uploaded or
                  // updated their CPS credentials CSV AFTER this app's
                  // detail page already loaded, in which case the
                  // automatic page-load fetch never had a credential to
                  // post, and simply retrying the fetch below would fail
                  // the exact same way forever. Also posts every other CSV
                  // credential (not just this app's own clientId) so the
                  // backend's per-group secure-property retry has
                  // alternates to try — some secure property GROUPS on the
                  // same CPS server require a different credential than
                  // the one scoped to this app.
                  if (hasCpsCsvCredentials) {
                    await resolveAndPostCpsCredentials({
                      cpsBaseUrl, cpsClientId, scopeId: orgId,
                      hasCredentials: hasCpsCsvCredentials, getSecret, getAllCredentials,
                    });
                  }
                  // Step 1: If cps.secure.properties key is not yet known, fetch non-secure to discover it
                  let secureKeys = cpsSchedulerProps['cps.secure.properties'];
                  if (!secureKeys) {
                    try {
                      const data = await fetchCpsProperties({ baseUrl: cpsBaseUrl, type: 'non-secure', keys: effectiveCpsKey, environment: effectiveCpsEnv, bgOrgId: orgId });
                      let flat = {};
                      if (Array.isArray(data?.responses)) data.responses.forEach(r => Object.assign(flat, r.properties || {}));
                      else if (Array.isArray(data)) data.forEach(r => { if (r?.properties) Object.assign(flat, r.properties); });
                      else if (data && typeof data === 'object') {
                        const fv = Object.values(data)[0];
                        flat = (fv && typeof fv === 'object') ? Object.values(data).reduce((m, v) => (v && typeof v === 'object' ? Object.assign(m, v) : m), {}) : data;
                      }
                      if (Object.keys(flat).length > 0) {
                        setCpsSchedulerProps(prev => ({ ...prev, ...flat }));
                        secureKeys = flat['cps.secure.properties'];
                      }
                    } catch { /* continue */ }
                  }
                  if (!secureKeys) { setCpsSecureSchedulerLoading(false); return; }
                  // Step 2: Fetch secure properties using the discovered keys
                  const data = await fetchCpsProperties({ baseUrl: cpsBaseUrl, type: 'secure', environment: effectiveCpsEnv, keys: secureKeys, bgOrgId: orgId });
                  const groups = Array.isArray(data?.responses) ? data.responses
                    : Array.isArray(data?.properties) ? data.properties
                    : Array.isArray(data) ? data : [];
                  const merged = {};
                  groups.forEach(g => Object.assign(merged, g.properties || {}));
                  if (Object.keys(merged).length > 0) setCpsSchedulerProps(prev => ({ ...prev, ...merged }));
                } catch { /* silently fail — button stays visible for retry */ }
                setCpsSecureSchedulerLoading(false);
              }}
              className="flex items-center gap-1.5 text-[10px] px-2.5 py-1 bg-sfpurple-100 dark:bg-sfpurple-500/15 border border-sfpurple-200/60 dark:border-sfpurple-400/20 text-sfpurple-700 dark:text-sfpurple-300 hover:bg-sfpurple-600 hover:text-white hover:border-sfpurple-600 rounded-lg transition-all disabled:opacity-50 font-semibold flex-shrink-0">
              {cpsSecureSchedulerLoading
                ? <><RefreshCw size={9} className="animate-spin" /> Loading…</>
                : <><Key size={9} /> Get Cron Expressions</>}
            </button>
          </div>
        )}
        {/* Trigger result toast inside the scheduler card */}
        {triggerResult && (
          <div className={`mx-5 mt-3 flex items-center justify-between px-4 py-2.5 rounded-xl border text-xs ${
            triggerResult.success
              ? 'bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200/60 dark:border-emerald-400/20 text-emerald-700 dark:text-emerald-300'
              : 'bg-red-50 dark:bg-red-500/10 border-red-200/60 dark:border-red-400/20 text-red-700 dark:text-red-300'
          }`}>
            <span>{triggerResult.message}</span>
            <button onClick={() => setTriggerResult(null)} className="ml-3 opacity-60 hover:opacity-100 flex-shrink-0"><X size={12} /></button>
          </div>
        )}
        {allSchedulers.length>0 && (
          <div className="px-5 pt-4 pb-3 border-b border-gray-100 dark:border-gray-800">
            <div className="relative">
              <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500 pointer-events-none"/>
              <input
                value={schedulerSearch}
                onChange={(e) => setSchedulerSearch(e.target.value)}
                placeholder="Filter by flow name or cron…"
                className="w-full bg-gray-50/70 dark:bg-gray-800/50 border border-gray-200/60 dark:border-gray-700/60 rounded-xl pl-8 pr-4 py-2.5 text-xs text-gray-700 dark:text-gray-200 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:border-sfpurple-400 dark:focus:border-sfpurple-500 focus:ring-2 focus:ring-sfpurple-500/10 focus:bg-white dark:focus:bg-gray-800 transition-all"
              />
              {schedulerSearch && (
                <button onClick={() => setSchedulerSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300"><X size={12} /></button>
              )}
            </div>
            {schedulerSearch && (
              <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-1.5">
                Showing {schedulers.length} of {allSchedulers.length} scheduler{allSchedulers.length !== 1 ? 's' : ''}
              </p>
            )}
          </div>
        )}
        {schedulers.length > 0 && (
          <div className={`px-5 py-3 border-b flex items-center justify-between gap-3 flex-wrap transition-colors ${
            selectedVisibleCount > 0
              ? 'bg-gradient-to-r from-sfpurple-50 via-sfpurple-50/40 to-transparent dark:from-sfpurple-500/10 dark:via-sfpurple-500/5 border-sfpurple-200/70 dark:border-sfpurple-400/20'
              : 'bg-transparent border-gray-100 dark:border-gray-800'
          }`}>
            <button
              onClick={toggleSelectAll}
              className="flex items-center gap-2 text-xs font-semibold text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 transition-colors">
              {allVisibleSelected ? <CheckSquare size={15} className="text-sfpurple-600 dark:text-sfpurple-400" /> : <Square size={15} />}
              {selectedVisibleCount > 0 ? (
                <span className="inline-flex items-center gap-1.5 text-sfpurple-700 dark:text-sfpurple-300">
                  <span className="flex items-center justify-center w-5 h-5 rounded-full bg-sfpurple-600 text-white text-[10px] font-bold">{selectedVisibleCount}</span>
                  selected
                </span>
              ) : 'Select all'}
            </button>
            {selectedVisibleCount > 0 && (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setBulkSchedulerRunConfirm({ schedulerKeys: selectedSchedulerKeys(visibleKeys) })}
                  disabled={!isRunning}
                  title={!isRunning ? 'App must be RUNNING to trigger schedulers' : 'Run the selected schedulers now'}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold rounded-lg border transition-all disabled:opacity-40 disabled:cursor-not-allowed bg-white dark:bg-gray-900 text-sfpurple-700 dark:text-sfpurple-300 border-sfpurple-200/70 dark:border-sfpurple-400/20 shadow-sm hover:bg-sfpurple-600 hover:text-white hover:border-sfpurple-600 hover:shadow-md hover:shadow-sfpurple-500/25">
                  <Zap size={12} /> Run
                </button>
                <button
                  onClick={() => setBulkSchedulerToggleConfirm({ schedulerKeys: selectedSchedulerKeys(visibleKeys), nextEnabled: true })}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold rounded-lg border transition-all bg-white dark:bg-gray-900 text-emerald-700 dark:text-emerald-300 border-emerald-200/70 dark:border-emerald-400/20 shadow-sm hover:bg-emerald-600 hover:text-white hover:border-emerald-600 hover:shadow-md hover:shadow-emerald-500/25">
                  <Power size={12} /> Enable
                </button>
                <button
                  onClick={() => setBulkSchedulerToggleConfirm({ schedulerKeys: selectedSchedulerKeys(visibleKeys), nextEnabled: false })}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold rounded-lg border transition-all bg-white dark:bg-gray-900 text-red-700 dark:text-red-300 border-red-200/70 dark:border-red-400/20 shadow-sm hover:bg-red-600 hover:text-white hover:border-red-600 hover:shadow-md hover:shadow-red-500/25">
                  <Power size={12} /> Disable
                </button>
                <span className="w-px h-5 bg-sfpurple-200/70 dark:bg-sfpurple-400/20 mx-0.5" />
                <button
                  onClick={() => setSelectedSchedulers(new Set())}
                  className="flex items-center gap-1 text-[11px] font-medium text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-200 px-1 transition-colors">
                  <X size={12} /> Clear
                </button>
              </div>
            )}
          </div>
        )}
        {allSchedulers.length>0 ? (
          <div className="p-4 space-y-3">
            {enrichedSchedulers.map(({
              s, active, schedulerTz, isUnresolvedPlaceholder, isTzUnresolvedPlaceholder, wasResolved, rawCron, cron, decodedCron,
              computedNextRun, freq, timeUnit, flowName, schedulerKey, rowId, isAmbiguous, lastRunRaw,
            }) => {
              const isTriggering = triggerLoadingSet.has(schedulerKey);
              const isToggling = toggleLoadingSet.has(schedulerKey);
              const isSelected = selectedSchedulers.has(rowId);

              let lastRunNode;
              if (!lastRunRaw) {
                lastRunNode = <span className="text-gray-400 dark:text-gray-600 text-xs">—</span>;
              } else {
                const d = new Date(lastRunRaw);
                const valid = !isNaN(d.getTime()) && d.getFullYear() > 1970;
                lastRunNode = valid ? (
                  <>
                    <span className="text-gray-700 dark:text-gray-200 text-xs font-mono font-semibold">{d.toLocaleDateString()}</span>
                    <p className="text-gray-400 dark:text-gray-500 text-[10px] font-mono">{d.toLocaleTimeString()}</p>
                  </>
                ) : <span className="text-gray-500 dark:text-gray-400 text-xs font-mono">{String(lastRunRaw)}</span>;
              }

              return (
                <div key={rowId} className={`group relative rounded-2xl border-l-4 border transition-all duration-300 overflow-hidden ${
                  isSelected
                    ? 'border-l-sfpurple-500 border-sfpurple-200/80 dark:border-sfpurple-400/30 bg-sfpurple-50/50 dark:bg-sfpurple-500/[0.07] shadow-md shadow-sfpurple-500/10'
                    : active
                      ? 'border-l-sfpurple-400 border-gray-200/70 dark:border-gray-700/60 bg-white/70 dark:bg-gray-900/40 shadow-sm hover:shadow-lg hover:border-sfpurple-200/70 dark:hover:border-sfpurple-400/20'
                      : 'border-l-gray-300 dark:border-l-gray-700 border-gray-200/50 dark:border-gray-800/60 bg-white/40 dark:bg-gray-900/20 opacity-75 hover:opacity-100'
                } backdrop-blur-sm`}>
                  <div className="px-4 py-3.5">
                    {/* ── Header row: select + identity (left) / actions (right) ── */}
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div className="flex items-center gap-3 min-w-0">
                        <button
                          onClick={() => toggleSelectOne(rowId)}
                          className="flex-shrink-0 flex items-center justify-center w-5 h-5 rounded-md transition-colors"
                          title={isSelected ? 'Deselect' : 'Select'}>
                          {isSelected
                            ? <CheckSquare size={17} className="text-sfpurple-600 dark:text-sfpurple-400" />
                            : <Square size={17} className="text-gray-300 dark:text-gray-600 group-hover:text-gray-400 dark:group-hover:text-gray-500" />}
                        </button>
                        <PulseDot active={active}/>
                        <div className="min-w-0">
                          <p title={flowName} className="text-gray-800 dark:text-gray-100 text-sm font-bold font-mono truncate leading-tight">{flowName}</p>
                          <div className="flex items-center gap-1 mt-1">
                            <span className={`inline-flex items-center text-[10px] px-1.5 py-0.5 rounded-md font-semibold ${active?'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400':'bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500'}`}>
                              {active?'Enabled':'Disabled'}
                            </span>
                            {isAmbiguous && (
                              <span title="Another scheduler in this app shares the same identifier — Run Now/Toggle are disabled to avoid acting on the wrong one"
                                className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md font-semibold bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400">
                                <AlertTriangle size={9} /> ambiguous
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <button
                          onClick={() => setSchedulerToggleConfirm({ schedulerKey, nextEnabled: !active })}
                          disabled={isToggling || isAmbiguous}
                          title={isAmbiguous ? 'Ambiguous scheduler identifier — another scheduler in this app shares the same name/flow, so this action is disabled to avoid toggling the wrong one' : (active ? `Disable "${schedulerKey}"` : `Enable "${schedulerKey}"`)}
                          className={`flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-xl border transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
                            active
                              ? 'bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-300 border-red-200/60 dark:border-red-400/20 hover:bg-red-600 hover:text-white hover:border-red-600 hover:shadow-md hover:shadow-red-500/30'
                              : 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-200/60 dark:border-emerald-400/20 hover:bg-emerald-600 hover:text-white hover:border-emerald-600 hover:shadow-md hover:shadow-emerald-500/30'
                          }`}>
                          {isToggling
                            ? <><RefreshCw size={13} className="animate-spin" /> {active ? 'Disabling…' : 'Enabling…'}</>
                            : <><Power size={13} /> {active ? 'Disable' : 'Enable'}</>}
                        </button>
                        <button
                          onClick={() => setSchedulerConfirmKey(schedulerKey)}
                          disabled={isTriggering || !isRunning || isAmbiguous}
                          title={isAmbiguous ? 'Ambiguous scheduler identifier — another scheduler in this app shares the same name/flow, so this action is disabled to avoid triggering the wrong one' : (!isRunning ? 'App must be RUNNING to trigger a scheduler' : `Run "${schedulerKey}" immediately`)}
                          className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-xl border transition-all disabled:opacity-40 disabled:cursor-not-allowed bg-sfpurple-50 dark:bg-sfpurple-500/10 text-sfpurple-700 dark:text-sfpurple-300 border-sfpurple-200/60 dark:border-sfpurple-400/20 hover:bg-sfpurple-600 hover:text-white hover:border-sfpurple-600 hover:shadow-md hover:shadow-sfpurple-500/30">
                          {isTriggering
                            ? <><RefreshCw size={13} className="animate-spin" /> Running…</>
                            : <><Zap size={13} /> Run Now</>}
                        </button>
                      </div>
                    </div>

                    {/* ── Metadata strip: schedule / last run / next run ── */}
                    <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-800/80 flex items-stretch gap-5 flex-wrap">
                      {/* Schedule */}
                      <div className="min-w-[180px] flex-1">
                        <p className="text-[9px] font-bold tracking-wider text-gray-400 dark:text-gray-500 uppercase mb-1.5 flex items-center gap-1">
                          <Clock size={9} /> Schedule
                        </p>
                        {cron && !isUnresolvedPlaceholder ? (
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <MetaTag color="cyan">{cron}</MetaTag>
                            {decodedCron && (
                              <span className="text-[12px] text-gray-700 dark:text-gray-200 font-semibold">{decodedCron}</span>
                            )}
                            {schedulerTz && (
                              isTzUnresolvedPlaceholder ? (
                                <span title={`Unresolved CPS placeholder: ${schedulerTz}`}
                                  className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 font-mono font-medium">
                                  <AlertTriangle size={9} /> {schedulerTz}
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md bg-sfteal-50 dark:bg-sfteal-500/10 text-sfteal-600 dark:text-sfteal-400 font-medium">
                                  <Clock size={9} /> {schedulerTz}
                                </span>
                              )
                            )}
                            {wasResolved && (
                              <span title={`Resolved from placeholder: ${rawCron}`}
                                className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500 cursor-help">
                                <Info size={10} />
                              </span>
                            )}
                          </div>
                        ) : isUnresolvedPlaceholder ? (
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span title={rawCron}
                              className="inline-flex items-center gap-1.5 text-[11px] px-2 py-1 rounded-lg font-mono font-medium bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-200/60 dark:border-amber-400/20">
                              <AlertTriangle size={11} /> Unresolved CPS placeholder
                            </span>
                            {schedulerTz && (
                              isTzUnresolvedPlaceholder ? (
                                <span title={`Unresolved CPS placeholder: ${schedulerTz}`}
                                  className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 font-mono font-medium">
                                  <AlertTriangle size={9} /> {schedulerTz}
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md bg-sfteal-50 dark:bg-sfteal-500/10 text-sfteal-600 dark:text-sfteal-400 font-medium">
                                  <Clock size={9} /> {schedulerTz}
                                </span>
                              )
                            )}
                          </div>
                        ) : freq != null ? (
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <MetaTag color="blue">{freq}{timeUnit ? ` ${timeUnit}` : ''}</MetaTag>
                            {schedulerTz && (
                              isTzUnresolvedPlaceholder ? (
                                <span title={`Unresolved CPS placeholder: ${schedulerTz}`}
                                  className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 font-mono font-medium">
                                  <AlertTriangle size={9} /> {schedulerTz}
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md bg-sfteal-50 dark:bg-sfteal-500/10 text-sfteal-600 dark:text-sfteal-400 font-medium">
                                  <Clock size={9} /> {schedulerTz}
                                </span>
                              )
                            )}
                          </div>
                        ) : <span className="text-gray-400 dark:text-gray-600 text-xs">No schedule info</span>}
                      </div>

                      <span className="w-px bg-gray-100 dark:bg-gray-800 self-stretch flex-shrink-0" />

                      {/* Last run */}
                      <div className="flex-shrink-0 min-w-[76px]">
                        <p className="text-[9px] font-bold tracking-wider text-gray-400 dark:text-gray-500 uppercase mb-1.5 flex items-center gap-1">
                          <History size={9} /> Last Run
                        </p>
                        {lastRunNode}
                      </div>

                      <span className="w-px bg-gray-100 dark:bg-gray-800 self-stretch flex-shrink-0" />

                      {/* Next run */}
                      <div className="flex-shrink-0 min-w-[76px]">
                        <p className="text-[9px] font-bold tracking-wider text-gray-400 dark:text-gray-500 uppercase mb-1.5 flex items-center gap-1">
                          <CalendarClock size={9} /> Next Run
                        </p>
                        {computedNextRun ? (
                          <>
                            <span className="text-sfpurple-700 dark:text-sfpurple-300 text-xs font-mono font-semibold">{computedNextRun.toLocaleDateString()}</span>
                            <p className="text-sfpurple-500 dark:text-sfpurple-400 text-[10px] font-mono">
                              {computedNextRun.toLocaleTimeString()} {getNextRunTzLabel(isTzUnresolvedPlaceholder ? undefined : schedulerTz)}
                            </p>
                          </>
                        ) : freq ? (
                          <span className="text-gray-400 dark:text-gray-600 text-xs" title="Fixed-frequency scheduler — next run not calculable from frequency alone">—</span>
                        ) : (
                          <span className="text-gray-400 dark:text-gray-600 text-xs">—</span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : schedulerSearch ? (
          <div className="px-5 py-10 text-center text-gray-500 dark:text-gray-400 text-sm">No schedulers match <span className="text-gray-700 dark:text-gray-300 font-mono">"{schedulerSearch}"</span></div>
        ) : (
          <div className="flex flex-col items-center justify-center py-14 gap-3 text-center">
            <div className="flex items-center justify-center w-14 h-14 rounded-2xl bg-sfpurple-100 dark:bg-sfpurple-500/10">
              <Clock size={24} className="text-sfpurple-500 dark:text-sfpurple-400" />
            </div>
            <p className="text-gray-400 dark:text-gray-500 text-sm">No schedulers configured for this application</p>
          </div>
        )}
      </GlassCard>
    </div>
  );
}
