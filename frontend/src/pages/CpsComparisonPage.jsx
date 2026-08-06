import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { GitCompare, RefreshCw, Search, Copy, Check, Download, ArrowLeftRight, AlertTriangle, SlidersHorizontal, Key } from 'lucide-react';
import Select from '../components/Select';
import BgFilterModal, { applyBgFilter } from '../components/BgFilterModal';
import { useCpsCredentialStore } from '../context/CpsCredentialStoreContext';
import CpsCredentialImportButton from '../components/CpsCredentialImportButton';
import api from '../services/api';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function extractCpsProps(appDetail) {
  if (!appDetail) return {};
  const ds = appDetail.target?.deploymentSettings || {};
  const appCfg = appDetail.application?.configuration || {};
  const propsSvc = appCfg['mule.agent.application.properties.service'] || {};
  const runtimeProps = propsSvc.properties || {};
  const envVars = ds.environmentVariables || ds.environmentVars || {};
  const allProps = { ...appDetail.properties, ...runtimeProps, ...ds.properties, ...envVars };
  return {
    cpsBaseUrl:  allProps['cps.configServerBaseUrl'] || allProps['config.server.base.url'] || '',
    cpsKey:      allProps['cps.projectName']          || allProps['cloudhub.api.name']       || appDetail.name || '',
    cpsEnv:      allProps['cps.prefix']               || allProps['cps.environment']          || '',
    // CPS client ID — secret resolved from the imported CSV
    cpsClientId: allProps['cps.clientId'] || allProps['cps.client_id'] || allProps['cps.client.id'] || allProps['cps.apiClientId'] || '',
  };
}

const PROP_TYPE_OPTS = [
  { value: 'non-secure', label: 'Non-Secure Properties' },
  { value: 'secure',     label: 'Secure Properties' },
  { value: 'binaries',   label: 'Binary Assets' },
];

function flattenCpsResponse(data) {
  if (!data) return {};
  if (Array.isArray(data?.responses)) {
    const map = {};
    data.responses.forEach(r => Object.assign(map, r.properties || {}));
    return map;
  }
  if (Array.isArray(data)) {
    const map = {};
    data.forEach(r => { if (r?.properties && typeof r.properties === 'object') Object.assign(map, r.properties); });
    if (Object.keys(map).length > 0) return map;
  }
  if (typeof data === 'object' && !Array.isArray(data)) {
    const firstVal = Object.values(data)[0];
    if (firstVal && typeof firstVal === 'object' && !Array.isArray(firstVal)) {
      const map = {};
      Object.values(data).forEach(v => { if (v && typeof v === 'object') Object.assign(map, v); });
      return map;
    }
    return data;
  }
  return {};
}

function CopyBtn({ text }) {
  const [done, setDone] = useState(false);
  return (
    <button onClick={() => { navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500); }}
      className="text-gray-600 hover:text-gray-300 transition-colors p-0.5">
      {done ? <Check size={10} className="text-emerald-400" /> : <Copy size={10} />}
    </button>
  );
}

const ENV_BADGE = { production: 'bg-green-400', sandbox: 'bg-yellow-400', design: 'bg-blue-400' };
const ENV_TAG = { production: 'bg-green-500/20 text-green-400', sandbox: 'bg-yellow-500/20 text-yellow-400' };

// ─── SidePanel ────────────────────────────────────────────────────────────────

