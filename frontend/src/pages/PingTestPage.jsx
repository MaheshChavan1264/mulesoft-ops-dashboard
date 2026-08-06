import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { useCredentialStore } from '../context/CredentialStoreContext';
import { useLocation } from 'react-router-dom';
import {
  Activity, RefreshCw, Search, SlidersHorizontal, Play, X, Key,
  Eye, EyeOff, ChevronDown, ChevronRight, CheckCircle2, XCircle,
  AlertCircle, Clock, Globe, ShieldCheck,
} from 'lucide-react';
import Select from '../components/Select';
import BgFilterModal, { applyBgFilter } from '../components/BgFilterModal';
import CredentialImportButton from '../components/CredentialImportButton';
import api from '../services/api';

const ENV_BADGE = { production: 'bg-green-400', sandbox: 'bg-yellow-400', design: 'bg-blue-400' };
const ENV_TAG_COLOR = { production: 'bg-green-500/20 text-green-400', sandbox: 'bg-yellow-500/20 text-yellow-400' };

const STATUS_CONFIG = {
  SUCCESS: { icon: <CheckCircle2 size={14} className="text-emerald-400" />, label: 'Healthy',     cls: 'text-emerald-400 bg-emerald-500/10 border-emerald-700/40', dot: 'bg-emerald-400', ping: true },
  PARTIAL: { icon: <AlertCircle  size={14} className="text-yellow-400"  />, label: 'Partial',     cls: 'text-yellow-400 bg-yellow-500/10 border-yellow-700/40',   dot: 'bg-yellow-400', ping: false },
  FAILED:  { icon: <XCircle      size={14} className="text-red-400"     />, label: 'Unreachable', cls: 'text-red-400 bg-red-500/10 border-red-700/40',             dot: 'bg-red-500',    ping: false },
};

function latencyColor(ms) {
  if (!ms) return 'text-gray-400';
  if (ms < 300) return 'text-emerald-400';
  if (ms < 1000) return 'text-yellow-400';
  return 'text-red-400';
}

// ─── PingTableRow ────────────────────────────────────────────────────────────

