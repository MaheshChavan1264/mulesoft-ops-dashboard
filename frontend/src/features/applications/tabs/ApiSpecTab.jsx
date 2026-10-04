import React from 'react';
import { Globe, Activity, Package, RefreshCw, AlertTriangle } from 'lucide-react';
import TableHeader from '../../../components/ui/TableHeader';
import { GlassCard, StatTile } from '../shared';

/**
 * ApiSpecTab — ApplicationDetailPage's "API Spec" tab.
 *
 * Extracted from pages/ApplicationDetailPage.jsx — see
 * FRONTEND_ARCHITECTURE_REVIEW.md §4 "god component" finding.
 */
export default function ApiSpecTab({ pingSpec, pingSpecLoading, fetchPingSpec }) {
  const methodCls = (m) => m === 'GET' ? 'bg-sf-50 dark:bg-sf-500/10 text-sf-700 dark:text-sf-300 border-sf-200/60 dark:border-sf-400/20'
    : m === 'POST' ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-200/60 dark:border-emerald-400/20'
    : m === 'PUT' ? 'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-200/60 dark:border-amber-400/20'
    : m === 'DELETE' ? 'bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-300 border-red-200/60 dark:border-red-400/20'
    : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-gray-200/60 dark:border-gray-700/60';

  return (
    <div className="space-y-5">
      {/* Stat tiles */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatTile icon={Globe} label="Total Endpoints" accent="blue" value={pingSpec?.allEndpoints?.length ?? '—'} sub={pingSpec?.specType ? pingSpec.specType.toUpperCase() : undefined} />
        <StatTile icon={Activity} label="Ping / Health Paths" accent="emerald" value={pingSpec?.pingEndpoints?.length ?? '—'} />
        <StatTile icon={Package} label="Exchange Asset" accent="purple" value={pingSpec?.assetName || '—'} />
      </div>

      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-gray-900 dark:text-gray-100 font-semibold text-sm flex items-center gap-2">
            <Globe size={14} className="text-sf-600 dark:text-sf-400" /> API Specification — Exchange
          </h2>
          <p className="text-gray-500 dark:text-gray-400 text-xs mt-0.5">
            {pingSpecLoading ? 'Searching Exchange and parsing spec…' :
              pingSpec ? <>
                <span className="text-gray-500 dark:text-gray-400">{pingSpec.assetName}</span>
                {' · '}{pingSpec.specType?.toUpperCase()} · {pingSpec.allEndpoints?.length ?? 0} endpoints
                {pingSpec.pingEndpoints?.length > 0 && (
                  <span className="ml-2 text-emerald-600 dark:text-emerald-400 font-medium">
                    · {pingSpec.pingEndpoints.length} ping path{pingSpec.pingEndpoints.length !== 1 ? 's' : ''} found
                  </span>
                )}
              </> : 'No spec available — app may not have an Exchange asset linked'}
          </p>
        </div>
        <button onClick={() => fetchPingSpec(null, true)} disabled={pingSpecLoading}
          title="Re-fetch API spec from Exchange"
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 bg-gray-50/80 dark:bg-gray-800/60 hover:bg-gray-100 dark:hover:bg-gray-700 border border-gray-200/70 dark:border-gray-700/60 rounded-lg transition-all disabled:opacity-50">
          <RefreshCw size={11} className={pingSpecLoading ? 'animate-spin' : ''} />
          {pingSpec ? 'Refresh' : 'Fetch Spec'}
        </button>
      </div>

      {pingSpecLoading && (
        <div className="flex items-center justify-center py-16 gap-3 text-gray-500 dark:text-gray-400">
          <RefreshCw size={18} className="animate-spin" />
          <span className="text-sm">Searching Exchange and parsing API spec…</span>
        </div>
      )}

      {!pingSpecLoading && !pingSpec && (
        <div className="flex flex-col items-center justify-center py-16 gap-3 bg-white/50 dark:bg-gray-900/30 border border-gray-200/60 dark:border-gray-700/50 rounded-2xl">
          <div className="flex items-center justify-center w-14 h-14 rounded-2xl bg-sf-100 dark:bg-sf-500/10">
            <Globe size={24} className="text-sf-500 dark:text-sf-400" />
          </div>
          <p className="text-gray-500 dark:text-gray-400 text-sm">No Exchange spec found for this application</p>
          <p className="text-gray-400 dark:text-gray-500 text-xs">The app needs an Exchange asset linked via <code className="text-gray-500 dark:text-gray-400">application.ref</code> in its ARM descriptor</p>
        </div>
      )}

      {pingSpec && !pingSpecLoading && (
        <>
          {/* Ping endpoints highlighted */}
          {pingSpec.pingEndpoints?.length > 0 && (
            <GlassCard icon={Activity} title="Ping / Health Endpoints" count={pingSpec.pingEndpoints.length} accent="green" noPad>
              <div className="px-5 py-2 bg-emerald-50/60 dark:bg-emerald-500/5 border-b border-emerald-200/40 dark:border-emerald-400/10">
                <span className="text-[10px] text-emerald-700 dark:text-emerald-400">
                  These endpoints will be tried first during ping tests. Required query params are auto-filled.
                </span>
              </div>
              <table className="w-full text-sm border-collapse">
                <TableHeader>
                  <tr className="border-b border-gray-200/60 dark:border-gray-700/60">
                    {['Method', 'Path', 'Query Params', 'Headers', 'Description'].map(h => (
                      <th key={h} className="px-4 py-3 text-left text-[10px] font-bold tracking-wider text-gray-500 dark:text-gray-400 uppercase">{h}</th>
                    ))}
                  </tr>
                </TableHeader>
                <tbody>
                  {pingSpec.pingEndpoints.map((ep, i) => (
                    <tr key={i} className="border-b border-gray-100 dark:border-gray-800 hover:bg-sf-50/30 dark:hover:bg-sf-500/5 transition-colors">
                      <td className="px-4 py-3">
                        <span className={`text-[10px] px-2 py-0.5 rounded font-bold border ${methodCls(ep.method)}`}>{ep.method}</span>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-sfteal-700 dark:text-sfteal-300">{ep.path}</td>
                      <td className="px-4 py-3">
                        {ep.queryParams?.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {ep.queryParams.map(p => (
                              <span key={p.name} title={`${p.description}${p.example ? ` (e.g. ${p.example})` : ''}`}
                                className={`text-[10px] px-1.5 py-0.5 rounded border font-mono ${p.required ? 'bg-sforange-50 dark:bg-sforange-500/10 text-sforange-700 dark:text-sforange-300 border-sforange-200/60 dark:border-sforange-400/20' : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 border-gray-200/60 dark:border-gray-700/60'}`}>
                                {p.name}{p.required ? '*' : ''}
                              </span>
                            ))}
                          </div>
                        ) : <span className="text-gray-400 dark:text-gray-600 text-xs">—</span>}
                      </td>
                      <td className="px-4 py-3">
                        {ep.headers?.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {ep.headers.map(h => (
                              <span key={h.name} title={h.description}
                                className={`text-[10px] px-1.5 py-0.5 rounded border font-mono ${h.required ? 'bg-sfpurple-50 dark:bg-sfpurple-500/10 text-sfpurple-700 dark:text-sfpurple-300 border-sfpurple-200/60 dark:border-sfpurple-400/20' : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 border-gray-200/60 dark:border-gray-700/60'}`}>
                                {h.name}{h.required ? '*' : ''}
                              </span>
                            ))}
                          </div>
                        ) : <span className="text-gray-400 dark:text-gray-600 text-xs">—</span>}
                      </td>
                      <td className="px-4 py-3 text-gray-500 dark:text-gray-400 text-xs">{ep.description || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </GlassCard>
          )}

          {/* All endpoints table */}
          {pingSpec.allEndpoints?.length > 0 && (
            <GlassCard icon={Globe} title="All Endpoints" count={pingSpec.allEndpoints.length} accent="cyan" noPad>
              <div className="max-h-[50vh] overflow-y-auto">
                <table className="w-full text-sm border-collapse">
                  <TableHeader sticky>
                    <tr className="border-b border-gray-200/60 dark:border-gray-700/60">
                      {['Method', 'Path', 'Query Params', 'Headers', 'Description'].map(h => (
                        <th key={h} className="px-4 py-2.5 text-left text-[10px] font-bold tracking-wider text-gray-500 dark:text-gray-400 uppercase">{h}</th>
                      ))}
                    </tr>
                  </TableHeader>
                  <tbody>
                    {pingSpec.allEndpoints.map((ep, i) => {
                      const isPing = pingSpec.pingEndpoints?.some(p => p.path === ep.path && p.method === ep.method);
                      return (
                        <tr key={i} className={`border-b border-gray-100 dark:border-gray-800 hover:bg-sf-50/30 dark:hover:bg-sf-500/5 transition-colors ${isPing ? 'bg-emerald-50/40 dark:bg-emerald-500/5' : ''}`}>
                          <td className="px-4 py-2.5">
                            <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold border ${methodCls(ep.method)}`}>{ep.method}</span>
                          </td>
                          <td className="px-4 py-2.5">
                            <span className={`font-mono text-xs ${isPing ? 'text-emerald-700 dark:text-emerald-300' : 'text-gray-600 dark:text-gray-300'}`}>{ep.path}</span>
                            {isPing && <span className="ml-1.5 text-[9px] text-emerald-500 dark:text-emerald-400">● ping</span>}
                          </td>
                          <td className="px-4 py-2.5">
                            {ep.queryParams?.length > 0 ? (
                              <div className="flex flex-wrap gap-1">
                                {ep.queryParams.map(p => (
                                  <span key={p.name} title={p.description}
                                    className={`text-[9px] px-1 py-0.5 rounded border font-mono ${p.required ? 'bg-sforange-50 dark:bg-sforange-500/10 text-sforange-700 dark:text-sforange-300 border-sforange-200/60 dark:border-sforange-400/20' : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 border-gray-200/60 dark:border-gray-700/60'}`}>
                                    {p.name}
                                  </span>
                                ))}
                              </div>
                            ) : <span className="text-gray-400 dark:text-gray-600 text-[10px]">—</span>}
                          </td>
                          <td className="px-4 py-2.5">
                            {ep.headers?.length > 0 ? (
                              <div className="flex flex-wrap gap-1">
                                {ep.headers.map(h => (
                                  <span key={h.name} title={h.description}
                                    className="text-[9px] px-1 py-0.5 rounded border font-mono bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 border-gray-200/60 dark:border-gray-700/60">
                                    {h.name}
                                  </span>
                                ))}
                              </div>
                            ) : <span className="text-gray-400 dark:text-gray-600 text-[10px]">—</span>}
                          </td>
                          <td className="px-4 py-2.5 text-gray-500 dark:text-gray-400 text-xs max-w-xs truncate">{ep.description || '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="px-5 py-2 border-t border-gray-200/60 dark:border-gray-700/60 text-[10px] text-gray-400 dark:text-gray-500">
                * = required · <span className="text-sforange-600 dark:text-sforange-400">orange</span> = required query param · <span className="text-sfpurple-600 dark:text-sfpurple-400">purple</span> = required header · <span className="text-emerald-600 dark:text-emerald-400">● ping</span> = health check endpoint
              </div>
            </GlassCard>
          )}

          {pingSpec.pingEndpoints?.length === 0 && (
            <div className="flex items-start gap-3 bg-amber-50 dark:bg-amber-500/5 border border-amber-200/60 dark:border-amber-400/15 rounded-2xl px-5 py-4">
              <AlertTriangle size={14} className="text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-amber-700 dark:text-amber-300 text-sm font-medium">No ping/health endpoints detected</p>
                <p className="text-amber-600/80 dark:text-amber-400/80 text-xs mt-1">
                  The spec doesn't contain paths matching: ping, health, status, liveness, readiness, or heartbeat.
                  The dashboard will still try the standard paths: <code className="text-amber-700 dark:text-amber-300">/api/v1/ping → /api/v2/ping → /api/ping → /ping</code>
                </p>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
