import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { useCredentialStore } from '../context/CredentialStoreContext';
import { useNavigate } from 'react-router-dom';
import { Search, RefreshCw, ChevronRight, Play, Square, RotateCcw, AlertTriangle, X, SlidersHorizontal, FileSpreadsheet, Activity, CheckCircle2, XCircle, Clock, ShieldCheck } from 'lucide-react';
import CredentialImportButton from '../components/CredentialImportButton';
import StatusBadge from '../components/StatusBadge';
import Select from '../components/Select';
import BgFilterModal, { applyBgFilter } from '../components/BgFilterModal';
import CpsExportModal from '../components/CpsExportModal';
import PingResultCard from '../components/PingResultCard';
import api from '../services/api';

const ENV_BADGE = { production: 'bg-green-400', sandbox: 'bg-yellow-400', design: 'bg-blue-400' };
const ENV_TAG_COLOR = {
  production: 'bg-green-500/20 text-green-400',
  sandbox: 'bg-yellow-500/20 text-yellow-400'
};

const availableActions = (status) => {
  const s = (status || '').toUpperCase();
  if (['RUNNING', 'STARTED', 'PARTIALLY_STARTED', 'PARTIALLY_RUNNING'].includes(s)) return ['stop', 'restart'];
  if (['STOPPED', 'FAILED', 'DEPLOY_FAILED', 'UNDEPLOYED', 'NOT_RUNNING'].includes(s)) return ['start'];
  return [];
};

const ACTION_CONFIG = {
  start:   { label: 'Start',   Icon: Play,      btnCls: 'text-emerald-400 hover:bg-emerald-950/60 hover:text-emerald-300 border-emerald-800/40', bulkCls: 'bg-emerald-600 hover:bg-emerald-500 text-white' },
  stop:    { label: 'Stop',    Icon: Square,    btnCls: 'text-red-400 hover:bg-red-950/60 hover:text-red-300 border-red-800/40',                 bulkCls: 'bg-red-600 hover:bg-red-500 text-white' },
  restart: { label: 'Restart', Icon: RotateCcw, btnCls: 'text-blue-400 hover:bg-blue-950/60 hover:text-blue-300 border-blue-800/40',             bulkCls: 'bg-blue-600 hover:bg-blue-500 text-white' }
};

