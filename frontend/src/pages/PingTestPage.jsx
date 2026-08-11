import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Activity, ChevronDown, ChevronRight, CheckCircle2, XCircle,
  AlertCircle, Globe, ShieldCheck, ArrowLeft, Download, RefreshCw,
  UploadCloud, X, Lock,
} from 'lucide-react';
import api from '../services/api';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const ENV_BADGE = { production: 'bg-green-400', sandbox: 'bg-yellow-400', design: 'bg-blue-400' };

const STATUS_CONFIG = {
  SUCCESS:                   { label: 'Healthy',            cls: 'text-emerald-400 bg-emerald-500/10 border-emerald-700/40', dot: 'bg-emerald-400', ping: true },
  PARTIAL:                   { label: 'Partial',            cls: 'text-yellow-400 bg-yellow-500/10 border-yellow-700/40',   dot: 'bg-yellow-400', ping: false },
  FAILED:                    { label: 'Unreachable',        cls: 'text-red-400 bg-red-500/10 border-red-700/40',             dot: 'bg-red-500',    ping: false },
  SKIPPED_CONTRACT_PENDING:  { label: 'Contract Pending',  cls: 'text-orange-400 bg-orange-500/10 border-orange-700/40',   dot: 'bg-orange-400', ping: false },
};

function latencyColor(ms) {
  if (!ms) return 'text-gray-400';
  if (ms < 300) return 'text-emerald-400';
  if (ms < 1000) return 'text-yellow-400';
  return 'text-red-400';
}

// ─── Result Row (Feature 1: retry button) ────────────────────────────────────

