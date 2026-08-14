import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { useCpsCredentialStore } from '../context/CpsCredentialStoreContext';
import { Search, Users, RefreshCw, AlertTriangle, Copy, Check, Key, ChevronDown, ChevronRight, Lock } from 'lucide-react';
import api from '../services/api';

const LS_ORG = 'usersearch_orgId';
const LS_ENV = 'usersearch_envId';
const LS_ENV_NAME = 'usersearch_envName';

const CopyBtn = ({ text }) => {
  const [done, setDone] = useState(false);
  return (
    <button onClick={() => { navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500); }}
      className="opacity-0 group-hover:opacity-100 p-1 rounded text-slate-500 hover:text-slate-300 transition-all flex-shrink-0">
      {done ? <Check size={10} className="text-emerald-400" /> : <Copy size={10} />}
    </button>
  );
};

function extractCpsConfig(app, orgId) {
  const ds = app.target?.deploymentSettings || {};
  const ps = (app.application?.configuration || {})['mule.agent.application.properties.service'] || {};
  const p = { ...(ps.properties || {}), ...(ds.properties || {}), ...(ds.environmentVariables || ds.environmentVars || {}), ...(app.properties || {}) };
  return {
    cpsBaseUrl:     p['cps.configServerBaseUrl'] || p['config.server.base.url'] || '',
    cpsKey:         p['cps.projectName'] || p['cloudhub.api.name'] || app.name || '',
    cpsEnv:         p['cps.prefix'] || p['cps.environment'] || '',
    cpsClientId:    p['cps.clientId'] || p['cps.client_id'] || p['cps.client.id'] || p['cps.apiClientId'] || '',
    deploymentType: app._type === 'ch1' ? 'ch1' : 'ch2',
    envName:        app.environment?.name || '',
    bgOrgId:        orgId,
  };
}