/* ── Single-app Confirm Modal ──────────────────────────────── */
function ConfirmModal({ state, onConfirm, onCancel, loading }) {
  if (!state) return null;
  const { action, app } = state;
  const { Icon, label, bulkCls } = ACTION_CONFIG[action];
  const dangerous = action === 'stop';
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6 w-full max-w-md shadow-2xl mx-4">
        <div className="flex items-start gap-4">
          <div className={`p-2.5 rounded-xl flex-shrink-0 border ${dangerous ? 'bg-red-950/60 border-red-800/40' : 'bg-blue-950/60 border-blue-800/40'}`}>
            <AlertTriangle size={18} className={dangerous ? 'text-red-400' : 'text-blue-400'} />
          </div>
          <div className="flex-1">
            <h3 className="text-white font-semibold text-base mb-1">{label} Application?</h3>
            <p className="text-gray-400 text-sm">
              Are you sure you want to <span className="font-medium text-white">{label.toLowerCase()}</span>{' '}
              <span className="font-mono text-blue-300 text-xs bg-blue-950/40 px-1.5 py-0.5 rounded">{app.name}</span>?
            </p>
            {dangerous && <p className="text-red-400/80 text-xs mt-2">⚠ This will stop all running flows and connections.</p>}
          </div>
          <button onClick={onCancel} className="text-gray-600 hover:text-gray-300 flex-shrink-0"><X size={16} /></button>
        </div>
        <div className="flex justify-end gap-3 mt-6">
          <button onClick={onCancel} disabled={loading}
            className="px-4 py-2 text-sm text-gray-400 hover:text-white bg-gray-800 hover:bg-gray-700 rounded-lg disabled:opacity-50 transition-colors">
            Cancel
          </button>
          <button onClick={onConfirm} disabled={loading}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg disabled:opacity-50 transition-colors ${bulkCls}`}>
            {loading
              ? <><span className="animate-spin rounded-full h-3.5 w-3.5 border-b-2 border-white" /> Working…</>
              : <><Icon size={13} /> Confirm {label}</>}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Bulk Confirm Modal ─────────────────────────────────────── */
function BulkConfirmModal({ state, onConfirm, onCancel, loading, results }) {
  if (!state) return null;
  const { action, apps } = state;
  const { Icon, label, bulkCls } = ACTION_CONFIG[action];
  const dangerous = action === 'stop';
  const isDone = !!results;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6 w-full max-w-lg shadow-2xl mx-4">
        <div className="flex items-start gap-4 mb-4">
          <div className={`p-2.5 rounded-xl flex-shrink-0 border ${dangerous ? 'bg-red-950/60 border-red-800/40' : 'bg-blue-950/60 border-blue-800/40'}`}>
            <AlertTriangle size={18} className={dangerous ? 'text-red-400' : 'text-blue-400'} />
          </div>
          <div className="flex-1">
            <h3 className="text-white font-semibold text-base mb-1">
              {isDone ? 'Results' : `${label} ${apps.length} Application${apps.length !== 1 ? 's' : ''}?`}
            </h3>
            {!isDone && (
              <p className="text-gray-400 text-sm">
                This will <span className="text-white font-medium">{label.toLowerCase()}</span> the following applications:
              </p>
            )}
            {dangerous && !isDone && (
              <p className="text-red-400/80 text-xs mt-1">⚠ This will stop all running flows and connections for each app.</p>
            )}
          </div>
          <button onClick={onCancel} disabled={loading} className="text-gray-600 hover:text-gray-300 flex-shrink-0">
            <X size={16} />
          </button>
        </div>

        {/* App list with per-app result indicators */}
        <div className="max-h-52 overflow-y-auto space-y-1.5 mb-5 pr-1">
          {apps.map((app) => {
            const r = results?.[app.id];
            return (
              <div key={app.id} className="flex items-center justify-between bg-gray-800/60 border border-gray-700/40 rounded-lg px-3 py-2 gap-2">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <span className={`w-2 h-2 rounded-full flex-shrink-0 ${ENV_BADGE[app.environment?.type] || 'bg-gray-400'}`} />
                  <span className="text-gray-200 text-xs font-medium truncate">{app.name}</span>
                  <span className="text-gray-600 text-xs flex-shrink-0 hidden sm:inline">({app.environment?.name})</span>
                </div>
                <div className="flex-shrink-0">
                  {r ? (
                    r.success
                      ? <span className="text-emerald-400 text-xs font-medium">✓ Done</span>
                      : <span className="text-red-400 text-xs font-medium" title={r.error}>✗ Failed</span>
                  ) : loading ? (
                    <span className="animate-spin rounded-full h-3 w-3 border-b-2 border-blue-400 block" />
                  ) : (
                    <span className="text-gray-600 text-xs">Pending</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Summary when done */}
        {isDone && (
          <div className="flex gap-3 mb-4 text-xs">
            <span className="text-emerald-400 font-medium">
              ✓ {Object.values(results).filter((r) => r.success).length} succeeded
            </span>
            {Object.values(results).filter((r) => !r.success).length > 0 && (
              <span className="text-red-400 font-medium">
                ✗ {Object.values(results).filter((r) => !r.success).length} failed
              </span>
            )}
          </div>
        )}

        <div className="flex justify-end gap-3">
          <button onClick={onCancel} disabled={loading}
            className="px-4 py-2 text-sm text-gray-400 hover:text-white bg-gray-800 hover:bg-gray-700 rounded-lg disabled:opacity-50 transition-colors">
            {isDone ? 'Close' : 'Cancel'}
          </button>
          {!isDone && (
            <button onClick={onConfirm} disabled={loading}
              className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg disabled:opacity-50 transition-colors ${bulkCls}`}>
              {loading
                ? <><span className="animate-spin rounded-full h-3.5 w-3.5 border-b-2 border-white" /> Working…</>
                : <><Icon size={13} /> {label} All {apps.length}</>}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Bulk Ping Modal ────────────────────────────────────────── */