function PingTableRow({ app, result, loading, selected, onToggle, expandedId, setExpandedId, autoResolved }) {
  const key = `${app.id}|${app.environment?.id}`;
  const isExpanded = expandedId === key;
  const isCH1 = app.deploymentType !== 'CloudHub 2.0';
  const cfg = result ? STATUS_CONFIG[result.status] || STATUS_CONFIG.FAILED : null;

  return (
    <>
      <tr className={`border-t border-gray-800 hover:bg-gray-800/20 transition-colors ${selected ? 'bg-cyan-950/10' : ''}`}>
        {/* Checkbox */}
        <td className="px-4 py-3">
          <button
            onClick={onToggle}
            className={`w-4 h-4 rounded border flex items-center justify-center transition-colors flex-shrink-0 ${
              selected ? 'bg-cyan-600 border-cyan-500' : 'border-gray-600 hover:border-cyan-500'
            }`}
          >
            {selected && <span className="text-white text-[10px] font-bold leading-none">✓</span>}
          </button>
        </td>

        {/* App name */}
        <td className="px-4 py-3">
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${ENV_BADGE[app.environment?.type] || 'bg-gray-400'}`} />
            <div>
              <div className="flex items-center gap-1.5">
                <p className="text-white text-sm font-medium">{app.name}</p>
                {autoResolved && (
                  <span
                    title={`Auto-resolved: ${autoResolved.apiInstanceName} → ${autoResolved.contractApp}`}
                    className="flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 bg-emerald-500/10 border border-emerald-700/40 text-emerald-400 rounded font-medium"
                  >
                    <Key size={8} />
                    auto
                  </span>
                )}
              </div>
              <p className="text-gray-500 text-xs">{app.environment?.name}</p>
            </div>
          </div>
        </td>

        {/* Type */}
        <td className="px-3 py-3">
          <span className={`text-xs px-2 py-0.5 rounded font-medium ${isCH1 ? 'bg-purple-500/20 text-purple-400' : 'bg-blue-500/20 text-blue-400'}`}>
            {isCH1 ? 'CH1' : 'CH2'}
          </span>
        </td>

        {/* Ping Status */}
        <td className="px-3 py-3">
          {loading && (
            <span className="flex items-center gap-1.5 text-gray-400 text-xs">
              <RefreshCw size={12} className="animate-spin" /> Pinging…
            </span>
          )}
          {!loading && !result && <span className="text-gray-600 text-xs">—</span>}
          {!loading && result && cfg && (
            <span className={`inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full border font-semibold ${cfg.cls}`}>
              <span className="relative flex h-1.5 w-1.5 flex-shrink-0">
                {cfg.ping && <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-60 ${cfg.dot}`} />}
                <span className={`relative inline-flex rounded-full h-1.5 w-1.5 ${cfg.dot}`} />
              </span>
              {cfg.label}
            </span>
          )}
        </td>

        {/* Active Endpoint */}
        <td className="px-3 py-3 max-w-xs">
          {result?.activeEndpoint ? (
            <span className="font-mono text-xs text-cyan-300/90 truncate block" title={result.activeEndpoint}>
              {result.activeEndpoint}
            </span>
          ) : (
            <span className="text-gray-600 text-xs">—</span>
          )}
        </td>

        {/* HTTP Status */}
        <td className="px-3 py-3 text-center">
          {result?.httpStatus != null ? (
            <span className={`font-mono font-bold text-sm ${
              result.httpStatus < 300 ? 'text-emerald-400' :
              result.httpStatus < 500 ? 'text-yellow-400' : 'text-red-400'
            }`}>{result.httpStatus}</span>
          ) : <span className="text-gray-600 text-xs">—</span>}
        </td>

        {/* Latency */}
        <td className="px-3 py-3 text-right">
          {result?.responseTimeMs != null ? (
            <span className={`font-mono font-semibold text-sm ${latencyColor(result.responseTimeMs)}`}>
              {result.responseTimeMs}ms
            </span>
          ) : <span className="text-gray-600 text-xs">—</span>}
        </td>

        {/* Expand */}
        <td className="px-3 py-3 text-center">
          {result && (
            <button
              onClick={() => setExpandedId(isExpanded ? null : key)}
              className="text-gray-500 hover:text-gray-300 transition-colors"
            >
              {isExpanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
            </button>
          )}
        </td>
      </tr>

      {/* Expanded detail row */}
      {isExpanded && result && (
        <tr className="border-t border-gray-800/40 bg-gray-900/40">
          <td colSpan={8} className="px-6 py-4">
            <div className="space-y-3 text-sm">

              {/* Auto-resolved credential source */}
              {autoResolved && (
                <div className="flex items-start gap-3">
                  <ShieldCheck size={13} className="text-emerald-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <span className="text-gray-400 text-xs font-medium uppercase tracking-wider">Credentials (Auto-resolved)</span>
                    <p className="text-emerald-400/90 text-xs mt-0.5">
                      API Manager: <span className="font-medium">{autoResolved.apiInstanceName}</span>
                      {' · '}Contract: <span className="font-medium">{autoResolved.contractApp}</span>
                      {' · '}client_id: <span className="font-mono">{autoResolved.clientId?.slice(0, 8)}…</span>
                    </p>
                  </div>
                </div>
              )}

              {/* Full endpoint */}
              <div className="flex items-start gap-3">
                <Globe size={13} className="text-gray-500 flex-shrink-0 mt-0.5" />
                <div>
                  <span className="text-gray-400 text-xs font-medium uppercase tracking-wider">Full Endpoint</span>
                  <p className="font-mono text-xs text-cyan-300 break-all mt-0.5">{result.activeEndpoint || '—'}</p>
                </div>
              </div>

              {/* Error */}
              {result.error && (
                <div className="flex items-start gap-3">
                  <XCircle size={13} className="text-red-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <span className="text-gray-400 text-xs font-medium uppercase tracking-wider">Error</span>
                    <p className="text-red-400 text-xs mt-0.5 break-all">{result.error}</p>
                  </div>
                </div>
              )}

              {/* Payload */}
              {result.payload && (
                <div>
                  <span className="text-gray-400 text-xs font-medium uppercase tracking-wider block mb-1.5">Response Payload</span>
                  <pre className="bg-[#0B0F17] rounded-lg px-4 py-3 text-xs text-emerald-400/90 overflow-auto max-h-32 font-mono border border-gray-800/60 leading-relaxed">
                    {typeof result.payload === 'string' ? result.payload : JSON.stringify(result.payload, null, 2)}
                  </pre>
                </div>
              )}

              {/* Attempt log */}
              {result.attempts && result.attempts.length > 0 && (
                <div>
                  <span className="text-gray-400 text-xs font-medium uppercase tracking-wider block mb-1.5">
                    Attempt Log — {result.attempts.length} path{result.attempts.length !== 1 ? 's' : ''} tried
                  </span>
                  <table className="w-full text-xs border-collapse">
                    <thead>
                      <tr className="bg-gray-800/60">
                        <th className="px-3 py-2 text-left text-gray-400 font-medium">URL</th>
                        <th className="px-3 py-2 text-left text-gray-400 font-medium w-32">Result</th>
                        <th className="px-3 py-2 text-right text-gray-400 font-medium w-24">Latency</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.attempts.map((a, i) => (
                        <tr key={i} className="border-t border-gray-800/40 hover:bg-gray-800/20">
                          <td className="px-3 py-2 font-mono text-gray-300 break-all">{a.url}</td>
                          <td className="px-3 py-2">
                            {a.error ? (
                              <span className="text-red-400 text-[11px]">{a.error}</span>
                            ) : (
                              <span className={`font-bold ${a.httpStatus < 300 ? 'text-emerald-400' : a.httpStatus < 500 ? 'text-yellow-400' : 'text-red-400'}`}>
                                HTTP {a.httpStatus}
                              </span>
                            )}
                          </td>
                          <td className={`px-3 py-2 font-mono text-right ${latencyColor(a.responseTimeMs)}`}>
                            {a.responseTimeMs != null ? `${a.responseTimeMs}ms` : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ─── PingTestPage ─────────────────────────────────────────────────────────────

export default function PingTestPage() {
  const { orgId } = useAuth();
  const { hasCredentials, resolveFromCandidates } = useCredentialStore();

  const [allBusinessGroups, setAllBusinessGroups] = useState([]);
  const [selectedBg, setSelectedBg] = useState('__all__');
  const [bgLoading, setBgLoading] = useState(true);
  const [showBgFilter, setShowBgFilter] = useState(false);
  const [environments, setEnvironments] = useState([]);
  const [apps, setApps] = useState([]);
  const [appsLoading, setAppsLoading] = useState(false);

  const [search, setSearch] = useState('');
  const [filterEnv, setFilterEnv] = useState('');
  const [filterType, setFilterType] = useState('');

  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [transactionId, setTransactionId] = useState('smokeTest');
  const [showSecret, setShowSecret] = useState(false);

  const [selectedAppIds, setSelectedAppIds] = useState(new Set());
  const [running, setRunning] = useState(false);
  const [currentApp, setCurrentApp] = useState(null);
  const [results, setResults] = useState({});
  const [showTestedOnly, setShowTestedOnly] = useState(false);
  const [preloadedApps, setPreloadedApps] = useState([]);
  const [expandedId, setExpandedId] = useState(null);

  // Per-app auto-resolved credentials from API Manager + CSV sheet
  const [autoResolvedMap, setAutoResolvedMap] = useState({});
  // Whether we are currently resolving credentials (pre-ping)
  const [resolving, setResolving] = useState(false);

  const location = useLocation();

  useEffect(() => { if (orgId) loadBGs(); }, [orgId]);
  useEffect(() => { if (selectedBg) loadApps(selectedBg); }, [selectedBg]);
  useEffect(() => {
    const state = location.state;
    if (state?.preloadedResults && state?.preloadedApps) {
      setResults(state.preloadedResults);
      setPreloadedApps(state.preloadedApps);
      setShowTestedOnly(true);
      window.history.replaceState({}, '');
    }
  }, []);
  useEffect(() => { setSelectedAppIds(new Set()); }, [selectedBg, filterEnv, filterType]);

  const loadBGs = async () => {
    setBgLoading(true);
    try {
      const res = await api.get('/organizations/business-groups');
      const groups = res.data.data || [];
      setAllBusinessGroups(groups);
      setSelectedBg('__all__');
    } catch { setSelectedBg(orgId); }
    setBgLoading(false);
  };

  const loadApps = async (bgId) => {
    setAppsLoading(true); setApps([]); setResults({}); setAutoResolvedMap({});
    try {
      const visible = applyBgFilter(allBusinessGroups);
      const bgIds = bgId === '__all__' ? (visible.length > 0 ? visible.map(g => g.id) : [orgId]) : [bgId];
      const [ar, er] = await Promise.all([
        Promise.allSettled(bgIds.map(id => api.get(`/applications/summary/${id}`))),
        Promise.allSettled(bgIds.map(id => api.get(`/environments/${id}`))),
      ]);
      const ma = [], me = [], sa = new Set(), se = new Set();
      ar.forEach((r, i) => {
        if (r.status === 'fulfilled') {
          (r.value.data.data || []).forEach(a => {
            const k = `${a.id}|${a.environment?.id || ''}`;
            if (!sa.has(k)) { sa.add(k); ma.push({ ...a, _bgId: bgIds[i] }); }
          });
        }
      });
      er.forEach(r => {
        if (r.status === 'fulfilled') {
          (r.value.data.data || []).forEach(e => {
            if (!se.has(e.id)) { se.add(e.id); me.push(e); }
          });
        }
      });
      setApps(ma); setEnvironments(me);
    } catch {}
    setAppsLoading(false);
  };

  // ─── Auto-resolve credentials ──────────────────────────────────────────────
  /**
   * For each app, call POST /api/health/auto-credentials to get the list of
   * approved contractIds from API Manager, then do a local lookup in the
   * in-memory credential map. The secret never leaves the browser except at
   * the moment a ping is fired.
   *
   * Returns: { [appId]: { clientId, clientSecret, apiInstanceName, contractApp } }
   */
  const resolveAllCredentials = useCallback(async (appsToResolve) => {
    if (!hasCredentials || !appsToResolve.length) return {};

    // Collect all unique BG IDs known to the page — the API Manager instance
    // for an app may be registered in a different BG than the deployment BG.
    const allBgIds = [...new Set(allBusinessGroups.map(g => g.id).filter(Boolean))];

    const settled = await Promise.allSettled(
      appsToResolve.map(async (app) => {
        const bgId = app._bgId;
        const envId = app.environment?.id;
        if (!bgId || !envId) {
          console.warn(`[AutoCreds] Skipping "${app.name}" — missing bgId or envId`);
          return null;
        }
        try {
          const { data } = await api.post('/health/auto-credentials', {
            orgId: bgId,
            envId,
            appName: app.name,
            // Pass all BG IDs so the backend can search other BGs when the
            // app's own BG has no API Manager instances
            allBgIds: allBgIds.filter(id => id !== bgId),
          });

          console.log(`[AutoCreds] "${app.name}" →`, {
            found: data.found,
            matchedApis: data.matchedApis?.map(a => a.label),
            candidates: data.matchInfo?.map(m => ({ id: m.clientId?.slice(0, 12) + '…', api: m.apiInstanceName, app: m.contractApp })),
          });

          if (data.found && data.matchInfo?.length > 0) {
            const matched = resolveFromCandidates(data.matchInfo.map(m => m.clientId));
            if (matched) {
              const meta = data.matchInfo.find(m => m.clientId === matched.clientId);
              console.log(`[AutoCreds] ✅ "${app.name}" → matched clientId ${matched.clientId.slice(0, 12)}… from "${meta?.contractApp}"`);
              return {
                appId: app.id,
                clientId: matched.clientId,
                clientSecret: matched.clientSecret,
                apiInstanceName: meta?.apiInstanceName || '—',
                contractApp: meta?.contractApp || '—',
              };
            } else {
              console.warn(`[AutoCreds] ⚠️ "${app.name}" → API Manager found ${data.matchInfo.length} contract(s) but NONE of the coreServicesIds are in your CSV.`,
                'Contract clientIds:', data.matchInfo.map(m => m.clientId));
            }
          } else {
            console.warn(`[AutoCreds] ⚠️ "${app.name}" → No matching API Manager instance found. orgId=${bgId} envId=${envId}`);
          }
          return null;
        } catch (err) {
          console.error(`[AutoCreds] ❌ "${app.name}" → request failed:`, err.message);
          return null;
        }
      })
    );

    const resolved = {};
    settled.forEach(r => {
      if (r.status === 'fulfilled' && r.value) {
        resolved[r.value.appId] = r.value;
      }
    });
    return resolved;
  }, [hasCredentials, resolveFromCandidates]);

  // ─── Ping runner ───────────────────────────────────────────────────────────

  const filtered = useMemo(() => apps.filter(a =>
    (!search || a.name?.toLowerCase().includes(search.toLowerCase())) &&
    (!filterEnv || a.environment?.id === filterEnv) &&
    (!filterType || a.deploymentType === filterType)
  ), [apps, search, filterEnv, filterType]);

  const appsToTest = useMemo(() =>
    selectedAppIds.size > 0
      ? filtered.filter(a => selectedAppIds.has(`${a.id}|${a.environment?.id}`))
      : filtered,
    [filtered, selectedAppIds]);

  const displayApps = useMemo(() => {
    let list;
    if (showTestedOnly) {
      const src = preloadedApps.length > 0 ? preloadedApps : apps;
      const ord = { SUCCESS: 0, PARTIAL: 1, FAILED: 2 };
      list = [...src.filter(a => results[a.id])].sort(
        (a, b) => (ord[results[a.id]?.status] ?? 3) - (ord[results[b.id]?.status] ?? 3)
      );
    } else {
      list = filtered;
    }
    if (selectedAppIds.size > 0) {
      return [...list].sort((a, b) => {
        const aKey = `${a.id}|${a.environment?.id}`;
        const bKey = `${b.id}|${b.environment?.id}`;
        return (selectedAppIds.has(aKey) ? 0 : 1) - (selectedAppIds.has(bKey) ? 0 : 1);
      });
    }
    return list;
  }, [showTestedOnly, apps, preloadedApps, filtered, results, selectedAppIds]);

  const allFilteredSelected = filtered.length > 0 && filtered.every(a => selectedAppIds.has(`${a.id}|${a.environment?.id}`));
  const someSelected = selectedAppIds.size > 0;

  const toggleApp = (app) => {
    const k = `${app.id}|${app.environment?.id}`;
    setSelectedAppIds(prev => { const n = new Set(prev); n.has(k) ? n.delete(k) : n.add(k); return n; });
  };

  const runPings = async (resolvedCreds) => {
    setRunning(true); setResults({});
    for (const app of appsToTest) {
      setCurrentApp(app.id);
      const isCH1 = app.deploymentType !== 'CloudHub 2.0';
      let ch2IngressUrl;
      if (!isCH1 && app._bgId && app.environment?.id) {
        try {
          const d = await api.get(`/applications/cloudhub2/${app._bgId}/${app.environment.id}/${app.id}`);
          const ds = d.data?.target?.deploymentSettings || {};
          const hi = ds.http?.inbound || {};
          const ep = hi.endpoints || [];
          ch2IngressUrl = hi.publicUrl || ep.find(e => e.access === 'external')?.url || ep[0]?.url;
        } catch {}
      }

      // Credential priority: manual global → auto-resolved per-app → none
      const manualId = clientId.trim();
      const manualSecret = clientSecret.trim();
      const auto = resolvedCreds?.[app.id];
      const useClientId     = manualId     || auto?.clientId     || undefined;
      const useClientSecret = manualSecret || auto?.clientSecret || undefined;

      try {
        const { data } = await api.post('/health/ping', {
          targetType: isCH1 ? 'CH1' : 'CH2',
          appName: app.name,
          ch2IngressUrl,
          clientId: useClientId,
          clientSecret: useClientSecret,
          transactionId: transactionId.trim() || 'smokeTest',
        });
        setResults(prev => ({ ...prev, [app.id]: data }));
      } catch (err) {
        setResults(prev => ({ ...prev, [app.id]: { status: 'FAILED', error: err.message } }));
      }
    }
    setCurrentApp(null); setRunning(false);
  };

  const handleRun = async () => {
    setShowTestedOnly(false);
    setAutoResolvedMap({});

    // If credentials sheet is loaded AND no manual client_id is typed → auto-resolve first
    let resolvedCreds = {};
    if (hasCredentials && !clientId.trim()) {
      setResolving(true);
      resolvedCreds = await resolveAllCredentials(appsToTest);
      setAutoResolvedMap(resolvedCreds);
      setResolving(false);
    }

    await runPings(resolvedCreds);
    setShowTestedOnly(true);
  };

  // ─── Select options ────────────────────────────────────────────────────────

  const visibleGroups = applyBgFilter(allBusinessGroups);
  const filterActive = visibleGroups.length < allBusinessGroups.length;
  const bgOptions = [
    { value: '__all__', label: 'All Organizations', tag: `${visibleGroups.length}`, tagColor: 'bg-gray-700 text-gray-300' },
    ...visibleGroups.map(g => ({ value: g.id, label: g.name, indent: !!g.parentId, tag: !g.parentId ? 'Root' : undefined, tagColor: 'bg-blue-500/20 text-blue-400' })),
  ];
  const envOptions = [
    { value: '', label: 'All Environments' },
    ...environments.map(e => ({ value: e.id, label: e.name, badge: true, badgeColor: ENV_BADGE[e.type] || 'bg-gray-400', tag: e.type, tagColor: ENV_TAG_COLOR[e.type] || 'bg-gray-700 text-gray-400' })),
  ];
  const typeOptions = [
    { value: '', label: 'All Types' },
    { value: 'CloudHub 2.0', label: 'CloudHub 2.0', tag: 'CH2', tagColor: 'bg-blue-500/20 text-blue-400' },
    { value: 'CloudHub 1.0', label: 'CloudHub 1.0', tag: 'CH1', tagColor: 'bg-purple-500/20 text-purple-400' },
  ];

  const done = Object.keys(results).length;
  const successCount = Object.values(results).filter(r => r.status === 'SUCCESS').length;
  const partialCount = Object.values(results).filter(r => r.status === 'PARTIAL').length;
  const failedCount  = Object.values(results).filter(r => r.status === 'FAILED').length;
  const autoResolvedCount = Object.keys(autoResolvedMap).length;
  const testLabel = selectedAppIds.size > 0
    ? `Run (${selectedAppIds.size} selected)`
    : `Run Ping Tests (${filtered.length})`;

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5">
      {showBgFilter && (
        <BgFilterModal
          businessGroups={allBusinessGroups}
          onClose={() => setShowBgFilter(false)}
          onSaved={() => {
            const v = applyBgFilter(allBusinessGroups);
            if (selectedBg !== '__all__' && !v.find(g => g.id === selectedBg)) setSelectedBg('__all__');
          }}
        />
      )}

      {/* Page header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <Activity size={20} className="text-cyan-400" /> Ping Test
          </h1>
          <p className="text-gray-400 text-sm mt-1">
            {filtered.length} apps
            {done > 0 && (
              <span className="ml-2">
                · <span className="text-emerald-400">{successCount} ✓</span>
                {partialCount > 0 && <span className="text-yellow-400 ml-1">{partialCount} ~</span>}
                {failedCount  > 0 && <span className="text-red-400 ml-1">{failedCount} ✗</span>}
              </span>
            )}
            {autoResolvedCount > 0 && (
              <span className="ml-2 text-emerald-400/70 text-xs">
                · 🔑 {autoResolvedCount} auto-creds
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {running || resolving ? (
            <button
              onClick={() => setRunning(false)}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-red-700 hover:bg-red-600 text-white rounded-lg"
            >
              <X size={14} /> Stop
            </button>
          ) : (
            <button
              onClick={handleRun}
              disabled={appsLoading || filtered.length === 0}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-cyan-700 hover:bg-cyan-600 disabled:opacity-50 text-white rounded-lg"
            >
              <Play size={14} /> {testLabel}
            </button>
          )}
          <button
            onClick={() => { setResults({}); setAutoResolvedMap({}); setExpandedId(null); }}
            disabled={done === 0}
            className="flex items-center gap-2 px-3 py-2 text-sm text-gray-400 hover:text-white bg-gray-800 rounded-lg disabled:opacity-40"
          >
            <RefreshCw size={13} /> Clear
          </button>
        </div>
      </div>

      {/* Filters + credentials panel */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl px-5 py-4 space-y-3">
        {/* Row 1: BG / Env / Type */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-[10px] text-gray-500 uppercase tracking-wider font-medium">Business Group</p>
              <button
                onClick={() => setShowBgFilter(true)}
                className={`flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border ${filterActive ? 'bg-blue-600/20 border-blue-600/50 text-blue-400' : 'bg-gray-800 border-gray-700 text-gray-500 hover:text-gray-300'}`}
              >
                <SlidersHorizontal size={9} />{filterActive ? `${visibleGroups.length}/${allBusinessGroups.length}` : 'Filter'}
              </button>
            </div>
            <Select value={selectedBg} onChange={v => { setSelectedBg(v); setResults({}); }} options={bgOptions} placeholder="Select BG..." searchable={visibleGroups.length > 5} disabled={bgLoading} />
          </div>
          <div>
            <p className="text-[10px] text-gray-500 uppercase tracking-wider font-medium mb-1.5">Environment</p>
            <Select value={filterEnv} onChange={setFilterEnv} options={envOptions} placeholder="All Environments" searchable />
          </div>
          <div>
            <p className="text-[10px] text-gray-500 uppercase tracking-wider font-medium mb-1.5">Type</p>
            <Select value={filterType} onChange={setFilterType} options={typeOptions} placeholder="All Types" />
          </div>
        </div>

        {/* Row 2: Search */}
        <div className="relative">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search app names..."
            className="w-full bg-gray-800 border border-gray-700 rounded-lg pl-9 pr-4 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-cyan-600/50"
          />
        </div>

        {/* Row 3: Credentials */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1 border-t border-gray-800">
          <div>
            <label className="text-[10px] text-gray-500 uppercase tracking-wider font-medium flex items-center gap-1 mb-1">
              <Key size={9} /> client_id <span className="normal-case text-gray-600">(overrides auto)</span>
            </label>
            <input
              value={clientId} onChange={e => setClientId(e.target.value)}
              placeholder="optional — leave blank to auto-resolve"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-xs text-gray-200 font-mono focus:outline-none focus:border-cyan-600/50"
            />
          </div>
          <div>
            <label className="text-[10px] text-gray-500 uppercase tracking-wider font-medium flex items-center gap-1 mb-1">
              <Key size={9} /> client_secret
            </label>
            <div className="relative">
              <input
                value={clientSecret} onChange={e => setClientSecret(e.target.value)}
                type={showSecret ? 'text' : 'password'}
                placeholder="optional"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 pr-8 text-xs text-gray-200 font-mono focus:outline-none focus:border-cyan-600/50"
              />
              <button onClick={() => setShowSecret(!showSecret)} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300">
                {showSecret ? <EyeOff size={12} /> : <Eye size={12} />}
              </button>
            </div>
          </div>
          <div>
            <label className="text-[10px] text-gray-500 uppercase tracking-wider font-medium mb-1 block">x-transaction-id</label>
            <input
              value={transactionId} onChange={e => setTransactionId(e.target.value)}
              placeholder="smokeTest"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-xs text-gray-200 font-mono focus:outline-none focus:border-cyan-600/50"
            />
          </div>
        </div>

        {/* Row 4: Credential Import — shown below the creds row */}
        <div className="flex items-center justify-between pt-1 border-t border-gray-800/60">
          <div className="flex items-center gap-2">
            <CredentialImportButton />
            {hasCredentials && !clientId.trim() && (
              <span className="text-[10px] text-gray-500">
                Auto-resolve enabled — credentials matched per-app at run time
              </span>
            )}
            {clientId.trim() && (
              <span className="text-[10px] text-gray-500">
                Manual client_id set — auto-resolve bypassed
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Resolving credentials banner */}
      {resolving && (
        <div className="bg-gray-900 border border-emerald-800/40 rounded-xl px-5 py-3 flex items-center gap-3">
          <RefreshCw size={14} className="animate-spin text-emerald-400 flex-shrink-0" />
          <span className="text-emerald-300 text-xs font-medium">
            Resolving credentials from API Manager… ({appsToTest.length} apps)
          </span>
        </div>
      )}

      {/* Running progress banner */}
      {running && (
        <div className="bg-gray-900 border border-cyan-800/40 rounded-xl px-5 py-3 flex items-center gap-3">
          <RefreshCw size={14} className="animate-spin text-cyan-400 flex-shrink-0" />
          <div className="flex-1">
            <div className="flex items-center justify-between text-xs mb-1.5">
              <span className="text-cyan-300 font-medium">Running…</span>
              <span className="text-gray-500">{done} / {appsToTest.length}</span>
            </div>
            <div className="w-full bg-gray-800 rounded-full h-1.5">
              <div
                className="bg-cyan-500 h-1.5 rounded-full transition-all"
                style={{ width: `${appsToTest.length > 0 ? (done / appsToTest.length) * 100 : 0}%` }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Results summary bar */}
      {!running && done > 0 && (
        <div className="flex items-center justify-between flex-wrap gap-3 px-5 py-3 bg-gray-900 border border-gray-800 rounded-xl text-sm">
          <div className="flex items-center gap-4">
            <span className="text-gray-400 font-medium">{done} tested</span>
            <span className="text-emerald-400 font-semibold">✓ {successCount} healthy</span>
            {partialCount > 0 && <span className="text-yellow-400 font-semibold">~ {partialCount} partial</span>}
            {failedCount  > 0 && <span className="text-red-400 font-semibold">✗ {failedCount} failed</span>}
            {autoResolvedCount > 0 && (
              <span className="flex items-center gap-1 text-emerald-400/70 text-xs font-medium">
                <ShieldCheck size={11} /> {autoResolvedCount} auto-creds used
              </span>
            )}
          </div>
          <button
            onClick={() => setShowTestedOnly(!showTestedOnly)}
            className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border font-medium transition-all ${
              showTestedOnly
                ? 'bg-cyan-600/20 border-cyan-600/60 text-cyan-300'
                : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-white'
            }`}
          >
            {showTestedOnly ? '✓ Tested apps' : 'View tested apps'}
          </button>
        </div>
      )}

      {/* Loading state */}
      {appsLoading && (
        <div className="flex items-center justify-center py-16 gap-2 text-gray-500 text-sm">
          <RefreshCw size={15} className="animate-spin" /> Loading applications…
        </div>
      )}

      {/* Results table */}
      {!appsLoading && displayApps.length > 0 && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-800/50 text-gray-400 text-xs uppercase tracking-wider">
                <th
                  className="px-4 py-3 w-10 cursor-pointer"
                  onClick={() =>
                    allFilteredSelected
                      ? setSelectedAppIds(new Set())
                      : setSelectedAppIds(new Set(filtered.map(a => `${a.id}|${a.environment?.id}`)))
                  }
                >
                  <div className={`w-4 h-4 rounded border flex items-center justify-center ${
                    allFilteredSelected ? 'bg-cyan-600 border-cyan-500' : someSelected ? 'bg-cyan-900/60 border-cyan-600' : 'border-gray-600 hover:border-cyan-500'
                  }`}>
                    {allFilteredSelected && <span className="text-white text-[10px] font-bold leading-none">✓</span>}
                    {!allFilteredSelected && someSelected && <span className="text-cyan-400 text-[10px] font-bold leading-none">–</span>}
                  </div>
                </th>
                <th className="text-left px-4 py-3 font-medium">Application</th>
                <th className="text-left px-3 py-3 font-medium">Type</th>
                <th className="text-left px-3 py-3 font-medium">Status</th>
                <th className="text-left px-3 py-3 font-medium">Active Endpoint</th>
                <th className="text-center px-3 py-3 font-medium">HTTP</th>
                <th className="text-right px-3 py-3 font-medium">Latency</th>
                <th className="px-3 py-3 w-10"></th>
              </tr>
            </thead>
            <tbody>
              {displayApps.map(app => (
                <PingTableRow
                  key={`${app.id}|${app.environment?.id}`}
                  app={app}
                  result={results[app.id]}
                  loading={running && currentApp === app.id}
                  selected={selectedAppIds.has(`${app.id}|${app.environment?.id}`)}
                  onToggle={() => toggleApp(app)}
                  expandedId={expandedId}
                  setExpandedId={setExpandedId}
                  autoResolved={autoResolvedMap[app.id]}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Empty states */}
      {!appsLoading && displayApps.length === 0 && apps.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <Activity size={40} className="text-gray-700" />
          <p className="text-gray-500 text-sm">No applications found</p>
        </div>
      )}
      {!appsLoading && displayApps.length === 0 && apps.length > 0 && !showTestedOnly && (
        <div className="flex flex-col items-center justify-center py-12 gap-3">
          <p className="text-gray-500 text-sm">No apps match your filters</p>
          <button
            onClick={() => { setSearch(''); setFilterEnv(''); setFilterType(''); }}
            className="text-cyan-400 hover:text-cyan-300 text-xs underline"
          >
            Clear filters
          </button>
        </div>
      )}
    </div>
  );
}
