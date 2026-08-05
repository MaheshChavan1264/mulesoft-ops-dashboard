import React, { useState, useRef, useEffect } from 'react';
import { X, Download, RefreshCw, CheckCircle, AlertTriangle, FileSpreadsheet, ChevronRight, Globe } from 'lucide-react';
import { exportCpsProperties } from '../utils/exportCps';
import api from '../services/api';

export default function CpsExportModal({ apps, bgOrgId, bgName, filterSummary, onClose }) {
  const [status, setStatus] = useState('idle'); // idle | running | done | error
  const [progress, setProgress] = useState({ current: 0, total: 0, appName: '' });
  const [errorMsg, setErrorMsg] = useState('');
  const [cpsBaseUrl, setCpsBaseUrl] = useState('');
  const [cpsEnv, setCpsEnv] = useState('');
  const cancelledRef = useRef(false);

  // Try to pre-populate CPS URL from stored credentials
  useEffect(() => {
    api.get('/cps/credentials').then(res => {
      const byUrlBg = res.data?.byUrlBg || {};
      const byUrl = res.data?.byUrl || {};
      // Find a URL that matches this BG
      const bgMatch = Object.keys(byUrlBg).find(k => k.includes(`::${bgOrgId}`));
      if (bgMatch) {
        const url = bgMatch.split('::')[0];
        setCpsBaseUrl(url);
        setCpsEnv(url.includes('ut') || url.includes('stage') ? 'uat' : 'prod');
      } else if (Object.keys(byUrl).length > 0) {
        const url = Object.keys(byUrl)[0];
        setCpsBaseUrl(url);
        setCpsEnv(url.includes('ut') || url.includes('stage') ? 'uat' : 'prod');
      }
    }).catch(() => {});
  }, [bgOrgId]);

  // All apps are candidates — CPS URL is user-specified
  const appsWithCps = apps;

  const handleExport = async () => {
    cancelledRef.current = false;
    setStatus('running');
    setProgress({ current: 0, total: appsWithCps.length, appName: '' });
    setErrorMsg('');

    if (!cpsBaseUrl.trim()) {
      setErrorMsg('Please enter the CPS Base URL before exporting.');
      setStatus('error');
      return;
    }

    try {
      await exportCpsProperties({
        apps,
        bgOrgId,
        cpsBaseUrl: cpsBaseUrl.trim(),
        cpsEnvOverride: cpsEnv.trim(),
        onProgress: (current, total, appName) => {
          setProgress({ current, total, appName });
        },
        onComplete: () => {
          setStatus('done');
        },
        onError: (msg) => {
          setErrorMsg(msg);
          setStatus('error');
        }
      });
      setStatus('done');
    } catch (e) {
      setErrorMsg(e.message || 'Export failed');
      setStatus('error');
    }
  };

  const progressPct = progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-lg shadow-2xl mx-4">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-emerald-950/50 border border-emerald-800/40">
              <FileSpreadsheet size={15} className="text-emerald-400" />
            </div>
            <div>
              <h2 className="text-white font-semibold text-base">Export CPS Properties</h2>
              <p className="text-gray-500 text-xs mt-0.5">
                BG: <span className="text-gray-300">{bgName}</span>
                {filterSummary && <span className="text-gray-600"> · {filterSummary}</span>}
              </p>
            </div>
          </div>
          <button onClick={onClose} disabled={status === 'running'}
            className="text-gray-600 hover:text-gray-300 p-1 disabled:opacity-30">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-4">
          {/* Summary */}
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-gray-800/60 border border-gray-700/40 rounded-xl px-4 py-3 text-center">
              <p className="text-2xl font-bold text-white">{apps.length}</p>
              <p className="text-gray-500 text-xs mt-0.5">Total Apps</p>
            </div>
            <div className="bg-emerald-950/30 border border-emerald-800/40 rounded-xl px-4 py-3 text-center">
              <p className="text-2xl font-bold text-emerald-400">{appsWithCps.length}</p>
              <p className="text-gray-500 text-xs mt-0.5">With CPS</p>
            </div>
            <div className="bg-gray-800/60 border border-gray-700/40 rounded-xl px-4 py-3 text-center">
              <p className="text-2xl font-bold text-gray-300">{apps.length - appsWithCps.length}</p>
              <p className="text-gray-500 text-xs mt-0.5">No CPS</p>
            </div>
          </div>

          {/* CPS URL + Env inputs — always visible in idle/error state */}
          {(status === 'idle' || status === 'error') && (
            <div className="space-y-3 bg-gray-800/30 border border-gray-700/40 rounded-xl p-4">
              <p className="text-gray-400 text-xs font-semibold uppercase tracking-wider flex items-center gap-1.5">
                <Globe size={11} /> CPS Server Configuration
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2">
                  <label className="block text-[10px] text-gray-500 uppercase tracking-wider mb-1">CPS Base URL</label>
                  <input
                    value={cpsBaseUrl}
                    onChange={(e) => setCpsBaseUrl(e.target.value)}
                    placeholder="https://sapi-config-property-pd.bt-integration.api.sfdcbt.net"
                    className="w-full bg-gray-900/80 border border-gray-700/60 rounded-lg px-3 py-2 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-600/50 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-gray-500 uppercase tracking-wider mb-1">Environment</label>
                  <input
                    value={cpsEnv}
                    onChange={(e) => setCpsEnv(e.target.value)}
                    placeholder="prod / uat"
                    className="w-full bg-gray-900/80 border border-gray-700/60 rounded-lg px-3 py-2 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-600/50 font-mono"
                  />
                </div>
              </div>
              {!cpsBaseUrl && (
                <p className="text-yellow-500/80 text-[10px]">
                  ⚠ Enter the CPS server URL (matches <code className="text-yellow-400">cps.configServerBaseUrl</code> in runtime properties)
                </p>
              )}
            </div>
          )}

          {/* Output format info */}
          {status === 'idle' && (
            <div className="space-y-2">
              <p className="text-gray-400 text-xs font-medium uppercase tracking-wider">Output: Excel (.xlsx) — 3 sheets</p>
              <div className="space-y-1.5">
                {[
                  { name: 'AllPropertiesCatalog', desc: 'Non-secure + secure properties per app/key group' },
                  { name: 'Host_APIUsersCatalog', desc: 'Hosts, API usernames, secure access info' },
                  { name: 'ScheduleCatalog', desc: 'Scheduler configuration per app' }
                ].map(s => (
                  <div key={s.name} className="flex items-center gap-2 bg-gray-800/40 border border-gray-700/30 rounded-lg px-3 py-2">
                    <ChevronRight size={11} className="text-gray-600 flex-shrink-0" />
                    <span className="text-gray-200 text-xs font-mono">{s.name}</span>
                    <span className="text-gray-600 text-xs">— {s.desc}</span>
                  </div>
                ))}
              </div>
              <p className="text-gray-600 text-[10px]">
                ⚠ Sensitive fields (passwords, secrets) are masked as <code>****</code>
              </p>
            </div>
          )}

          {/* Progress */}
          {(status === 'running' || status === 'done') && (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs">
                <span className="text-gray-400">
                  {status === 'done' ? 'Export complete!' : `Processing ${progress.current} of ${progress.total}…`}
                </span>
                <span className={`font-medium ${status === 'done' ? 'text-emerald-400' : 'text-blue-400'}`}>{progressPct}%</span>
              </div>
              {/* Progress bar */}
              <div className="w-full bg-gray-800 rounded-full h-2">
                <div
                  className={`h-2 rounded-full transition-all duration-300 ${status === 'done' ? 'bg-emerald-500' : 'bg-blue-500'}`}
                  style={{ width: `${progressPct}%` }}
                />
              </div>
              {progress.appName && status === 'running' && (
                <p className="text-gray-500 text-[10px] font-mono truncate">
                  Current: {progress.appName}
                </p>
              )}
              {status === 'done' && (
                <div className="flex items-center gap-2 text-emerald-400 text-sm">
                  <CheckCircle size={16} />
                  <span>File downloaded successfully!</span>
                </div>
              )}
            </div>
          )}

          {/* Error */}
          {status === 'error' && (
            <div className="flex items-start gap-3 bg-red-950/30 border border-red-800/50 rounded-xl px-4 py-3">
              <AlertTriangle size={15} className="text-red-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-red-300 text-sm font-medium">Export failed</p>
                <p className="text-red-500/80 text-xs mt-0.5">{errorMsg}</p>
              </div>
            </div>
          )}

          {appsWithCps.length === 0 && status === 'idle' && (
            <div className="flex items-center gap-2 bg-yellow-950/30 border border-yellow-800/50 rounded-xl px-4 py-3 text-yellow-300 text-sm">
              <AlertTriangle size={14} />
              No apps with CPS configuration found in this BG
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-800 gap-3">
          <p className="text-gray-600 text-xs">
            {appsWithCps.length} app{appsWithCps.length !== 1 ? 's' : ''} will be exported
          </p>
          <div className="flex gap-3">
            <button onClick={onClose} disabled={status === 'running'}
              className="px-4 py-2 text-sm text-gray-400 hover:text-white bg-gray-800 hover:bg-gray-700 rounded-lg transition-colors disabled:opacity-50">
              {status === 'done' ? 'Close' : 'Cancel'}
            </button>
            {status !== 'done' && (
              <button
                onClick={handleExport}
                disabled={status === 'running' || appsWithCps.length === 0}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg disabled:opacity-50 transition-colors"
              >
                {status === 'running'
                  ? <><RefreshCw size={13} className="animate-spin" /> Exporting…</>
                  : status === 'error'
                    ? <><RefreshCw size={13} /> Retry Export</>
                    : <><Download size={13} /> Export to Excel</>}
              </button>
            )}
            {status === 'done' && (
              <button
                onClick={handleExport}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors"
              >
                <Download size={13} /> Download Again
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}