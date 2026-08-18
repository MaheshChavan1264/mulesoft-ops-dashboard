import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { useCpsCredentialStore } from '../context/CpsCredentialStoreContext';
import { applyBgFilter } from '../components/BgFilterModal';
import { applyEnvFilter } from '../components/EnvFilterModal';
import { Search, Users, RefreshCw, AlertTriangle, Copy, Check, Key, Lock, ChevronRight, Building2, Download } from 'lucide-react';
import api from '../services/api';
import { getCached, setCached } from '../services/apiCache';

const CopyBtn = ({ text }) => {
  const [done, setDone] = useState(false);
  return (
    <button onClick={() => { navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500); }}
      className="opacity-0 group-hover:opacity-100 p-1 rounded text-slate-500 hover:text-slate-300 transition-all flex-shrink-0">
      {done ? <Check size={10} className="text-emerald-400" /> : <Copy size={10} />}
    </button>
  );
};

function chLabel(dt) {
  if (!dt) return 'CloudHub 1.0';
  const d = dt.toLowerCase();
  return (d.includes('2') || d === 'ch2') ? 'CloudHub 2.0' : 'CloudHub 1.0';
}

function extractCpsConfig(app, orgId) {
  const ds = app.target?.deploymentSettings || {};
  const ps = (app.application?.configuration || {})['mule.agent.application.properties.service'] || {};
  const p = { ...(ps.properties || {}), ...(ds.properties || {}), ...(ds.environmentVariables || ds.environmentVars || {}), ...(app.properties || {}) };
  return {
    cpsBaseUrl: p['cps.configServerBaseUrl'] || p['config.server.base.url'] || '',
    cpsKey: p['cps.projectName'] || p['cloudhub.api.name'] || app.name || '',
    cpsEnv: p['cps.prefix'] || p['cps.environment'] || '',
    cpsClientId: p['cps.clientId'] || p['cps.client_id'] || p['cps.client.id'] || p['cps.apiClientId'] || '',
    deploymentType: app._type === 'ch1' ? 'ch1' : 'ch2',
    envName: app.environment?.name || '',
    bgOrgId: orgId,
  };
}

