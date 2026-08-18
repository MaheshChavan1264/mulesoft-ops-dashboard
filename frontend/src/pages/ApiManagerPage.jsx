import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { RefreshCw, ShieldCheck, Search, SlidersHorizontal, ChevronRight, Users, CheckCircle, XCircle, Clock, AlertCircle } from 'lucide-react';
import StatusBadge from '../components/StatusBadge';
import Select from '../components/Select';
import BgFilterModal, { applyBgFilter } from '../components/BgFilterModal';
import api from '../services/api';
import { ENV_BADGE } from '../utils/appUtils';

const ENV_TAG_COLOR = { production: 'bg-green-500/20 text-green-400', sandbox: 'bg-yellow-500/20 text-yellow-400' };

function ContractCard({ c, i }) {
  const appName =
    c.application?.name ||
    c.clientApplication?.name ||
    c.applicationName ||
    `App ${c.clientApplicationId || c.applicationId || c.id}`;

  // coreServicesId inside application{} IS the OAuth client_id in Anypoint Platform.
  // The contracts endpoint never returns a field literally named "clientId" —
  // the client credential is stored as application.coreServicesId.
  const clientId =
    c.application?.coreServicesId ||              // PRIMARY — confirmed as the client_id
    c._enrichedClientId ||                         // Exchange API enrichment (fallback)
    c.application?.clientId ||
    c.application?.client_id ||
    c.application?.credentials?.clientId ||
    c.clientApplication?.coreServicesId ||
    c.clientApplication?.clientId ||
    c.clientId ||
    c.client_id ||
    null;

  const clientAppId =
    c.application?.id ||
    c.clientApplication?.id ||
    c.clientApplicationId ||
    c.applicationId ||
    null;
  const status = (c.status || 'ACTIVE').toUpperCase();
  const tierName = c.tier?.name || c.requestedTier?.name || null;
  const created = c.createdDate ? new Date(c.createdDate).toLocaleDateString() : null;

  const statusIcon =
    status === 'ACTIVE' ? <CheckCircle size={12} className="text-green-400 flex-shrink-0" /> :
    status === 'REVOKED' ? <XCircle size={12} className="text-red-400 flex-shrink-0" /> :
    status === 'PENDING_APPROVAL' ? <Clock size={12} className="text-yellow-400 flex-shrink-0" /> :
    <AlertCircle size={12} className="text-gray-400 flex-shrink-0" />;

  const statusColor =
    status === 'ACTIVE' ? 'text-green-400 bg-green-500/10 border-green-700/40' :
    status === 'REVOKED' ? 'text-red-400 bg-red-500/10 border-red-700/40' :
    status === 'PENDING_APPROVAL' ? 'text-yellow-400 bg-yellow-500/10 border-yellow-700/40' :
    'text-gray-400 bg-gray-700/30 border-gray-600/40';

  return (
    <div key={c.id || i} className="px-5 py-3 hover:bg-gray-800/30 transition-colors">
      <div className="flex items-start justify-between gap-3 mb-2">
        <p className="text-white text-sm font-medium truncate">{appName}</p>
        <span className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border font-semibold flex-shrink-0 ${statusColor}`}>
          {statusIcon}{status.replace('_', ' ')}
        </span>
      </div>
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <span className="text-gray-500 text-[10px] w-16 flex-shrink-0">Client ID</span>
          <span className="font-mono text-[10px] bg-gray-800 px-1.5 py-0.5 rounded text-gray-300 break-all select-all">
            {clientId || '—'}
          </span>
        </div>
        {clientAppId && (
          <div className="flex items-center gap-2">
            <span className="text-gray-500 text-[10px] w-16 flex-shrink-0">App ID</span>
            <span className="font-mono text-[10px] text-gray-500">{clientAppId}</span>
          </div>
        )}
        <div className="flex items-center gap-2 flex-wrap pt-0.5">
          {tierName && (
            <span className="text-blue-400 text-[10px] bg-blue-500/10 border border-blue-700/40 px-1.5 py-0.5 rounded">{tierName}</span>
          )}
          {created && <span className="text-gray-600 text-[10px]">{created}</span>}
        </div>
      </div>
    </div>
  );
}

function PolicyCard({ p, i }) {
  const policyName =
    p.template?.name || p.template?.assetId || p.assetId ||
    (typeof p.policyTemplateId === 'string' && isNaN(p.policyTemplateId) ? p.policyTemplateId : null) ||
    `Policy ${p.id}`;
  const rawVer = p.template?.assetVersion || p.assetVersion;
  const policyVersion = rawVer && String(rawVer).length <= 10 ? rawVer : null;
  return (
    <div key={p.id || i} className="px-5 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-white text-sm font-medium capitalize">{policyName.replace(/-/g, ' ')}</p>
        <span className={`text-[10px] px-2 py-0.5 rounded-full border font-semibold flex-shrink-0 ${p.disabled ? 'text-red-400 bg-red-500/10 border-red-700/40' : 'text-green-400 bg-green-500/10 border-green-700/40'}`}>
          {p.disabled ? 'Disabled' : 'Active'}
        </span>
      </div>
      <div className="flex items-center gap-2 mt-0.5">
        <p className="text-gray-500 text-xs font-mono">{policyName}</p>
        {policyVersion && <span className="text-gray-600 text-[10px]">v{policyVersion}</span>}
      </div>
    </div>
  );
}

export default function ApiManagerPage() {
  const { orgId: authOrgId } = useAuth();
  const [allBusinessGroups, setAllBusinessGroups] = useState([]);
  const [selectedBg, setSelectedBg] = useState('');
  const [bgLoading, setBgLoading] = useState(true);
  const [showBgFilter, setShowBgFilter] = useState(false);
  const [environments, setEnvironments] = useState([]);
  const [selectedEnv, setSelectedEnv] = useState('');
  const [apis, setApis] = useState([]);
  const [selectedApi, setSelectedApi] = useState(null);
  const [policies, setPolicies] = useState([]);
  const [contracts, setContracts] = useState([]);
  const [contractsLoading, setContractsLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');

  useEffect(() => { if (authOrgId) loadBusinessGroups(); }, [authOrgId]);
  useEffect(() => { if (selectedBg) loadEnvs(selectedBg); }, [selectedBg]);
  useEffect(() => { if (selectedBg && selectedEnv) loadApis(); }, [selectedBg, selectedEnv]);

  const loadBusinessGroups = async () => {
    setBgLoading(true);
    try {
      const res = await api.get('/organizations/business-groups');
      const groups = res.data.data || [];
      setAllBusinessGroups(groups);
      const visible = applyBgFilter(groups);
      const root = visible.find(g => !g.parentId) || visible[0];
      setSelectedBg(root?.id || authOrgId);
    } catch { setSelectedBg(authOrgId); }
    setBgLoading(false);
  };

  const loadEnvs = async (bgId) => {
    setSelectedEnv(''); setApis([]); setSelectedApi(null);
    try {
      const res = await api.get(`/environments/${bgId}`);
      const envs = res.data.data || [];
      setEnvironments(envs);
      if (envs.length > 0) setSelectedEnv(envs[0].id);
    } catch { setEnvironments([]); }
  };

  const loadApis = async () => {
    setLoading(true); setError(''); setApis([]); setSelectedApi(null);
    try {
      const res = await api.get(`/apis/${selectedBg}/${selectedEnv}`);
      const data = res.data;
      const rawItems = data.assets || data.data || (Array.isArray(data) ? data : []);
      const list = rawItems.flatMap(item =>
        Array.isArray(item.apis) && item.apis.length > 0
          ? item.apis.map(inst => ({ ...inst, assetId: inst.assetId || item.assetId, assetVersion: inst.assetVersion || item.assetVersion, groupId: inst.groupId || item.groupId }))
          : [item]
      );
      setApis(list);
      if (list.length === 0) setError('No API instances found in this environment.');
    } catch (e) {
      setError(e.response?.data?.error || e.response?.data?.message || 'Failed to load API instances.');
      setApis([]);
    }
    setLoading(false);
  };

  const selectApi = async (apiInstance) => {
    setSelectedApi(apiInstance); setPolicies([]); setContracts([]); setContractsLoading(true);

    const [pRes, cRes] = await Promise.allSettled([
      api.get(`/apis/${selectedBg}/${selectedEnv}/${apiInstance.id}/policies`),
      api.get(`/apis/${selectedBg}/${selectedEnv}/${apiInstance.id}/contracts`),
    ]);

    if (pRes.status === 'fulfilled') {
      const d = pRes.value.data;
      setPolicies(d.policies || (Array.isArray(d) ? d : []));
    }

    let contractList = [];
    if (cRes.status === 'fulfilled') {
      const d = cRes.value.data;
      contractList = d.contracts || (Array.isArray(d) ? d : []);
    }

    // No enrichment needed — coreServicesId in application{} is the client_id.
    setContracts(contractList);
    setContractsLoading(false);
  };

  const visibleGroups = applyBgFilter(allBusinessGroups);
  const filterActive = visibleGroups.length < allBusinessGroups.length;
  const selectedBgName = visibleGroups.find(g => g.id === selectedBg)?.name || 'Organization';
  const bgOptions = visibleGroups.map(g => ({ value: g.id, label: g.name, indent: !!g.parentId, tag: !g.parentId ? 'Root' : undefined, tagColor: 'bg-blue-500/20 text-blue-400' }));
  const envOptions = environments.map(e => ({ value: e.id, label: e.name, badge: true, badgeColor: ENV_BADGE[e.type] || 'bg-gray-400', tag: e.type, tagColor: ENV_TAG_COLOR[e.type] || 'bg-gray-700 text-gray-400' }));
  const filtered = apis.filter(a => !search || (a.assetId || a.name || '').toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="space-y-5">
      {showBgFilter && (
        <BgFilterModal businessGroups={allBusinessGroups} onClose={() => setShowBgFilter(false)}
          onSaved={() => {
            const visible = applyBgFilter(allBusinessGroups);
            if (!visible.find(g => g.id === selectedBg)) { const root = visible.find(g => !g.parentId) || visible[0]; if (root) setSelectedBg(root.id); }
          }} />
      )}

      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-white">API Manager</h1>
          <p className="text-gray-400 text-sm mt-1">Managed API instances in <span className="text-blue-400">{selectedBgName}</span></p>
        </div>
        <button onClick={loadApis} disabled={loading || !selectedEnv} className="flex items-center gap-2 text-sm text-gray-400 hover:text-white bg-gray-800 px-3 py-2 rounded-lg disabled:opacity-50">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-xl px-5 py-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs text-gray-500 uppercase tracking-wider font-medium">Business Group</p>
              <button onClick={() => setShowBgFilter(true)} className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded-lg border transition-all ${filterActive ? 'bg-blue-600/20 border-blue-600/50 text-blue-400' : 'bg-gray-800 border-gray-700 text-gray-500 hover:text-gray-300'}`}>
                <SlidersHorizontal size={11} />{filterActive ? `${visibleGroups.length}/${allBusinessGroups.length}` : 'Filter'}
              </button>
            </div>
            <Select value={selectedBg} onChange={v => setSelectedBg(v)} options={bgOptions} placeholder="Select business group..." searchable={visibleGroups.length > 5} disabled={bgLoading} />
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wider font-medium mb-2">Environment</p>
            <Select value={selectedEnv} onChange={setSelectedEnv} options={envOptions} placeholder="Select environment..." searchable />
          </div>
        </div>
      </div>

      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search API instances..."
          className="w-full bg-gray-900 border border-gray-700 rounded-lg pl-9 pr-4 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500" />
      </div>

      {error && <div className="bg-yellow-950/20 border border-yellow-800/40 rounded-xl px-4 py-3 text-yellow-400 text-sm">{error}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* API List */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-800">
            <h3 className="text-white font-semibold">API Instances ({filtered.length})</h3>
          </div>
          {loading ? (
            <div className="flex items-center justify-center py-16"><div className="animate-spin rounded-full h-7 w-7 border-b-2 border-blue-500" /></div>
          ) : (
            <div className="divide-y divide-gray-800 max-h-[500px] overflow-y-auto">
              {filtered.map(a => (
                <button key={`${a.id}-${a.assetId}`} onClick={() => selectApi(a)}
                  className={`w-full flex items-center justify-between px-5 py-3.5 hover:bg-gray-800/50 text-left transition-colors ${selectedApi?.id === a.id ? 'bg-blue-600/10 border-l-2 border-blue-500' : ''}`}>
                  <div className="flex items-center gap-3">
                    <ShieldCheck size={15} className="text-blue-400 flex-shrink-0" />
                    <div>
                      <p className="text-white text-sm font-medium">{a.assetId || a.name || a.label}</p>
                      <p className="text-gray-500 text-xs">v{a.assetVersion || a.productVersion || '—'} · ID: {a.id}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge status={a.status || 'active'} />
                    <ChevronRight size={13} className="text-gray-600" />
                  </div>
                </button>
              ))}
              {filtered.length === 0 && !loading && (
                <p className="px-5 py-10 text-center text-gray-500 text-sm">
                  {search ? 'No APIs match your search.' : selectedEnv ? 'No API instances found.' : 'Select an environment.'}
                </p>
              )}
            </div>
          )}
        </div>

        {/* API Detail */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden overflow-y-auto max-h-[700px]">
          {selectedApi ? (
            <>
              <div className="px-5 py-3 border-b border-gray-800 sticky top-0 bg-gray-900 z-10">
                <h3 className="text-white font-semibold">{selectedApi.assetId || selectedApi.name}</h3>
                <p className="text-gray-400 text-xs mt-0.5">Version {selectedApi.assetVersion || selectedApi.productVersion || '—'}{selectedApi.instanceLabel && <span className="ml-2 text-blue-400">· {selectedApi.instanceLabel}</span>}</p>
              </div>

              <div className="p-5 space-y-2.5 text-sm border-b border-gray-800">
                {[
                  ['API ID', selectedApi.id],
                  ['Group ID', selectedApi.groupId || '—'],
                  ['Environment', selectedApi.environmentId || selectedEnv],
                  ['Endpoint URI', selectedApi.endpoint?.uri || selectedApi.endpointUri || '—'],
                  ['Proxy URI', selectedApi.endpoint?.proxyUri || '—'],
                  ['Technology', selectedApi.technology || selectedApi.type || '—'],
                  ['Status', selectedApi.status || 'active'],
                ].map(([label, val]) => (
                  <div key={label} className="flex items-start justify-between gap-4">
                    <span className="text-gray-400 flex-shrink-0">{label}</span>
                    <span className="text-white text-xs font-mono break-all text-right">{String(val)}</span>
                  </div>
                ))}
              </div>

              <div className="px-5 py-3 border-b border-gray-800">
                <h4 className="text-gray-300 font-medium text-sm">Applied Policies ({policies.length})</h4>
              </div>
              <div className="divide-y divide-gray-800 border-b border-gray-800">
                {policies.length > 0
                  ? policies.map((p, i) => <PolicyCard key={p.id || i} p={p} i={i} />)
                  : <p className="px-5 py-6 text-center text-gray-500 text-sm">No policies applied.</p>
                }
              </div>

              <div className="px-5 py-3 border-b border-gray-800 flex items-center justify-between">
                <h4 className="text-gray-300 font-medium text-sm flex items-center gap-2">
                  <Users size={13} className="text-blue-400" />
                  Contracts{!contractsLoading && <span className="text-gray-500 font-normal ml-1">({contracts.length})</span>}
                </h4>
                {contractsLoading && <RefreshCw size={12} className="animate-spin text-gray-500" />}
              </div>
              <div className="divide-y divide-gray-800">
                {contractsLoading ? (
                  <div className="flex items-center justify-center py-8 gap-2 text-gray-500 text-xs">
                    <RefreshCw size={13} className="animate-spin" /> Loading contracts…
                  </div>
                ) : contracts.length > 0
                  ? contracts.map((c, i) => <ContractCard key={c.id || i} c={c} i={i} />)
                  : <p className="px-5 py-6 text-center text-gray-500 text-sm">No contracts found.</p>
                }
              </div>
            </>
          ) : (
            <div className="flex items-center justify-center h-full py-20 text-gray-500 text-sm">
              Select an API instance to view details
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