export default function UserSearchPage() {
  const { orgId: authOrgId } = useAuth();
  const { getAllCredentials, hasCredentials: hasCpsCreds, getSecret } = useCpsCredentialStore();

  const [bgs,      setBgs]      = useState([]);
  const [orgId,    setOrgId]    = useState(() => localStorage.getItem(LS_ORG) || '');
  const [envs,     setEnvs]     = useState([]);
  const [envId,    setEnvId]    = useState(() => localStorage.getItem(LS_ENV) || '');
  const [envName,  setEnvName]  = useState(() => localStorage.getItem(LS_ENV_NAME) || '');
  const [bgsLoad,  setBgsLoad]  = useState(false);
  const [envsLoad, setEnvsLoad] = useState(false);

  const [query,    setQuery]    = useState('');
  const [loading,  setLoading]  = useState(false);
  const [results,  setResults]  = useState(null);
  const [error,    setError]    = useState('');
  const [appsN,    setAppsN]    = useState(0);
  const [appsT,    setAppsT]    = useState(0);
  const [expanded, setExpanded] = useState(new Set());

  useEffect(() => {
    setBgsLoad(true);
    api.get('/organizations/business-groups')
      .then(r => {
        const g = r.data?.data || [];
        setBgs(g);
        // Only set default if nothing is already selected from localStorage
        if (!orgId) {
          const d = g.find(x => x.id === authOrgId) || g[0];
          if (d) { setOrgId(d.id); localStorage.setItem(LS_ORG, d.id); }
        }
      })
      .catch(() => {}).finally(() => setBgsLoad(false));
  }, [authOrgId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!orgId) return;
    setEnvsLoad(true);
    api.get(`/environments/${orgId}`)
      .then(r => {
        const e = r.data?.data || r.data?.environments || r.data || [];
        setEnvs(Array.isArray(e) ? e : []);
      })
      .catch(() => {}).finally(() => setEnvsLoad(false));
  }, [orgId]);

  /**
   * Post CPS credentials per URL — Strategy 1: use the specific cpsClientId from
   * ARM props (getSecret lookup). Strategy 2: try all credentials (first match wins).
   * entries: app entries with { cpsBaseUrl, cpsClientId, bgOrgId }
   */
  const postCreds = useCallback(async (entries, oId) => {
    if (!hasCpsCreds) return;
    const allCreds = getAllCredentials();
    if (!allCreds.length) return;

    // Build per-URL credential map (resolve once per unique URL)
    const urlCredMap = new Map();
    for (const entry of entries) {
      if (!entry.cpsBaseUrl) continue;
      const normUrl = entry.cpsBaseUrl.trim().replace(/\/+$/, '').replace(/\/api\/v2\/?$/, '');
      if (urlCredMap.has(normUrl)) continue;

      // Strategy 1: use the specific cpsClientId known from app's ARM props
      if (entry.cpsClientId) {
        const secret = getSecret(entry.cpsClientId);
        if (secret) { urlCredMap.set(normUrl, { clientId: entry.cpsClientId, clientSecret: secret }); continue; }
      }
      // Strategy 2: use first available credential as fallback
      if (allCreds.length > 0) { urlCredMap.set(normUrl, allCreds[0]); }
    }

    for (const [normUrl, { clientId, clientSecret }] of urlCredMap.entries()) {
      try {
        await api.post('/cps/credentials', {
          credentials: {
            [`${normUrl}::${oId}`]: { clientId, clientSecret },
            [normUrl]: { clientId, clientSecret },
          }
        });
      } catch { /* non-fatal */ }
    }
  }, [hasCpsCreds, getAllCredentials, getSecret]);

  const fetchApps = useCallback(async (oId, eId) => {
    const apps = [];
    const BATCH = 15;

    // CH2 — Step 1: get summary list to collect app IDs
    let ch2List = [];
    try {
      let offset = 0;
      while (true) {
        const r = await api.get(`/applications/cloudhub2/${oId}/${eId}`, { params: { limit: 100, offset } });
        const items = r.data?.items || r.data?.deployments || r.data?.content || (Array.isArray(r.data) ? r.data : []);
        if (!items.length) break;
        ch2List.push(...items);
        const total = r.data?.total ?? r.data?.totalItems ?? items.length;
        if (ch2List.length >= total || items.length < 100) break;
        offset += 100;
      }
    } catch {}

    // CH2 — Step 2: batch-fetch full details (contains target.deploymentSettings with cps.* props)
    for (let i = 0; i < ch2List.length; i += BATCH) {
      const batch = ch2List.slice(i, i + BATCH);
      const settled = await Promise.allSettled(
        batch.map(a => api.get(`/applications/cloudhub2/${oId}/${eId}/${a.id}`).then(r => r.data).catch(() => a))
      );
      settled.forEach(s => { if (s.status === 'fulfilled' && s.value) apps.push(s.value); });
    }

    // CH1 — list already includes properties
    try {
      const r = await api.get(`/applications/cloudhub1/${eId}`, { params: { orgId: oId } });
      const ch1 = Array.isArray(r.data) ? r.data : (r.data?.applications || r.data?.data || []);
      apps.push(...ch1.map(c => ({
        _type: 'ch1', id: c.domain, name: c.domain,
        properties: c.properties || {},
        environment: { name: envName },
      })));
    } catch {}

    return apps;
  }, [envName]);

  const runSearch = async () => {
    if (!query.trim() || !orgId || !envId) { if (!orgId || !envId) setError('Select a BG and Environment first.'); return; }
    setLoading(true); setError(''); setResults(null); setAppsN(0); setAppsT(0); setExpanded(new Set());
    try {
      const all = await fetchApps(orgId, envId);
      setAppsT(all.length);
      if (!all.length) { setError('No apps found.'); setLoading(false); return; }
      const entries = all.map(a => ({ appName: a.name, appId: a.id || a.name, ...extractCpsConfig(a, orgId) })).filter(e => e.cpsBaseUrl && e.cpsKey);
      await postCreds(entries, orgId);
      setAppsN(entries.length);
      if (!entries.length) { setResults({ results: [], scanned: 0, skipped: all.length }); setLoading(false); return; }
      const r = await api.post('/cps/search-user', { username: query.trim(), apps: entries });
      setResults(r.data);
      if (r.data?.results?.length > 0 && r.data.results.length <= 5) setExpanded(new Set(r.data.results.map(x => x.appName)));
    } catch (e) { setError(e.response?.data?.error || e.message || 'Search failed'); }
    finally { setLoading(false); }
  };

  const toggle = name => setExpanded(prev => { const n = new Set(prev); n.has(name) ? n.delete(name) : n.add(name); return n; });
  const bgName = bgs.find(g => g.id === orgId)?.name || '';

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-white flex items-center gap-2"><Users size={20} className="text-cyan-400" /> Global Search</h1>
        <p className="text-slate-500 text-sm mt-1">Search for a username across all app CPS non-secure & secure properties</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 bg-slate-900/50 border border-slate-800/60 rounded-2xl px-5 py-4">
        <div className="space-y-1.5">
          <label className="text-[10px] text-slate-500 uppercase tracking-wider font-bold">Business Group</label>
          {bgsLoad ? <div className="text-slate-500 text-xs flex items-center gap-2"><RefreshCw size={12} className="animate-spin" />Loading…</div> : (
            <select value={orgId} onChange={e => {
              setOrgId(e.target.value);
              setEnvId(''); setEnvName('');
              localStorage.setItem(LS_ORG, e.target.value);
              localStorage.removeItem(LS_ENV); localStorage.removeItem(LS_ENV_NAME);
              setResults(null); setError('');
            }}
              className="w-full bg-slate-800/60 border border-slate-700/50 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-cyan-600/50">
              <option value="">— Select BG —</option>
              {bgs.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          )}
        </div>
        <div className="space-y-1.5">
          <label className="text-[10px] text-slate-500 uppercase tracking-wider font-bold">Environment</label>
          {envsLoad ? <div className="text-slate-500 text-xs flex items-center gap-2"><RefreshCw size={12} className="animate-spin" />Loading…</div> : (
            <select value={envId}
              onChange={e => {
                const ev = envs.find(x => x.id === e.target.value);
                setEnvId(e.target.value); setEnvName(ev?.name || '');
                localStorage.setItem(LS_ENV, e.target.value);
                localStorage.setItem(LS_ENV_NAME, ev?.name || '');
                setResults(null); setError('');
              }}
              disabled={!orgId || !envs.length}
              className="w-full bg-slate-800/60 border border-slate-700/50 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-cyan-600/50 disabled:opacity-50">
              <option value="">— Select Environment —</option>
              {envs.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          )}
        </div>
        {bgName && envName && (
          <div className="flex items-end pb-1 gap-2 flex-wrap">
            <span className="text-[10px] px-2 py-0.5 rounded-full border bg-slate-800/60 text-slate-400 border-slate-700/50">🏢 {bgName}</span>
            <span className="text-[10px] px-2 py-0.5 rounded-full border bg-cyan-950/40 text-cyan-400 border-cyan-800/40">🌐 {envName}</span>
          </div>
        )}
      </div>

      <div className="flex gap-3 items-center">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
          <input value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => e.key === 'Enter' && !loading && runSearch()}
            placeholder="Enter username (e.g. john.doe@example.com)"
            className="w-full bg-slate-900/60 border border-slate-800/80 rounded-xl pl-10 pr-4 py-3 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-cyan-600/50 focus:bg-slate-900" />
        </div>
        <button onClick={runSearch} disabled={loading || !query.trim() || !orgId || !envId}
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
          {appsN > 0 && <p className="text-slate-500 text-xs">{appsN} apps with CPS config · parallel fetch running</p>}
          {appsT > 0 && (
            <div className="w-full max-w-xs space-y-1">
              <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden"><div className="h-full bg-cyan-600 rounded-full animate-pulse w-full" /></div>
              <p className="text-[10px] text-slate-600 text-center">{appsT} total apps in environment</p>
            </div>
          )}
        </div>
      )}

      {error && !loading && (
        <div className="flex items-start gap-3 bg-red-950/30 border border-red-800/50 rounded-xl px-4 py-3 text-red-400 text-sm">
          <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" /><span>{error}</span>
        </div>
      )}

      {results && !loading && (
        <div className="space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-3 bg-slate-900/50 border border-slate-800/60 rounded-2xl px-5 py-3">
            <div className="flex items-center gap-3 flex-wrap">
              <Users size={14} className="text-cyan-400" />
              <span className="text-white text-sm font-semibold">
                Results for <span className="text-cyan-300 font-mono bg-cyan-950/30 px-1.5 py-0.5 rounded">{query.trim()}</span>
              </span>
              <span className={`text-xs px-2.5 py-1 rounded-full font-bold border ${results.results.length > 0 ? 'bg-emerald-950/50 text-emerald-300 border-emerald-700/50' : 'bg-slate-800/60 text-slate-500 border-slate-700/40'}`}>
                {results.results.length} app{results.results.length !== 1 ? 's' : ''} matched
              </span>
            </div>
            <div className="flex items-center gap-4 text-[10px] text-slate-500">
              <span>🔍 {results.scanned} scanned</span>
              <span>⏭ {results.skipped} skipped</span>
            </div>
          </div>

          {results.results.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 gap-3 bg-slate-900/40 border border-slate-800/60 rounded-2xl">
              <Users size={32} className="text-slate-700" />
              <p className="text-slate-500 text-sm">No apps found with <span className="font-mono text-slate-400">"{query.trim()}"</span> in CPS properties</p>
              {results.skipped > 0 && <p className="text-slate-600 text-xs">{results.skipped} apps skipped (no CPS config or missing credentials)</p>}
            </div>
          )}

          {results.results.map(item => {
            const open = expanded.has(item.appName);
            const secN = item.matchedProps.filter(p => p.source === 'secure').length;
            const nsN  = item.matchedProps.filter(p => p.source === 'non-secure').length;
            return (
              <div key={item.appName} className="bg-slate-900/50 border border-slate-800/60 rounded-2xl overflow-hidden hover:border-slate-700/60 transition-colors">
                <button onClick={() => toggle(item.appName)}
                  className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-slate-800/20 transition-colors gap-3">
                  <div className="flex items-center gap-2 flex-wrap min-w-0 flex-1">
                    <span className="text-white font-semibold text-sm font-mono truncate">{item.appName}</span>
                    <span className="text-[10px] px-2 py-0.5 rounded-full font-bold border bg-emerald-950/40 text-emerald-300 border-emerald-700/40 flex-shrink-0">
                      {item.matchedProps.length} match{item.matchedProps.length !== 1 ? 'es' : ''}
                    </span>
                    {nsN > 0 && <span className="inline-flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded-full border bg-slate-800/60 text-slate-400 border-slate-700/40 flex-shrink-0"><Key size={8} /> {nsN} non-secure</span>}
                    {secN > 0 && <span className="inline-flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded-full border bg-orange-950/40 text-orange-300 border-orange-700/40 flex-shrink-0"><Lock size={8} /> {secN} secure</span>}
                  </div>
                  {open ? <ChevronDown size={15} className="text-slate-500 flex-shrink-0" /> : <ChevronRight size={15} className="text-slate-500 flex-shrink-0" />}
                </button>

                {open && (
                  <div className="border-t border-slate-800/60">
                    <table className="w-full text-sm border-collapse">
                      <thead>
                        <tr className="bg-slate-800/50 border-b border-slate-700/40">
                          <th className="px-5 py-2.5 text-left text-[10px] font-bold tracking-wider text-slate-500 uppercase w-[40%]">Property Key</th>
                          <th className="px-5 py-2.5 text-left text-[10px] font-bold tracking-wider text-slate-500 uppercase">Value</th>
                          <th className="px-5 py-2.5 text-left text-[10px] font-bold tracking-wider text-slate-500 uppercase w-28">Source</th>
                        </tr>
                      </thead>
                      <tbody>
                        {item.matchedProps.map((prop, i) => (
                          <tr key={i} className="group border-b border-slate-800/40 hover:bg-slate-800/30 transition-colors last:border-0">
                            <td className="px-5 py-3 align-top">
                              <div className="flex items-center gap-1.5">
                                <span className="text-slate-400 text-xs font-mono break-all">{prop.key}</span>
                                <CopyBtn text={prop.key} />
                              </div>
                            </td>
                            <td className="px-5 py-3 align-top">
                              <div className="flex items-center gap-1.5">
                                <span className="font-mono text-xs text-slate-200 break-all">{prop.value}</span>
                                <CopyBtn text={prop.value} />
                              </div>
                            </td>
                            <td className="px-5 py-3 align-top">
                              {prop.source === 'secure'
                                ? <span className="inline-flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded-full font-bold border bg-orange-950/40 text-orange-300 border-orange-700/40"><Lock size={8} /> Secure</span>
                                : <span className="inline-flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded-full font-bold border bg-slate-800/60 text-slate-400 border-slate-700/40"><Key size={8} /> Non-Secure</span>
                              }
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