function BulkPingModal({ apps, onClose }) {
  const navigate = useNavigate();
  const { hasCredentials, resolveFromCandidates } = useCredentialStore();
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [transactionId, setTransactionId] = useState('smokeTest');
  const [running, setRunning] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [results, setResults] = useState({});
  const [autoResolvedMap, setAutoResolvedMap] = useState({});
  const [showSecret, setShowSecret] = useState(false);

  // Resolve credentials from API Manager + CSV sheet for each app (in parallel)
  const resolveAllCredentials = useCallback(async () => {
    if (!hasCredentials || clientId.trim()) return {};
    const settled = await Promise.allSettled(
      apps.map(async (app) => {
        const bgId = app._bgId;
        const envId = app.environment?.id;
        if (!bgId || !envId) return null;
        try {
          const { data } = await api.post('/health/auto-credentials', {
            orgId: bgId, envId, appName: app.name,
          });
          if (data.found && data.matchInfo?.length > 0) {
            const matched = resolveFromCandidates(data.matchInfo.map(m => m.clientId));
            if (matched) {
              const meta = data.matchInfo.find(m => m.clientId === matched.clientId);
              return { appId: app.id, ...matched, apiInstanceName: meta?.apiInstanceName || '—', contractApp: meta?.contractApp || '—' };
            }
          }
          return null;
        } catch { return null; }
      })
    );
    const resolved = {};
    settled.forEach(r => { if (r.status === 'fulfilled' && r.value) resolved[r.value.appId] = r.value; });
    return resolved;
  }, [hasCredentials, resolveFromCandidates, apps, clientId]);

  const runAll = async () => {
    setRunning(false);
    setResults({});
    setAutoResolvedMap({});

    // Step 1: auto-resolve credentials in parallel for all apps
    let resolvedCreds = {};
    if (hasCredentials && !clientId.trim()) {
      setResolving(true);
      resolvedCreds = await resolveAllCredentials();
      setAutoResolvedMap(resolvedCreds);
      setResolving(false);
    }

    setRunning(true);
    const collectedResults = {};

    /**
     * Ping a single app and return its result.
     * Fetches CH2 ingress URL on-demand, uses resolved or manual credentials.
     */
    const pingApp = async (app) => {
      const isCH1 = app.deploymentType !== 'CloudHub 2.0';
      let ch2IngressUrl = undefined;

      if (!isCH1 && app._bgId && app.environment?.id && app.id) {
        try {
          const detail = await api.get(`/applications/cloudhub2/${app._bgId}/${app.environment.id}/${app.id}`);
          const ds = detail.data?.target?.deploymentSettings || {};
          const httpInbound = ds.http?.inbound || {};
          const endpoints = httpInbound.endpoints || [];
          ch2IngressUrl =
            httpInbound.publicUrl ||
            endpoints.find(e => e.access === 'external')?.url ||
            endpoints[0]?.url ||
            undefined;
        } catch {}
      }

      const auto = resolvedCreds[app.id];
      const useClientId     = clientId.trim()     || auto?.clientId     || undefined;
      const useClientSecret = clientSecret.trim() || auto?.clientSecret || undefined;

      try {
        const { data } = await api.post('/health/ping', {
          targetType: isCH1 ? 'CH1' : 'CH2',
          appName: app.name,
          ch2IngressUrl,
          clientId: useClientId,
          clientSecret: useClientSecret,
          transactionId: transactionId.trim() || 'smokeTest',
        });
        return { appId: app.id, result: data };
      } catch (err) {
        return { appId: app.id, result: { status: 'FAILED', error: err.message } };
      }
    };

    // Run pings in parallel batches of 10 to balance speed vs rate limiting.
    // 100 apps → ~10 batches × ~5s avg = ~50s total (vs ~500s sequential).
    const BATCH_SIZE = 10;
    for (let i = 0; i < apps.length; i += BATCH_SIZE) {
      const batch = apps.slice(i, i + BATCH_SIZE);
      const batchResults = await Promise.allSettled(batch.map(pingApp));
      batchResults.forEach(r => {
        if (r.status === 'fulfilled') {
          const { appId, result } = r.value;
          collectedResults[appId] = result;
          setResults(prev => ({ ...prev, [appId]: result }));
        }
      });
    }

    setRunning(false);
    // Navigate to Ping Test Results page with full results + auto-resolved credential info
    navigate('/ping-test', { state: { preloadedResults: collectedResults, preloadedApps: apps, autoResolvedMap: resolvedCreds } });
    onClose();
  };

  const done = Object.keys(results).length;
  const success = Object.values(results).filter(r => r.status === 'SUCCESS').length;
  const partial = Object.values(results).filter(r => r.status === 'PARTIAL').length;
  const failed = Object.values(results).filter(r => r.status === 'FAILED').length;

  const latencyColor = ms => !ms ? 'text-gray-500' : ms < 300 ? 'text-green-400' : ms < 1000 ? 'text-yellow-400' : 'text-red-400';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-2xl shadow-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800 flex-shrink-0">
          <div className="flex items-center gap-3">
            <Activity size={16} className="text-cyan-400" />
            <span className="text-white font-semibold">Bulk Ping Test</span>
            <span className="text-xs text-gray-500 bg-gray-800 px-2 py-0.5 rounded-full">{apps.length} apps</span>
          </div>
          <div className="flex items-center gap-3">
            <CredentialImportButton compact />
            <button onClick={onClose} className="text-gray-500 hover:text-gray-300"><X size={16} /></button>
          </div>
        </div>

        {/* Credential inputs */}
        <div className="px-6 py-4 border-b border-gray-800 flex-shrink-0 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="text-[10px] text-gray-500 uppercase tracking-wider font-medium block mb-1">
                client_id <span className="normal-case text-gray-600">(overrides auto)</span>
              </label>
              <input value={clientId} onChange={e => setClientId(e.target.value)} placeholder="leave blank to auto-resolve"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-xs text-gray-200 font-mono focus:outline-none focus:border-cyan-600/50" />
            </div>
            <div>
              <label className="text-[10px] text-gray-500 uppercase tracking-wider font-medium block mb-1">client_secret</label>
              <div className="relative">
                <input value={clientSecret} onChange={e => setClientSecret(e.target.value)} type={showSecret ? 'text' : 'password'} placeholder="optional"
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 pr-8 text-xs text-gray-200 font-mono focus:outline-none focus:border-cyan-600/50" />
                <button onClick={() => setShowSecret(!showSecret)} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 text-xs">{showSecret ? '🙈' : '👁'}</button>
              </div>
            </div>
            <div>
              <label className="text-[10px] text-gray-500 uppercase tracking-wider font-medium block mb-1">x-transaction-id</label>
              <input value={transactionId} onChange={e => setTransactionId(e.target.value)} placeholder="smokeTest"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-xs text-gray-200 font-mono focus:outline-none focus:border-cyan-600/50" />
            </div>
          </div>
          {/* Credential import status */}
          {hasCredentials && !clientId.trim() && (
            <div className="flex items-center gap-1.5 text-[10px] text-emerald-400/80">
              <ShieldCheck size={10} />
              Credentials CSV loaded — will auto-resolve per app from API Manager
            </div>
          )}
        </div>

        {/* Resolving banner */}
        {resolving && (
          <div className="px-6 py-2 border-b border-gray-800 flex items-center gap-2 text-xs text-emerald-400 flex-shrink-0">
            <RefreshCw size={11} className="animate-spin" />
            Resolving credentials from API Manager…
          </div>
        )}

        {/* Progress summary */}
        {done > 0 && (
          <div className="px-6 py-3 border-b border-gray-800 flex items-center gap-4 text-xs flex-shrink-0">
            <span className="text-gray-500">{done}/{apps.length} tested</span>
            {success > 0 && <span className="text-green-400 font-medium">✓ {success} healthy</span>}
            {partial > 0 && <span className="text-yellow-400 font-medium">~ {partial} partial</span>}
            {failed > 0 && <span className="text-red-400 font-medium">✗ {failed} failed</span>}
            {Object.keys(autoResolvedMap).length > 0 && (
              <span className="flex items-center gap-1 text-emerald-400/70 font-medium">
                <ShieldCheck size={10} />{Object.keys(autoResolvedMap).length} auto-creds
              </span>
            )}
          </div>
        )}

        {/* Results list — each app gets a full PingResultCard */}
        <div className="overflow-y-auto flex-1 p-4 space-y-3">
          {apps.map(app => (
            <PingResultCard
              key={app.id}
              app={app}
              result={results[app.id]}
              loading={running && !results[app.id]}
            />
          ))}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-800 flex items-center justify-between flex-shrink-0">
          <p className="text-gray-600 text-xs">Pings /api/v1/ping → /api/v2/ping → /api/ping → /ping in order</p>
          <div className="flex items-center gap-3">
            <button onClick={onClose} className="px-4 py-2 text-sm text-gray-400 hover:text-white bg-gray-800 rounded-lg">Close</button>
            <button onClick={runAll} disabled={running || resolving}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-cyan-700 hover:bg-cyan-600 disabled:opacity-50 text-white rounded-lg">
              {resolving ? <><RefreshCw size={13} className="animate-spin" /> Resolving…</> : running ? <><RefreshCw size={13} className="animate-spin" /> Running…</> : <><Activity size={13} /> Run All Pings</>}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ApplicationsPage() {
  const { orgId } = useAuth();
  const navigate = useNavigate();

  const [allBusinessGroups, setAllBusinessGroups] = useState([]);
  const [selectedBg, setSelectedBg] = useState('');
  const [showBgFilter, setShowBgFilter] = useState(false);
  const [environments, setEnvironments] = useState([]);
  const [apps, setApps] = useState([]);
  const [loading, setLoading] = useState(false);
  const [bgLoading, setBgLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterEnv, setFilterEnv] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterType, setFilterType] = useState('');
  const [error, setError] = useState('');
  const [showExport, setShowExport] = useState(false);
  const [showBulkPing, setShowBulkPing] = useState(false);

  // Single-app action states
  const [actionLoading, setActionLoading] = useState({});
  const [confirmState, setConfirmState] = useState(null);
  const [actionResult, setActionResult] = useState(null);

  // Multi-select states
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [bulkConfirm, setBulkConfirm] = useState(null);
  const [bulkLoading, setBulkLoading] = useState(false);
  const [bulkResults, setBulkResults] = useState(null);

  useEffect(() => { if (orgId) loadBusinessGroups(); }, [orgId]);
  useEffect(() => { if (selectedBg) loadApps(selectedBg); }, [selectedBg]);
  useEffect(() => { setSelectedIds(new Set()); }, [selectedBg]);

  const loadBusinessGroups = async () => {
    setBgLoading(true);
    try {
      const res = await api.get('/organizations/business-groups');
      const groups = res.data.data || [];
      setAllBusinessGroups(groups);
      // Default to "All" so all filtered BGs are shown from the start
      setSelectedBg('__all__');
    } catch { setSelectedBg(orgId); }
    setBgLoading(false);
  };

  const loadApps = async (bgId, forceRefresh = false) => {
    setLoading(true);
    setError('');
    setFilterEnv('');
    setSelectedIds(new Set());
    try {
      // '__all__' → load from every visible BG in parallel and merge
      const visible = applyBgFilter(allBusinessGroups);
      const bgIds = bgId === '__all__'
        ? (visible.length > 0 ? visible.map(g => g.id) : [orgId])
        : [bgId];

      const params = forceRefresh ? { params: { refresh: 'true' } } : {};
      const [appsResults, envsResults] = await Promise.all([
        Promise.allSettled(bgIds.map(id => api.get(`/applications/summary/${id}`, params))),
        Promise.allSettled(bgIds.map(id => api.get(`/environments/${id}`))),
      ]);

      const mergedApps = [];
      const mergedEnvs = [];
      const seenApps = new Set();
      const seenEnvs = new Set();

      appsResults.forEach((r, i) => {
        if (r.status === 'fulfilled') {
          (r.value.data.data || []).forEach(a => {
            const key = `${a.id}|${a.environment?.id || ''}`;
            // Tag each app with _bgId so actions know which org it belongs to
            if (!seenApps.has(key)) { seenApps.add(key); mergedApps.push({ ...a, _bgId: bgIds[i] }); }
          });
        }
      });
      envsResults.forEach(r => {
        if (r.status === 'fulfilled') {
          (r.value.data.data || []).forEach(e => {
            if (!seenEnvs.has(e.id)) { seenEnvs.add(e.id); mergedEnvs.push(e); }
          });
        }
      });

      setApps(mergedApps);
      setEnvironments(mergedEnvs);
      if (mergedApps.length === 0) setError('No applications found.');
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to load applications.');
      setApps([]);
    }
    setLoading(false);
  };

  /* ── Single-app action ─────────────────────────────── */
  const requestAction = (e, app, action) => {
    e.stopPropagation();
    setActionResult(null);
    setConfirmState({ app, action });
  };

  const executeAction = async () => {
    if (!confirmState) return;
    const { app, action } = confirmState;
    setActionLoading((prev) => ({ ...prev, [app.id]: action }));
    try {
      const isCH2 = app.deploymentType === 'CloudHub 2.0';
      const envId = app.environment?.id;
      const appBgId = app._bgId || (selectedBg !== '__all__' ? selectedBg : orgId);
      if (isCH2) {
        await api.post(`/applications/cloudhub2/${appBgId}/${envId}/${app.id}/action`, { action });
      } else {
        await api.post(`/applications/cloudhub1/${envId}/${app.id}/action?orgId=${appBgId}`, { action });
      }
      const nextStatus = action === 'start' ? 'RUNNING' : action === 'stop' ? 'STOPPED' : 'DEPLOYING';
      setApps((prev) => prev.map((a) => a.id === app.id ? { ...a, status: nextStatus } : a));
      setActionResult({ success: true, message: `✓ ${app.name}: ${action} initiated` });
    } catch (e) {
      setActionResult({ success: false, message: `✗ Failed to ${action} ${app.name}: ${e.response?.data?.error || e.message}` });
    } finally {
      setActionLoading((prev) => ({ ...prev, [app.id]: null }));
      setConfirmState(null);
      setTimeout(() => setActionResult(null), 6000);
    }
  };

  /* ── Multi-select ──────────────────────────────────── */
  const filtered = useMemo(() => apps.filter((a) => {
    const matchSearch = !search || a.name?.toLowerCase().includes(search.toLowerCase());
    const matchEnv = !filterEnv || a.environment?.id === filterEnv;
    const matchStatus = !filterStatus || (a.status || '').toUpperCase() === filterStatus.toUpperCase();
    const matchType = !filterType || a.deploymentType === filterType;
    return matchSearch && matchEnv && matchStatus && matchType;
  }), [apps, search, filterEnv, filterStatus, filterType]);

  const allSelected = filtered.length > 0 && filtered.every((a) => selectedIds.has(a.id));
  const someSelected = !allSelected && filtered.some((a) => selectedIds.has(a.id));
  const selectedApps = filtered.filter((a) => selectedIds.has(a.id));

  // Selected rows float to the top
  const displayFiltered = useMemo(() => {
    if (selectedIds.size === 0) return filtered;
    return [...filtered].sort((a, b) => {
      const aS = selectedIds.has(a.id) ? 0 : 1;
      const bS = selectedIds.has(b.id) ? 0 : 1;
      return aS - bS;
    });
  }, [filtered, selectedIds]);

  const toggleRow = (e, appId) => {
    e.stopPropagation();
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(appId) ? next.delete(appId) : next.add(appId);
      return next;
    });
  };

  const toggleAll = (e) => {
    e.stopPropagation();
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allSelected || someSelected) {
        filtered.forEach((a) => next.delete(a.id));
      } else {
        filtered.forEach((a) => next.add(a.id));
      }
      return next;
    });
  };

  /* ── Bulk action ───────────────────────────────────── */
  const requestBulkAction = (action) => {
    setBulkResults(null);
    setBulkConfirm({ action, apps: selectedApps });
  };

  const executeBulkAction = async () => {
    if (!bulkConfirm) return;
    const { action, apps: targets } = bulkConfirm;
    setBulkLoading(true);
    setBulkResults(null);

    const settled = await Promise.allSettled(
      targets.map((app) => {
        const isCH2 = app.deploymentType === 'CloudHub 2.0';
        const envId = app.environment?.id;
        const appBgId = app._bgId || (selectedBg !== '__all__' ? selectedBg : orgId);
        if (isCH2) {
          return api.post(`/applications/cloudhub2/${appBgId}/${envId}/${app.id}/action`, { action });
        } else {
          return api.post(`/applications/cloudhub1/${envId}/${app.id}/action?orgId=${appBgId}`, { action });
        }
      })
    );

    const resultMap = {};
    const nextStatus = action === 'start' ? 'RUNNING' : action === 'stop' ? 'STOPPED' : 'DEPLOYING';

    targets.forEach((app, i) => {
      const r = settled[i];
      resultMap[app.id] = r.status === 'fulfilled'
        ? { success: true }
        : { success: false, error: r.reason?.response?.data?.error || r.reason?.message || 'Failed' };
    });

    // Optimistic update for successful ones
    setApps((prev) => prev.map((a) => resultMap[a.id]?.success ? { ...a, status: nextStatus } : a));
    setBulkResults(resultMap);
    setBulkLoading(false);
    // Keep only failed ones selected
    setSelectedIds((prev) => {
      const next = new Set(prev);
      targets.forEach((a) => { if (resultMap[a.id]?.success) next.delete(a.id); });
      return next;
    });
  };

  const bulkActions = useMemo(() => {
    if (selectedApps.length === 0) return [];
    const canStart   = selectedApps.some((a) => availableActions(a.status).includes('start'));
    const canStop    = selectedApps.some((a) => availableActions(a.status).includes('stop'));
    const canRestart = selectedApps.some((a) => availableActions(a.status).includes('restart'));
    return [
      ...(canStart   ? ['start']   : []),
      ...(canStop    ? ['stop']    : []),
      ...(canRestart ? ['restart'] : [])
    ];
  }, [selectedApps]);

  /* ── Select options ────────────────────────────────── */
  // Apply BG filter to the visible list
  const visibleGroups = applyBgFilter(allBusinessGroups);
  const filterActive = visibleGroups.length < allBusinessGroups.length;

  const bgOptions = [
    { value: '__all__', label: 'All Organizations', tag: `${visibleGroups.length}`, tagColor: 'bg-gray-700 text-gray-300' },
    ...visibleGroups.map((g) => ({
      value: g.id, label: g.name, indent: !!g.parentId,
      tag: !g.parentId ? 'Root' : undefined, tagColor: 'bg-blue-500/20 text-blue-400'
    })),
  ];

  const envOptions = [
    { value: '', label: 'All Environments' },
    ...environments.map((e) => ({
      value: e.id, label: e.name, badge: true,
      badgeColor: ENV_BADGE[e.type] || 'bg-gray-400',
      tag: e.type, tagColor: ENV_TAG_COLOR[e.type] || 'bg-gray-700 text-gray-400'
    }))
  ];

  const statusOptions = [
    { value: '', label: 'All Statuses' },
    { value: 'RUNNING',   label: 'Running',   badge: true, badgeColor: 'bg-green-400' },
    { value: 'APPLIED',   label: 'Applied',   badge: true, badgeColor: 'bg-cyan-400' },
    { value: 'FAILED',    label: 'Failed',    badge: true, badgeColor: 'bg-red-400' },
    { value: 'STOPPED',   label: 'Stopped',   badge: true, badgeColor: 'bg-gray-400' },
    { value: 'DEPLOYING', label: 'Deploying', badge: true, badgeColor: 'bg-blue-400' },
    { value: 'UPDATING',  label: 'Updating',  badge: true, badgeColor: 'bg-purple-400' },
    { value: 'STARTING',  label: 'Starting',  badge: true, badgeColor: 'bg-blue-300' },
    { value: 'STOPPING',  label: 'Stopping',  badge: true, badgeColor: 'bg-orange-400' },
    { value: 'PARTIALLY_STARTED', label: 'Partial', badge: true, badgeColor: 'bg-yellow-400' }
  ];

  const typeOptions = [
    { value: '', label: 'All Deployment Types' },
    { value: 'CloudHub 2.0', label: 'CloudHub 2.0', tag: 'CH2', tagColor: 'bg-blue-500/20 text-blue-400' },
    { value: 'CloudHub 1.0', label: 'CloudHub 1.0', tag: 'CH1', tagColor: 'bg-purple-500/20 text-purple-400' }
  ];

  const selectedBgName = selectedBg === '__all__'
    ? 'All Organizations'
    : visibleGroups.find((g) => g.id === selectedBg)?.name || 'Organization';

  return (
    <div className="space-y-5">
      {/* Modals */}
      {/* BG Filter Modal */}
      {showBgFilter && (
        <BgFilterModal
          businessGroups={allBusinessGroups}
          onClose={() => setShowBgFilter(false)}
          onSaved={() => {
            const visible = applyBgFilter(allBusinessGroups);
            if (!visible.find((g) => g.id === selectedBg)) {
              const root = visible.find((g) => !g.parentId) || visible[0];
              if (root) setSelectedBg(root.id);
            }
          }}
        />
      )}

      <ConfirmModal
        state={confirmState}
        onConfirm={executeAction}
        onCancel={() => setConfirmState(null)}
        loading={!!actionLoading[confirmState?.app?.id]}
      />
      <BulkConfirmModal
        state={bulkConfirm}
        onConfirm={executeBulkAction}
        onCancel={() => { setBulkConfirm(null); setBulkResults(null); }}
        loading={bulkLoading}
        results={bulkResults}
      />

      {/* Bulk Ping Modal */}
      {showBulkPing && (
        <BulkPingModal
          apps={selectedApps.length > 0 ? selectedApps : filtered}
          onClose={() => setShowBulkPing(false)}
        />
      )}

      {/* CPS Export Modal */}
      {showExport && (
        <CpsExportModal
          apps={filtered}
          bgOrgId={selectedBg}
          bgName={selectedBgName}
          selectedEnvId={filterEnv || ''}
          envName={filterEnv ? (environments.find(e=>e.id===filterEnv)?.name || '') : (filtered[0]?.environment?.name || '')}
          filterSummary={[
            filterEnv ? `Env: ${environments.find(e=>e.id===filterEnv)?.name || filterEnv}` : null,
            filterStatus ? `Status: ${filterStatus}` : null,
            filterType ? `Type: ${filterType}` : null,
            search ? `Search: "${search}"` : null
          ].filter(Boolean).join(' · ')}
          onClose={() => setShowExport(false)}
        />
      )}

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-white">Applications</h1>
          <p className="text-gray-400 text-sm mt-1">
            {loading ? 'Loading...' : `${apps.length} integrations in ${selectedBgName}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <CredentialImportButton />
          <button onClick={() => setShowBulkPing(true)} disabled={loading || filtered.length === 0}
            title={selectedApps.length > 0 ? `Ping ${selectedApps.length} selected apps` : 'Ping all visible apps'}
            className="flex items-center gap-2 text-sm text-cyan-400 hover:text-cyan-300 bg-cyan-950/40 hover:bg-cyan-950/60 border border-cyan-800/50 px-3 py-2 rounded-lg disabled:opacity-40 transition-colors">
            <Activity size={14} />
            {selectedApps.length > 0 ? `Ping (${selectedApps.length})` : 'Ping Test'}
          </button>
          <button onClick={() => setShowExport(true)} disabled={loading || apps.length === 0}
            title="Export CPS Properties to Excel"
            className="flex items-center gap-2 text-sm text-emerald-400 hover:text-emerald-300 bg-emerald-950/40 hover:bg-emerald-950/60 border border-emerald-800/50 px-3 py-2 rounded-lg disabled:opacity-40 transition-colors">
            <FileSpreadsheet size={14} /> Export CPS
          </button>
          <button onClick={() => loadApps(selectedBg, true)} disabled={loading || bgLoading}
            className="flex items-center gap-2 text-sm text-gray-400 hover:text-white bg-gray-800 px-3 py-2 rounded-lg disabled:opacity-50">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>
      </div>

      {/* Single-app toast */}
      {actionResult && (
        <div className={`flex items-center justify-between px-4 py-3 rounded-xl border text-sm ${
          actionResult.success ? 'bg-emerald-950/40 border-emerald-800/50 text-emerald-300' : 'bg-red-950/40 border-red-800/50 text-red-300'
        }`}>
          <span>{actionResult.message}</span>
          <button onClick={() => setActionResult(null)} className="ml-4 opacity-60 hover:opacity-100"><X size={14} /></button>
        </div>
      )}

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 text-red-400 text-sm">{error}</div>
      )}

      {/* Business Group selector */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl px-5 py-4">
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs text-gray-500 uppercase tracking-wider font-medium">Business Group</p>
          <button
            onClick={() => setShowBgFilter(true)}
            title="Configure visible business groups"
            className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded-lg border transition-all ${
              filterActive
                ? 'bg-blue-600/20 border-blue-600/50 text-blue-400 hover:bg-blue-600/30'
                : 'bg-gray-800 border-gray-700 text-gray-500 hover:text-gray-300 hover:border-gray-600'
            }`}
          >
            <SlidersHorizontal size={11} />
            {filterActive ? `${visibleGroups.length}/${allBusinessGroups.length} shown` : 'Filter BGs'}
          </button>
        </div>
        <Select
          value={selectedBg}
          onChange={(v) => { setSelectedBg(v); setSearch(''); setFilterStatus(''); setFilterType(''); }}
          options={bgOptions}
          placeholder="Select business group..."
          searchable={visibleGroups.length > 5}
          disabled={bgLoading}
        />
      </div>

      {/* Filters */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="relative sm:col-span-2 lg:col-span-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
          <input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search applications..."
            className="w-full bg-gray-900 border border-gray-700 rounded-lg pl-9 pr-4 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500" />
        </div>
        <div><Select value={filterEnv} onChange={setFilterEnv} options={envOptions} placeholder="Environment" searchable /></div>
        <div><Select value={filterStatus} onChange={setFilterStatus} options={statusOptions} placeholder="Status" /></div>
        <div><Select value={filterType} onChange={setFilterType} options={typeOptions} placeholder="Type" /></div>
      </div>

      {/* Bulk action toolbar — appears when rows are selected */}
      {selectedApps.length > 0 && (
        <div className="flex items-center justify-between flex-wrap gap-3 px-4 py-3 bg-blue-950/40 border border-blue-800/50 rounded-xl">
          <div className="flex items-center gap-3">
            <span className="text-blue-300 text-sm font-medium">
              {selectedApps.length} application{selectedApps.length !== 1 ? 's' : ''} selected
            </span>
            <button
              onClick={() => setSelectedIds(new Set())}
              className="text-blue-500 hover:text-blue-300 text-xs underline underline-offset-2">
              Clear
            </button>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-blue-500 text-xs hidden sm:inline">Bulk action:</span>
            {bulkActions.map((action) => {
              const { Icon, label, bulkCls } = ACTION_CONFIG[action];
              return (
                <button key={action} onClick={() => requestBulkAction(action)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${bulkCls}`}>
                  <Icon size={12} /> {label} All
                </button>
              );
            })}
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center h-48">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
        </div>
      ) : (
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-800/50 text-gray-400 text-xs uppercase tracking-wider">
                {/* Select-all checkbox */}
                <th className="px-4 py-3 w-10" onClick={toggleAll}>
                  <div className={`w-4 h-4 rounded border flex items-center justify-center cursor-pointer transition-colors ${
                    allSelected ? 'bg-blue-600 border-blue-500' : someSelected ? 'bg-blue-900/60 border-blue-600' : 'border-gray-600 hover:border-blue-500'
                  }`}>
                    {allSelected && <span className="text-white text-[10px] font-bold leading-none">✓</span>}
                    {someSelected && <span className="text-blue-400 text-[10px] font-bold leading-none">–</span>}
                  </div>
                </th>
                <th className="text-left px-4 py-3 font-medium">Application</th>
                <th className="text-left px-4 py-3 font-medium">Status</th>
                <th className="text-left px-4 py-3 font-medium">Environment</th>
                <th className="text-left px-4 py-3 font-medium">Type</th>
                <th className="text-left px-4 py-3 font-medium">Mule Version</th>
                <th className="text-left px-4 py-3 font-medium">Last Modified</th>
                <th className="px-4 py-3 font-medium text-center">Actions</th>
              </tr>
            </thead>
            <tbody>
              {displayFiltered.map((app, idx) => {
                const actions = availableActions(app.status);
                const isActing = !!actionLoading[app.id];
                const isChecked = selectedIds.has(app.id);

                return (
                  <tr key={`${app.id}-${idx}`}
                    className={`border-t border-gray-800 hover:bg-gray-800/30 cursor-pointer transition-colors ${isChecked ? 'bg-blue-950/20' : ''}`}
                    onClick={() => navigate(`/applications/${app._bgId || (selectedBg !== '__all__' ? selectedBg : orgId)}/${app.environment?.id}/${app.id}`)}>
                    {/* Checkbox */}
                    <td className="px-4 py-3" onClick={(e) => toggleRow(e, app.id)}>
                      <div className={`w-4 h-4 rounded border flex items-center justify-center cursor-pointer transition-colors ${
                        isChecked ? 'bg-blue-600 border-blue-500' : 'border-gray-600 hover:border-blue-500'
                      }`}>
                        {isChecked && <span className="text-white text-[10px] font-bold leading-none">✓</span>}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-white font-medium">{app.name}</td>
                    <td className="px-4 py-3"><StatusBadge status={app.status} /></td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${ENV_BADGE[app.environment?.type] || 'bg-gray-400'}`} />
                        <span className="text-gray-300">{app.environment?.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded font-medium ${
                        app.deploymentType === 'CloudHub 2.0' ? 'bg-blue-500/20 text-blue-400' : 'bg-purple-500/20 text-purple-400'
                      }`}>{app.deploymentType}</span>
                    </td>
                    <td className="px-4 py-3 text-gray-400 font-mono text-xs">{app.muleVersion || '—'}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs">
                      {app.lastModifiedDate ? new Date(app.lastModifiedDate).toLocaleDateString() : '—'}
                    </td>
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-center gap-1">
                        {isActing ? (
                          <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-400" />
                        ) : actions.length > 0 ? (
                          actions.map((action) => {
                            const { Icon, label, btnCls } = ACTION_CONFIG[action];
                            return (
                              <button key={action} title={label}
                                onClick={(e) => requestAction(e, app, action)}
                                className={`p-1.5 rounded-lg border transition-all ${btnCls}`}>
                                <Icon size={13} />
                              </button>
                            );
                          })
                        ) : (
                          <ChevronRight size={14} className="text-gray-600" />
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {displayFiltered.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-5 py-12 text-center text-gray-500">
                    {apps.length === 0
                      ? `No applications found in ${selectedBgName}.`
                      : 'No applications match your filters.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {filtered.length > 0 && (
        <p className="text-xs text-gray-600 text-right">
          {selectedApps.length > 0 && <span className="text-blue-500 mr-2">{selectedApps.length} selected ·</span>}
          Showing {filtered.length} of {apps.length}
        </p>
      )}
    </div>
  );
}
