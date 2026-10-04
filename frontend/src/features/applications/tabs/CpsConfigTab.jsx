import React from 'react';
import { Settings, Key, Package, Database, Check, Copy, RefreshCw, AlertTriangle, Search } from 'lucide-react';
import { postCpsCredentialsRaw, fetchCpsProperties } from '../../../services/cpsService';
import { getErrorMessage } from '../../../services/http';
import TableHeader from '../../../components/ui/TableHeader';
import CopyBtn from '../../../components/shared/CopyBtn';
import { GlassCard, StatTile, SecretVal, CopyGroupBtn } from '../shared';

/**
 * CpsConfigTab — ApplicationDetailPage's "CPS" (Config Property Server) tab.
 *
 * Extracted from pages/ApplicationDetailPage.jsx — see
 * FRONTEND_ARCHITECTURE_REVIEW.md §4 "god component" finding.
 */
export default function CpsConfigTab({
  cpsData, setCpsData, cpsEnv, cpsEnvOverride, setCpsEnvOverride, cpsKeyOverride, setCpsKeyOverride,
  cpsCredsResolved, hasCpsCsvCredentials, cpsBaseUrl, effectiveCpsEnv, effectiveCpsKey,
  setCpsError, cpsMissingCred, cpsError, cpsAttemptedUrl, cpsLoading, loadCpsData,
  setShowCpsSettings, setRawJsonView,
  copiedCpsNs, setCopiedCpsNs, copiedCpsSec, setCopiedCpsSec,
  cpsSearch, setCpsSearch, secureLoading, setSecureLoading,
  getAllCredentials, cpsDepType, appEnvName, orgId, isCH1,
}) {
  const nsCount = cpsData ? Object.keys(cpsData.nonSecure).length : 0;
  const secCount = cpsData ? cpsData.secureGroups.reduce((sum, g) => sum + (g.properties && typeof g.properties === 'object' ? Object.keys(g.properties).length : 0), 0) : 0;
  const binCount = cpsData?.binaryKeys ? cpsData.binaryKeys.split(',').map(f => f.trim()).filter(Boolean).length : 0;

  return (
    <div className="space-y-5">
      {/* Stat tiles */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatTile icon={Settings} label="Non-Secure Properties" accent="blue" value={cpsData ? nsCount : '—'} />
        <StatTile icon={Key} label="Secure Properties" accent="purple" value={cpsData ? secCount : '—'} sub={cpsData?.secureKeys && secCount===0 ? 'available to load' : undefined} />
        <StatTile icon={Package} label="Binary Assets" accent="amber" value={cpsData ? binCount : '—'} />
      </div>

      {/* Info bar */}
      <div className="relative rounded-2xl border border-gray-200/70 dark:border-gray-700/60 bg-white/70 dark:bg-gray-900/50 backdrop-blur-md shadow-sm overflow-hidden">
        <div className="flex items-center justify-between flex-wrap gap-4 px-5 py-4">
          <div className="space-y-2 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-gradient-to-br from-sf-500 to-sf-600 shadow-sm shadow-sf-500/30 flex-shrink-0">
                <Key size={13} className="text-white" />
              </div>
              <span className="text-gray-900 dark:text-gray-100 text-sm font-semibold">Config Property Server</span>
              <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold border ${cpsEnv==='prod'?'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-200/60 dark:border-emerald-400/20':'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-200/60 dark:border-amber-400/20'}`}>{cpsEnv.toUpperCase()}</span>
              <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold border ${isCH1?'bg-sfpurple-50 dark:bg-sfpurple-500/10 text-sfpurple-700 dark:text-sfpurple-300 border-sfpurple-200/60 dark:border-sfpurple-400/20':'bg-sf-50 dark:bg-sf-500/10 text-sf-700 dark:text-sf-300 border-sf-200/60 dark:border-sf-400/20'}`}>{isCH1?'CH1':'CH2'}</span>
              {cpsCredsResolved && (
                <span className="flex items-center gap-1 text-[10px] font-semibold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200/60 dark:border-emerald-400/20 px-1.5 py-0.5 rounded-full">
                  <Key size={8} /> Creds auto-resolved
                </span>
              )}
              {hasCpsCsvCredentials && !cpsCredsResolved && !cpsData && (
                <span className="text-[10px] text-amber-600 dark:text-amber-400">🔑 CSV loaded — will auto-resolve on load</span>
              )}
            </div>
            <p className="text-gray-400 dark:text-gray-500 text-xs font-mono break-all">{cpsBaseUrl}</p>
            {/* Editable key + env overrides */}
            <div className="flex flex-wrap gap-2 mt-1">
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-gray-400 dark:text-gray-500 uppercase tracking-wider font-semibold">Env</span>
                <input
                  value={cpsEnvOverride || effectiveCpsEnv}
                  onChange={(e) => { setCpsEnvOverride(e.target.value); setCpsData(null); setCpsError(''); }}
                  className="bg-gray-50/80 dark:bg-gray-800/60 border border-gray-200/70 dark:border-gray-700/60 rounded-lg px-2 py-1 text-xs text-gray-700 dark:text-gray-200 font-mono w-24 focus:outline-none focus:border-sf-400 dark:focus:border-sf-500 focus:ring-2 focus:ring-sf-500/10"
                />
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-gray-400 dark:text-gray-500 uppercase tracking-wider font-semibold">Key</span>
                <input
                  value={cpsKeyOverride || effectiveCpsKey}
                  onChange={(e) => { setCpsKeyOverride(e.target.value); setCpsData(null); setCpsError(''); }}
                  className="bg-gray-50/80 dark:bg-gray-800/60 border border-gray-200/70 dark:border-gray-700/60 rounded-lg px-2 py-1 text-xs text-gray-700 dark:text-gray-200 font-mono w-56 focus:outline-none focus:border-sf-400 dark:focus:border-sf-500 focus:ring-2 focus:ring-sf-500/10"
                />
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {cpsData && Object.keys(cpsData.nonSecure).length > 0 && (
              <>
                <button
                  onClick={() => {
                    const raw = cpsData.rawNsResponse;
                    setRawJsonView({
                      title: 'Non-Secure Properties (Raw JSON)',
                      data: raw
                    });
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-sf-700 dark:text-sf-300 hover:text-white bg-sf-50 dark:bg-sf-500/10 hover:bg-sf-600 border border-sf-200/60 dark:border-sf-400/20 hover:border-sf-600 rounded-lg transition-all">
                  <Database size={11} /> Raw JSON (NS)
                </button>
                <button
                  onClick={() => {
                    // Copy the original raw CPS API response (not the parsed flat object)
                    const raw = cpsData.rawNsResponse;
                    navigator.clipboard.writeText(
                      typeof raw === 'string' ? raw : JSON.stringify(raw, null, 2)
                    );
                    setCopiedCpsNs(true);
                    setTimeout(() => setCopiedCpsNs(false), 2000);
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300 hover:text-white bg-emerald-50 dark:bg-emerald-500/10 hover:bg-emerald-600 border border-emerald-200/60 dark:border-emerald-400/20 hover:border-emerald-600 rounded-lg transition-all">
                  {copiedCpsNs ? <><Check size={11} /> Copied!</> : <><Copy size={11} /> Non-Secure</>}
                </button>
              </>
            )}
            {cpsData && cpsData.secureGroups.length > 0 && (
              <>
                <button
                  onClick={() => {
                    const raw = cpsData.rawSecureResponse;
                    setRawJsonView({
                      title: 'Secure Properties (Raw JSON)',
                      data: raw
                    });
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-sf-700 dark:text-sf-300 hover:text-white bg-sf-50 dark:bg-sf-500/10 hover:bg-sf-600 border border-sf-200/60 dark:border-sf-400/20 hover:border-sf-600 rounded-lg transition-all">
                  <Database size={11} /> Raw JSON (Sec)
                </button>
                <button
                  onClick={() => {
                    // Copy the original raw secure CPS API response
                    const raw = cpsData.rawSecureResponse;
                    navigator.clipboard.writeText(
                      typeof raw === 'string' ? raw : JSON.stringify(raw, null, 2)
                    );
                    setCopiedCpsSec(true);
                    setTimeout(() => setCopiedCpsSec(false), 2000);
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-sfpurple-700 dark:text-sfpurple-300 hover:text-white bg-sfpurple-50 dark:bg-sfpurple-500/10 hover:bg-sfpurple-600 border border-sfpurple-200/60 dark:border-sfpurple-400/20 hover:border-sfpurple-600 rounded-lg transition-all">
                  {copiedCpsSec ? <><Check size={11} /> Copied!</> : <><Copy size={11} /> Secure</>}
                </button>
              </>
            )}
            <button onClick={() => loadCpsData(cpsKeyOverride, cpsEnvOverride)} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 bg-gray-50/80 dark:bg-gray-800/60 hover:bg-gray-100 dark:hover:bg-gray-700 border border-gray-200/70 dark:border-gray-700/60 rounded-lg transition-all"><RefreshCw size={11}/> {cpsData ? 'Refresh' : 'Load'}</button>
            <button onClick={() => setShowCpsSettings(true)} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-gradient-to-b from-sf-500 to-sf-600 hover:from-sf-400 hover:to-sf-500 text-white rounded-lg shadow-sm shadow-sf-500/30 hover:shadow-md transition-all"><Key size={11}/> Configure CPS</button>
          </div>
        </div>
      </div>

      {/* Missing credentials warning */}
      {cpsMissingCred && (
        <div className="flex items-center justify-between gap-4 bg-amber-50 dark:bg-amber-500/5 border border-amber-200/60 dark:border-amber-400/15 rounded-2xl px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-amber-100 dark:bg-amber-500/15 flex-shrink-0">
              <AlertTriangle size={16} className="text-amber-600 dark:text-amber-400" />
            </div>
            <div>
              <p className="text-amber-700 dark:text-amber-300 text-sm font-semibold">CPS credentials not configured</p>
              <p className="text-amber-600/80 dark:text-amber-400/80 text-xs mt-0.5">Missing <code className="bg-amber-100 dark:bg-amber-500/15 px-1 rounded">{cpsMissingCred}</code> credentials. Click "Configure CPS" to add them.</p>
            </div>
          </div>
          <button onClick={() => setShowCpsSettings(true)} className="flex-shrink-0 px-3.5 py-2 text-xs font-semibold bg-gradient-to-b from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-white rounded-xl shadow-md shadow-amber-500/30 hover:shadow-lg transition-all hover:-translate-y-0.5 active:translate-y-0">Configure</button>
        </div>
      )}

      {/* Error */}
      {cpsError && (
        <div className="bg-red-50 dark:bg-red-500/5 border border-red-200/60 dark:border-red-400/15 rounded-2xl px-5 py-4 space-y-2">
          <div className="flex items-center gap-3 text-red-700 dark:text-red-300 text-sm font-medium">
            <AlertTriangle size={14} className="flex-shrink-0" /> {cpsError}
          </div>
          {cpsAttemptedUrl && (
            <div className="text-[10px] text-red-500/80 dark:text-red-400/70 font-mono break-all border-t border-red-200/40 dark:border-red-400/15 pt-2">
              Attempted: {cpsAttemptedUrl}
            </div>
          )}
          <div className="text-[10px] text-red-500/70 dark:text-red-400/60 pt-0.5">
            💡 Check the <strong>Env</strong> and <strong>Key</strong> fields above — they must match exactly what's stored in CPS.
            Check the backend console for the full URL that was called.
          </div>
        </div>
      )}

      {/* Loading */}
      {cpsLoading && (
        <div className="flex items-center justify-center py-16 gap-3 text-gray-500 dark:text-gray-400">
          <RefreshCw size={18} className="animate-spin" />
          <span className="text-sm">Loading CPS properties…</span>
        </div>
      )}

      {/* Not loaded yet */}
      {!cpsLoading && !cpsData && !cpsError && !cpsMissingCred && (
        <div className="flex flex-col items-center justify-center py-16 gap-4 bg-white/50 dark:bg-gray-900/30 border border-gray-200/60 dark:border-gray-700/50 rounded-2xl">
          <div className="flex items-center justify-center w-14 h-14 rounded-2xl bg-sf-100 dark:bg-sf-500/10">
            <Key size={24} className="text-sf-500 dark:text-sf-400" />
          </div>
          <p className="text-gray-500 dark:text-gray-400 text-sm">Click to load properties from the Config Property Server</p>
          <p className="text-gray-400 dark:text-gray-500 text-xs">Will fetch <code className="text-gray-500 dark:text-gray-400">{effectiveCpsKey}</code> in <code className="text-gray-500 dark:text-gray-400">{effectiveCpsEnv}</code></p>
          <button onClick={() => loadCpsData(cpsKeyOverride, cpsEnvOverride)} className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-b from-sf-500 to-sf-600 hover:from-sf-400 hover:to-sf-500 text-white text-sm font-semibold rounded-xl shadow-md shadow-sf-500/30 hover:shadow-lg hover:shadow-sf-500/40 ring-1 ring-inset ring-white/20 transition-all hover:-translate-y-0.5 active:translate-y-0">
            <Key size={13} /> Load CPS Properties
          </button>
        </div>
      )}

      {/* CPS data loaded */}
      {cpsData && (
        <div className="space-y-5">
          {/* Search */}
          <div className="relative">
            <Search size={13} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500 pointer-events-none" />
            <input value={cpsSearch} onChange={(e) => setCpsSearch(e.target.value)} placeholder="Filter CPS properties by key or value…"
              className="w-full bg-white/70 dark:bg-gray-900/50 border border-gray-200/70 dark:border-gray-700/60 rounded-xl pl-10 pr-4 py-2.5 text-sm text-gray-700 dark:text-gray-200 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:border-sf-400 dark:focus:border-sf-500 focus:ring-2 focus:ring-sf-500/10 shadow-sm transition-all" />
          </div>

          {/* Non-secure properties — flat table from the properties object */}
          {Object.keys(cpsData.nonSecure).length > 0 && (() => {
            const CHIP_KEYS = new Set(['cps.secure.properties', 'cps.secure.binaries']);
            const searchLo = cpsSearch.toLowerCase();
            const visibleEntries = Object.entries(cpsData.nonSecure)
              .filter(([k, v]) => !searchLo || k.toLowerCase().includes(searchLo) || String(v).toLowerCase().includes(searchLo))
              .sort(([a], [b]) => a.localeCompare(b));

            return (
              <GlassCard icon={Settings} title="Non-Secure Properties" count={visibleEntries.length} accent="blue" noPad>
                <div className="max-h-80 overflow-y-auto">
                <table className="w-full text-sm border-collapse">
                  <TableHeader>
                    <tr className="border-b border-gray-200/60 dark:border-gray-700/60">
                      <th className="px-5 py-3 text-left text-[10px] font-bold tracking-wider text-gray-500 dark:text-gray-400 uppercase w-[42%]">Property Key</th>
                      <th className="px-5 py-3 text-left text-[10px] font-bold tracking-wider text-gray-500 dark:text-gray-400 uppercase">Value</th>
                    </tr>
                  </TableHeader>
                  <tbody>
                    {visibleEntries.map(([k, v]) => {
                      const isChip = CHIP_KEYS.has(k);
                      const isNum = typeof v === 'number';
                      const display = v === null || v === undefined ? '—'
                        : typeof v === 'object' ? JSON.stringify(v)
                        : String(v);
                      return (
                        <tr key={k} className="group border-b border-gray-100 dark:border-gray-800 hover:bg-sf-50/40 dark:hover:bg-sf-500/5 transition-colors">
                          <td className="px-5 py-3 align-top">
                            <div className="flex items-center gap-1.5">
                              <span className="text-gray-500 dark:text-gray-400 text-xs font-mono break-all">{k}</span>
                              <CopyBtn text={k} />
                            </div>
                          </td>
                          <td className="px-5 py-3 align-top">
                            {isChip ? (
                              <div className="flex flex-wrap gap-1">
                                {display.split(',').map((item) => item.trim()).filter(Boolean).map((item) => (
                                  <span key={item} className={`inline-flex text-[10px] px-2 py-0.5 rounded-md font-mono border ${
                                    k === 'cps.secure.binaries'
                                      ? 'bg-sforange-50 dark:bg-sforange-500/10 text-sforange-700 dark:text-sforange-300 border-sforange-200/60 dark:border-sforange-400/20'
                                      : 'bg-sfpurple-50 dark:bg-sfpurple-500/10 text-sfpurple-700 dark:text-sfpurple-300 border-sfpurple-200/60 dark:border-sfpurple-400/20'
                                  }`}>{item}</span>
                                ))}
                                <CopyBtn text={display} />
                              </div>
                            ) : (
                              <div className="flex items-start gap-1.5">
                                <span className={`text-xs font-mono break-all ${isNum ? 'text-sfteal-700 dark:text-sfteal-300' : 'text-gray-700 dark:text-gray-200'}`}>{display}</span>
                                <CopyBtn text={display} />
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                </div>
              </GlassCard>
            );
          })()}

          {/* ── Get Secure Properties button ── */}
          {cpsData.secureKeys && cpsData.secureGroups.length === 0 && (
            <div className="flex items-center justify-between bg-sfpurple-50/60 dark:bg-sfpurple-500/5 border border-sfpurple-200/50 dark:border-sfpurple-400/15 rounded-2xl px-5 py-4">
              <div className="space-y-1">
                <p className="text-sfpurple-700 dark:text-sfpurple-300 text-sm font-semibold flex items-center gap-2">
                  <Key size={13} /> Secure Properties
                </p>
                <p className="text-sfpurple-500 dark:text-sfpurple-400 text-xs">Keys: {cpsData.secureKeys}</p>
              </div>
              <button
                disabled={secureLoading}
                onClick={async () => {
                  try {
                    setSecureLoading(true);
                    // Re-post ALL CSV credentials before the secure fetch.
                    // The session may have expired or been cleared since the
                    // non-secure load — this ensures getCredentials() can find
                    // a valid credential and doesn't return 422.
                    if (hasCpsCsvCredentials && cpsBaseUrl) {
                      const normBase = cpsBaseUrl.trim().replace(/\/+$/, '').replace(/\/api\/v2\/?$/, '');
                      const allCreds = getAllCredentials();
                      if (allCreds.length > 0) {
                        const credMap = {};
                        for (const { clientId, clientSecret } of allCreds) {
                          credMap[`${normBase}::${clientId}`] = { clientId, clientSecret };
                        }
                        try { await postCpsCredentialsRaw({ credentials: credMap }); } catch {}
                      }
                    }
                    const raw = await fetchCpsProperties({
                      baseUrl: cpsBaseUrl, type: 'secure', environment: cpsData.useEnv,
                      keys: cpsData.secureKeys, deploymentType: cpsDepType, envName: appEnvName, bgOrgId: orgId
                    });
                    const groups = Array.isArray(raw?.responses) ? raw.responses
                      : Array.isArray(raw?.properties) ? raw.properties
                      : Array.isArray(raw) ? raw : [];
                    setCpsData((prev) => ({ ...prev, secureGroups: groups, rawSecureResponse: raw }));
                  } catch (e) {
                    // show error in the secure section
                    setCpsData((prev) => ({ ...prev, secureGroups: [{ key: '__error__', _error: getErrorMessage(e) }] }));
                  }
                  setSecureLoading(false);
                }}
                className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-b from-sfpurple-500 to-sfpurple-600 hover:from-sfpurple-400 hover:to-sfpurple-500 text-white text-xs font-semibold rounded-xl shadow-md shadow-sfpurple-500/30 hover:shadow-lg hover:shadow-sfpurple-500/40 ring-1 ring-inset ring-white/20 transition-all disabled:opacity-50 flex-shrink-0 hover:-translate-y-0.5 active:translate-y-0"
              >
                {secureLoading
                  ? <><RefreshCw size={12} className="animate-spin" /> Loading…</>
                  : <><Key size={12} /> Get Secure Properties</>}
              </button>
            </div>
          )}

          {/* Secure property groups */}
          {cpsData.secureGroups.length > 0 && cpsData.secureGroups.map((group) => {
            // Error group — show error message instead of a property card
            if (group.key === '__error__' || group._error) {
              return (
                <div key="__error__" className="flex items-start gap-3 bg-red-50 dark:bg-red-500/5 border border-red-200/60 dark:border-red-400/15 rounded-xl px-5 py-4 text-red-700 dark:text-red-300 text-sm">
                  <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-medium">Secure properties could not be loaded</p>
                    <p className="text-xs text-red-500/80 dark:text-red-400/70 mt-1">{group._error || 'Unknown error'}</p>
                    <p className="text-xs text-red-600/60 dark:text-red-400/50 mt-1">
                      The credential may not have access to this project's secure properties. Try refreshing the page to retry with a different credential.
                    </p>
                  </div>
                </div>
              );
            }
            const groupProps = group.properties || {};
            // Skip groups where properties is a "COULD NOT ACCESS" string
            if (typeof groupProps === 'string') {
              return (
                <div key={group.key} className="flex items-start gap-3 bg-amber-50 dark:bg-amber-500/5 border border-amber-200/60 dark:border-amber-400/15 rounded-xl px-5 py-3 text-amber-700 dark:text-amber-300 text-xs">
                  <AlertTriangle size={12} className="flex-shrink-0 mt-0.5" />
                  <span>🔒 <strong>{group.key}</strong>: {groupProps}</span>
                </div>
              );
            }
            const filtered = Object.entries(groupProps).filter(([k, v]) =>
              !cpsSearch || k.toLowerCase().includes(cpsSearch.toLowerCase()) || String(v).toLowerCase().includes(cpsSearch.toLowerCase()));
            if (filtered.length === 0 && cpsSearch) return null;
            return (
              <GlassCard key={group.key} icon={Key} title={`🔒 ${group.key}`} count={Object.keys(groupProps).length} accent="orange" noPad>
                <div className="px-5 py-2 bg-sforange-50/60 dark:bg-sforange-500/5 border-b border-sforange-200/40 dark:border-sforange-400/10 flex items-center justify-between">
                  <span className="text-[10px] text-sforange-600 dark:text-sforange-400">Secure property group — treat values as sensitive</span>
                  <CopyGroupBtn text={JSON.stringify({
                    responses: [{
                      environment: group.environment || cpsData.useEnv || effectiveCpsEnv,
                      key: group.key,
                      properties: groupProps,
                    }]
                  }, null, 2)} />
                </div>
                <div className="max-h-64 overflow-y-auto">
                <table className="w-full text-sm border-collapse">
                  <tbody>
                    {(cpsSearch ? filtered : Object.entries(groupProps).sort(([a],[b])=>a.localeCompare(b))).map(([k, v]) => (
                      <tr key={k} className="group border-b border-gray-100 dark:border-gray-800 hover:bg-sf-50/40 dark:hover:bg-sf-500/5 transition-colors">
                        <td className="px-5 py-3 w-[42%]"><span className="text-gray-500 dark:text-gray-400 text-xs font-mono break-all">{k}</span></td>
                        <td className="px-5 py-3"><SecretVal value={String(v)} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              </GlassCard>
            );
          })}

          {/* ── Binary Assets — displayed directly from cps.secure.binaries ── */}
          {cpsData.binaryKeys && (() => {
            const binaryFiles = cpsData.binaryKeys.split(',').map((f) => f.trim()).filter(Boolean)
              .filter((f) => !cpsSearch || f.toLowerCase().includes(cpsSearch.toLowerCase()));
            if (binaryFiles.length === 0) return null;
            return (
              <GlassCard icon={Package} title="Binary Assets" count={binaryFiles.length} accent="purple" noPad>
                <div className="px-5 py-2 bg-sfpurple-50/60 dark:bg-sfpurple-500/5 border-b border-sfpurple-200/40 dark:border-sfpurple-400/10">
                  <span className="text-[10px] text-sfpurple-600 dark:text-sfpurple-400">Binary files configured in <code className="text-sfpurple-700 dark:text-sfpurple-300">cps.secure.binaries</code></span>
                </div>
                <table className="w-full text-sm border-collapse">
                  <TableHeader>
                    <tr className="border-b border-gray-200/60 dark:border-gray-700/60">
                      <th className="px-5 py-3 text-left text-[10px] font-bold tracking-wider text-gray-500 dark:text-gray-400 uppercase">File Name</th>
                      <th className="px-5 py-3 text-left text-[10px] font-bold tracking-wider text-gray-500 dark:text-gray-400 uppercase">Extension</th>
                    </tr>
                  </TableHeader>
                  <tbody>
                    {binaryFiles.map((fileName, i) => {
                      const ext = fileName.includes('.') ? fileName.split('.').pop().toLowerCase() : '—';
                      const extColor = ext === 'jks' ? 'bg-sf-50 dark:bg-sf-500/10 text-sf-700 dark:text-sf-300 border-sf-200/60 dark:border-sf-400/20'
                        : ext === 'pem' ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-200/60 dark:border-emerald-400/20'
                        : ext === 'gpg' || ext === 'pgp' ? 'bg-sfpurple-50 dark:bg-sfpurple-500/10 text-sfpurple-700 dark:text-sfpurple-300 border-sfpurple-200/60 dark:border-sfpurple-400/20'
                        : ext === 'crt' || ext === 'cer' ? 'bg-sfteal-50 dark:bg-sfteal-500/10 text-sfteal-700 dark:text-sfteal-300 border-sfteal-200/60 dark:border-sfteal-400/20'
                        : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 border-gray-200/60 dark:border-gray-700/60';
                      return (
                        <tr key={i} className="group border-b border-gray-100 dark:border-gray-800 hover:bg-sf-50/40 dark:hover:bg-sf-500/5 transition-colors">
                          <td className="px-5 py-3">
                            <div className="flex items-center gap-1.5">
                              <span className="text-gray-700 dark:text-gray-200 text-xs font-mono">{fileName}</span>
                              <CopyBtn text={fileName} />
                            </div>
                          </td>
                          <td className="px-5 py-3">
                            <span className={`inline-flex text-[10px] px-2 py-0.5 rounded-md font-mono border uppercase ${extColor}`}>{ext}</span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </GlassCard>
            );
          })()}
        </div>
      )}
    </div>
  );
}
