import React, { useState, useEffect, useCallback } from 'react';
import { X, Download, RefreshCw, CheckCircle, AlertTriangle, FileSpreadsheet, Globe, ChevronRight, Building2, Layers, Key, Zap, Search } from 'lucide-react';
import { exportCpsProperties } from '../utils/exportCps';
import { useCpsCredentialStore } from '../context/CpsCredentialStoreContext';
import { applyBgFilter } from './BgFilterModal';
import api from '../services/api';

/* ── BG + Env multi-selector ────────────────────────────────── */
function BgEnvSelector({ selectedBgId, selectedEnvId, onSelectionsChange }) {
  const [businessGroups, setBusinessGroups] = useState([]);
  const [envsByBg, setEnvsByBg] = useState({});
  const [loadingEnvs, setLoadingEnvs] = useState({});
  const [expandedBgs, setExpandedBgs] = useState(new Set());
  const [selections, setSelections] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [envSearch, setEnvSearch] = useState('');

  useEffect(() => { loadBusinessGroups(); }, []);

  const loadBusinessGroups = async () => {
    setLoading(true);
    try {
      const res = await api.get('/organizations/business-groups');
      const groups = res.data.data || [];
      setBusinessGroups(groups);
      const initialBgId = selectedBgId;
      if (initialBgId) {
        const sel = new Set();
        if (selectedEnvId) { sel.add(`${initialBgId}:${selectedEnvId}`); }
        else { sel.add(`${initialBgId}:*`); }
        setSelections(sel);
        setExpandedBgs(new Set([initialBgId]));
        loadEnvsForBg(initialBgId);
      }
    } catch { /* ignore */ }
    setLoading(false);
  };

  const loadEnvsForBg = useCallback(async (bgId) => {
    if (envsByBg[bgId]) return;
    setLoadingEnvs(prev => ({ ...prev, [bgId]: true }));
    try {
      const res = await api.get(`/environments/${bgId}`);
      const envs = res.data.data || [];
      setEnvsByBg(prev => ({ ...prev, [bgId]: envs }));
    } catch { setEnvsByBg(prev => ({ ...prev, [bgId]: [] })); }
    setLoadingEnvs(prev => ({ ...prev, [bgId]: false }));
  }, [envsByBg]);

  const toggleBgExpand = (bgId) => {
    setExpandedBgs(prev => { const n = new Set(prev); n.has(bgId) ? n.delete(bgId) : n.add(bgId); return n; });
    loadEnvsForBg(bgId);
  };

  const isBgSelected = (bgId) => selections.has(`${bgId}:*`) || [...selections].some(s => s.startsWith(`${bgId}:`));
  const isEnvSelected = (bgId, envId) => selections.has(`${bgId}:${envId}`) || selections.has(`${bgId}:*`);

  const toggleBg = (bgId) => {
    setSelections(prev => {
      const next = new Set(prev);
      if (isBgSelected(bgId)) { [...next].filter(s => s.startsWith(`${bgId}:`)).forEach(s => next.delete(s)); }
      else {
        const envs = envsByBg[bgId];
        if (envs?.length) { envs.forEach(e => next.add(`${bgId}:${e.id}`)); }
        else { next.add(`${bgId}:*`); }
      }
      return next;
    });
  };

  const toggleEnv = (bgId, envId) => {
    setSelections(prev => {
      const next = new Set(prev);
      const key = `${bgId}:${envId}`;
      const allKey = `${bgId}:*`;
      if (next.has(allKey)) {
        next.delete(allKey);
        (envsByBg[bgId] || []).forEach(e => next.add(`${bgId}:${e.id}`));
      }
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  useEffect(() => {
    const result = [];
    selections.forEach(sel => {
      const [bgId, envId] = sel.split(':');
      const bg = businessGroups.find(g => g.id === bgId);
      if (!bg) return;
      if (envId === '*') {
        const envs = envsByBg[bgId] || [];
        if (envs.length === 0) { result.push({ bgId, bgName: bg.name, envId: null, envName: 'All Environments' }); }
        else { envs.forEach(e => result.push({ bgId, bgName: bg.name, envId: e.id, envName: e.name })); }
      } else {
        const env = (envsByBg[bgId] || []).find(e => e.id === envId);
        result.push({ bgId, bgName: bg.name, envId, envName: env?.name || envId });
      }
    });
    onSelectionsChange(result);
  }, [selections, businessGroups, envsByBg]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Compute derived values (before any early return) ────────────────
  const visible = applyBgFilter(businessGroups);
  const searchLo = envSearch.toLowerCase().trim();

  // Auto-load envs for all visible BGs when search is active — MUST be before early return
  useEffect(() => {
    if (!searchLo || loading) return;
    visible.forEach(bg => { if (!envsByBg[bg.id]) loadEnvsForBg(bg.id); });
  }, [searchLo, loading]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return <div className="flex items-center justify-center py-6"><RefreshCw size={16} className="animate-spin text-gray-500" /></div>;

  const root = visible.find(g => !g.parentId);
  const children = visible.filter(g => g.parentId);
  const ordered = root ? [root, ...children] : visible;

  const getFilteredEnvs = (bgId) => {
    const envs = envsByBg[bgId] || [];
    if (!searchLo) return envs;
    return envs.filter(e => e.name.toLowerCase().includes(searchLo) || e.type?.toLowerCase().includes(searchLo));
  };

  return (
    <div className="border border-gray-700/50 rounded-xl overflow-hidden">
      {/* Env search input */}
      <div className="relative border-b border-gray-700/50">
        <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
        <input
          value={envSearch}
          onChange={e => setEnvSearch(e.target.value)}
          placeholder="Search environments…"
          className="w-full bg-gray-800/40 pl-8 pr-3 py-2 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:bg-gray-800/60"
        />
        {envSearch && (
          <button onClick={() => setEnvSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 text-xs">✕</button>
        )}
      </div>
      <div style={{ maxHeight: '12rem', overflowY: 'auto' }}>
      {ordered.map(bg => {
        const isExpanded = expandedBgs.has(bg.id) || !!searchLo;
        const isChecked = isBgSelected(bg.id);
        const envs = getFilteredEnvs(bg.id);
        const loadingE = loadingEnvs[bg.id];
        // Hide BG if search active and no matching envs (and not still loading)
        if (searchLo && envs.length === 0 && !loadingE) return null;
        return (
          <div key={bg.id} className="border-b border-gray-800/40 last:border-0">
            <div className="flex items-center gap-2 px-3 py-2.5 hover:bg-gray-800/30 transition-colors">
              <div onClick={() => toggleBg(bg.id)}
                className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 cursor-pointer transition-colors ${isChecked ? 'bg-blue-600 border-blue-500' : 'border-gray-600 hover:border-blue-500'}`}>
                {isChecked && <span className="text-white text-[10px] font-bold">✓</span>}
              </div>
              <Building2 size={12} className={isChecked ? 'text-blue-400' : 'text-gray-600'} />
              <span className={`text-xs font-medium flex-1 ${isChecked ? 'text-white' : 'text-gray-400'}`}>{bg.name}</span>
              {!bg.parentId && <span className="text-[9px] bg-blue-500/20 text-blue-400 border border-blue-500/30 px-1.5 py-0.5 rounded-full">ROOT</span>}
              <button onClick={() => toggleBgExpand(bg.id)} className="text-gray-600 hover:text-gray-300 p-0.5 rounded transition-colors">
                <ChevronRight size={12} className={`transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
              </button>
            </div>
            {isExpanded && (
              <div className="bg-gray-900/40">
                {loadingE ? (
                  <div className="flex items-center gap-2 px-8 py-2 text-gray-600 text-xs"><RefreshCw size={11} className="animate-spin" /> Loading environments…</div>
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
    </div>
  );
}

/* ── Main Modal ─────────────────────────────────────────────── */
export default function CpsExportModal({ apps: passedApps, bgOrgId, bgName, envName, selectedEnvId, filterSummary, onClose }) {
  const { getAllCredentials, hasCredentials: hasCpsCreds, getSecret } = useCpsCredentialStore();

  const [status, setStatus] = useState('idle');
  const [progress, setProgress] = useState({ current: 0, total: 0, label: '' });
  const [errorMsg, setErrorMsg] = useState('');
  const [cpsBaseUrl, setCpsBaseUrl] = useState('');
  const [cpsEnv, setCpsEnv] = useState('');
  const [bgEnvSelections, setBgEnvSelections] = useState([]);

  // Whether to use the pre-passed apps (selected from Applications page) or BG/Env selector
  const hasPreselected = passedApps?.length > 0;
  const [usePreselected, setUsePreselected] = useState(hasPreselected);

  // Auto-detect state
  const [autoDetecting, setAutoDetecting] = useState(false);
  const [autoDetected, setAutoDetected] = useState(false);

  // ── Auto-detect CPS URL from the first pre-selected app's ARM properties ──
  const autoDetectFromApp = useCallback(async (app) => {
    if (!app || cpsBaseUrl) return;
    setAutoDetecting(true);
    try {
      const envId = app.environment?.id;
      const appBgId = app._bgId || bgOrgId;
      if (!envId || !appBgId) return;
      let armProps = {};
      if (app.deploymentType === 'CloudHub 2.0') {
        const r = await api.get(`/applications/cloudhub2/${appBgId}/${envId}/${app.id}`);
        const ds = r.data?.target?.deploymentSettings || {};
        const ps = (r.data?.application?.configuration || {})['mule.agent.application.properties.service'] || {};
        armProps = { ...(ps.properties || {}), ...(ds.properties || {}), ...(ds.environmentVariables || ds.environmentVars || {}), ...(r.data?.properties || {}) };
      } else {
        const r = await api.get(`/applications/cloudhub1/${envId}/${app.id}`, { params: { orgId: appBgId } });
        armProps = r.data?.properties || {};
      }
      const url = armProps['cps.configServerBaseUrl'] || armProps['config.server.base.url'];
      if (url) {
        const normUrl = url.trim().replace(/\/+$/, '').replace(/\/api\/v2\/?$/, '');
        setCpsBaseUrl(normUrl);
        const detectedEnv = armProps['cps.prefix'] || armProps['cps.environment'] || '';
        setCpsEnv(detectedEnv);
        setAutoDetected(true);
      }
    } catch { /* ignore — user can enter manually */ }
    setAutoDetecting(false);
  }, [bgOrgId, cpsBaseUrl]);

  // ── Load stored credentials + auto-detect URL on mount ──────────────────
  useEffect(() => {
    // 1. Try stored session credentials first (fast)
    api.get('/cps/credentials').then(res => {
      const byUrlBg = res.data?.byUrlBg || {};
      const byUrl = res.data?.byUrl || {};
      const bgMatch = Object.keys(byUrlBg).find(k => k.includes(`::${bgOrgId}`));
      if (bgMatch) {
        const url = bgMatch.split('::')[0];
        setCpsBaseUrl(url);
        setCpsEnv(url.includes('ut') || url.includes('stage') ? 'uat' : 'prod');
        setAutoDetected(true);
        return;
      }
      if (Object.keys(byUrl).length > 0) {
        const url = Object.keys(byUrl)[0];
        setCpsBaseUrl(url);
        setCpsEnv(url.includes('ut') || url.includes('stage') ? 'uat' : 'prod');
        setAutoDetected(true);
        return;
      }
      // 2. No stored creds — try to detect from first pre-selected app
      if (passedApps?.length > 0) {
        autoDetectFromApp(passedApps[0]);
      }
    }).catch(() => {
      if (passedApps?.length > 0) autoDetectFromApp(passedApps[0]);
    });
  }, [bgOrgId]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleExport = async () => {
    if (bgEnvSelections.length === 0 && !usePreselected) {
      setErrorMsg('Please select at least one Business Group / Environment.');
      setStatus('error');
      return;
    }
    setStatus('running');
    setErrorMsg('');

    let allApps = [];

    if (usePreselected && passedApps?.length > 0) {
      // Use the pre-selected apps directly
      allApps = passedApps.map(a => ({ ...a, _bgName: a.environment?.name || bgName }));
    } else {
      // Collect all apps from selected BG/env combinations
      for (const sel of bgEnvSelections) {
        try {
          const res = await api.get(`/applications/summary/${sel.bgId}`);
          const appsForBg = res.data.data || [];
          const filtered = sel.envId ? appsForBg.filter(a => a.environment?.id === sel.envId) : appsForBg;
          filtered.forEach(a => {
            if (!allApps.find(x => x.id === a.id && x.environment?.id === a.environment?.id)) {
              allApps.push({ ...a, _bgId: sel.bgId, _bgName: sel.bgName, _envName: sel.envName });
            }
          });
        } catch { /* skip */ }
      }
    }

    // ── Group apps by environment — one Excel file per environment ────────
    const appsByEnv = new Map();
    for (const a of allApps) {
      const envKey = a._envName || a.environment?.name || 'Unknown';
      if (!appsByEnv.has(envKey)) appsByEnv.set(envKey, { apps: [], bgName: a._bgName || bgName });
      appsByEnv.get(envKey).apps.push(a);
    }

    const envEntries = [...appsByEnv.entries()]; // [{envName, {apps, bgName}}]
    const totalAll = allApps.length;
    let totalProcessed = 0;

    try {
      for (let ei = 0; ei < envEntries.length; ei++) {
        const [envLabel, { apps: envApps, bgName: envBgName }] = envEntries[ei];
        await exportCpsProperties({
          apps: envApps,
          bgOrgId,
          bgName: envBgName,
          envName: envLabel,
          cpsBaseUrl: cpsBaseUrl.trim(),
          cpsEnvOverride: cpsEnv.trim(),
          onProgress: (current, _total, label) => {
            setProgress({ current: totalProcessed + current, total: totalAll, label });
          },
          getCredential: hasCpsCreds ? getSecret : null,
          getAllCredentials: hasCpsCreds ? getAllCredentials : null,
        });
        totalProcessed += envApps.length;
        // Brief pause between file downloads so browser doesn't block subsequent ones
        if (ei < envEntries.length - 1) await new Promise(r => setTimeout(r, 200));
      }
      setStatus('done');
    } catch (e) {
      setErrorMsg(e.message || 'Export failed');
      setStatus('error');
    }
  };

  const progressPct = progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;
  const canExport = usePreselected ? passedApps?.length > 0 : bgEnvSelections.length > 0;

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
              <p className="text-gray-500 text-xs mt-0.5">
                {usePreselected
                  ? `Exporting ${passedApps.length} selected app${passedApps.length !== 1 ? 's' : ''}`
                  : 'Select Business Groups and Environments to export'}
              </p>
            </div>
          </div>
          <button onClick={onClose} disabled={status === 'running'} className="text-gray-600 hover:text-gray-300 p-1 disabled:opacity-30">
            <X size={18} />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">

          {/* Pre-selected apps banner + toggle */}
          {(status === 'idle' || status === 'error') && hasPreselected && (
            <div className="flex items-center justify-between gap-3 bg-blue-950/30 border border-blue-800/40 rounded-xl px-4 py-3">
              <div className="flex items-center gap-2">
                <Zap size={13} className="text-blue-400 flex-shrink-0" />
                <span className="text-blue-300 text-xs font-medium">
                  {passedApps.length} app{passedApps.length !== 1 ? 's' : ''} pre-selected from Applications page
                </span>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  onClick={() => setUsePreselected(!usePreselected)}
                  className={'text-[10px] px-2.5 py-1 rounded-lg border font-medium transition-colors ' + (usePreselected ? 'bg-blue-600/30 border-blue-600/50 text-blue-300' : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-gray-200')}>
                  {usePreselected ? '✓ Use Selected Apps' : 'Use BG/Env Selector'}
                </button>
              </div>
            </div>
          )}

          {/* BG + Env selector (only when not using preselected) */}
          {(status === 'idle' || status === 'error') && !usePreselected && (
            <div className="space-y-2">
              <p className="text-gray-400 text-xs font-semibold uppercase tracking-wider flex items-center gap-1.5">
                <Layers size={11} /> Business Groups & Environments
              </p>
              <BgEnvSelector selectedBgId={bgOrgId} selectedEnvId={selectedEnvId} onSelectionsChange={setBgEnvSelections} />
              {bgEnvSelections.length > 0 && (
                <p className="text-blue-400 text-[10px]">
                  {bgEnvSelections.length} environment{bgEnvSelections.length !== 1 ? 's' : ''} selected across {[...new Set(bgEnvSelections.map(s => s.bgId))].length} BG{[...new Set(bgEnvSelections.map(s => s.bgId))].length !== 1 ? 's' : ''}
                </p>
              )}
            </div>
          )}

          {/* CPS Server Config */}
          {(status === 'idle' || status === 'error') && (
            <div className="space-y-3 bg-gray-800/30 border border-gray-700/40 rounded-xl p-4">
              <div className="flex items-center justify-between">
                <p className="text-gray-400 text-xs font-semibold uppercase tracking-wider flex items-center gap-1.5">
                  <Globe size={11} /> CPS Server Configuration
                </p>
                <div className="flex items-center gap-2">
                  {autoDetecting && <span className="flex items-center gap-1 text-[10px] text-blue-400"><RefreshCw size={9} className="animate-spin" /> Detecting…</span>}
                  {autoDetected && !autoDetecting && <span className="flex items-center gap-1 text-[10px] text-emerald-400"><Zap size={9} /> Auto-detected</span>}
                  {hasCpsCreds && <span className="flex items-center gap-1 text-[10px] text-emerald-400/70"><Key size={9} /> CSV creds loaded</span>}
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2">
                  <label className="block text-[10px] text-gray-500 uppercase tracking-wider mb-1">CPS Base URL <span className="normal-case text-gray-600">(optional — auto-detected per app)</span></label>
                  <input value={cpsBaseUrl} onChange={e => { setCpsBaseUrl(e.target.value); setAutoDetected(false); }}
                    placeholder="Auto-detected from app properties…"
                    className="w-full bg-gray-900/80 border border-gray-700/60 rounded-lg px-3 py-2 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-600/50 font-mono" />
                </div>
                <div>
                  <label className="block text-[10px] text-gray-500 uppercase tracking-wider mb-1">CPS Env Override <span className="normal-case text-gray-600">(optional)</span></label>
                  <input value={cpsEnv} onChange={e => setCpsEnv(e.target.value)}
                    placeholder="prod / uat (auto per app)"
                    className="w-full bg-gray-900/80 border border-gray-700/60 rounded-lg px-3 py-2 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-600/50 font-mono" />
                </div>
              </div>
              {!cpsBaseUrl && !autoDetecting && (
                <p className="text-[10px] text-yellow-600/80">
                  ⚠ No CPS URL set — each app will use its own <code>cps.configServerBaseUrl</code> from deployment properties.
                </p>
              )}
            </div>
          )}

          {/* Output format */}
          {status === 'idle' && (
            <div className="space-y-1.5">
              <p className="text-gray-500 text-[10px] uppercase tracking-wider font-medium">Output: Excel (.xlsx) — 4 sheets</p>
              {['AllPropertiesCatalog', 'Host_APIUsersCatalog', 'ScheduleCatalog', 'StaticIPsCatalog'].map(s => (
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
                  {status === 'done' ? 'Export complete!' : `Fetching ${progress.current}/${progress.total} apps in parallel…`}
                </span>
                <span className={'font-medium ' + (status === 'done' ? 'text-emerald-400' : 'text-blue-400')}>{progressPct}%</span>
              </div>
              <div className="w-full bg-gray-800 rounded-full h-2">
                <div className={'h-2 rounded-full transition-all duration-300 ' + (status === 'done' ? 'bg-emerald-500' : 'bg-blue-500')} style={{ width: `${progressPct}%` }} />
              </div>
              {progress.label && status === 'running' && (
                <p className="text-gray-500 text-[10px] font-mono truncate">⚡ {progress.label}</p>
              )}
              {status === 'done' && (
                <div className="flex items-center gap-2 text-emerald-400 text-sm"><CheckCircle size={16} /> File downloaded successfully!</div>
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
            {usePreselected
              ? `${passedApps?.length || 0} app${(passedApps?.length || 0) !== 1 ? 's' : ''} selected`
              : bgEnvSelections.length > 0 ? `${bgEnvSelections.length} env${bgEnvSelections.length !== 1 ? 's' : ''} selected` : 'No selection'}
          </p>
          <div className="flex gap-3">
            <button onClick={onClose} disabled={status === 'running'}
              className="px-4 py-2 text-sm text-gray-400 hover:text-white bg-gray-800 hover:bg-gray-700 rounded-lg transition-colors disabled:opacity-50">
              {status === 'done' ? 'Close' : 'Cancel'}
            </button>
            {status !== 'done' && (
              <button onClick={handleExport} disabled={status === 'running' || !canExport}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg disabled:opacity-50 transition-colors">
                {status === 'running'
                  ? <><RefreshCw size={13} className="animate-spin" /> Exporting…</>
                  : status === 'error' ? <><RefreshCw size={13} /> Retry</> : <><Download size={13} /> Export to Excel</>}
              </button>
            )}
            {status === 'done' && (
              <button onClick={handleExport} className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors">
                <Download size={13} /> Download Again
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