function SidePanel({ label, color, state, filteredBgs, propType, onPropTypeChange, onUpdate, onLoadEnvs, onLoadApps, onSelectApp }) {
  const { bgId, envId, envs, apps, appId, loadingEnvs, loadingApps, loadingDetail, cpsUrl, cpsEnv, cpsKey, credsResolved } = state;
  const isBlue = color === 'border-blue-700/50';
  const showEnvInLabel = bgId === '__all__' || !envId; // show env name in app label when "all"

  const bgOptions = [
    { value: '__all__', label: 'All Organizations', tag: `${filteredBgs.length}`, tagColor: 'bg-gray-700 text-gray-300' },
    ...filteredBgs.map(g => ({ value: g.id, label: g.name, tag: !g.parentId ? 'Root' : undefined, tagColor: 'bg-blue-500/20 text-blue-400', indent: !!g.parentId })),
  ];

  const envOptions = [
    { value: '__all__', label: 'All Environments' },
    ...envs.map(e => ({ value: e.id, label: e.name, badge: true, badgeColor: ENV_BADGE[e.type] || 'bg-gray-400', tag: e.type, tagColor: ENV_TAG[e.type] || 'bg-gray-700 text-gray-400' })),
  ];

  // App options: when showing all, include env name in label for disambiguation
  const appOptions = apps.map(a => ({
    value: `${a.id}|${a.environment?.id || ''}|${a._bgId || ''}`,
    label: showEnvInLabel ? `${a.name} (${a.environment?.name || ''})` : a.name,
    tag: a.deploymentType === 'CloudHub 2.0' ? 'CH2' : 'CH1',
    tagColor: a.deploymentType === 'CloudHub 2.0' ? 'bg-blue-500/20 text-blue-400' : 'bg-purple-500/20 text-purple-400',
  }));

  return (
    <div className={`flex-1 min-w-0 bg-gray-900 border ${color} rounded-xl p-4 space-y-3`}>
      <div className="flex items-center justify-between">
        <p className={`text-xs font-bold uppercase tracking-wider ${isBlue ? 'text-blue-400' : 'text-orange-400'}`}>{label}</p>
        {credsResolved && (
          <span className="flex items-center gap-1 text-[9px] text-emerald-400 bg-emerald-500/10 border border-emerald-700/40 px-1.5 py-0.5 rounded">
            <Key size={8} /> CPS creds auto-filled
          </span>
        )}
      </div>

      {/* Property type tabs — per-side selection */}
      <div className="flex gap-1">
        {PROP_TYPE_OPTS.map(opt => (
          <button key={opt.value} onClick={() => onPropTypeChange(opt.value)}
            className={`flex-1 text-[10px] py-1 px-1.5 rounded-lg border font-medium transition-all text-center ${
              propType === opt.value
                ? (isBlue ? 'bg-blue-600/20 border-blue-600/50 text-blue-300' : 'bg-orange-600/20 border-orange-600/50 text-orange-300')
                : 'bg-gray-800 border-gray-700 text-gray-500 hover:text-gray-300'
            }`}>
            {opt.value === 'non-secure' ? 'Non-Secure' : opt.value === 'secure' ? 'Secure' : 'Binaries'}
          </button>
        ))}
      </div>

      {/* BG — includes "All Organizations" option */}
      <div>
        <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Business Group</p>
        <Select
          value={bgId}
          onChange={v => {
            onUpdate({ bgId: v, envId: '__all__', appId: '', envs: [], apps: [], cpsUrl: '', cpsEnv: '', cpsKey: '', credsResolved: false });
            onLoadEnvs(v);
            onLoadApps(v, '__all__');
          }}
          options={bgOptions}
          placeholder="Select Business Group…"
          searchable={filteredBgs.length > 5}
        />
      </div>

      {/* Env — optional; "All Environments" triggers loading all apps */}
      <div>
        <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1 flex items-center gap-1">
          Environment {loadingEnvs && <RefreshCw size={9} className="animate-spin text-gray-600" />}
        </p>
        <Select
          value={envId || '__all__'}
          onChange={v => { onUpdate({ envId: v, appId: '', apps: [], cpsUrl: '', cpsEnv: '', cpsKey: '', credsResolved: false }); onLoadApps(bgId, v); }}
          options={envOptions}
          placeholder="All Environments"
          disabled={!bgId}
        />
      </div>

      {/* App — searchable, always enabled once BG is set */}
      <div>
        <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1 flex items-center gap-1">
          Application {loadingApps && <RefreshCw size={9} className="animate-spin text-gray-600" />}
          {loadingDetail && <span className="text-[9px] text-cyan-400 ml-1">Resolving CPS config…</span>}
          {apps.length > 0 && <span className="text-[9px] text-gray-600 ml-auto">{apps.length} apps</span>}
        </p>
        <Select
          value={appId}
          onChange={v => onSelectApp(v)}
          options={appOptions}
          placeholder={bgId ? 'Search application…' : 'Select a BG first…'}
          disabled={!bgId}
          searchable
        />
      </div>

      {/* CPS config — auto-filled, editable */}
      <div className="pt-2 border-t border-gray-800/60 space-y-2">
        <p className="text-[10px] text-gray-500 uppercase tracking-wider">CPS Configuration (auto-filled)</p>
        <div>
          <label className="text-[10px] text-gray-600 block mb-0.5">CPS Base URL</label>
          <input value={cpsUrl} onChange={e => onUpdate({ cpsUrl: e.target.value })} placeholder="https://cps-server.api.sfdcbt.net"
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2.5 py-1.5 text-xs text-gray-200 font-mono focus:outline-none focus:border-cyan-600/50 placeholder-gray-600" />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-[10px] text-gray-600 block mb-0.5">CPS Environment</label>
            <input value={cpsEnv} onChange={e => onUpdate({ cpsEnv: e.target.value })} placeholder="prod / uat"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2.5 py-1.5 text-xs text-gray-200 font-mono focus:outline-none focus:border-cyan-600/50 placeholder-gray-600" />
          </div>
          <div>
            <label className="text-[10px] text-gray-600 block mb-0.5">Project Key</label>
            <input value={cpsKey} onChange={e => onUpdate({ cpsKey: e.target.value })} placeholder="my-api-name"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2.5 py-1.5 text-xs text-gray-200 font-mono focus:outline-none focus:border-cyan-600/50 placeholder-gray-600" />
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

const INIT_SIDE = { bgId: '', envId: '__all__', envs: [], apps: [], appId: '', loadingEnvs: false, loadingApps: false, loadingDetail: false, cpsUrl: '', cpsEnv: '', cpsKey: '', credsResolved: false };

export default function CpsComparisonPage() {
  const { getSecret, hasCredentials } = useCpsCredentialStore();
  const [allBgs, setAllBgs] = useState([]);
  const [showBgFilter, setShowBgFilter] = useState(false);
  // Each side has its own property type
  const [propTypeA, setPropTypeA] = useState('non-secure');
  const [propTypeB, setPropTypeB] = useState('non-secure');
  const [sideA, setSideA] = useState({ ...INIT_SIDE });
  const [sideB, setSideB] = useState({ ...INIT_SIDE });
  const [comparing, setComparing] = useState(false);
  const [propsA, setPropsA] = useState(null); // flat {k:v} map or null
  const [propsB, setPropsB] = useState(null);
  const [errorA, setErrorA] = useState('');
  const [errorB, setErrorB] = useState('');
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');

  // Load BGs on mount
  useEffect(() => {
    api.get('/organizations/business-groups').then(r => setAllBgs(r.data.data || [])).catch(() => {});
  }, []);

  const updateSide = useCallback((side, updates) => {
    (side === 'A' ? setSideA : setSideB)(prev => ({ ...prev, ...updates }));
  }, []);

  const loadEnvs = useCallback(async (side, bgId) => {
    if (!bgId) return;
    updateSide(side, { loadingEnvs: true, envs: [] });
    try {
      const r = await api.get(`/environments/${bgId}`);
      updateSide(side, { envs: r.data.data || [], loadingEnvs: false });
    } catch {
      updateSide(side, { loadingEnvs: false });
    }
  }, [updateSide]);

  const loadApps = useCallback(async (side, bgId, envId) => {
    if (!bgId) return;
    updateSide(side, { loadingApps: true, apps: [] });
    try {
      const visible = applyBgFilter(allBgs);
      // Determine which BG IDs to fetch from
      const bgIds = bgId === '__all__'
        ? (visible.length > 0 ? visible.map(g => g.id) : [])
        : [bgId];

      if (bgIds.length === 0) { updateSide(side, { loadingApps: false }); return; }

      const results = await Promise.allSettled(bgIds.map(id => api.get(`/applications/summary/${id}`)));
      const merged = [];
      const seen = new Set();
      results.forEach((r, i) => {
        if (r.status === 'fulfilled') {
          (r.value.data.data || []).forEach(a => {
            // Filter by env if a specific env is selected
            if (envId && envId !== '__all__' && a.environment?.id !== envId) return;
            const key = `${a.id}|${a.environment?.id || ''}`;
            if (!seen.has(key)) { seen.add(key); merged.push({ ...a, _bgId: bgIds[i] }); }
          });
        }
      });
      updateSide(side, { apps: merged, loadingApps: false });
    } catch {
      updateSide(side, { loadingApps: false });
    }
  }, [allBgs, updateSide]);

  const selectApp = useCallback(async (side, compositeId) => {
    const sideState = side === 'A' ? sideA : sideB;
    // compositeId = "appId|envId|bgId"
    const [appId, envId, bgId] = compositeId.split('|');
    const app = sideState.apps.find(a =>
      String(a.id) === appId &&
      (a.environment?.id === envId || !envId) &&
      (a._bgId === bgId || !bgId)
    ) || sideState.apps.find(a => String(a.id) === appId);
    if (!app) return;

    const resolvedBgId = bgId || app._bgId || sideState.bgId;
    const resolvedEnvId = envId || app.environment?.id || sideState.envId;

    updateSide(side, { appId: compositeId, loadingDetail: true, cpsUrl: '', cpsEnv: '', cpsKey: '', credsResolved: false });
    try {
      let detail;
      if (app.deploymentType === 'CloudHub 2.0') {
        const r = await api.get(`/applications/cloudhub2/${resolvedBgId}/${resolvedEnvId}/${app.id}`);
        detail = r.data;
      } else {
        const r = await api.get(`/applications/cloudhub1/${resolvedEnvId}/${app.id}`, { params: { orgId: resolvedBgId } });
        detail = { name: app.name, properties: r.data.properties || {} };
      }
      const extracted = extractCpsProps(detail);

      // Auto-resolve CPS credentials from the imported CPS CSV
      let credsResolved = false;
      if (extracted.cpsClientId && extracted.cpsBaseUrl && hasCredentials) {
        const clientSecret = getSecret(extracted.cpsClientId);
        if (clientSecret) {
          try {
            const credKey = `${extracted.cpsBaseUrl.trim().replace(/\/+$/, '').replace(/\/api\/v2\/?$/, '')}::${resolvedBgId}`;
            await api.post('/cps/credentials', {
              credentials: { [credKey]: { clientId: extracted.cpsClientId, clientSecret } }
            });
            credsResolved = true;
          } catch { /* non-fatal */ }
        }
      }

      updateSide(side, {
        loadingDetail: false,
        cpsUrl: extracted.cpsBaseUrl,
        cpsEnv: extracted.cpsEnv,
        cpsKey: extracted.cpsKey,
        credsResolved,
      });
    } catch {
      updateSide(side, { loadingDetail: false });
    }
  }, [sideA, sideB, updateSide, hasCredentials, getSecret]);

  // Swap sides
  const swapSides = () => {
    setSideA({ ...sideB });
    setSideB({ ...sideA });
    setPropsA(propsB);
    setPropsB(propsA);
    setErrorA(errorB);
    setErrorB(errorA);
  };

  // Filtered BGs (respects BG filter modal)
  const filteredBgs = applyBgFilter(allBgs);
  const filterActive = filteredBgs.length < allBgs.length;

  // Compare — each side uses its own propType
  const compare = async () => {
    setComparing(true);
    setPropsA(null); setPropsB(null);
    setErrorA(''); setErrorB('');

    /**
     * Fetch CPS properties for one side.
     *
     * For non-secure: direct fetch, flatten to {key: value} map.
     *
     * For secure / binaries: the keys are NOT known up-front — they live inside
     * the non-secure response as:
     *   cps.secure.properties  →  comma-separated list of keys for secure fetch
     *   cps.secure.binaries    →  comma-separated list of keys for binary fetch
     *
     * So we always fetch non-secure first, extract those key lists, then fetch
     * the requested type using the discovered keys.
     */
    const fetchSide = async (s, pt) => {
      if (!s.cpsUrl || !s.cpsKey) throw new Error('CPS URL and project key are required');

      const baseParams = {
        baseUrl: s.cpsUrl,
        environment: s.cpsEnv || undefined,
        bgOrgId: (s.bgId && s.bgId !== '__all__') ? s.bgId : undefined,
      };

      if (pt === 'non-secure') {
        const r = await api.get('/cps/fetch', { params: { ...baseParams, type: 'non-secure', keys: s.cpsKey } });
        return flattenCpsResponse(r.data);
      }

      // For secure or binaries — first fetch non-secure to discover the sub-keys
      const nsR = await api.get('/cps/fetch', { params: { ...baseParams, type: 'non-secure', keys: s.cpsKey } });
      const nsFlat = flattenCpsResponse(nsR.data);

      if (pt === 'secure') {
        const secureKeysRaw = nsFlat['cps.secure.properties'] || '';
        if (!secureKeysRaw.trim()) {
          return {}; // no secure properties defined for this app
        }
        const secureKeys = secureKeysRaw.split(',').map(k => k.trim()).filter(Boolean).join(',');
        const r = await api.get('/cps/fetch', { params: { ...baseParams, type: 'secure', keys: secureKeys } });
        return flattenCpsResponse(r.data);
      }

      if (pt === 'binaries') {
        const binaryKeysRaw = nsFlat['cps.secure.binaries'] || '';
        if (!binaryKeysRaw.trim()) {
          return {}; // no binaries defined for this app
        }
        const binaryKeys = binaryKeysRaw.split(',').map(k => k.trim()).filter(Boolean).join(',');
        const r = await api.get('/cps/fetch', { params: { ...baseParams, type: 'binaries', keys: binaryKeys } });
        // Binaries response: { type:'binaries', binaries:[{ key, size, contentType }] }
        const binData = r.data?.binaries || r.data || [];
        const binMap = {};
        (Array.isArray(binData) ? binData : []).forEach(b => {
          const name = b.key || b.name || '?';
          binMap[name] = b.size != null ? `${b.contentType || 'binary'} (${b.size} bytes)` : (b.contentType || 'present');
        });
        return binMap;
      }

      return {};
    };

    const [resA, resB] = await Promise.allSettled([fetchSide(sideA, propTypeA), fetchSide(sideB, propTypeB)]);

    if (resA.status === 'fulfilled') setPropsA(resA.value);
    else setErrorA(resA.reason?.response?.data?.error || resA.reason?.message || 'Failed');

    if (resB.status === 'fulfilled') setPropsB(resB.value);
    else setErrorB(resB.reason?.response?.data?.error || resB.reason?.message || 'Failed');

    setComparing(false);
    setFilter('all');
    setSearch('');
  };

  // Build diff
  const diff = useMemo(() => {
    if (!propsA && !propsB) return [];
    const a = propsA || {};
    const b = propsB || {};
    const allKeys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
    return allKeys.map(key => {
      const valA = key in a ? String(a[key] ?? '') : null;
      const valB = key in b ? String(b[key] ?? '') : null;
      let status;
      if (valA === null) status = 'only-b';
      else if (valB === null) status = 'only-a';
      else if (valA === valB) status = 'matching';
      else status = 'different';
      return { key, valA, valB, status };
    });
  }, [propsA, propsB]);

  const stats = useMemo(() => ({
    total: diff.length,
    different: diff.filter(d => d.status === 'different').length,
    'only-a': diff.filter(d => d.status === 'only-a').length,
    'only-b': diff.filter(d => d.status === 'only-b').length,
    matching: diff.filter(d => d.status === 'matching').length,
  }), [diff]);

  const displayRows = useMemo(() => {
    let rows = filter === 'all' ? diff : diff.filter(d => d.status === filter);
    if (search.trim()) rows = rows.filter(d => d.key.toLowerCase().includes(search.toLowerCase()));
    return rows;
  }, [diff, filter, search]);

  const canCompare = (sideA.cpsUrl && sideA.cpsKey) || (sideB.cpsUrl && sideB.cpsKey);
  const hasResults = propsA !== null || propsB !== null;

  // Export CSV
  const exportCsv = () => {
    const rows = [['Property Key', `Side A (${sideA.cpsKey || 'A'})`, `Side B (${sideB.cpsKey || 'B'})`, 'Status']];
    diff.forEach(d => rows.push([d.key, d.valA ?? '(not set)', d.valB ?? '(not set)', d.status.toUpperCase()]));
    const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cps-comparison-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const STATUS_ROW = {
    different: 'bg-red-950/20 border-l-2 border-red-600',
    'only-a':  'bg-blue-950/20 border-l-2 border-blue-600',
    'only-b':  'bg-orange-950/20 border-l-2 border-orange-600',
    matching:  '',
  };
  const STATUS_BADGE = {
    different: 'text-red-400 bg-red-500/10 border-red-700/40',
    'only-a':  'text-blue-400 bg-blue-500/10 border-blue-700/40',
    'only-b':  'text-orange-400 bg-orange-500/10 border-orange-700/40',
    matching:  'text-emerald-400 bg-emerald-500/10 border-emerald-700/40',
  };
  const STATUS_LABEL = { different: 'DIFF', 'only-a': 'A ONLY', 'only-b': 'B ONLY', matching: 'MATCH' };

  return (
    <div className="space-y-5">
      {showBgFilter && (
        <BgFilterModal businessGroups={allBgs} onClose={() => setShowBgFilter(false)} onSaved={() => {}} />
      )}

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <GitCompare size={20} className="text-cyan-400" /> CPS Properties Comparison
          </h1>
          <p className="text-gray-400 text-sm mt-1">Compare CPS property values between two environments side-by-side</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* CPS credentials import */}
          <CpsCredentialImportButton />
          {/* BG Filter button */}
          <button onClick={() => setShowBgFilter(true)}
            className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border transition-all ${filterActive ? 'bg-blue-600/20 border-blue-600/50 text-blue-400' : 'bg-gray-800 border-gray-700 text-gray-500 hover:text-gray-300'}`}>
            <SlidersHorizontal size={11} />
            {filterActive ? `${filteredBgs.length}/${allBgs.length} BGs` : 'Filter BGs'}
          </button>
          {hasResults && (
            <button onClick={exportCsv}
              className="flex items-center gap-2 px-3 py-1.5 text-xs text-emerald-400 hover:text-emerald-300 bg-emerald-950/40 hover:bg-emerald-950/60 border border-emerald-800/50 rounded-lg transition-colors">
              <Download size={12} /> Export CSV
            </button>
          )}
        </div>
      </div>

      {/* Side panels */}
      <div className="flex flex-col lg:flex-row gap-4 items-stretch">
        <SidePanel
          label="Side A"
          color="border-blue-700/50"
          state={sideA}
          filteredBgs={filteredBgs}
          propType={propTypeA}
          onPropTypeChange={setPropTypeA}
          onUpdate={u => updateSide('A', u)}
          onLoadEnvs={bgId => loadEnvs('A', bgId)}
          onLoadApps={(bgId, envId) => loadApps('A', bgId, envId)}
          onSelectApp={id => selectApp('A', id)}
        />

        {/* Swap + Compare button column */}
        <div className="flex lg:flex-col items-center justify-center gap-3 lg:py-4">
          <button onClick={swapSides} title="Swap sides"
            className="p-2 text-gray-500 hover:text-white bg-gray-800 hover:bg-gray-700 rounded-lg border border-gray-700 transition-colors">
            <ArrowLeftRight size={14} />
          </button>
          <button onClick={compare} disabled={comparing || !canCompare}
            className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium bg-cyan-700 hover:bg-cyan-600 disabled:opacity-50 text-white rounded-lg transition-colors">
            {comparing ? <><RefreshCw size={13} className="animate-spin" /> Comparing…</> : <><GitCompare size={13} /> Compare</>}
          </button>
        </div>

        <SidePanel
          label="Side B"
          color="border-orange-700/50"
          state={sideB}
          filteredBgs={filteredBgs}
          propType={propTypeB}
          onPropTypeChange={setPropTypeB}
          onUpdate={u => updateSide('B', u)}
          onLoadEnvs={bgId => loadEnvs('B', bgId)}
          onLoadApps={(bgId, envId) => loadApps('B', bgId, envId)}
          onSelectApp={id => selectApp('B', id)}
        />
      </div>

      {/* Errors */}
      {(errorA || errorB) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {errorA && (
            <div className="flex items-start gap-2 bg-red-950/30 border border-red-800/50 rounded-xl px-4 py-3 text-red-400 text-xs">
              <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" />
              <span><strong>Side A:</strong> {errorA}</span>
            </div>
          )}
          {errorB && (
            <div className={`flex items-start gap-2 bg-red-950/30 border border-red-800/50 rounded-xl px-4 py-3 text-red-400 text-xs ${!errorA ? 'lg:col-start-2' : ''}`}>
              <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" />
              <span><strong>Side B:</strong> {errorB}</span>
            </div>
          )}
        </div>
      )}

      {/* Results */}
      {hasResults && diff.length > 0 && (
        <div className="space-y-3">
          {/* Stats + filter tabs */}
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-2 flex-wrap">
              {['all', 'different', 'only-a', 'only-b', 'matching'].map(f => (
                <button key={f} onClick={() => setFilter(f)}
                  className={`text-xs px-3 py-1.5 rounded-lg border font-medium transition-all ${
                    filter === f ? 'bg-cyan-600/20 border-cyan-600/60 text-cyan-300' : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-white'
                  }`}>
                  {f === 'all' ? `All (${stats.total})`
                    : f === 'different' ? `🔴 Different (${stats.different})`
                    : f === 'only-a'   ? `🔵 Only A (${stats['only-a']})`
                    : f === 'only-b'   ? `🟠 Only B (${stats['only-b']})`
                    : `✅ Matching (${stats.matching})`}
                </button>
              ))}
            </div>
            {/* Search */}
            <div className="relative">
              <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Filter by key…"
                className="bg-gray-800 border border-gray-700 rounded-lg pl-7 pr-3 py-1.5 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-cyan-600/50 w-48" />
            </div>
          </div>

          {/* Diff table */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
            {/* Column headers */}
            <div className="grid grid-cols-[1fr_1fr_1fr_80px] bg-gray-800/60 text-gray-400 text-[10px] uppercase tracking-wider px-4 py-2.5 gap-3">
              <span>Property Key</span>
              <span>Side A ({sideA.cpsKey || '—'})</span>
              <span>Side B ({sideB.cpsKey || '—'})</span>
              <span className="text-center">Status</span>
            </div>

            <div className="divide-y divide-gray-800/40 max-h-[60vh] overflow-y-auto">
              {displayRows.length === 0 ? (
                <div className="px-4 py-10 text-center text-gray-500 text-sm">No properties match the current filter.</div>
              ) : displayRows.map(row => (
                <div key={row.key} className={`grid grid-cols-[1fr_1fr_1fr_80px] gap-3 px-4 py-2.5 group transition-colors hover:bg-gray-800/20 ${STATUS_ROW[row.status] || ''}`}>
                  {/* Key */}
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="font-mono text-xs text-gray-300 truncate" title={row.key}>{row.key}</span>
                    <CopyBtn text={row.key} />
                  </div>
                  {/* Value A */}
                  <div className="flex items-center gap-1.5 min-w-0">
                    {row.valA !== null ? (
                      <>
                        <span className={`font-mono text-xs truncate ${row.status === 'different' ? 'text-red-300' : 'text-gray-300'}`} title={row.valA}>{row.valA}</span>
                        <CopyBtn text={row.valA} />
                      </>
                    ) : <span className="text-[10px] text-gray-700 italic">not set</span>}
                  </div>
                  {/* Value B */}
                  <div className="flex items-center gap-1.5 min-w-0">
                    {row.valB !== null ? (
                      <>
                        <span className={`font-mono text-xs truncate ${row.status === 'different' ? 'text-orange-300' : 'text-gray-300'}`} title={row.valB}>{row.valB}</span>
                        <CopyBtn text={row.valB} />
                      </>
                    ) : <span className="text-[10px] text-gray-700 italic">not set</span>}
                  </div>
                  {/* Status badge */}
                  <div className="flex items-center justify-center">
                    <span className={`text-[9px] px-2 py-0.5 rounded-full border font-bold ${STATUS_BADGE[row.status]}`}>
                      {STATUS_LABEL[row.status]}
                    </span>
                  </div>
                </div>
              ))}
            </div>

            {/* Footer */}
            {displayRows.length > 0 && (
              <div className="px-4 py-2 bg-gray-800/30 border-t border-gray-800 text-[10px] text-gray-600">
                Showing {displayRows.length} of {diff.length} properties
                {search && ` · filtered by "${search}"`}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Empty state after compare */}
      {hasResults && diff.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 gap-3 bg-gray-900 border border-gray-800 rounded-xl">
          <GitCompare size={40} className="text-gray-700" />
          <p className="text-gray-400 text-sm">No properties found — check the CPS URL, credentials and project key.</p>
        </div>
      )}

      {/* Initial empty state */}
      {!hasResults && !comparing && (
        <div className="flex flex-col items-center justify-center py-16 gap-3 bg-gray-900 border border-gray-800 rounded-xl">
          <GitCompare size={40} className="text-gray-700" />
          <p className="text-gray-500 text-sm">Select apps on both sides, then click <strong className="text-white">Compare</strong></p>
          <p className="text-gray-600 text-xs">CPS URL and project key will be auto-filled from the selected app's runtime properties</p>
        </div>
      )}
    </div>
  );
}
