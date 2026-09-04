import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { useCpsCredentialStore } from '../context/CpsCredentialStoreContext';
import { applyBgFilter } from '../components/BgFilterModal';
import { applyEnvFilter } from '../components/EnvFilterModal';
import { Search, Users, RefreshCw, AlertTriangle, Copy, Check, Key, Lock, ChevronRight, ChevronDown, Building2, Download, X, SlidersHorizontal, ArrowUpDown } from 'lucide-react';
import api from '../services/api';
import { getCached, getCachedSWR, setCached } from '../services/apiCache';
import { CK } from '../services/cacheKeys';

const CopyBtn = ({ text }) => {
  const [done, setDone] = useState(false);
  return (
    <button onClick={() => { navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500); }}
      className="opacity-0 group-hover:opacity-100 p-1 rounded text-slate-500 hover:text-slate-300 transition-all flex-shrink-0">
      {done ? <Check size={10} className="text-emerald-400" /> : <Copy size={10} />}
    </button>
  );
};

// Feature 1: Highlight matched search term inside a string
function Highlight({ text, terms }) {
  if (!text || !terms?.length) return <span>{text}</span>;
  const pattern = new RegExp(`(${terms.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
  const parts = String(text).split(pattern);
  return (
    <span>
      {parts.map((part, i) =>
        pattern.test(part)
          ? <mark key={i} className="bg-yellow-400/30 text-yellow-200 rounded-sm px-0.5 not-italic">{part}</mark>
          : part
      )}
    </span>
  );
}

function chLabel(dt) {
  if (!dt) return 'CloudHub 1.0';
  const d = dt.toLowerCase();
  return (d.includes('2') || d === 'ch2') ? 'CloudHub 2.0' : 'CloudHub 1.0';
}

// Extract the full merged property map from a CH2 detail or CH1 app object
function mergeAppProps(app) {
  const ds = app.target?.deploymentSettings || {};
  const appCfg = app.application?.configuration || {};
  const ps = appCfg['mule.agent.application.properties.service'] || {};
  return {
    ...(ps.properties || {}),
    ...(ds.runtimeProperties || {}),
    ...(ds.properties || {}),
    ...(ds.environmentVariables || ds.environmentVars || {}),
    ...(appCfg.properties || {}),
    ...(app.application?.properties || {}),
    ...(app.properties || {}),
  };
}

function extractCpsConfig(app, orgId) {
  // Merge all possible property sources from both CH1 and CH2 detail responses
  const p = mergeAppProps(app);

  // ── CPS Base URL — try all known key variants ─────────────────────────
  let cpsBaseUrl =
    p['cps.configServerBaseUrl'] ||
    p['config.server.base.url']  ||
    p['cps.baseUrl']             ||
    p['cps.base.url']            ||
    p['cps.server.url']          ||
    p['cps.url']                 ||
    p['anypoint.config.server.baseUrl'] ||
    p['config.server.url']       ||
    p['configserver.url']        ||
    p['cloudconfig.url']         ||
    '';

  // ── Fallback: scan all property values for a CPS-like URL ────────────
  // Matches any http(s) URL whose key or value suggests a CPS/config server
  if (!cpsBaseUrl) {
    const CPS_KEY_HINT = /cps|config[.\-_]?server|configserver|cloud[.\-_]?config/i;
    for (const [key, val] of Object.entries(p)) {
      if (typeof val === 'string' && /^https?:\/\//i.test(val) && CPS_KEY_HINT.test(key)) {
        cpsBaseUrl = val;
        break;
      }
    }
  }

  // ── CPS Project Key ───────────────────────────────────────────────────
  const cpsKey =
    p['cps.projectName']    ||
    p['cloudhub.api.name']  ||
    p['cps.appName']        ||
    p['cps.app.name']       ||
    p['api.name']           ||
    app.name                ||
    '';

  // ── CPS Environment Prefix ────────────────────────────────────────────
  const cpsEnv =
    p['cps.prefix']       ||
    p['cps.environment']  ||
    p['cps.env']          ||
    p['environment']      ||
    p['deployment.env']   ||
    '';

  // ── CPS Client ID ─────────────────────────────────────────────────────
  const cpsClientId =
    p['cps.clientId']    ||
    p['cps.client_id']   ||
    p['cps.client.id']   ||
    p['cps.apiClientId'] ||
    p['cps.api.clientId'] ||
    '';

  return {
    cpsBaseUrl,
    cpsKey,
    cpsEnv,
    cpsClientId,
    deploymentType: app._type === 'ch1' ? 'ch1' : 'ch2',
    envName: app.environment?.name || '',
    bgOrgId: orgId,
  };
}

// Grouped BG+Env selector with quick-select shortcuts
function BgEnvSelector({ businessGroups, onSelectionsChange }) {
  const [allEnvs, setAllEnvs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selections, setSelections] = useState(new Set()); // "bgId:envId"
  const [search, setSearch] = useState('');
  const [envFilterVersion, setEnvFilterVersion] = useState(0);
  const [bgFilterVersion, setBgFilterVersion] = useState(0);
  useEffect(() => {
    const h = () => setEnvFilterVersion(v => v + 1);
    window.addEventListener('envFilterChanged', h);
    return () => window.removeEventListener('envFilterChanged', h);
  }, []);
  useEffect(() => {
    const h = () => setBgFilterVersion(v => v + 1);
    window.addEventListener('bgFilterChanged', h);
    return () => window.removeEventListener('bgFilterChanged', h);
  }, []);

  useEffect(() => {
    const visible = applyBgFilter(businessGroups);
    if (!visible.length) { setLoading(false); return; }
    setLoading(true);
    Promise.allSettled(
      visible.map(bg =>
        api.get(`/environments/${bg.id}`)
          .then(r => {
            const envList = r.data?.data || r.data?.environments || (Array.isArray(r.data) ? r.data : []);
            return envList.map(e => ({
              id: e.id,
              bgId: bg.id, bgName: bg.name,
              envId: e.id, envName: e.name, envType: e.type,
            }));
          })
          .catch(() => [])
      )
    ).then(results => {
      const flat = results.flatMap(r => r.status === 'fulfilled' ? r.value : []);
      const envFiltered = applyEnvFilter(flat);
      setAllEnvs(envFiltered.length > 0 ? envFiltered : flat);
      setLoading(false);
    });
  }, [businessGroups, envFilterVersion, bgFilterVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const sel = allEnvs.filter(e => selections.has(`${e.bgId}:${e.envId}`));
    onSelectionsChange(sel);
  }, [selections, allEnvs]); // eslint-disable-line react-hooks/exhaustive-deps

  const searchLo = search.toLowerCase().trim();
  const visibleEnvs = searchLo
    ? allEnvs.filter(e =>
        e.envName.toLowerCase().includes(searchLo) ||
        e.bgName.toLowerCase().includes(searchLo) ||
        (e.envType || '').toLowerCase().includes(searchLo)
      )
    : allEnvs;

  // Group visible envs by BG for display
  const grouped = useMemo(() => {
    const map = new Map();
    visibleEnvs.forEach(e => {
      if (!map.has(e.bgId)) map.set(e.bgId, { bgId: e.bgId, bgName: e.bgName, envs: [] });
      map.get(e.bgId).envs.push(e);
    });
    return [...map.values()];
  }, [visibleEnvs]);

  const toggle = (bgId, envId) => {
    setSelections(prev => {
      const n = new Set(prev);
      const k = `${bgId}:${envId}`;
      n.has(k) ? n.delete(k) : n.add(k);
      return n;
    });
  };

  // Toggle all envs of a specific BG
  const toggleBg = (bgId, envs) => {
    const keys = envs.map(e => `${e.bgId}:${e.envId}`);
    const allSelected = keys.every(k => selections.has(k));
    setSelections(prev => {
      const n = new Set(prev);
      if (allSelected) keys.forEach(k => n.delete(k));
      else keys.forEach(k => n.add(k));
      return n;
    });
  };

  const selectByType = (type) =>
    setSelections(prev => {
      const n = new Set(prev);
      allEnvs.filter(e => e.envType === type).forEach(e => n.add(`${e.bgId}:${e.envId}`));
      return n;
    });

  const clearAll = () => setSelections(new Set());
  const selectAll = () => setSelections(new Set(visibleEnvs.map(e => `${e.bgId}:${e.envId}`)));

  const prodCount = allEnvs.filter(e => e.envType === 'production').length;
  const sandboxCount = allEnvs.filter(e => e.envType !== 'production').length;

  return (
    <div className="border border-slate-700/50 rounded-xl overflow-hidden">
      {/* Quick-select shortcuts */}
      {!loading && allEnvs.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap px-3 py-2 border-b border-slate-700/50 bg-slate-800/20">
          <span className="text-[9px] text-slate-600 uppercase tracking-wider font-bold flex-shrink-0">Quick select:</span>
          {prodCount > 0 && (
            <button onClick={() => selectByType('production')}
              className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border bg-green-950/40 text-green-400 border-green-800/50 hover:bg-green-950/70 transition-colors font-medium">
              ● All Production ({prodCount})
            </button>
          )}
          {sandboxCount > 0 && (
            <button onClick={() => selectByType('sandbox')}
              className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border bg-yellow-950/40 text-yellow-400 border-yellow-800/50 hover:bg-yellow-950/70 transition-colors font-medium">
              ● All Sandbox ({sandboxCount})
            </button>
          )}
          <div className="ml-auto flex items-center gap-2">
            <span className="text-[10px] text-slate-500">{selections.size}/{allEnvs.length} selected</span>
            {selections.size > 0 && (
              <button onClick={clearAll} className="text-[10px] text-red-500/70 hover:text-red-400 transition-colors">Clear all</button>
            )}
          </div>
        </div>
      )}

      {/* Search bar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-700/50 bg-slate-800/40">
        <Search size={11} className="text-slate-500 flex-shrink-0" />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search BG or environment…"
          className="flex-1 bg-transparent text-xs text-slate-200 placeholder-slate-600 focus:outline-none min-w-0"
        />
        {search && (
          <button onClick={() => setSearch('')} className="text-slate-500 hover:text-slate-300 text-xs flex-shrink-0">✕</button>
        )}
        {search && visibleEnvs.length > 0 && (
          <button onClick={selectAll} className="text-[10px] text-cyan-400 hover:text-cyan-300 font-medium flex-shrink-0 border-l border-slate-700/60 pl-2">
            Select {visibleEnvs.length}
          </button>
        )}
      </div>

      {/* Grouped environment list */}
      {loading ? (
        <div className="flex items-center justify-center gap-2 py-6 text-slate-500 text-xs">
          <RefreshCw size={12} className="animate-spin" /> Loading environments…
        </div>
      ) : grouped.length === 0 ? (
        <div className="py-6 text-center text-slate-600 text-xs">
          {search ? `No environments match "${search}"` : 'No environments available'}
        </div>
      ) : (
        <div style={{ maxHeight: '16rem', overflowY: 'auto' }}>
          {grouped.map(({ bgId, bgName, envs }) => {
            const bgKeys = envs.map(e => `${e.bgId}:${e.envId}`);
            const allBgSelected = bgKeys.every(k => selections.has(k));
            const someBgSelected = !allBgSelected && bgKeys.some(k => selections.has(k));
            return (
              <div key={bgId}>
                {/* BG group header — click to select/deselect all envs in this BG */}
                <div
                  onClick={() => toggleBg(bgId, envs)}
                  className={`flex items-center gap-2 px-3 py-1.5 cursor-pointer bg-slate-800/50 border-b border-slate-700/40 hover:bg-slate-800/70 transition-colors group`}
                >
                  <div className={`w-3.5 h-3.5 rounded border flex items-center justify-center flex-shrink-0 transition-colors ${
                    allBgSelected ? 'bg-cyan-600 border-cyan-500' :
                    someBgSelected ? 'bg-cyan-900/60 border-cyan-600' :
                    'border-slate-600 group-hover:border-cyan-500'
                  }`}>
                    {allBgSelected && <Check size={8} className="text-white" />}
                    {someBgSelected && <span className="text-cyan-400 text-[8px] font-bold leading-none">–</span>}
                  </div>
                  <Building2 size={10} className="text-slate-500 flex-shrink-0" />
                  <span className="text-[10px] font-semibold text-slate-400 flex-1 truncate">{bgName}</span>
                  <span className="text-[9px] text-slate-600">{envs.length} env{envs.length !== 1 ? 's' : ''}</span>
                </div>
                {/* Env rows for this BG */}
                {envs.map(env => {
                  const key = `${env.bgId}:${env.envId}`;
                  const isChecked = selections.has(key);
                  const isProd = env.envType === 'production';
                  return (
                    <div
                      key={key}
                      onClick={() => toggle(env.bgId, env.envId)}
                      className={`flex items-center gap-3 pl-8 pr-3 py-2 cursor-pointer transition-colors border-b border-slate-800/30 last:border-0 ${isChecked ? 'bg-cyan-950/20' : 'hover:bg-slate-800/30'}`}
                    >
                      <div className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 transition-colors ${isChecked ? 'bg-cyan-600 border-cyan-500' : 'border-slate-600 hover:border-cyan-500'}`}>
                        {isChecked && <Check size={9} className="text-white" />}
                      </div>
                      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${isProd ? 'bg-green-400' : 'bg-yellow-400'}`} />
                      <span className={`text-xs flex-1 ${isChecked ? 'text-white font-medium' : 'text-slate-300'}`}>{env.envName}</span>
                      <span className={`text-[9px] px-1.5 py-0.5 rounded-full flex-shrink-0 ${isProd ? 'bg-green-900/40 text-green-500' : 'bg-yellow-900/40 text-yellow-500'}`}>
                        {env.envType || 'sandbox'}
                      </span>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function UserSearchPage() {
  const { orgId: authOrgId } = useAuth();
  const navigate = useNavigate();
  const { getAllCredentials, hasCredentials: hasCpsCreds, getSecret } = useCpsCredentialStore();
  const [bgs, setBgs] = useState([]);
  const [bgsLoad, setBgsLoad] = useState(false);
  const [bgEnvSelections, setBgEnvSelections] = useState([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState(null);
  const [error, setError] = useState('');
  const [credentialErrors, setCredentialErrors] = useState(0);
  const [progress, setProgress] = useState({ envsDone: 0, envsTotal: 0, appsT: 0, appsN: 0, phase: 1, batchDone: 0, batchTotal: 0 });
  const [envStats, setEnvStats] = useState([]);
  // Feature 3: cancel
  const abortRef = useRef(null);
  // Feature 8: search mode — 'value' | 'key'
  const [searchMode, setSearchMode] = useState('value');
  // Feature 2: group by app toggle
  const [groupByApp, setGroupByApp] = useState(false);
  const [expandedApps, setExpandedApps] = useState(new Set());
  // Feature 15: sortable columns
  const [sortCol, setSortCol] = useState('');
  const [sortDir, setSortDir] = useState('asc');

  useEffect(() => {
    setBgsLoad(true);
    api.get('/organizations/business-groups').then(r => setBgs(r.data?.data || [])).catch(() => {}).finally(() => setBgsLoad(false));
  }, []);

  // Fire-and-forget credential posting — no await, runs in background.
  //
  // KEY FIX: store ALL CSV credentials as {url}::{clientId} entries so the
  // backend retry loop (which searches for {url}::* entries) can try every
  // credential when the primary one returns 401.
  // Previously only ONE credential was stored per URL+BG, so if that credential
  // didn't have access, ALL retries failed (nothing to retry with).
  const postCreds = useCallback((entries) => {
    if (!hasCpsCreds) return;
    const allCreds = getAllCredentials();
    if (!allCreds.length) return;

    // Collect unique normalised CPS base URLs from this batch of entries
    const uniqueNorms = new Set();
    const primaryByBg = new Map(); // {norm}::{bgOrgId} → best cred from app properties

    for (const e of entries) {
      if (!e.cpsBaseUrl) continue;
      const norm = e.cpsBaseUrl.trim().replace(/\/+$/, '').replace(/\/api\/v2\/?$/, '');
      uniqueNorms.add(norm);

      // If the app declares its own clientId and we have its secret, use it as primary
      const bgKey = `${norm}::${e.bgOrgId}`;
      if (!primaryByBg.has(bgKey) && e.cpsClientId) {
        const s = getSecret(e.cpsClientId);
        if (s) primaryByBg.set(bgKey, { clientId: e.cpsClientId, clientSecret: s });
      }
    }

    if (!uniqueNorms.size) return;

    // Build credential map to post to the session:
    //   {norm}::{bgOrgId}    → app-specific primary (from cpsClientId in ARM properties)
    //   {norm}::{clientId}   → ALL CSV credentials as alt entries for the retry loop
    //   {norm}               → URL-only fallback
    const credMap = {};
    for (const norm of uniqueNorms) {
      // App-specific primaries
      for (const [bgKey, cred] of primaryByBg.entries()) {
        if (bgKey.startsWith(`${norm}::`)) credMap[bgKey] = cred;
      }
      // ALL CSV credentials stored under {url}::{clientId} so retry loop finds them
      for (const { clientId, clientSecret } of allCreds) {
        credMap[`${norm}::${clientId}`] = { clientId, clientSecret };
      }
      // URL-only fallback: use first credential from CSV
      credMap[norm] = { clientId: allCreds[0].clientId, clientSecret: allCreds[0].clientSecret };
    }

    // Fire without await — credentials are stored in session for the backend
    api.post('/cps/credentials', { credentials: credMap }).catch(() => {});
  }, [hasCpsCreds, getAllCredentials, getSecret]);

  const fetchAppsForEnv = useCallback(async (bgId, envId, envName) => {
    const apps = [];
    const DETAIL_BATCH = 50;
    let ch2List = [];
    // Track status from the list (summary) to fall back on if detail doesn't have it
    const listStatusMap = {}; // id → status string

    // ── CH2: always do a fresh paginated list fetch ───────────────────────
    // Do NOT use the ApplicationsPage summary cache (apps:${bgId}:${bgId}) —
    // that cache is paginated to 100 apps and would miss apps 101+ in large envs.
    // Per-app detail cache (ch2detail:${a.id}:${envId}) is still used below.
    try {
      let offset = 0;
      while (true) {
        const r = await api.get(`/applications/cloudhub2/${bgId}/${envId}`, { params: { limit: 100, offset } });
        const items = r.data?.items || r.data?.deployments || r.data?.content || (Array.isArray(r.data) ? r.data : []);
        if (!items.length) break;
        items.forEach(a => { if (a.id && a.status) listStatusMap[a.id] = a.status; });
          ch2List.push(...items);
          // Only stop when the API returns fewer items than requested — this is the
          // definitive "last page" signal regardless of what field name the API
          // uses for the total count (total / totalItems / totalElements / count).
          // Comparing against r.data.total is unreliable because some API versions
          // return total=100 (page size) rather than the global count.
          if (items.length < 100) break;
        offset += 100;
      }
    } catch {}

    // ── Feature 17: track apps with confirmed "no CPS config" to skip detail re-fetch ──
    // After the first search, apps with no CPS properties are marked in a module-level
    // Set so subsequent searches skip the CH2 detail fetch for them entirely.
    // The key is appId:envId to scope it to the specific deployment.
    const NO_CPS_CACHE_KEY = 'noCpsAppIds';
    let noCpsIds = (() => { try { return new Set(JSON.parse(sessionStorage.getItem(NO_CPS_CACHE_KEY) || '[]')); } catch { return new Set(); } })();
    const saveNoCpsIds = () => { try { sessionStorage.setItem(NO_CPS_CACHE_KEY, JSON.stringify([...noCpsIds].slice(-500))); } catch {} };

    // ── CH2: detail fetch with per-app caching + large parallel batch ─────
    // CH2 list API does NOT return runtime properties — must fetch each app detail.
    // Per-app cache avoids re-fetching on repeat searches (5-min TTL).
    for (let i = 0; i < ch2List.length; i += DETAIL_BATCH) {
      const settled = await Promise.allSettled(
        ch2List.slice(i, i + DETAIL_BATCH).map(a => {
          const appKey = `ch2detail:${a.id}:${envId}`;
          // Feature 17: skip detail fetch for apps previously confirmed to have no CPS config
          const skipKey = `${a.id}:${envId}`;
          if (noCpsIds.has(skipKey)) {
            return Promise.resolve({ ...a, status: listStatusMap[a.id] || a.status || '', _noCps: true });
          }
          const cached = getCached(appKey);
          // Merge summary status into cached detail if detail lacks it
          if (cached) {
            if (!cached.status && listStatusMap[a.id]) cached.status = listStatusMap[a.id];
            return Promise.resolve(cached);
          }
          return api.get(`/applications/cloudhub2/${bgId}/${envId}/${a.id}`)
            .then(r => {
              const detail = r.data;
              // CH2 detail: status is in application.status, desiredStatus, or top-level status
              if (!detail.status) {
                detail.status = detail.application?.status || detail.desiredStatus
                  || listStatusMap[a.id] || '';
              }
              // Feature 17: check if this app has CPS config; if not, mark it for future skipping
              const merged = mergeAppProps(detail);
              const hasCpsUrl = !!(merged['cps.configServerBaseUrl'] || merged['config.server.base.url'] ||
                merged['cps.baseUrl'] || merged['cps.base.url'] || merged['cps.url'] ||
                Object.entries(merged).some(([k, v]) => typeof v === 'string' && /^https?:\/\//i.test(v) && /cps|config[.\-_]?server/i.test(k)));
              if (!hasCpsUrl) { noCpsIds.add(`${a.id}:${envId}`); saveNoCpsIds(); }
              setCached(appKey, detail);
              return detail;
            })
            .catch(() => ({ ...a, status: listStatusMap[a.id] || a.status || '' }));
        })
      );
      settled.forEach(s => { if (s.status === 'fulfilled' && s.value && !s.value._noCps) apps.push(s.value); });
    }

    // ── CH1: always fetch fresh list (1 call returns ALL apps with properties)
    // CH1 list API returns the full properties map directly — no per-app detail needed.
    // Cache the list per env (5-min TTL) to speed up repeat searches.
    // SWR: serve stale data immediately and re-fetch silently in background.
    try {
      const ch1Key = CK.ch1list(bgId, envId);
      const ch1Swr = getCachedSWR(ch1Key);
      let ch1Data = ch1Swr?.data || null;
      if (!ch1Data) {
        const r = await api.get(`/applications/cloudhub1/${envId}`, { params: { orgId: bgId } });
        ch1Data = Array.isArray(r.data) ? r.data : (r.data?.applications || r.data?.data || []);
        setCached(ch1Key, ch1Data, 5 * 60 * 1000);
      } else if (ch1Swr?.stale) {
        // Serve stale data now; refresh cache in background for the next search
        api.get(`/applications/cloudhub1/${envId}`, { params: { orgId: bgId } })
          .then(r => {
            const fresh = Array.isArray(r.data) ? r.data : (r.data?.applications || r.data?.data || []);
            setCached(ch1Key, fresh, 5 * 60 * 1000);
          })
          .catch(() => {});
      }
      apps.push(...ch1Data.map(c => ({
        _type: 'ch1', id: c.domain, name: c.domain,
        properties: c.properties || {}, // full properties from CH1 list API
        status: c.status || '',          // CH1 status (STARTED / STOPPED etc.)
        environment: { name: envName, id: envId },
      })));
    } catch {}

    return apps;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const cancelSearch = () => { abortRef.current?.abort(); };

  const toggleSort = (col) => {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortCol(col); setSortDir('asc'); }
  };

  const SortBtn = ({ col }) => (
    <button onClick={() => toggleSort(col)} className="ml-0.5 opacity-40 hover:opacity-100 transition-opacity">
      {sortCol === col ? (sortDir === 'asc' ? '↑' : '↓') : <ArrowUpDown size={9} />}
    </button>
  );

  const runSearch = async () => {
    if (!query.trim()) { setError('Enter a search term.'); return; }
    if (!bgEnvSelections.length) { setError('Select at least one Environment.'); return; }
    // Feature 3: cancel previous search
    abortRef.current?.abort();
    const ctl = new AbortController();
    abortRef.current = ctl;

    setLoading(true); setError(''); setResults(null); setCredentialErrors(0); setEnvStats([]);
    setProgress({ envsDone: 0, envsTotal: bgEnvSelections.length, appsT: 0, appsN: 0, phase: 1, batchDone: 0, batchTotal: 0 });

    // Feature 9: multi-term — split by comma
    const terms = query.trim().split(',').map(t => t.trim()).filter(Boolean);

    // ── Phase 1: Fetch all envs in PARALLEL ───────────────────────────────
    const searchTermLo = terms[0].toLowerCase(); // primary term for ARM scan
    const armRows = []; // direct ARM/deployment property matches (no CPS)

    const envResults = await Promise.allSettled(
      bgEnvSelections.map(async (sel) => {
        const apps = await fetchAppsForEnv(sel.bgId, sel.envId, sel.envName);
        const allMapped = apps.map(a => ({
          appName: a.name,
          appId: a.id || a.name,
          ...extractCpsConfig(a, sel.bgId),
          envName: a.environment?.name || sel.envName,
          envId: sel.envId,
          status: a.status || a.target?.desiredStatus || a.target?.status || '',
        }));
        const entries = allMapped.filter(e => e.cpsBaseUrl && e.cpsKey);

        // ── Infer CPS URL for apps without one ───────────────────────────────
        // Some CH2 apps (e.g. job-s360-edh-account-v1) don't store cpsBaseUrl
        // in their ARM deployment properties, but they use the SAME CPS server
        // as every other app in the same BG+env.
        // Find the dominant (most-used) CPS URL from apps that DO have it,
        // then assign it to the apps that don't so they also get searched.
        const urlCounts = entries.reduce((acc, e) => {
          acc[e.cpsBaseUrl] = (acc[e.cpsBaseUrl] || 0) + 1;
          return acc;
        }, {});
        const dominantCpsUrl = Object.entries(urlCounts).sort(([, a], [, b]) => b - a)[0]?.[0] || '';
        const fallbackEnv = sel.envType === 'production' || sel.envName.toLowerCase().includes('prod') ? 'prod' : '';
        const inferredEntries = dominantCpsUrl
          ? allMapped
              .filter(e => !e.cpsBaseUrl && e.cpsKey)
              .map(e => ({ ...e, cpsBaseUrl: dominantCpsUrl, cpsEnv: e.cpsEnv || fallbackEnv }))
          : [];
        const allEnvEntries = [...entries, ...inferredEntries];

        // Fire-and-forget credentials (no await)
        if (allEnvEntries.length) postCreds(allEnvEntries);

        // ── Also scan ARM deployment properties directly ───────────────
        for (const a of apps) {
          if (ctl.signal.aborted) break;
          const p = mergeAppProps(a);
          // Feature 8: key mode searches property keys; value mode searches values
          const hits = Object.entries(p).filter(([k, v]) =>
            searchMode === 'key'
              ? terms.some(t => k.toLowerCase().includes(t.toLowerCase()))
              : typeof v === 'string' && terms.some(t => v.toLowerCase().includes(t.toLowerCase()))
          );
          if (hits.length > 0) {
            armRows.push({
              bgName: sel.bgName,
              chEnv: a.environment?.name || sel.envName,
              chVersion: chLabel(a._type === 'ch1' ? 'ch1' : 'ch2'),
              appName: a.name,
              appId: a.id || a.name,
              bgOrgId: sel.bgId,
              envId: sel.envId,
              status: a.status || '',
              nsKey: '(ARM props)',
              cpsPrefix: '—',
              secureKey: '',
              propKey: hits.map(([k]) => k).join(', '),
              apiUser: hits[0][1],
              password: '—',
              source: 'arm-props',
            });
          }
        }

        // Per-env stat tracking
        setEnvStats(prev => [...prev, {
          envName: sel.envName, bgName: sel.bgName,
          total: apps.length, withCps: allEnvEntries.length,
        }]);
        setProgress(p => ({
          ...p,
          appsT: p.appsT + apps.length,
          envsDone: p.envsDone + 1,
        }));
        return allEnvEntries;
      })
    );

    // ── Surface env-level fetch failures to the user ──────────────────────
    const failedEnvCount = envResults.filter(r => r.status === 'rejected').length;
    if (failedEnvCount > 0) {
      setError(`Warning: ${failedEnvCount} environment${failedEnvCount !== 1 ? 's' : ''} could not be loaded and were skipped. Results may be incomplete.`);
    }

    // ── Phase 2: Flatten + deduplicate entries ─────────────────────────────
    const seen = new Set();
      const allEntries = envResults
        .flatMap(r => r.status === 'fulfilled' ? r.value : [])
        .filter(e => {
          // Deduplicate by cpsUrl + cpsKey + cpsEnv + bgOrgId + envId
          // Use envId (CloudHub UUID) instead of envName — envName can be identical
          // across BGs (e.g., both EI-FI-PROD and BT-FINANCE-PROD have CH env named
          // "Production"), while envId is always unique per BG+environment combination.
          const k = `${e.cpsBaseUrl}||${e.cpsKey}||${e.cpsEnv}||${e.bgOrgId}||${e.envId || e.envName}`;
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        });

    setProgress(p => ({ ...p, appsN: allEntries.length }));

    if (!allEntries.length) {
      setError('No apps with CPS config found — check that apps have cps.configServerBaseUrl set');
      setResults([]); setLoading(false); return;
    }

    if (ctl.signal.aborted) { setLoading(false); return; }

    // ── Phase 3: Backend CPS fan-out search ───────────────────────────────
    // Feature 4: show incremental results as each batch arrives
    const BACKEND_BATCH = 100;
    const totalBatches = Math.ceil(allEntries.length / BACKEND_BATCH);
    setProgress(p => ({ ...p, phase: 2, batchDone: 0, batchTotal: totalBatches }));

    let totalCredErrors = 0;
    let batchFailed = 0;

    for (let bi = 0; bi < allEntries.length; bi += BACKEND_BATCH) {
      if (ctl.signal.aborted) break;
      const batch = allEntries.slice(bi, bi + BACKEND_BATCH);
      const batchNum = Math.floor(bi / BACKEND_BATCH) + 1;
      try {
        // Feature 8: pass searchMode to backend (value search = username, key search = different param)
        const payload = searchMode === 'key'
          ? { username: terms.join(','), searchMode: 'key', apps: batch }
          : { username: terms.join(','), apps: batch };
        const r = await api.post('/cps/search-user', payload, { timeout: 120000 });
        totalCredErrors += r.data?.credentialErrors || 0;

        // Feature 4: incrementally build and display results after each batch
        const batchRows = [];
        for (const item of r.data?.results || []) {
          for (const prop of item.matchedProps || []) {
            batchRows.push({
              bgName: item.bgName || item.envName?.split('/')[0] || '—',
              chEnv: item.envName || '—',
              chVersion: chLabel(item.deploymentType),
              appName: item.appName,
              appId: item.appId || item.appName,
              bgOrgId: item.bgOrgId || '',
              envId: item.envId || '',
              status: item.status || '',
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
        setResults(prev => (prev ? [...prev, ...batchRows] : batchRows));
      } catch (batchErr) {
        batchFailed++;
        if (!ctl.signal.aborted)
          console.warn(`[search-user] batch ${batchNum}/${totalBatches} failed:`, batchErr.message);
      }
      setProgress(p => ({ ...p, batchDone: batchNum }));
    }

    if (!ctl.signal.aborted) {
      setCredentialErrors(totalCredErrors);
      // Merge ARM rows, ensuring no duplicate with CPS results
      setResults(prev => {
        const cpsAppNames = new Set((prev || []).map(r => r.appName));
        const uniqueArmRows = armRows.filter(r => !cpsAppNames.has(r.appName));
        return [...(prev || []), ...uniqueArmRows];
      });
      if (batchFailed > 0 && batchFailed === totalBatches) {
        setError(`Search failed — all ${totalBatches} batch(es) returned errors. Check backend logs.`);
      }
    }
    setLoading(false);
  };

  const exportCsv = () => {
    if (!results || !results.length) return;
    // Feature 13: include Business Group as first column
    const H = ['Business Group', 'Cloudhub Environment', 'Cloudhub Version', 'Integration Name', 'Non-Secure Key', 'CPS Prefix', 'Secure Key', 'Found In Property Key', 'API User', 'Password'];
    const rows = results.map(r => [r.bgName || '—', r.chEnv, r.chVersion, r.appName, r.nsKey, r.cpsPrefix, r.secureKey, r.propKey, r.apiUser, r.password]);
    const csv = [H, ...rows].map(row => row.map(v => '"' + String(v ?? '').replace(/"/g, '""') + '"').join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'global-search-' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const selCount = bgEnvSelections.length;
  const COL_HEADERS = ['#', 'Cloudhub Environment', 'Cloudhub Version', 'Integration Name', 'Status', 'Non-Secure Key', 'CPS Prefix', 'Secure Key', 'Found In Property Key', 'API User', 'Password'];

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

      <div className="space-y-2">
        <div className="flex gap-3 items-center">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
            <input value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => e.key === 'Enter' && !loading && runSearch()}
              placeholder={searchMode === 'key' ? 'Enter property key name to find (e.g. db.username)…' : 'Enter username / email / value to search in CPS properties…'}
              className="w-full bg-slate-900/60 border border-slate-800/80 rounded-xl pl-10 pr-4 py-3 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-cyan-600/50 focus:bg-slate-900" />
          </div>
          {/* Feature 3: Cancel button during search */}
          {loading
            ? <button onClick={cancelSearch}
                className="flex items-center gap-2 px-5 py-3 bg-red-800 hover:bg-red-700 text-white text-sm font-semibold rounded-xl transition-colors flex-shrink-0">
                <X size={14} /> Cancel
              </button>
            : <button onClick={runSearch} disabled={!query.trim() || !selCount}
                className="flex items-center gap-2 px-5 py-3 bg-cyan-700 hover:bg-cyan-600 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-xl transition-colors flex-shrink-0">
                <Search size={14} /> Search
              </button>}
        </div>
        {/* Feature 8: Search mode toggle + Feature 9: multi-term hint */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1 bg-slate-800/60 border border-slate-700/40 rounded-lg p-0.5">
            {[['value','Search Values'], ['key','Search Keys']].map(([mode, label]) => (
              <button key={mode} onClick={() => setSearchMode(mode)}
                className={`text-[10px] px-2.5 py-1 rounded-md font-medium transition-all ${searchMode === mode ? 'bg-cyan-700 text-white' : 'text-slate-500 hover:text-slate-300'}`}>
                {label}
              </button>
            ))}
          </div>
          <p className="text-[10px] text-slate-600">
            {searchMode === 'value'
              ? 'Tip: separate multiple terms with commas — e.g. john.doe, jane.smith'
              : 'Key mode: finds apps that have this property key configured (any value)'}
          </p>
        </div>
      </div>

      {!hasCpsCreds && (
        <div className="flex items-center gap-3 bg-yellow-950/20 border border-yellow-800/40 rounded-xl px-4 py-3 text-yellow-400/80 text-xs">
          <AlertTriangle size={13} className="flex-shrink-0" />
          No CPS credentials imported — use the <strong className="text-yellow-300">CPS CSV import</strong> in the header to also search secure properties.
        </div>
      )}

      {/* Feature 1.9: informative empty state when no search has been run yet */}
      {results === null && !loading && (
        <div className="bg-slate-900/40 border border-slate-800/60 rounded-2xl px-6 py-8 space-y-5">
          <div className="flex items-start gap-4">
            <div className="p-3 rounded-xl bg-cyan-950/40 border border-cyan-800/30 flex-shrink-0">
              <Users size={20} className="text-cyan-400" />
            </div>
            <div>
              <h3 className="text-white text-sm font-semibold">How Global Search works</h3>
              <p className="text-slate-400 text-xs mt-1 leading-relaxed">
                Searches for a username or email substring across <strong className="text-slate-300">CPS non-secure and secure properties</strong> for every app in the selected environments.
                Also scans ARM deployment properties (CloudHub environment variables) as a fallback.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {[
              {
                icon: '🔍',
                title: 'Property keys scanned',
                items: ['.username', '.user', '.login', '.email', '.apiUser', '(any key whose value contains your search)'],
              },
              {
                icon: '🗝️',
                title: 'What you need',
                items: ['Select 1+ environments above', 'Import a CPS CSV (header: CPS Credentials)', 'Enter a username or partial email'],
              },
              {
                icon: '📋',
                title: 'What you get back',
                items: ['App name + environment + status', 'The exact property key containing the match', 'CPS secure group name (if secure)', 'Associated password key (masked)'],
              },
            ].map(({ icon, title, items }) => (
              <div key={title} className="bg-slate-800/30 border border-slate-700/40 rounded-xl p-4 space-y-2">
                <p className="text-slate-300 text-xs font-semibold flex items-center gap-2">
                  <span>{icon}</span> {title}
                </p>
                <ul className="space-y-1">
                  {items.map(item => (
                    <li key={item} className="text-slate-500 text-[10px] flex items-start gap-1.5">
                      <span className="text-cyan-700 flex-shrink-0 mt-0.5">›</span>
                      <code className="font-mono">{item}</code>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          <p className="text-slate-600 text-[10px] text-center">
            💡 Tip: search for a partial email (e.g. <code className="text-slate-500">@company.com</code>) to find all service accounts, or an ldap username to locate where it's used across integrations.
          </p>
        </div>
      )}

      {loading && (
        <div className="bg-slate-900/50 border border-slate-800/60 rounded-2xl px-5 py-6 flex flex-col items-center gap-3">
          <RefreshCw size={22} className="animate-spin text-cyan-400" />
          <p className="text-slate-300 text-sm font-medium">
            {progress.phase === 1 ? 'Phase 1 — Fetching app lists…' : 'Phase 2 — Scanning CPS properties…'}
          </p>
          {/* Feature 11: two-phase progress */}
          {progress.phase === 1 && (
            <div className="flex items-center gap-4 text-xs text-slate-500">
              <span>{progress.envsDone}/{progress.envsTotal} envs</span>
              <span>{progress.appsT} apps found</span>
              {progress.appsN > 0 && <span>{progress.appsN} with CPS</span>}
            </div>
          )}
          {progress.phase === 2 && (
            <div className="flex items-center gap-4 text-xs text-slate-500">
              <span>Batch {progress.batchDone}/{progress.batchTotal}</span>
              <span>{progress.appsN} apps</span>
              {results?.length > 0 && <span className="text-emerald-400/80">✓ {results.length} match{results.length !== 1 ? 'es' : ''} so far</span>}
            </div>
          )}
          <div className="w-full max-w-xs">
            <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
              <div className="h-full bg-cyan-600 rounded-full transition-all duration-300" style={{ width:
                progress.phase === 1 && progress.envsTotal > 0 ? `${Math.round((progress.envsDone / progress.envsTotal) * 50)}%`
                : progress.phase === 2 && progress.batchTotal > 0 ? `${50 + Math.round((progress.batchDone / progress.batchTotal) * 50)}%`
                : '0%'
              }} />
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
            {/* Per-env diagnostic — helps identify BGs where apps have no CPS config */}
            {envStats.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {envStats.map((s, i) => (
                  <span key={i} className={`text-[9px] px-2 py-0.5 rounded-full border font-mono ${
                    s.withCps === 0 ? 'bg-yellow-950/30 text-yellow-500 border-yellow-800/40' : 'bg-slate-800/40 text-slate-500 border-slate-700/40'
                  }`} title={`${s.bgName} / ${s.envName}: ${s.total} apps, ${s.withCps} with CPS config`}>
                    {s.bgName}/{s.envName}: {s.withCps}/{s.total} CPS
                  </span>
                ))}
              </div>
            )}
            {/* Feature 2: group-by-app toggle */}
            <div className="flex items-center gap-2">
              <button onClick={() => setGroupByApp(v => !v)}
                className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border font-medium transition-all ${groupByApp ? 'bg-cyan-700/30 border-cyan-700/60 text-cyan-300' : 'bg-slate-800/60 border-slate-700/40 text-slate-400 hover:text-slate-300'}`}>
                <Building2 size={11} /> {groupByApp ? 'Grouped by App' : 'Group by App'}
              </button>
              {results.length > 0 && (
                <button onClick={exportCsv}
                  className="flex items-center gap-2 px-4 py-2 text-sm text-emerald-400 hover:text-emerald-300 bg-emerald-950/40 border border-emerald-800/40 rounded-xl transition-colors font-medium">
                  <Download size={13} /> Export CSV
                </button>
              )}
            </div>
          </div>

          {credentialErrors > 0 && (
            <div className="flex items-start gap-3 bg-yellow-950/20 border border-yellow-800/40 rounded-xl px-4 py-3">
              <AlertTriangle size={13} className="text-yellow-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-yellow-300 text-xs font-semibold">
                  {credentialErrors} app{credentialErrors !== 1 ? 's' : ''} not searched — missing CPS credentials
                </p>
                <p className="text-yellow-500/80 text-[10px] mt-0.5">
                  These apps use a CPS server not covered by your uploaded credentials CSV. Upload a broader CSV via the <strong className="text-yellow-400">CPS CSV import</strong> button in the header to include them.
                </p>
              </div>
            </div>
          )}

          {results.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 gap-3 bg-slate-900/40 border border-slate-800/60 rounded-2xl">
              <Users size={32} className="text-slate-700" />
              <p className="text-slate-500 text-sm">No apps found with <span className="font-mono text-slate-400">"{query.trim()}"</span> in CPS properties</p>
            </div>
          ) : (() => {
            // Feature 9: derive active search terms for highlighting
            const activeTerms = query.trim().split(',').map(t => t.trim()).filter(Boolean);
            // Feature 15: sort results
            const sortedResults = sortCol
              ? [...results].sort((a, b) => {
                  const v = r => String(r[sortCol] ?? '').toLowerCase();
                  const cmp = v(a).localeCompare(v(b));
                  return sortDir === 'asc' ? cmp : -cmp;
                })
              : results;

            // Feature 2: grouped view
            if (groupByApp) {
              const appGroups = new Map();
              sortedResults.forEach(row => {
                const key = row.appName;
                if (!appGroups.has(key)) appGroups.set(key, { row, rows: [] });
                appGroups.get(key).rows.push(row);
              });
              return (
                <div className="space-y-2">
                  {[...appGroups.entries()].map(([appName, { row: first, rows }]) => {
                    const isExp = expandedApps.has(appName);
                    return (
                      <div key={appName} className="bg-slate-900/50 border border-slate-800/60 rounded-xl overflow-hidden">
                        <button onClick={() => setExpandedApps(prev => { const n = new Set(prev); n.has(appName) ? n.delete(appName) : n.add(appName); return n; })}
                          className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-800/30 transition-colors">
                          <div className="flex items-center gap-3 min-w-0">
                            <button onClick={e => { e.stopPropagation(); if (first.bgOrgId && first.envId && first.appId) navigate(`/applications/${first.bgOrgId}/${first.envId}/${first.appId}`); }}
                              className="text-sm font-semibold text-cyan-300 hover:text-cyan-200 font-mono truncate transition-colors" title="Open Application Detail">
                              {appName}
                            </button>
                            <span className="text-[10px] text-slate-500">{first.chEnv}</span>
                            {first.status && <span className={`text-[9px] px-1.5 py-0.5 rounded-full border font-bold ${first.status.toUpperCase()==='RUNNING' ? 'bg-green-950/40 text-green-400 border-green-700/40' : 'bg-gray-800/60 text-gray-500 border-gray-600/40'}`}>{first.status}</span>}
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            <span className="text-[10px] text-slate-500">{rows.length} match{rows.length !== 1 ? 'es' : ''}</span>
                            <ChevronDown size={13} className={`text-slate-600 transition-transform ${isExp ? '' : '-rotate-90'}`} />
                          </div>
                        </button>
                        {isExp && (
                          <div className="border-t border-slate-800/40 divide-y divide-slate-800/30">
                            {rows.map((row, ri) => (
                              <div key={ri} className="flex items-center gap-3 px-4 py-2.5 hover:bg-slate-800/20 text-xs">
                                <div className="flex items-center gap-1 min-w-0 flex-1">
                                  <span className="font-mono text-cyan-300/80"><Highlight text={row.propKey} terms={activeTerms} /></span>
                                  {row.secureKey ? <span className="text-[9px] text-orange-400 bg-orange-950/30 px-1 rounded ml-1">{row.secureKey}</span> : null}
                                </div>
                                <span className="font-mono text-emerald-300 break-all max-w-xs"><Highlight text={row.apiUser} terms={activeTerms} /></span>
                                <CopyBtn text={row.apiUser} />
                                <span className="font-mono text-slate-600">{row.password}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            }

            // Flat table view (default)
            return (
              <div className="bg-slate-900/50 border border-slate-800/60 rounded-2xl overflow-hidden">
                {/* Feature 15: sticky table + sortable headers */}
                <div className="overflow-x-auto overflow-y-auto max-h-[65vh]">
                  <table className="w-full text-sm border-collapse">
                    <thead className="sticky top-0 z-10">
                      <tr className="bg-slate-800/95 border-b border-slate-700/40 backdrop-blur-sm">
                        <th className="px-3 py-3 text-left text-[10px] font-bold text-slate-500 uppercase w-8">#</th>
                        {[['chEnv','Environment'], ['chVersion','Type'], ['appName','App Name'], ['status','Status'], ['nsKey','CPS Key'], ['cpsPrefix','Prefix'], ['secureKey','Secure Group'], ['propKey','Property Key'], ['apiUser','Value'], ['password','Password']].map(([col, label]) => (
                          <th key={col} className="px-3 py-3 text-left text-[10px] font-bold tracking-wider text-slate-500 uppercase whitespace-nowrap cursor-pointer hover:text-slate-300 select-none" onClick={() => toggleSort(col)}>
                            {label} <SortBtn col={col} />
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {sortedResults.map((row, i) => (
                        <tr key={i} className="group border-b border-slate-800/40 hover:bg-slate-800/30 transition-colors last:border-0">
                          <td className="px-3 py-3 text-xs text-slate-600 font-mono tabular-nums text-right select-none">{i + 1}</td>
                          <td className="px-3 py-3 text-xs text-slate-300 whitespace-nowrap">{row.chEnv}</td>
                          <td className="px-3 py-3 whitespace-nowrap">
                            <span className={'text-[10px] px-2 py-0.5 rounded font-bold border ' + (row.chVersion === 'CloudHub 2.0' ? 'bg-blue-950/40 text-blue-300 border-blue-700/40' : 'bg-purple-950/40 text-purple-300 border-purple-700/40')}>{row.chVersion}</span>
                          </td>
                          {/* Feature 5: clickable app name */}
                          <td className="px-3 py-3">
                            <div className="flex items-center gap-1 group/cell">
                              <button onClick={() => { if (row.bgOrgId && row.envId && row.appId) navigate(`/applications/${row.bgOrgId}/${row.envId}/${row.appId}`); }}
                                className="text-xs font-mono text-cyan-300 hover:text-cyan-200 font-medium hover:underline underline-offset-2 text-left transition-colors" title="Open Application Detail">
                                {row.appName}
                              </button>
                              <CopyBtn text={row.appName} />
                            </div>
                          </td>
                          <td className="px-3 py-3 whitespace-nowrap">
                            {row.status ? (
                              <span className={`text-[10px] px-1.5 py-0.5 rounded-full border font-bold ${row.status.toUpperCase()==='RUNNING' ? 'bg-green-950/40 text-green-400 border-green-700/40' : row.status.toUpperCase()==='STOPPED' ? 'bg-gray-800/60 text-gray-500 border-gray-600/40' : row.status.toUpperCase()==='FAILED' ? 'bg-red-950/40 text-red-400 border-red-700/40' : 'bg-yellow-950/40 text-yellow-400 border-yellow-700/40'}`}>{row.status.toUpperCase()}</span>
                            ) : <span className="text-slate-700 text-[10px]">—</span>}
                          </td>
                          <td className="px-3 py-3"><div className="flex items-center gap-1 group/cell"><span className="text-xs font-mono text-slate-400">{row.nsKey}</span><CopyBtn text={row.nsKey} /></div></td>
                          <td className="px-3 py-3 text-xs font-mono text-slate-400">{row.cpsPrefix}</td>
                          <td className="px-3 py-3">
                            {row.secureKey
                              ? <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border bg-orange-950/40 text-orange-300 border-orange-700/40 font-mono"><Lock size={8} /> {row.secureKey}</span>
                              : <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border bg-slate-800/60 text-slate-500 border-slate-700/40"><Key size={8} /> non-secure</span>}
                          </td>
                          {/* Feature 1: highlight propKey */}
                          <td className="px-3 py-3"><div className="flex items-center gap-1 group/cell"><span className="text-xs font-mono text-cyan-300"><Highlight text={row.propKey} terms={activeTerms} /></span><CopyBtn text={row.propKey} /></div></td>
                          {/* Feature 1: highlight apiUser */}
                          <td className="px-3 py-3"><div className="flex items-center gap-1 group/cell"><span className="text-xs font-mono text-emerald-300 break-all"><Highlight text={row.apiUser} terms={activeTerms} /></span><CopyBtn text={row.apiUser} /></div></td>
                          <td className="px-3 py-3 text-xs font-mono text-slate-500">{row.password}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}