function BgEnvSelector({ businessGroups, onSelectionsChange }) {
  const [envsByBg, setEnvsByBg] = useState({});
  const [loadingEnvs, setLoadingEnvs] = useState({});
  const [expandedBgs, setExpandedBgs] = useState(new Set());
  const [selections, setSelections] = useState(new Set());
  const [envSearch, setEnvSearch] = useState('');

  const loadEnvs = useCallback(async (bgId) => {
    if (envsByBg[bgId]) return;
    setLoadingEnvs(p => ({ ...p, [bgId]: true }));
    try {
      const r = await api.get(`/environments/${bgId}`);
      const envs = r.data?.data || r.data?.environments || r.data || [];
      setEnvsByBg(p => ({ ...p, [bgId]: Array.isArray(envs) ? envs : [] }));
    } catch { setEnvsByBg(p => ({ ...p, [bgId]: [] })); }
    setLoadingEnvs(p => ({ ...p, [bgId]: false }));
  }, [envsByBg]);

  const isBgSel = (bgId) => [...selections].some(s => s.startsWith(bgId + ':'));
  const isEnvSel = (bgId, envId) => selections.has(bgId + ':' + envId);

  const toggleEnv = (bgId, envId) => {
    setSelections(prev => {
      const n = new Set(prev);
      const k = bgId + ':' + envId;
      n.has(k) ? n.delete(k) : n.add(k);
      return n;
    });
  };

  const toggleBg = (bgId) => {
    const envs = envsByBg[bgId] || [];
    setSelections(prev => {
      const n = new Set(prev);
      if (isBgSel(bgId)) { [...n].filter(s => s.startsWith(bgId + ':')).forEach(s => n.delete(s)); }
      else { envs.forEach(e => n.add(bgId + ':' + e.id)); }
      return n;
    });
  };

  useEffect(() => {
    const result = [];
    selections.forEach(sel => {
      const [bgId, envId] = sel.split(':');
      const bg = businessGroups.find(g => g.id === bgId);
      if (!bg) return;
      const env = (envsByBg[bgId] || []).find(e => e.id === envId);
      if (env) result.push({ bgId, bgName: bg.name, envId, envName: env.name, envType: env.type });
    });
    onSelectionsChange(result);
  }, [selections, businessGroups, envsByBg]); // eslint-disable-line react-hooks/exhaustive-deps

  const visible = applyBgFilter(businessGroups);
  const ordered = [visible.find(g => !g.parentId), ...visible.filter(g => g.parentId)].filter(Boolean);

  // When a search term is active, auto-expand all BGs and filter envs
  const searchLo = envSearch.toLowerCase().trim();
  const getFilteredEnvs = (bgId) => {
    const envs = applyEnvFilter(envsByBg[bgId] || []); // apply global env filter
    if (!searchLo) return envs;
    return envs.filter(e => e.name.toLowerCase().includes(searchLo) || e.type?.toLowerCase().includes(searchLo));
  };
  // Auto-load envs for all BGs when search is active
  useEffect(() => {
    if (!searchLo) return;
    visible.forEach(bg => { if (!envsByBg[bg.id]) loadEnvs(bg.id); });
  }, [searchLo]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="border border-slate-700/50 rounded-xl overflow-hidden">
      {/* Search bar */}
      <div className="relative border-b border-slate-700/50">
        <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
        <input
          value={envSearch}
          onChange={e => setEnvSearch(e.target.value)}
          placeholder="Search environments…"
          className="w-full bg-slate-800/40 pl-8 pr-3 py-2 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:bg-slate-800/60"
        />
        {envSearch && (
          <button onClick={() => setEnvSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 text-xs">✕</button>
        )}
      </div>
      <div style={{ maxHeight: '11rem', overflowY: 'auto' }}>
      {ordered.map(bg => {
        const expanded = expandedBgs.has(bg.id) || !!searchLo;
        const checked = isBgSel(bg.id);
        const envs = getFilteredEnvs(bg.id);
        // Hide BG entirely if search active and no matching envs
        if (searchLo && envs.length === 0 && !loadingEnvs[bg.id]) return null;
        return (
          <div key={bg.id} className="border-b border-slate-800/40 last:border-0">
            <div className="flex items-center gap-2 px-3 py-2.5 hover:bg-slate-800/30 transition-colors">
              <div onClick={() => { loadEnvs(bg.id); toggleBg(bg.id); }}
                className={`w-4 h-4 rounded border flex items-center justify-center cursor-pointer flex-shrink-0 transition-colors ${checked ? 'bg-cyan-600 border-cyan-500' : 'border-slate-600 hover:border-cyan-500'}`}>
                {checked && <span className="text-white text-[10px] font-bold">✓</span>}
              </div>
              <Building2 size={12} className={checked ? 'text-cyan-400' : 'text-slate-600'} />
              <span className={`text-xs font-medium flex-1 ${checked ? 'text-white' : 'text-slate-400'}`}>{bg.name}</span>
              {!bg.parentId && <span className="text-[9px] bg-blue-500/20 text-blue-400 border border-blue-500/30 px-1.5 py-0.5 rounded-full">ROOT</span>}
              <button onClick={() => { setExpandedBgs(p => { const n = new Set(p); n.has(bg.id) ? n.delete(bg.id) : n.add(bg.id); return n; }); loadEnvs(bg.id); }}
                className="text-slate-600 hover:text-slate-300 p-0.5 rounded">
                <ChevronRight size={12} className={`transition-transform ${expanded ? 'rotate-90' : ''}`} />
              </button>
            </div>
            {expanded && (
              <div className="bg-slate-900/40">
                {loadingEnvs[bg.id] ? (
                  <div className="flex items-center gap-2 px-8 py-2 text-slate-600 text-xs"><RefreshCw size={10} className="animate-spin" /> Loading…</div>
                ) : envs.length === 0 ? (
                  <div className="px-8 py-2 text-slate-700 text-xs">No environments</div>
                ) : envs.map(env => {
                  const ec = isEnvSel(bg.id, env.id);
                  const isProd = env.type === 'production';
                  return (
                    <div key={env.id} onClick={() => toggleEnv(bg.id, env.id)}
                      className="flex items-center gap-2 px-8 py-2 hover:bg-slate-800/20 cursor-pointer transition-colors">
                      <div className={`w-3.5 h-3.5 rounded border flex items-center justify-center flex-shrink-0 transition-colors ${ec ? 'bg-cyan-600 border-cyan-500' : 'border-slate-600 hover:border-cyan-500'}`}>
                        {ec && <span className="text-white text-[9px] font-bold">✓</span>}
                      </div>
                      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${isProd ? 'bg-green-400' : 'bg-yellow-400'}`} />
                      <span className={`text-xs flex-1 ${ec ? 'text-slate-200' : 'text-slate-500'}`}>{env.name}</span>
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

export default function UserSearchPage() {
  const { orgId: authOrgId } = useAuth();
  const { getAllCredentials, hasCredentials: hasCpsCreds, getSecret } = useCpsCredentialStore();
  const [bgs, setBgs] = useState([]);
  const [bgsLoad, setBgsLoad] = useState(false);
  const [bgEnvSelections, setBgEnvSelections] = useState([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState(null);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState({ envsDone: 0, envsTotal: 0, appsT: 0, appsN: 0 });

  useEffect(() => {
    setBgsLoad(true);
    api.get('/organizations/business-groups').then(r => setBgs(r.data?.data || [])).catch(() => {}).finally(() => setBgsLoad(false));
  }, []);

  // Fire-and-forget credential posting — no await, runs in background
  const postCreds = useCallback((entries) => {
    if (!hasCpsCreds) return;
    const allCreds = getAllCredentials();
    if (!allCreds.length) return;
    const urlMap = new Map();
    for (const e of entries) {
      if (!e.cpsBaseUrl) continue;
      const norm = e.cpsBaseUrl.trim().replace(/\/+$/, '').replace(/\/api\/v2\/?$/, '');
      if (urlMap.has(norm)) continue;
      if (e.cpsClientId) { const s = getSecret(e.cpsClientId); if (s) { urlMap.set(norm, { clientId: e.cpsClientId, clientSecret: s }); continue; } }
      if (allCreds.length) urlMap.set(norm, allCreds[0]);
    }
    // Fire without await — credentials are stored in session for the backend,
    // the CPS search itself handles 401-retry, so no need to block on this
    for (const [norm, { clientId, clientSecret }] of urlMap.entries()) {
      api.post('/cps/credentials', { credentials: {
        [norm + '::' + (entries[0]?.bgOrgId || '')]: { clientId, clientSecret },
        [norm]: { clientId, clientSecret },
      }}).catch(() => {});
    }
  }, [hasCpsCreds, getAllCredentials, getSecret]);

  const fetchAppsForEnv = useCallback(async (bgId, envId, envName) => {
    const apps = [];
    const DETAIL_BATCH = 50; // increased from 15 — fetch 50 CH2 details in parallel
    let ch2List = [];

    // ── Try app summary cache first (already loaded by ApplicationsPage) ──
    const cacheKey = `apps:__all__:${bgId}`;
    const cachedSummary = getCached(cacheKey);
    // ── CH2: use summary cache for list (avoids fresh list fetch) ─────────
    if (cachedSummary?.apps) {
      ch2List = cachedSummary.apps.filter(
        a => a.environment?.id === envId && a.deploymentType === 'CloudHub 2.0'
      );
      // Note: CH1 from summary has NO runtime properties → always fetch fresh below
    } else {
      // Fresh CH2 list fetch (paginated)
      try {
        let offset = 0;
        while (true) {
          const r = await api.get(`/applications/cloudhub2/${bgId}/${envId}`, { params: { limit: 100, offset } });
          const items = r.data?.items || r.data?.deployments || r.data?.content || (Array.isArray(r.data) ? r.data : []);
          if (!items.length) break;
          ch2List.push(...items);
          const total = r.data?.total ?? r.data?.totalItems ?? items.length;
          if (ch2List.length >= total || items.length < 100) break;
          offset += 100;
        }
      } catch {}
    }

    // ── CH2: detail fetch with per-app caching + large parallel batch ─────
    // CH2 list API does NOT return runtime properties — must fetch each app detail.
    // Per-app cache avoids re-fetching on repeat searches (5-min TTL).
    for (let i = 0; i < ch2List.length; i += DETAIL_BATCH) {
      const settled = await Promise.allSettled(
        ch2List.slice(i, i + DETAIL_BATCH).map(a => {
          const appKey = `ch2detail:${a.id}:${envId}`;
          const cached = getCached(appKey);
          if (cached) return Promise.resolve(cached);
          return api.get(`/applications/cloudhub2/${bgId}/${envId}/${a.id}`)
            .then(r => { setCached(appKey, r.data); return r.data; })
            .catch(() => a);
        })
      );
      settled.forEach(s => { if (s.status === 'fulfilled' && s.value) apps.push(s.value); });
    }

    // ── CH1: always fetch fresh list (1 call returns ALL apps with properties)
    // CH1 list API returns the full properties map directly — no per-app detail needed.
    // Cache the list per env (5-min TTL) to speed up repeat searches.
    try {
      const ch1Key = `ch1list:${bgId}:${envId}`;
      let ch1Data = getCached(ch1Key);
      if (!ch1Data) {
        const r = await api.get(`/applications/cloudhub1/${envId}`, { params: { orgId: bgId } });
        ch1Data = Array.isArray(r.data) ? r.data : (r.data?.applications || r.data?.data || []);
        setCached(ch1Key, ch1Data);
      }
      apps.push(...ch1Data.map(c => ({
        _type: 'ch1', id: c.domain, name: c.domain,
        properties: c.properties || {}, // full properties from CH1 list API
        environment: { name: envName, id: envId },
      })));
    } catch {}

    return apps;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const runSearch = async () => {
    if (!query.trim()) { setError('Enter a search term.'); return; }
    if (!bgEnvSelections.length) { setError('Select at least one Environment.'); return; }
    setLoading(true); setError(''); setResults(null);
    setProgress({ envsDone: 0, envsTotal: bgEnvSelections.length, appsT: 0, appsN: 0 });

    // ── Phase 1: Fetch all envs in PARALLEL (was sequential) ──────────────
    const envResults = await Promise.allSettled(
      bgEnvSelections.map(async (sel) => {
        const apps = await fetchAppsForEnv(sel.bgId, sel.envId, sel.envName);
        const entries = apps
          .map(a => ({ appName: a.name, appId: a.id || a.name, ...extractCpsConfig(a, sel.bgId) }))
          .filter(e => e.cpsBaseUrl && e.cpsKey);
        // Fire-and-forget credentials (no await)
        if (entries.length) postCreds(entries);
        // Atomic progress increment
        setProgress(p => ({
          ...p,
          appsT: p.appsT + apps.length,
          envsDone: p.envsDone + 1,
        }));
        return entries;
      })
    );

    // ── Phase 2: Flatten + deduplicate entries ─────────────────────────────
    const seen = new Set();
    const allEntries = envResults
      .flatMap(r => r.status === 'fulfilled' ? r.value : [])
      .filter(e => {
        // Deduplicate by cpsUrl + cpsKey + cpsEnv + bgOrgId
        const k = `${e.cpsBaseUrl}||${e.cpsKey}||${e.cpsEnv}||${e.bgOrgId}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });

    setProgress(p => ({ ...p, appsN: allEntries.length }));

    if (!allEntries.length) { setResults([]); setLoading(false); return; }

    // ── Phase 3: Backend CPS fan-out search ───────────────────────────────
    try {
      const r = await api.post('/cps/search-user', { username: query.trim(), apps: allEntries });
      const rows = [];
      for (const item of r.data?.results || []) {
        for (const prop of item.matchedProps || []) {
          rows.push({
            chEnv: item.envName || '—',
            chVersion: chLabel(item.deploymentType),
            appName: item.appName,
            nsKey: item.cpsKey || '—',
            cpsPrefix: item.cpsPrefix || '—',
            secureKey: prop.secureGroupKey || (prop.source === 'secure' ? '(secure)' : ''),
            propKey: prop.key,
            apiUser: prop.value,
            password: prop.password || '—',
            source: prop.source,
          });
        }
      }
      setResults(rows);
    } catch (e) { setError(e.response?.data?.error || e.message || 'Search failed'); }
    setLoading(false);
  };

  const exportCsv = () => {
    if (!results || !results.length) return;
    const H = ['Cloudhub Environment', 'Cloudhub Version', 'Integration Name', 'Non-Secure Key', 'CPS Prefix', 'Secure Key', 'Found In Property Key', 'API User', 'Password'];
    const rows = results.map(r => [r.chEnv, r.chVersion, r.appName, r.nsKey, r.cpsPrefix, r.secureKey, r.propKey, r.apiUser, r.password]);
    const csv = [H, ...rows].map(row => row.map(v => '"' + String(v ?? '').replace(/"/g, '""') + '"').join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'global-search-' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const selCount = bgEnvSelections.length;
  const COL_HEADERS = ['Cloudhub Environment', 'Cloudhub Version', 'Integration Name', 'Non-Secure Key', 'CPS Prefix', 'Secure Key', 'Found In Property Key', 'API User', 'Password'];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-white flex items-center gap-2"><Users size={20} className="text-cyan-400" /> Global Search</h1>
        <p className="text-slate-500 text-sm mt-1">Search for a username across all app CPS non-secure & secure properties</p>
      </div>

      <div className="bg-slate-900/50 border border-slate-800/60 rounded-2xl px-5 py-4 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-[10px] text-slate-500 uppercase tracking-wider font-bold">Business Groups & Environments</p>
          {selCount > 0 && (
            <span className="text-[10px] text-cyan-400 font-medium">
              {selCount} env{selCount !== 1 ? 's' : ''} across {new Set(bgEnvSelections.map(s => s.bgId)).size} BG{new Set(bgEnvSelections.map(s => s.bgId)).size !== 1 ? 's' : ''} selected
            </span>
          )}
        </div>
        {bgsLoad
          ? <div className="flex items-center gap-2 text-slate-500 text-xs py-2"><RefreshCw size={13} className="animate-spin" /> Loading…</div>
          : <BgEnvSelector businessGroups={bgs} onSelectionsChange={setBgEnvSelections} />
        }
        {selCount > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {bgEnvSelections.map(s => (
              <span key={s.bgId + ':' + s.envId}
                className={'text-[10px] px-2 py-0.5 rounded-full border font-medium ' + (s.envType === 'production' ? 'bg-green-950/40 text-green-400 border-green-800/50' : 'bg-yellow-950/40 text-yellow-400 border-yellow-800/50')}>
                {s.bgName} / {s.envName}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="flex gap-3 items-center">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
          <input value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => e.key === 'Enter' && !loading && runSearch()}
            placeholder="Enter username or email to search in CPS properties…"
            className="w-full bg-slate-900/60 border border-slate-800/80 rounded-xl pl-10 pr-4 py-3 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-cyan-600/50 focus:bg-slate-900" />
        </div>
        <button onClick={runSearch} disabled={loading || !query.trim() || !selCount}
          className="flex items-center gap-2 px-5 py-3 bg-cyan-700 hover:bg-cyan-600 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-xl transition-colors flex-shrink-0">
          {loading ? <><RefreshCw size={14} className="animate-spin" /> Searching…</> : <><Search size={14} /> Search</>}
        </button>
      </div>

      {!hasCpsCreds && (
        <div className="flex items-center gap-3 bg-yellow-950/20 border border-yellow-800/40 rounded-xl px-4 py-3 text-yellow-400/80 text-xs">
          <AlertTriangle size={13} className="flex-shrink-0" />
          No CPS credentials imported — use the <strong className="text-yellow-300">CPS CSV import</strong> in the header to also search secure properties.
        </div>
      )}

      {loading && (
        <div className="bg-slate-900/50 border border-slate-800/60 rounded-2xl px-5 py-8 flex flex-col items-center gap-4">
          <RefreshCw size={24} className="animate-spin text-cyan-400" />
          <p className="text-slate-300 text-sm font-medium">Scanning CPS properties…</p>
          <div className="flex items-center gap-4 text-xs text-slate-500">
            <span>{progress.envsDone}/{progress.envsTotal} envs scanned</span>
            <span>{progress.appsT} apps found</span>
            {progress.appsN > 0 && <span>{progress.appsN} with CPS config</span>}
          </div>
          <div className="w-full max-w-xs">
            <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
              <div className="h-full bg-cyan-600 rounded-full animate-pulse w-full" />
            </div>
          </div>
        </div>
      )}

      {error && !loading && (
        <div className="flex items-start gap-3 bg-red-950/30 border border-red-800/50 rounded-xl px-4 py-3 text-red-400 text-sm">
          <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" /><span>{error}</span>
        </div>
      )}

      {results !== null && !loading && (
        <div className="space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-white text-sm font-semibold flex items-center gap-2">
                <Users size={14} className="text-cyan-400" />
                Results for <span className="text-cyan-300 font-mono bg-cyan-950/30 px-1.5 py-0.5 rounded text-xs">{query.trim()}</span>
              </span>
              <span className={'text-xs px-2.5 py-1 rounded-full font-bold border ' + (results.length > 0 ? 'bg-emerald-950/50 text-emerald-300 border-emerald-700/50' : 'bg-slate-800/60 text-slate-500 border-slate-700/40')}>
                {results.length} match{results.length !== 1 ? 'es' : ''}
              </span>
            </div>
            {results.length > 0 && (
              <button onClick={exportCsv}
                className="flex items-center gap-2 px-4 py-2 text-sm text-emerald-400 hover:text-emerald-300 bg-emerald-950/40 border border-emerald-800/40 rounded-xl transition-colors font-medium">
                <Download size={13} /> Export CSV
              </button>
            )}
          </div>

          {results.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 gap-3 bg-slate-900/40 border border-slate-800/60 rounded-2xl">
              <Users size={32} className="text-slate-700" />
              <p className="text-slate-500 text-sm">No apps found with <span className="font-mono text-slate-400">"{query.trim()}"</span> in CPS properties</p>
            </div>
          ) : (
            <div className="bg-slate-900/50 border border-slate-800/60 rounded-2xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="bg-slate-800/60 border-b border-slate-700/40">
                      {COL_HEADERS.map(h => (
                        <th key={h} className="px-3 py-3 text-left text-[10px] font-bold tracking-wider text-slate-500 uppercase whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {results.map((row, i) => (
                      <tr key={i} className="group border-b border-slate-800/40 hover:bg-slate-800/30 transition-colors last:border-0">
                        <td className="px-3 py-3 text-xs text-slate-300 whitespace-nowrap">{row.chEnv}</td>
                        <td className="px-3 py-3 whitespace-nowrap">
                          <span className={'text-[10px] px-2 py-0.5 rounded font-bold border ' + (row.chVersion === 'CloudHub 2.0' ? 'bg-blue-950/40 text-blue-300 border-blue-700/40' : 'bg-purple-950/40 text-purple-300 border-purple-700/40')}>
                            {row.chVersion}
                          </span>
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex items-center gap-1 group/cell">
                            <span className="text-xs font-mono text-white font-medium">{row.appName}</span>
                            <CopyBtn text={row.appName} />
                          </div>
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex items-center gap-1 group/cell">
                            <span className="text-xs font-mono text-slate-400">{row.nsKey}</span>
                            <CopyBtn text={row.nsKey} />
                          </div>
                        </td>
                        <td className="px-3 py-3 text-xs font-mono text-slate-400">{row.cpsPrefix}</td>
                        <td className="px-3 py-3">
                          {row.secureKey ? (
                            <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border bg-orange-950/40 text-orange-300 border-orange-700/40 font-mono">
                              <Lock size={8} /> {row.secureKey}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border bg-slate-800/60 text-slate-500 border-slate-700/40">
                              <Key size={8} /> non-secure
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex items-center gap-1 group/cell">
                            <span className="text-xs font-mono text-cyan-300">{row.propKey}</span>
                            <CopyBtn text={row.propKey} />
                          </div>
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex items-center gap-1 group/cell">
                            <span className="text-xs font-mono text-emerald-300 break-all">{row.apiUser}</span>
                            <CopyBtn text={row.apiUser} />
                          </div>
                        </td>
                        <td className="px-3 py-3 text-xs font-mono text-slate-500">{row.password}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
