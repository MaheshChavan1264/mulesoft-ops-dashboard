import React, { useState, useEffect, useCallback } from 'react';
import { X, Download, RefreshCw, CheckCircle, AlertTriangle, FileSpreadsheet, Globe, ChevronRight, Building2, Layers } from 'lucide-react';
import { exportCpsProperties } from '../utils/exportCps';
import api from '../services/api';

/* ── BG + Env multi-selector ────────────────────────────────── */
function BgEnvSelector({ selectedBgId, selectedEnvId, onSelectionsChange }) {
  const [businessGroups, setBusinessGroups] = useState([]);
  const [envsByBg, setEnvsByBg] = useState({});
  const [loadingEnvs, setLoadingEnvs] = useState({});
  const [expandedBgs, setExpandedBgs] = useState(new Set());
  // selections: Set of "{bgId}:{envId}" OR "{bgId}:*" (all envs in BG)
  const [selections, setSelections] = useState(new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadBusinessGroups();
  }, []);

  const loadBusinessGroups = async () => {
    setLoading(true);
    try {
      const res = await api.get('/organizations/business-groups');
      const groups = res.data.data || [];
      setBusinessGroups(groups);
      // Pre-select the current BG and env from the parent page
      const initialBgId = selectedBgId;
      if (initialBgId) {
        const sel = new Set();
        if (selectedEnvId) {
          sel.add(`${initialBgId}:${selectedEnvId}`);
        } else {
          sel.add(`${initialBgId}:*`);
        }
        setSelections(sel);
        setExpandedBgs(new Set([initialBgId]));
        loadEnvsForBg(initialBgId);
      }
    } catch { /* ignore */ }
    setLoading(false);
  };

  const loadEnvsForBg = useCallback(async (bgId) => {
    if (envsByBg[bgId]) return; // already loaded
    setLoadingEnvs(prev => ({ ...prev, [bgId]: true }));
    try {
      const res = await api.get(`/environments/${bgId}`);
      const envs = res.data.data || [];
      setEnvsByBg(prev => ({ ...prev, [bgId]: envs }));
    } catch {
      setEnvsByBg(prev => ({ ...prev, [bgId]: [] }));
    }
    setLoadingEnvs(prev => ({ ...prev, [bgId]: false }));
  }, [envsByBg]);

  const toggleBgExpand = (bgId) => {
    setExpandedBgs(prev => {
      const next = new Set(prev);
      next.has(bgId) ? next.delete(bgId) : next.add(bgId);
      return next;
    });
    loadEnvsForBg(bgId);
  };

  const isBgSelected = (bgId) => {
    // BG is "selected" if any of its envs are selected, or if "*" is selected
    return selections.has(`${bgId}:*`) || [...selections].some(s => s.startsWith(`${bgId}:`));
  };

  const isEnvSelected = (bgId, envId) => selections.has(`${bgId}:${envId}`) || selections.has(`${bgId}:*`);

  const toggleBg = (bgId) => {
    setSelections(prev => {
      const next = new Set(prev);
      if (isBgSelected(bgId)) {
        // Deselect all envs for this BG
        [...next].filter(s => s.startsWith(`${bgId}:`)).forEach(s => next.delete(s));
      } else {
        // Select all envs: use * if envs not loaded yet, else add each
        const envs = envsByBg[bgId];
        if (envs?.length) {
          envs.forEach(e => next.add(`${bgId}:${e.id}`));
        } else {
          next.add(`${bgId}:*`);
        }
      }
      return next;
    });
  };

  const toggleEnv = (bgId, envId) => {
    setSelections(prev => {
      const next = new Set(prev);
      const key = `${bgId}:${envId}`;
      const allKey = `${bgId}:*`;
      // Expand wildcard first
      if (next.has(allKey)) {
        next.delete(allKey);
        const envs = envsByBg[bgId] || [];
        envs.forEach(e => next.add(`${bgId}:${e.id}`));
      }
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  // Export selections as array of { bgId, bgName, envId, envName }
  useEffect(() => {
    const result = [];
    selections.forEach(sel => {
      const [bgId, envId] = sel.split(':');
      const bg = businessGroups.find(g => g.id === bgId);
      if (!bg) return;
      if (envId === '*') {
        const envs = envsByBg[bgId] || [];
        if (envs.length === 0) {
          result.push({ bgId, bgName: bg.name, envId: null, envName: 'All Environments' });
        } else {
          envs.forEach(e => result.push({ bgId, bgName: bg.name, envId: e.id, envName: e.name }));
        }
      } else {
        const envs = envsByBg[bgId] || [];
        const env = envs.find(e => e.id === envId);
        result.push({ bgId, bgName: bg.name, envId, envName: env?.name || envId });
      }
    });
    onSelectionsChange(result);
  }, [selections, businessGroups, envsByBg]);

  if (loading) return <div className="flex items-center justify-center py-6"><RefreshCw size={16} className="animate-spin text-gray-500" /></div>;

  const root = businessGroups.find(g => !g.parentId);
  const children = businessGroups.filter(g => g.parentId);
  const ordered = root ? [root, ...children] : businessGroups;

  return (
    <div className="max-h-56 overflow-y-auto border border-gray-700/50 rounded-xl">
      {ordered.map(bg => {
        const isExpanded = expandedBgs.has(bg.id);
        const isChecked = isBgSelected(bg.id);
        const envs = envsByBg[bg.id] || [];
        const loadingE = loadingEnvs[bg.id];
        return (
          <div key={bg.id} className="border-b border-gray-800/40 last:border-0">
            {/* BG row */}
            <div className="flex items-center gap-2 px-3 py-2.5 hover:bg-gray-800/30 transition-colors">
              <div onClick={() => toggleBg(bg.id)}
                className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 cursor-pointer transition-colors ${isChecked ? 'bg-blue-600 border-blue-500' : 'border-gray-600 hover:border-blue-500'}`}>
                {isChecked && <span className="text-white text-[10px] font-bold">✓</span>}
              </div>
              <Building2 size={12} className={isChecked ? 'text-blue-400' : 'text-gray-600'} />
              <span className={`text-xs font-medium flex-1 ${isChecked ? 'text-white' : 'text-gray-400'}`}>{bg.name}</span>
              {!bg.parentId && <span className="text-[9px] bg-blue-500/20 text-blue-400 border border-blue-500/30 px-1.5 py-0.5 rounded-full">ROOT</span>}
              <button onClick={() => toggleBgExpand(bg.id)}
                className="text-gray-600 hover:text-gray-300 p-0.5 rounded transition-colors">
                <ChevronRight size={12} className={`transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
              </button>
            </div>
            {/* Env rows */}
            {isExpanded && (
              <div className="bg-gray-900/40">
                {loadingE ? (
                  <div className="flex items-center gap-2 px-8 py-2 text-gray-600 text-xs">
                    <RefreshCw size={11} className="animate-spin" /> Loading environments…
                  </div>
                ) : envs.length === 0 ? (
                  <div className="px-8 py-2 text-gray-700 text-xs">No environments</div>
                ) : envs.map(env => {
                  const envChecked = isEnvSelected(bg.id, env.id);
                  const isProd = env.type === 'production';
                  return (
                    <div key={env.id} onClick={() => toggleEnv(bg.id, env.id)}
                      className="flex items-center gap-2 px-8 py-2 hover:bg-gray-800/20 cursor-pointer transition-colors">
                      <div className={`w-3.5 h-3.5 rounded border flex items-center justify-center flex-shrink-0 transition-colors ${envChecked ? 'bg-blue-600 border-blue-500' : 'border-gray-600 hover:border-blue-500'}`}>
                        {envChecked && <span className="text-white text-[9px] font-bold">✓</span>}
                      </div>
                      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${isProd ? 'bg-green-400' : 'bg-yellow-400'}`} />
                      <span className={`text-xs flex-1 ${envChecked ? 'text-gray-200' : 'text-gray-500'}`}>{env.name}</span>
                      <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${isProd ? 'bg-green-900/40 text-green-500' : 'bg-yellow-900/40 text-yellow-500'}`}>{env.type}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ── Main Modal ─────────────────────────────────────────────── */
export default function CpsExportModal({ apps: initialApps, bgOrgId, bgName, envName, selectedEnvId, filterSummary, onClose }) {
  const [status, setStatus] = useState('idle');
  const [progress, setProgress] = useState({ current: 0, total: 0, appName: '', bgEnv: '' });
  const [errorMsg, setErrorMsg] = useState('');
  const [cpsBaseUrl, setCpsBaseUrl] = useState('');
  const [cpsEnv, setCpsEnv] = useState('');
  const [bgEnvSelections, setBgEnvSelections] = useState([]);

  // Pre-populate CPS URL from stored credentials
  useEffect(() => {
    api.get('/cps/credentials').then(res => {
      const byUrlBg = res.data?.byUrlBg || {};
      const byUrl = res.data?.byUrl || {};
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

  const handleExport = async () => {
    if (!cpsBaseUrl.trim()) {
      setErrorMsg('Please enter the CPS Base URL before exporting.');
      setStatus('error');
      return;
    }
    if (bgEnvSelections.length === 0) {
      setErrorMsg('Please select at least one Business Group / Environment.');
      setStatus('error');
      return;
    }

    setStatus('running');
    setErrorMsg('');

    // Collect all apps from all selected BG/env combinations
    const allApps = [];
    for (const sel of bgEnvSelections) {
      try {
        const res = await api.get(`/applications/summary/${sel.bgId}`);
        const appsForBg = res.data.data || [];
        const filtered = sel.envId
          ? appsForBg.filter(a => a.environment?.id === sel.envId)
          : appsForBg;
        filtered.forEach(a => {
          // tag each app with the BG name for filename
          if (!allApps.find(x => x.id === a.id && x.environment?.id === a.environment?.id)) {
            allApps.push({ ...a, _bgName: sel.bgName, _envName: sel.envName });
          }
        });
      } catch { /* skip this BG/env */ }
    }

    const bgNames = [...new Set(bgEnvSelections.map(s => s.bgName))];
    const envNames = [...new Set(bgEnvSelections.map(s => s.envName))];

    try {
      await exportCpsProperties({
        apps: allApps,
        bgOrgId,
        bgName: bgNames.length === 1 ? bgNames[0] : 'Multi-BG',
        envName: envNames.length === 1 ? envNames[0] : 'Multi-Env',
        cpsBaseUrl: cpsBaseUrl.trim(),
        cpsEnvOverride: cpsEnv.trim(),
        onProgress: (current, total, appName) => {
          setProgress({ current, total, appName });
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
      <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-2xl shadow-2xl mx-4 max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-emerald-950/50 border border-emerald-800/40">
              <FileSpreadsheet size={15} className="text-emerald-400" />
            </div>
            <div>
              <h2 className="text-white font-semibold text-base">Export CPS Properties</h2>
              <p className="text-gray-500 text-xs mt-0.5">Select Business Groups and Environments to export</p>
            </div>
          </div>
          <button onClick={onClose} disabled={status === 'running'}
            className="text-gray-600 hover:text-gray-300 p-1 disabled:opacity-30">
            <X size={18} />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          {/* BG + Env selector */}
          {(status === 'idle' || status === 'error') && (
            <div className="space-y-2">
              <p className="text-gray-400 text-xs font-semibold uppercase tracking-wider flex items-center gap-1.5">
                <Layers size={11} /> Business Groups & Environments
              </p>
              <BgEnvSelector
                selectedBgId={bgOrgId}
                selectedEnvId={selectedEnvId}
                onSelectionsChange={setBgEnvSelections}
              />
              {bgEnvSelections.length > 0 && (
                <p className="text-blue-400 text-[10px]">
                  {bgEnvSelections.length} environment{bgEnvSelections.length !== 1 ? 's' : ''} selected across {[...new Set(bgEnvSelections.map(s => s.bgId))].length} BG{[...new Set(bgEnvSelections.map(s => s.bgId))].length !== 1 ? 's' : ''}
                </p>
              )}
            </div>
          )}

          {/* CPS URL + Env */}
          {(status === 'idle' || status === 'error') && (
            <div className="space-y-3 bg-gray-800/30 border border-gray-700/40 rounded-xl p-4">
              <p className="text-gray-400 text-xs font-semibold uppercase tracking-wider flex items-center gap-1.5">
                <Globe size={11} /> CPS Server Configuration
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2">
                  <label className="block text-[10px] text-gray-500 uppercase tracking-wider mb-1">CPS Base URL</label>
                  <input value={cpsBaseUrl} onChange={e => setCpsBaseUrl(e.target.value)}
                    placeholder="https://sapi-config-property-pd.bt-integration.api.sfdcbt.net"
                    className="w-full bg-gray-900/80 border border-gray-700/60 rounded-lg px-3 py-2 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-600/50 font-mono" />
                </div>
                <div>
                  <label className="block text-[10px] text-gray-500 uppercase tracking-wider mb-1">CPS Environment</label>
                  <input value={cpsEnv} onChange={e => setCpsEnv(e.target.value)}
                    placeholder="prod / uat"
                    className="w-full bg-gray-900/80 border border-gray-700/60 rounded-lg px-3 py-2 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-600/50 font-mono" />
                </div>
              </div>
            </div>
          )}

          {/* Output format */}
          {status === 'idle' && (
            <div className="space-y-1.5">
              <p className="text-gray-500 text-[10px] uppercase tracking-wider font-medium">Output: Excel (.xlsx) — 3 sheets</p>
              {['AllPropertiesCatalog', 'Host_APIUsersCatalog', 'ScheduleCatalog'].map(s => (
                <div key={s} className="flex items-center gap-2 bg-gray-800/40 border border-gray-700/30 rounded-lg px-3 py-1.5">
                  <ChevronRight size={10} className="text-gray-600 flex-shrink-0" />
                  <span className="text-gray-300 text-xs font-mono">{s}</span>
                </div>
              ))}
              <p className="text-gray-700 text-[10px]">⚠ Sensitive values masked as <code>****</code></p>
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
              <div className="w-full bg-gray-800 rounded-full h-2">
                <div className={`h-2 rounded-full transition-all duration-300 ${status === 'done' ? 'bg-emerald-500' : 'bg-blue-500'}`}
                  style={{ width: `${progressPct}%` }} />
              </div>
              {progress.appName && status === 'running' && (
                <p className="text-gray-500 text-[10px] font-mono truncate">Current: {progress.appName}</p>
              )}
              {status === 'done' && (
                <div className="flex items-center gap-2 text-emerald-400 text-sm">
                  <CheckCircle size={16} /> File downloaded successfully!
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
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-800 gap-3 flex-shrink-0">
          <p className="text-gray-600 text-xs">
            {bgEnvSelections.length > 0
              ? `${bgEnvSelections.length} env${bgEnvSelections.length !== 1 ? 's' : ''} selected`
              : 'No selection'}
          </p>
          <div className="flex gap-3">
            <button onClick={onClose} disabled={status === 'running'}
              className="px-4 py-2 text-sm text-gray-400 hover:text-white bg-gray-800 hover:bg-gray-700 rounded-lg transition-colors disabled:opacity-50">
              {status === 'done' ? 'Close' : 'Cancel'}
            </button>
            {status !== 'done' && (
              <button onClick={handleExport}
                disabled={status === 'running' || bgEnvSelections.length === 0 || !cpsBaseUrl.trim()}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg disabled:opacity-50 transition-colors">
                {status === 'running'
                  ? <><RefreshCw size={13} className="animate-spin" /> Exporting…</>
                  : status === 'error'
                    ? <><RefreshCw size={13} /> Retry</>
                    : <><Download size={13} /> Export to Excel</>}
              </button>
            )}
            {status === 'done' && (
              <button onClick={handleExport}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors">
                <Download size={13} /> Download Again
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