function ResultRow({ app, result, autoResolved, expandedId, setExpandedId, onRetry, onCheckContract, checkingContract, retrying }) {
  const rowKey = `${app.id}|${app.environment?.id}`;
  const isExpanded = expandedId === rowKey;
  const isCH1 = app.deploymentType !== 'CloudHub 2.0';
  const cfg = result ? STATUS_CONFIG[result.status] || STATUS_CONFIG.FAILED : null;
  const isPendingContract = result?.status === 'SKIPPED_CONTRACT_PENDING';
  // Normal retry: FAILED or PARTIAL (not pending contract)
  const canRetry = result && (result.status === 'FAILED' || result.status === 'PARTIAL');
  // Contract approved and creds resolved → can ping
  const contractApproved = isPendingContract && autoResolved?.source === 'contract';

  return (
    <>
      <tr className="border-t border-gray-800 hover:bg-gray-800/20 transition-colors">
        {/* App name */}
        <td className="px-4 py-3">
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${ENV_BADGE[app.environment?.type] || 'bg-gray-400'}`} />
            <div>
              <div className="flex items-center gap-1.5">
                <p className="text-white text-sm font-medium">{app.name}</p>
                {autoResolved && (
                  <span title={`Auto-resolved: ${autoResolved.apiInstanceName} → ${autoResolved.contractApp}`}
                    className="flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 bg-emerald-500/10 border border-emerald-700/40 text-emerald-400 rounded font-medium">
                    🔑 auto
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

        {/* Ping status */}
        <td className="px-3 py-3">
          {retrying ? (
            <span className="inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full border font-semibold text-cyan-400 bg-cyan-500/10 border-cyan-700/40">
              <RefreshCw size={10} className="animate-spin" /> Retrying…
            </span>
          ) : cfg ? (
            <div className="space-y-0.5">
              <span className={`inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full border font-semibold ${cfg.cls}`}>
                <span className="relative flex h-1.5 w-1.5 flex-shrink-0">
                  {cfg.ping && <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-60 ${cfg.dot}`} />}
                  <span className={`relative inline-flex rounded-full h-1.5 w-1.5 ${cfg.dot}`} />
                </span>
                {cfg.label}
              </span>
              {/* Show short reason inline for FAILED / SKIPPED rows */}
              {result.error && (result.status === 'FAILED' || result.status === 'SKIPPED_CONTRACT_PENDING') && (
                <p className="text-[10px] text-gray-500 max-w-[200px] leading-tight">
                  {result.error.length > 80 ? result.error.slice(0, 77) + '…' : result.error}
                </p>
              )}
              {/* JWT auto-used badge */}
              {result._jwtUsed && (
                <span className="inline-flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 bg-indigo-500/10 border border-indigo-700/40 text-indigo-400 rounded font-medium">
                  <Lock size={8} /> JWT auto
                </span>
              )}
              {/* JWT may be needed hint */}
              {result.status === 'PARTIAL' && !result._jwtUsed && (result.httpStatus === 401 || result.httpStatus === 400) && (
                <span className="inline-flex items-center gap-0.5 text-[9px] text-indigo-400/60">
                  <Lock size={8} /> may need JWT
                </span>
              )}
            </div>
          ) : <span className="text-gray-600 text-xs">—</span>}
        </td>

        {/* Active Endpoint */}
        <td className="px-3 py-3 max-w-xs">
          {result?.activeEndpoint ? (
            <span className="font-mono text-xs text-cyan-300/90 truncate block" title={result.activeEndpoint}>
              {result.activeEndpoint}
            </span>
          ) : <span className="text-gray-600 text-xs">—</span>}
        </td>

        {/* HTTP */}
        <td className="px-3 py-3 text-center">
          {result?.httpStatus != null ? (
            <span className={`font-mono font-bold text-sm ${result.httpStatus < 300 ? 'text-emerald-400' : result.httpStatus < 500 ? 'text-yellow-400' : 'text-red-400'}`}>
              {result.httpStatus}
            </span>
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

        {/* Actions: retry + expand */}
        <td className="px-3 py-3">
          <div className="flex items-center justify-center gap-1.5">
            {/* Feature 1: Retry button for FAILED / PARTIAL rows */}
            {/* Pending contract: two separate buttons */}
            {isPendingContract && !retrying && !checkingContract && (
              <>
                <button
                  onClick={() => onCheckContract(app)}
                  title="Check if the contract has been approved in API Manager"
                  className="flex items-center gap-1 text-[10px] px-1.5 py-1 rounded text-orange-400 hover:text-orange-300 hover:bg-orange-950/40 border border-orange-800/40 transition-colors font-medium whitespace-nowrap">
                  🔑 Check
                </button>
                {contractApproved && (
                  <button
                    onClick={() => onRetry(app)}
                    title="Run ping test with resolved credentials"
                    className="flex items-center gap-1 text-[10px] px-1.5 py-1 rounded text-emerald-400 hover:text-emerald-300 hover:bg-emerald-950/40 border border-emerald-800/40 transition-colors font-medium whitespace-nowrap">
                    <RefreshCw size={10} /> Ping
                  </button>
                )}
              </>
            )}
            {isPendingContract && checkingContract && (
              <span className="text-[10px] text-orange-400/70 flex items-center gap-1">
                <RefreshCw size={9} className="animate-spin" /> Checking…
              </span>
            )}
            {/* Normal retry for FAILED / PARTIAL */}
            {canRetry && !retrying && (
              <button
                onClick={() => onRetry(app)}
                title="Retry ping for this app"
                className="p-1 rounded text-red-400 hover:text-red-300 hover:bg-red-950/40 transition-colors">
                <RefreshCw size={13} />
              </button>
            )}
            {result && (
              <button onClick={() => setExpandedId(isExpanded ? null : rowKey)}
                className="text-gray-500 hover:text-gray-300 transition-colors p-1">
                {isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              </button>
            )}
          </div>
        </td>
      </tr>

      {/* Expanded detail */}
      {isExpanded && result && (
        <tr className="border-t border-gray-800/40 bg-gray-900/40">
          <td colSpan={7} className="px-6 py-4">
            <div className="space-y-3 text-sm">
              {result._jwtUsed && (
                <div className="flex items-center gap-2 bg-indigo-950/30 border border-indigo-800/40 rounded-lg px-3 py-2 text-indigo-400 text-xs">
                  <Lock size={12} className="flex-shrink-0" />
                  JWT Bearer token was auto-fetched from CPS and used for this ping
                </div>
              )}
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
              <div className="flex items-start gap-3">
                <Globe size={13} className="text-gray-500 flex-shrink-0 mt-0.5" />
                <div>
                  <span className="text-gray-400 text-xs font-medium uppercase tracking-wider">Full Endpoint</span>
                  <p className="font-mono text-xs text-cyan-300 break-all mt-0.5">{result.activeEndpoint || '—'}</p>
                </div>
              </div>
              {result.error && (
                <div className="flex items-start gap-3">
                  <XCircle size={13} className="text-red-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <span className="text-gray-400 text-xs font-medium uppercase tracking-wider">Error</span>
                    <p className="text-red-400 text-xs mt-0.5 break-all">{result.error}</p>
                  </div>
                </div>
              )}
              {result.payload && (() => {
                const endpoints = result.payload?.pingResponse?.endpoints;
                const summary = result.payload?.pingResponse?.summary;
                const payloadStr = typeof result.payload === 'string' ? result.payload : JSON.stringify(result.payload, null, 2);
                return (
                  <div className="space-y-3">
                    {/* Structured endpoint health table when pingResponse.endpoints exists */}
                    {endpoints?.length > 0 && (() => {
                      const ok = endpoints.filter(e => (e.status || '').toLowerCase() === 'success').length;
                      return (
                        <div>
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-gray-400 text-xs font-medium uppercase tracking-wider">Endpoint Health</span>
                            <div className="flex items-center gap-2 text-[10px]">
                              <span className="text-emerald-400 font-semibold">✓ {ok}</span>
                              {endpoints.length - ok > 0 && <span className="text-red-400 font-semibold">✗ {endpoints.length - ok}</span>}
                              {summary?.serviceName && <span className="text-gray-600 font-mono">{summary.serviceName}</span>}
                            </div>
                          </div>
                          <div className="space-y-1">
                            {endpoints.map((ep, i) => {
                              const isOk = (ep.status || '').toLowerCase() === 'success';
                              return (
                                <div key={i} className={`flex items-start gap-2 rounded-lg px-3 py-2 text-xs border ${isOk ? 'bg-emerald-950/20 border-emerald-800/30' : 'bg-red-950/20 border-red-800/30'}`}>
                                  <span className="text-[11px] flex-shrink-0 mt-0.5">{isOk ? '✅' : '❌'}</span>
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-1.5 flex-wrap">
                                      <span className="font-medium text-gray-200">{ep.serviceName}</span>
                                      {ep.endpointName && <span className="text-[10px] text-gray-500">· {ep.endpointName}</span>}
                                    </div>
                                    {ep.apiUser && <p className="text-[10px] text-gray-600 font-mono mt-0.5">{ep.apiUser}</p>}
                                    <p className={`text-[10px] mt-0.5 ${isOk ? 'text-emerald-400/70' : 'text-red-400/70'}`}>
                                      {ep.message}{ep.domain ? ` · ${ep.domain}` : ''}
                                    </p>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })()}
                    {/* Full raw JSON — always visible */}
                    <div>
                      <span className="text-gray-400 text-xs font-medium uppercase tracking-wider block mb-1.5">Response Body</span>
                      <pre className="bg-[#0B0F17] rounded-lg px-4 py-3 text-xs text-emerald-400/90 overflow-auto font-mono border border-gray-800/60 leading-relaxed whitespace-pre-wrap break-all">
                        {payloadStr}
                      </pre>
                    </div>
                  </div>
                );
              })()}
              {result.attempts?.length > 0 && (
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
                            {a.error
                              ? <span className="text-red-400 text-[11px]">{a.error}</span>
                              : <span className={`font-bold ${a.httpStatus < 300 ? 'text-emerald-400' : a.httpStatus < 500 ? 'text-yellow-400' : 'text-red-400'}`}>HTTP {a.httpStatus}</span>}
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
  const location = useLocation();
  const navigate = useNavigate();
  const csvInputRef = useRef(null);

  const [results, setResults] = useState({});
  const [apps, setApps] = useState([]);
  const [autoResolvedMap, setAutoResolvedMap] = useState({});
  const [expandedId, setExpandedId] = useState(null);
  const [showAll, setShowAll] = useState(false);

  // Feature 1: per-app retry state
  const [retryingIds, setRetryingIds] = useState(new Set());
  const [checkingContractIds, setCheckingContractIds] = useState(new Set());

  // Feature 2: CSV upload state
  const [csvMatchedNames, setCsvMatchedNames] = useState(null); // null = not uploaded yet
  const [csvFileName, setCsvFileName] = useState('');

  // Load preloaded results from bulk ping modal (passed via location.state)
  useEffect(() => {
    const state = location.state;
    if (state?.preloadedResults && state?.preloadedApps) {
      setResults(state.preloadedResults);
      setApps(state.preloadedApps);
      setAutoResolvedMap(state.autoResolvedMap || {});
      window.history.replaceState({}, '');
    }
  }, []);

  const testedApps = useMemo(() => {
    const ord = { SUCCESS: 0, PARTIAL: 1, FAILED: 2 };
    return [...apps.filter(a => results[a.id])].sort(
      (a, b) => (ord[results[a.id]?.status] ?? 3) - (ord[results[b.id]?.status] ?? 3)
    );
  }, [apps, results]);

  // ─── Check contract approval (no ping — just updates creds + status) ──────

  const checkContractApproval = useCallback(async (app) => {
    const appId = app.id;
    const prevResult = results[appId];
    if (!prevResult?.apiInstanceId) return;
    const bgId = app._bgId;
    const envId = app.environment?.id;
    if (!bgId || !envId) return;

    setCheckingContractIds(prev => new Set([...prev, appId]));
    try {
      const contractRes = await api.post('/health/auto-contract-creds', {
        orgId: bgId, envId, apiId: prevResult.apiInstanceId,
        envType: app.environment?.type || '',
      });
      const cd = contractRes.data;
      if (cd.contractStatus === 'approved' && cd.clientId && cd.clientSecret) {
        // Store credentials — user can now click "Retry Ping"
        setAutoResolvedMap(prev => ({ ...prev, [appId]: {
          clientId: cd.clientId,
          clientSecret: cd.clientSecret,
          apiInstanceName: String(prevResult.apiInstanceId),
          contractApp: cd.appName || prevResult.contractApp,
          source: 'contract',
        }}));
        // Update error message to show approval
        setResults(prev => ({ ...prev, [appId]: {
          ...prevResult,
          error: `✅ Contract approved for "${cd.appName}". Click Retry Ping to run the test.`,
        }}));
      } else {
        // Still pending — update error message
        setResults(prev => ({ ...prev, [appId]: {
          ...prevResult,
          error: `⏳ Contract still pending approval for "${cd.appName || prevResult.contractApp}". Approve in API Manager and check again.`,
        }}));
      }
    } catch (err) {
      setResults(prev => ({ ...prev, [appId]: {
        ...prevResult,
        error: `Contract check failed: ${err.message}`,
      }}));
    } finally {
      setCheckingContractIds(prev => { const n = new Set(prev); n.delete(appId); return n; });
    }
  }, [results]);

  // ─── Retry ping (uses already-resolved credentials from autoResolvedMap) ──

  const retryApp = useCallback(async (app) => {
    const appId = app.id;
    const auto = autoResolvedMap[appId];
    setRetryingIds(prev => new Set([...prev, appId]));
    try {
      const isCH1 = app.deploymentType !== 'CloudHub 2.0';
      let ch2IngressUrl;
      if (!isCH1 && app._bgId && app.environment?.id) {
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
      const { data } = await api.post('/health/ping', {
        targetType: isCH1 ? 'CH1' : 'CH2',
        appName: app.name,
        ch2IngressUrl,
        clientId: auto?.clientId || undefined,
        clientSecret: auto?.clientSecret || undefined,
        transactionId: 'smokeTest',
      });
      setResults(prev => ({ ...prev, [appId]: data }));
    } catch (err) {
      setResults(prev => ({ ...prev, [appId]: { status: 'FAILED', error: err.message } }));
    } finally {
      setRetryingIds(prev => { const n = new Set(prev); n.delete(appId); return n; });
    }
  }, [autoResolvedMap]);

  // ─── Feature 2: CSV Upload & Batch Ping ───────────────────────────────────

  const handleCsvUpload = useCallback((e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCsvFileName(file.name);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target.result || '';
      const lines = text.split(/\r?\n/).filter(Boolean);
      if (lines.length === 0) { setCsvMatchedNames([]); return; }

      // Detect header row and find the app name column
      const header = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, '').toLowerCase());
      const nameColIdx = header.findIndex(h => ['appname', 'name', 'domain', 'application'].includes(h));

      let rawNames;
      if (nameColIdx >= 0) {
        // Has recognised header — skip header row and read that column
        rawNames = lines.slice(1).map(l => l.split(',')[nameColIdx]?.trim().replace(/^"|"$/g, '')).filter(Boolean);
      } else {
        // No header match — treat every non-empty line as a name (single-column CSV)
        rawNames = lines.map(l => l.split(',')[0]?.trim().replace(/^"|"$/g, '')).filter(Boolean);
      }
      setCsvMatchedNames(rawNames.map(n => n.toLowerCase()));
    };
    reader.readAsText(file);
    // Reset so same file can be re-uploaded
    e.target.value = '';
  }, []);

  // Apps matched by CSV: cross-reference parsed names against current app list
  const csvMatchedApps = useMemo(() => {
    if (!csvMatchedNames) return [];
    return apps.filter(a => csvMatchedNames.some(n => a.name.toLowerCase().includes(n) || n.includes(a.name.toLowerCase())));
  }, [apps, csvMatchedNames]);

  // Batch-ping all CSV-matched apps (Feature 2)
  const [batchRunning, setBatchRunning] = useState(false);
  const runBatchPing = useCallback(async () => {
    if (csvMatchedApps.length === 0) return;
    setBatchRunning(true);
    const BATCH = 5;
    for (let i = 0; i < csvMatchedApps.length; i += BATCH) {
      const batch = csvMatchedApps.slice(i, i + BATCH);
      await Promise.allSettled(batch.map(app => retryApp(app)));
    }
    setBatchRunning(false);
    setShowAll(true); // switch to "show all" so CSV results are visible
  }, [csvMatchedApps, retryApp]);

  // ─── Export CSV ─────────────────────────────────────────────────────────────

  const exportCsv = useCallback(() => {
    const rows = [
      ['Application', 'Environment', 'Type', 'Status', 'HTTP Code', 'Active Endpoint', 'Latency (ms)', 'Credentials', 'Error', 'Response Payload'],
    ];
    testedApps.forEach(app => {
      const result = results[app.id];
      const auto = autoResolvedMap[app.id];
      const isCH1 = app.deploymentType !== 'CloudHub 2.0';
      const statusLabel = result ? (STATUS_CONFIG[result.status]?.label || result.status) : '—';
      const creds = auto ? `Auto (${auto.contractApp})` : result ? 'Manual / None' : '—';
      let payloadStr = '—';
      if (result?.payload != null) {
        payloadStr = typeof result.payload === 'string' ? result.payload : JSON.stringify(result.payload);
        if (payloadStr.length > 1000) payloadStr = payloadStr.slice(0, 1000) + '…';
      }
      rows.push([app.name, app.environment?.name || '—', isCH1 ? 'CH1' : 'CH2', statusLabel,
        result?.httpStatus ?? '—', result?.activeEndpoint || '—', result?.responseTimeMs ?? '—',
        creds, result?.error || '—', payloadStr]);
    });
    const csv = rows.map(row => row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `ping-test-results-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [testedApps, results, autoResolvedMap]);

  // ─── Status filter ───────────────────────────────────────────────────────
  const [statusFilter, setStatusFilter] = useState('ALL');
  const filteredApps = useMemo(() => {
    const base = showAll ? apps : testedApps;
    if (statusFilter === 'ALL') return base;
    return base.filter(a => results[a.id]?.status === statusFilter);
  }, [showAll, apps, testedApps, results, statusFilter]);

  const displayApps = filteredApps;
  const done = testedApps.length;
  const successCount = testedApps.filter(a => results[a.id]?.status === 'SUCCESS').length;
  const partialCount = testedApps.filter(a => results[a.id]?.status === 'PARTIAL').length;
  const failedCount  = testedApps.filter(a => results[a.id]?.status === 'FAILED').length;
  const autoResolvedCount = Object.keys(autoResolvedMap).length;
  const hasResults = done > 0;

  // ─── Empty state ─────────────────────────────────────────────────────────────

  if (!hasResults && apps.length === 0) {
    return (
      <div className="space-y-5">
        <h1 className="text-xl font-bold text-white flex items-center gap-2">
          <Activity size={20} className="text-cyan-400" /> Ping Test Results
        </h1>
        <div className="flex flex-col items-center justify-center py-24 gap-5 bg-gray-900 border border-gray-800 rounded-xl">
          <Activity size={48} className="text-gray-700" />
          <div className="text-center space-y-2">
            <p className="text-white font-medium">No ping results yet</p>
            <p className="text-gray-400 text-sm">Run a bulk ping test from the <strong>Applications</strong> page.</p>
          </div>
          <button onClick={() => navigate('/applications')}
            className="flex items-center gap-2 px-4 py-2 bg-cyan-700 hover:bg-cyan-600 text-white text-sm font-medium rounded-lg transition-colors">
            <ArrowLeft size={14} /> Go to Applications
          </button>
        </div>
      </div>
    );
  }

  // ─── Results view ─────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5">
      {/* Hidden CSV file input */}
      <input ref={csvInputRef} type="file" accept=".csv,text/csv" onChange={handleCsvUpload} className="hidden" />

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <Activity size={20} className="text-cyan-400" /> Ping Test Results
          </h1>
          <p className="text-gray-400 text-sm mt-1">
            {done} apps tested
            {done > 0 && (<span className="ml-2">
              · <span className="text-emerald-400">{successCount} ✓</span>
              {partialCount > 0 && <span className="text-yellow-400 ml-1">{partialCount} ~</span>}
              {failedCount  > 0 && <span className="text-red-400 ml-1">{failedCount} ✗</span>}
            </span>)}
            {autoResolvedCount > 0 && <span className="ml-2 text-emerald-400/70 text-xs">· 🔑 {autoResolvedCount} auto-creds</span>}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Feature 2: CSV Upload button */}
          <button onClick={() => csvInputRef.current?.click()}
            title="Upload a CSV of app names to batch-ping"
            className="flex items-center gap-2 px-3 py-2 text-sm text-blue-400 hover:text-blue-300 bg-blue-950/40 hover:bg-blue-950/60 border border-blue-800/50 rounded-lg transition-colors">
            <UploadCloud size={13} /> Upload CSV
          </button>
          {hasResults && (
            <button onClick={exportCsv}
              className="flex items-center gap-2 px-3 py-2 text-sm text-emerald-400 hover:text-emerald-300 bg-emerald-950/40 border border-emerald-800/50 rounded-lg transition-colors">
              <Download size={13} /> Export CSV
            </button>
          )}
          <button onClick={() => navigate('/applications')}
            className="flex items-center gap-2 px-3 py-2 text-sm text-gray-400 hover:text-white bg-gray-800 rounded-lg transition-colors">
            <ArrowLeft size={13} /> Back to Applications
          </button>
        </div>
      </div>

      {/* Feature 2: CSV match banner */}
      {csvMatchedNames !== null && (
        <div className={`flex items-center justify-between flex-wrap gap-3 px-4 py-3 rounded-xl border text-sm ${
          csvMatchedApps.length > 0
            ? 'bg-blue-950/30 border-blue-800/50'
            : 'bg-gray-900 border-gray-800'
        }`}>
          <div className="flex items-center gap-3">
            <UploadCloud size={14} className="text-blue-400 flex-shrink-0" />
            <span className="text-gray-300 text-xs">
              <span className="font-mono text-gray-500">{csvFileName}</span>
              {' — '}
              {csvMatchedApps.length > 0
                ? <span className="text-blue-300 font-semibold">{csvMatchedApps.length} app{csvMatchedApps.length !== 1 ? 's' : ''} matched from CSV</span>
                : <span className="text-gray-500">No apps matched</span>}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {csvMatchedApps.length > 0 && (
              <button onClick={runBatchPing} disabled={batchRunning}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-blue-700 hover:bg-blue-600 disabled:opacity-50 text-white rounded-lg transition-colors font-medium">
                {batchRunning
                  ? <><RefreshCw size={10} className="animate-spin" /> Running…</>
                  : <><Activity size={10} /> Run Batch Ping ({csvMatchedApps.length})</>}
              </button>
            )}
            <button onClick={() => { setCsvMatchedNames(null); setCsvFileName(''); }}
              className="text-gray-600 hover:text-gray-300 transition-colors">
              <X size={14} />
            </button>
          </div>
        </div>
      )}

      {/* Summary + toggle */}
      {hasResults && (
        <div className="flex items-center justify-between flex-wrap gap-3 px-5 py-3 bg-gray-900 border border-gray-800 rounded-xl text-sm">
          <div className="flex items-center gap-4">
            <span className="text-gray-400 font-medium">{done} tested</span>
            <span className="text-emerald-400 font-semibold">✓ {successCount} healthy</span>
            {partialCount > 0 && <span className="text-yellow-400 font-semibold">~ {partialCount} partial</span>}
            {failedCount  > 0 && <span className="text-red-400 font-semibold">✗ {failedCount} failed</span>}
            {autoResolvedCount > 0 && (
              <span className="flex items-center gap-1 text-emerald-400/70 text-xs font-medium">
                <ShieldCheck size={11} /> {autoResolvedCount} auto-creds
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            {/* Status filter chips */}
            {[
              { key: 'ALL', label: 'All', cls: 'text-slate-400 border-slate-700 hover:border-slate-500' },
              { key: 'SUCCESS', label: '✓ Healthy', cls: 'text-emerald-400 border-emerald-800/50 hover:border-emerald-600' },
              { key: 'PARTIAL', label: '~ Partial', cls: 'text-yellow-400 border-yellow-800/50 hover:border-yellow-600' },
              { key: 'FAILED', label: '✗ Failed', cls: 'text-red-400 border-red-800/50 hover:border-red-600' },
            ].map(f => (
              <button key={f.key} onClick={() => setStatusFilter(f.key)}
                className={`text-xs px-2.5 py-1 rounded-lg border font-medium transition-all ${f.cls} ${statusFilter === f.key ? 'bg-gray-800/80 ring-1 ring-inset ring-current' : 'bg-transparent'}`}>
                {f.label}
              </button>
            ))}
            <button onClick={() => setShowAll(v => !v)}
              className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border font-medium transition-all ${
                showAll ? 'bg-gray-800 border-gray-700 text-gray-400 hover:text-white' : 'bg-cyan-600/20 border-cyan-600/60 text-cyan-300'
              }`}>
              {showAll ? 'Show tested only' : `✓ Showing tested (${done})`}
            </button>
          </div>
        </div>
      )}

      {/* Results table */}
      {displayApps.length > 0 && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-800/50 text-gray-400 text-xs uppercase tracking-wider">
                <th className="text-left px-4 py-3 font-medium">Application</th>
                <th className="text-left px-3 py-3 font-medium">Type</th>
                <th className="text-left px-3 py-3 font-medium">Status</th>
                <th className="text-left px-3 py-3 font-medium">Active Endpoint</th>
                <th className="text-center px-3 py-3 font-medium">HTTP</th>
                <th className="text-right px-3 py-3 font-medium">Latency</th>
                <th className="px-3 py-3 w-16 text-center font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {displayApps.map(app => (
                <ResultRow
                  key={`${app.id}|${app.environment?.id}`}
                  app={app}
                  result={results[app.id]}
                  autoResolved={autoResolvedMap[app.id]}
                  expandedId={expandedId}
                  setExpandedId={setExpandedId}
                  onRetry={retryApp}
                  onCheckContract={checkContractApproval}
                  checkingContract={checkingContractIds.has(app.id)}
                  retrying={retryingIds.has(app.id)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
