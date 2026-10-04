import React, { useMemo, useEffect } from 'react';
import { Clock, Zap, Activity, Key, RefreshCw, X, Search, Power, CheckSquare, Square } from 'lucide-react';
import cronstrue from 'cronstrue';
import { fetchCpsProperties } from '../../../services/cpsService';
import { rememberResolvedSchedule } from '../../../services/cpsCronResolutionCache';
import { GlassCard, StatTile, PulseDot, MetaTag, getNextCronRun } from '../shared';

/**
 * InfrastructureTab — ApplicationDetailPage's "Schedulers" (Infrastructure) tab.
 *
 * Extracted from pages/ApplicationDetailPage.jsx — see
 * FRONTEND_ARCHITECTURE_REVIEW.md §4 "god component" finding.
 */
export default function InfrastructureTab({
  appId,
  allSchedulers, schedulers, isRunning, rStatus,
  cpsSchedulerProps, setCpsSchedulerProps, cpsBaseUrl, effectiveCpsKey, effectiveCpsEnv, orgId,
  cpsSecureSchedulerLoading, setCpsSecureSchedulerLoading,
  triggerResult, setTriggerResult,
  schedulerSearch, setSchedulerSearch,
  allProps, cpsData,
  triggerLoadingSet, setSchedulerConfirmKey,
  toggleLoadingSet, setSchedulerToggleConfirm,
  selectedSchedulers, setSelectedSchedulers, setBulkSchedulerToggleConfirm, setBulkSchedulerRunConfirm,
}) {
  const enabledCount = allSchedulers.filter(s => s.enabled !== false).length;
  const disabledCount = allSchedulers.length - enabledCount;
  const hasUnresolved = allSchedulers.some(s => {
    const expr = s.expression || s.schedule?.expression || '';
    if (!expr.startsWith('${')) return false;
    const propName = expr.slice(2, -1);
    return !cpsSchedulerProps[propName] && !cpsSchedulerProps[propName.toLowerCase()] && !allProps[propName];
  });

  // Best-effort Anypoint identifier — falls back to flow name when the API
  // omits a dedicated `name`/`schedulerName` field. Two distinct schedulers
  // CAN legitimately share this (e.g. the same flow scheduled twice), so it
  // must never be used alone as a React key or Set-selection identity.
  // Per Mulesoft's AMC API docs, `flowName` is the real identifier the
  // PUT/POST/DELETE scheduler endpoints expect — prioritize it over the
  // speculative `name`/`schedulerName`/`flow` fallbacks.
  const schedulerKeyOf = (s, i) => s.flowName || s.name || s.schedulerName || s.flow || `scheduler-${i}`;

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
    const computedNextRun = (cron && !isUnresolvedPlaceholder && active) ? getNextCronRun(cron) : null;
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
      s, i, active, schedulerTz, isUnresolvedPlaceholder, wasResolved, rawCron, cron, decodedCron,
      computedNextRun, freq, timeUnit, flowName, schedulerKey, rowId, isAmbiguous, lastRunRaw,
    };
  }), [schedulers, allProps, cpsSchedulerProps, cpsData, ambiguousKeySet]);

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
                <button onClick={() => setSchedulerSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 text-xs">✕</button>
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
          <div className="px-5 py-2.5 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between gap-3 flex-wrap">
            <button
              onClick={toggleSelectAll}
              className="flex items-center gap-1.5 text-[11px] font-medium text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200">
              {allVisibleSelected ? <CheckSquare size={14} className="text-sfpurple-600 dark:text-sfpurple-400" /> : <Square size={14} />}
              {selectedVisibleCount > 0 ? `${selectedVisibleCount} selected` : 'Select all'}
            </button>
            {selectedVisibleCount > 0 && (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setBulkSchedulerRunConfirm({ schedulerKeys: selectedSchedulerKeys(visibleKeys) })}
                  disabled={!isRunning}
                  title={!isRunning ? 'App must be RUNNING to trigger schedulers' : 'Run the selected schedulers now'}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-semibold rounded-lg border transition-all disabled:opacity-40 disabled:cursor-not-allowed bg-sfpurple-50 dark:bg-sfpurple-500/10 text-sfpurple-700 dark:text-sfpurple-300 border-sfpurple-200/60 dark:border-sfpurple-400/20 hover:bg-sfpurple-600 hover:text-white hover:border-sfpurple-600">
                  <Zap size={11} /> Run Selected
                </button>
                <button
                  onClick={() => setBulkSchedulerToggleConfirm({ schedulerKeys: selectedSchedulerKeys(visibleKeys), nextEnabled: true })}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-semibold rounded-lg border transition-all bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-200/60 dark:border-emerald-400/20 hover:bg-emerald-600 hover:text-white hover:border-emerald-600">
                  <Power size={11} /> Enable Selected
                </button>
                <button
                  onClick={() => setBulkSchedulerToggleConfirm({ schedulerKeys: selectedSchedulerKeys(visibleKeys), nextEnabled: false })}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-semibold rounded-lg border transition-all bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-300 border-red-200/60 dark:border-red-400/20 hover:bg-red-600 hover:text-white hover:border-red-600">
                  <Power size={11} /> Disable Selected
                </button>
                <button
                  onClick={() => setSelectedSchedulers(new Set())}
                  className="text-[11px] text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 px-1">
                  Clear
                </button>
              </div>
            )}
          </div>
        )}
        {allSchedulers.length>0 ? (
          <div className="p-4 space-y-3">
            {enrichedSchedulers.map(({
              s, active, schedulerTz, isUnresolvedPlaceholder, wasResolved, rawCron, cron, decodedCron,
              computedNextRun, freq, timeUnit, flowName, schedulerKey, rowId, isAmbiguous, lastRunRaw,
            }) => {
              const isTriggering = triggerLoadingSet.has(schedulerKey);
              const isToggling = toggleLoadingSet.has(schedulerKey);

              let lastRunNode;
              if (!lastRunRaw) {
                lastRunNode = <span className="text-gray-400 dark:text-gray-600 text-xs">—</span>;
              } else {
                const d = new Date(lastRunRaw);
                const valid = !isNaN(d.getTime()) && d.getFullYear() > 1970;
                lastRunNode = valid ? (
                  <>
                    <span className="text-gray-600 dark:text-gray-300 text-xs font-mono">{d.toLocaleDateString()}</span>
                    <p className="text-gray-400 dark:text-gray-500 text-[10px] font-mono">{d.toLocaleTimeString()}</p>
                  </>
                ) : <span className="text-gray-500 dark:text-gray-400 text-xs font-mono">{String(lastRunRaw)}</span>;
              }

              return (
                <div key={rowId} className={`group relative rounded-2xl border bg-white/70 dark:bg-gray-900/40 backdrop-blur-sm shadow-sm hover:shadow-lg transition-all duration-300 overflow-hidden ${active ? 'border-gray-200/70 dark:border-gray-700/60' : 'border-gray-200/50 dark:border-gray-800/60 opacity-70'}`}>
                  <div className={`absolute left-0 top-0 bottom-0 w-1 ${active ? 'bg-gradient-to-b from-sfpurple-400 to-sfpurple-600' : 'bg-gray-300 dark:bg-gray-700'}`} />
                  <div className="flex flex-wrap items-center gap-5 px-5 py-3.5 pl-6">
                    {/* Select checkbox */}
                    <input
                      type="checkbox"
                      checked={selectedSchedulers.has(rowId)}
                      onChange={() => toggleSelectOne(rowId)}
                      className="flex-shrink-0 rounded border-gray-300 dark:border-gray-600 text-sfpurple-600 focus:ring-sfpurple-500"
                    />
                    {/* Flow identity */}
                    <div className="flex items-center gap-2.5 w-[180px] min-w-0 flex-shrink-0">
                      <PulseDot active={active}/>
                      <div className="min-w-0">
                        <p title={flowName} className="text-gray-800 dark:text-gray-100 text-sm font-semibold font-mono truncate leading-tight">{flowName}</p>
                        <span className={`inline-flex items-center text-[10px] px-1.5 py-0.5 rounded-md font-semibold mt-1 ${active?'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400':'bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500'}`}>
                          {active?'Enabled':'Disabled'}
                        </span>
                        {isAmbiguous && (
                          <span title="Another scheduler in this app shares the same identifier — Run Now/Toggle are disabled to avoid acting on the wrong one"
                            className="inline-flex items-center text-[10px] px-1.5 py-0.5 rounded-md font-semibold mt-1 ml-1 bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400">
                            ⚠ ambiguous
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Cron / frequency */}
                    <div className="w-[240px] min-w-0 flex-shrink-0">
                      {cron && !isUnresolvedPlaceholder ? (
                        <div className="space-y-1">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <MetaTag color="cyan">{cron}</MetaTag>
                            {schedulerTz && <span className="text-[10px] text-sfteal-600 dark:text-sfteal-400">🕐 {schedulerTz}</span>}
                          </div>
                          {decodedCron && (
                            <p className="text-[12px] text-gray-600 dark:text-gray-300 font-medium truncate" title={decodedCron}>{decodedCron}</p>
                          )}
                          {wasResolved && (
                            <p className="text-[10px] text-gray-400 dark:text-gray-500 font-mono truncate" title="Property placeholder resolved from app properties">{rawCron}</p>
                          )}
                        </div>
                      ) : isUnresolvedPlaceholder ? (
                        <div className="space-y-1">
                          <MetaTag color="gray">{rawCron}</MetaTag>
                          <p className="text-[10px] text-amber-600 dark:text-amber-400">⚠ property not in runtime props — check CPS</p>
                          {schedulerTz && <p className="text-[10px] text-sfteal-600 dark:text-sfteal-400">🕐 {schedulerTz}</p>}
                        </div>
                      ) : freq ? (
                        <div className="space-y-1">
                          <MetaTag color="blue">{freq}{timeUnit ? ` ${timeUnit}` : ''}</MetaTag>
                          {schedulerTz && <p className="text-[10px] text-sfteal-600 dark:text-sfteal-400">🕐 {schedulerTz}</p>}
                        </div>
                      ) : <span className="text-gray-400 dark:text-gray-600 text-xs">No schedule info</span>}
                    </div>

                    {/* Last run */}
                    <div className="w-[88px] flex-shrink-0">
                      <p className="text-[9px] font-bold tracking-wider text-gray-400 dark:text-gray-500 uppercase mb-1">Last Run</p>
                      {lastRunNode}
                    </div>

                    {/* Next run */}
                    <div className="w-[88px] flex-shrink-0">
                      <p className="text-[9px] font-bold tracking-wider text-gray-400 dark:text-gray-500 uppercase mb-1">Next Run</p>
                      {computedNextRun ? (
                        <>
                          <span className="text-sfpurple-700 dark:text-sfpurple-300 text-xs font-mono font-semibold">{computedNextRun.toLocaleDateString()}</span>
                          <p className="text-sfpurple-500 dark:text-sfpurple-400 text-[10px] font-mono">{computedNextRun.toLocaleTimeString()}</p>
                        </>
                      ) : freq ? (
                        <span className="text-gray-400 dark:text-gray-600 text-xs" title="Fixed-frequency scheduler — next run not calculable from frequency alone">—</span>
                      ) : (
                        <span className="text-gray-400 dark:text-gray-600 text-xs">—</span>
                      )}
                    </div>

                    {/* Action */}
                    <div className="flex-shrink-0 flex items-center gap-2">
                      <button
                        onClick={() => setSchedulerToggleConfirm({ schedulerKey, nextEnabled: !active })}
                        disabled={isToggling || isAmbiguous}
                        title={isAmbiguous ? 'Ambiguous scheduler identifier — another scheduler in this app shares the same name/flow, so this action is disabled to avoid toggling the wrong one' : (active ? `Disable "${schedulerKey}"` : `Enable "${schedulerKey}"`)}
                        className={`flex items-center gap-1.5 px-3.5 py-2.5 text-xs font-semibold rounded-xl border transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
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
                        className="flex items-center gap-1.5 px-3.5 py-2.5 text-xs font-semibold rounded-xl border transition-all disabled:opacity-40 disabled:cursor-not-allowed bg-sfpurple-50 dark:bg-sfpurple-500/10 text-sfpurple-700 dark:text-sfpurple-300 border-sfpurple-200/60 dark:border-sfpurple-400/20 hover:bg-sfpurple-600 hover:text-white hover:border-sfpurple-600 hover:shadow-md hover:shadow-sfpurple-500/30">
                        {isTriggering
                          ? <><RefreshCw size={13} className="animate-spin" /> Running…</>
                          : <><Zap size={13} /> Run Now</>}
                      </button>
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
