import React, { useEffect, useState, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Activity, ChevronDown, ChevronRight, CheckCircle2, XCircle,
  AlertCircle, Globe, ShieldCheck, ArrowLeft,
} from 'lucide-react';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const ENV_BADGE = { production: 'bg-green-400', sandbox: 'bg-yellow-400', design: 'bg-blue-400' };

const STATUS_CONFIG = {
  SUCCESS: { label: 'Healthy',     cls: 'text-emerald-400 bg-emerald-500/10 border-emerald-700/40', dot: 'bg-emerald-400', ping: true },
  PARTIAL: { label: 'Partial',     cls: 'text-yellow-400 bg-yellow-500/10 border-yellow-700/40',   dot: 'bg-yellow-400', ping: false },
  FAILED:  { label: 'Unreachable', cls: 'text-red-400 bg-red-500/10 border-red-700/40',             dot: 'bg-red-500',    ping: false },
};

function latencyColor(ms) {
  if (!ms) return 'text-gray-400';
  if (ms < 300) return 'text-emerald-400';
  if (ms < 1000) return 'text-yellow-400';
  return 'text-red-400';
}

// ─── Result Row ───────────────────────────────────────────────────────────────

function ResultRow({ app, result, autoResolved, expandedId, setExpandedId }) {
  const rowKey = `${app.id}|${app.environment?.id}`;
  const isExpanded = expandedId === rowKey;
  const isCH1 = app.deploymentType !== 'CloudHub 2.0';
  const cfg = result ? STATUS_CONFIG[result.status] || STATUS_CONFIG.FAILED : null;

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
                  <span
                    title={`Auto-resolved: ${autoResolved.apiInstanceName} → ${autoResolved.contractApp}`}
                    className="flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 bg-emerald-500/10 border border-emerald-700/40 text-emerald-400 rounded font-medium"
                  >
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
          {cfg ? (
            <span className={`inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full border font-semibold ${cfg.cls}`}>
              <span className="relative flex h-1.5 w-1.5 flex-shrink-0">
                {cfg.ping && <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-60 ${cfg.dot}`} />}
                <span className={`relative inline-flex rounded-full h-1.5 w-1.5 ${cfg.dot}`} />
              </span>
              {cfg.label}
            </span>
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

        {/* Expand */}
        <td className="px-3 py-3 text-center">
          {result && (
            <button onClick={() => setExpandedId(isExpanded ? null : rowKey)} className="text-gray-500 hover:text-gray-300 transition-colors">
              {isExpanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
            </button>
          )}
        </td>
      </tr>

      {/* Expanded detail */}
      {isExpanded && result && (
        <tr className="border-t border-gray-800/40 bg-gray-900/40">
          <td colSpan={7} className="px-6 py-4">
            <div className="space-y-3 text-sm">

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

              {result.payload && (
                <div>
                  <span className="text-gray-400 text-xs font-medium uppercase tracking-wider block mb-1.5">Response Payload</span>
                  <pre className="bg-[#0B0F17] rounded-lg px-4 py-3 text-xs text-emerald-400/90 overflow-auto max-h-32 font-mono border border-gray-800/60 leading-relaxed">
                    {typeof result.payload === 'string' ? result.payload : JSON.stringify(result.payload, null, 2)}
                  </pre>
                </div>
              )}

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

  const [results, setResults] = useState({});
  const [apps, setApps] = useState([]);
  const [autoResolvedMap, setAutoResolvedMap] = useState({});
  const [expandedId, setExpandedId] = useState(null);
  const [showAll, setShowAll] = useState(false);

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

  const displayApps = showAll ? apps : testedApps;
  const done = testedApps.length;
  const successCount = testedApps.filter(a => results[a.id]?.status === 'SUCCESS').length;
  const partialCount = testedApps.filter(a => results[a.id]?.status === 'PARTIAL').length;
  const failedCount  = testedApps.filter(a => results[a.id]?.status === 'FAILED').length;
  const autoResolvedCount = Object.keys(autoResolvedMap).length;
  const hasResults = done > 0;

  // ─── Empty state (no preloaded results) ──────────────────────────────────────

  if (!hasResults && apps.length === 0) {
    return (
      <div className="space-y-5">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <Activity size={20} className="text-cyan-400" /> Ping Test Results
          </h1>
        </div>
        <div className="flex flex-col items-center justify-center py-24 gap-5 bg-gray-900 border border-gray-800 rounded-xl">
          <Activity size={48} className="text-gray-700" />
          <div className="text-center space-y-2">
            <p className="text-white font-medium">No ping results yet</p>
            <p className="text-gray-400 text-sm">
              Run a bulk ping test from the <strong>Applications</strong> page to see results here.
            </p>
          </div>
          <button
            onClick={() => navigate('/applications')}
            className="flex items-center gap-2 px-4 py-2 bg-cyan-700 hover:bg-cyan-600 text-white text-sm font-medium rounded-lg transition-colors"
          >
            <ArrowLeft size={14} /> Go to Applications
          </button>
        </div>
      </div>
    );
  }

  // ─── Results view ─────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <Activity size={20} className="text-cyan-400" /> Ping Test Results
          </h1>
          <p className="text-gray-400 text-sm mt-1">
            {done} apps tested
            {done > 0 && (
              <span className="ml-2">
                · <span className="text-emerald-400">{successCount} ✓</span>
                {partialCount > 0 && <span className="text-yellow-400 ml-1">{partialCount} ~</span>}
                {failedCount  > 0 && <span className="text-red-400 ml-1">{failedCount} ✗</span>}
              </span>
            )}
            {autoResolvedCount > 0 && (
              <span className="ml-2 text-emerald-400/70 text-xs">· 🔑 {autoResolvedCount} auto-creds</span>
            )}
          </p>
        </div>
        <button
          onClick={() => navigate('/applications')}
          className="flex items-center gap-2 px-3 py-2 text-sm text-gray-400 hover:text-white bg-gray-800 rounded-lg transition-colors"
        >
          <ArrowLeft size={13} /> Back to Applications
        </button>
      </div>

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
                <ShieldCheck size={11} /> {autoResolvedCount} auto-creds used
              </span>
            )}
          </div>
          <button
            onClick={() => setShowAll(v => !v)}
            className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border font-medium transition-all ${
              showAll
                ? 'bg-gray-800 border-gray-700 text-gray-400 hover:text-white'
                : 'bg-cyan-600/20 border-cyan-600/60 text-cyan-300'
            }`}
          >
            {showAll ? 'Show tested only' : `✓ Showing tested (${done})`}
          </button>
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
                <th className="px-3 py-3 w-10"></th>
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
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
