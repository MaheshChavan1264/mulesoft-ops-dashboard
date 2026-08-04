import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { RefreshCw, ShieldCheck, Search } from 'lucide-react';
import StatusBadge from '../components/StatusBadge';
import Select from '../components/Select';
import api from '../services/api';

export default function ApiManagerPage() {
  const { orgId } = useAuth();
  const [environments, setEnvironments] = useState([]);
  const [selectedEnv, setSelectedEnv] = useState('');
  const [apis, setApis] = useState([]);
  const [selectedApi, setSelectedApi] = useState(null);
  const [policies, setPolicies] = useState([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (orgId) loadEnvs();
  }, [orgId]);

  useEffect(() => {
    if (selectedEnv) loadApis();
  }, [selectedEnv]);

  const loadEnvs = async () => {
    try {
      const res = await api.get(`/environments/${orgId}`);
      const envs = res.data.data || [];
      setEnvironments(envs);
      if (envs.length > 0) setSelectedEnv(envs[0].id);
    } catch {
      setEnvironments([]);
    }
  };

  const loadApis = async () => {
    setLoading(true);
    setApis([]);
    setSelectedApi(null);
    try {
      const res = await api.get(`/apis/${orgId}/${selectedEnv}`);
      setApis(res.data.assets || res.data.data || []);
    } catch {
      setApis([]);
    }
    setLoading(false);
  };

  const selectApi = async (apiInstance) => {
    setSelectedApi(apiInstance);
    try {
      const res = await api.get(`/apis/${orgId}/${selectedEnv}/${apiInstance.id}/policies`);
      setPolicies(res.data.policies || res.data || []);
    } catch {
      setPolicies([]);
    }
  };

  const filtered = apis.filter(
    (a) => !search || (a.assetId || a.name || '').toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-white">API Manager</h1>
          <p className="text-gray-400 text-sm mt-1">Managed API instances and policies</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="w-56">
            <Select
              value={selectedEnv}
              onChange={setSelectedEnv}
              options={environments.map((e) => ({
                value: e.id,
                label: e.name,
                badge: true,
                badgeColor: e.type === 'production' ? 'bg-green-400' : e.type === 'sandbox' ? 'bg-yellow-400' : 'bg-gray-400',
                tag: e.type,
                tagColor: e.type === 'production' ? 'bg-green-500/20 text-green-400' : 'bg-yellow-500/20 text-yellow-400'
              }))}
              placeholder="Select environment..."
              searchable
            />
          </div>
          <button onClick={loadApis} className="flex items-center gap-2 text-sm text-gray-400 hover:text-white bg-gray-800 px-3 py-2 rounded-lg">
            <RefreshCw size={14} /> Refresh
          </button>
        </div>
      </div>

      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search API instances..."
          className="w-full bg-gray-900 border border-gray-700 rounded-lg pl-9 pr-4 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* API List */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-800 flex items-center justify-between">
            <h3 className="text-white font-semibold">API Instances ({filtered.length})</h3>
          </div>
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <div className="animate-spin rounded-full h-7 w-7 border-b-2 border-blue-500"></div>
            </div>
          ) : (
            <div className="divide-y divide-gray-800 max-h-[500px] overflow-y-auto">
              {filtered.map((a) => (
                <button
                  key={a.id}
                  onClick={() => selectApi(a)}
                  className={`w-full flex items-center justify-between px-5 py-3.5 hover:bg-gray-800/50 text-left ${
                    selectedApi?.id === a.id ? 'bg-blue-600/10 border-l-2 border-blue-500' : ''
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <ShieldCheck size={15} className="text-blue-400 flex-shrink-0" />
                    <div>
                      <p className="text-white text-sm font-medium">{a.assetId || a.name}</p>
                      <p className="text-gray-500 text-xs">v{a.assetVersion || a.productVersion} · ID: {a.id}</p>
                    </div>
                  </div>
                  <StatusBadge status={a.status || 'active'} />
                </button>
              ))}
              {filtered.length === 0 && (
                <p className="px-5 py-10 text-center text-gray-500 text-sm">
                  {search ? 'No APIs match your search.' : 'No API instances found in this environment.'}
                </p>
              )}
            </div>
          )}
        </div>

        {/* API Detail */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          {selectedApi ? (
            <>
              <div className="px-5 py-3 border-b border-gray-800">
                <h3 className="text-white font-semibold">{selectedApi.assetId || selectedApi.name}</h3>
                <p className="text-gray-400 text-xs mt-0.5">Version {selectedApi.assetVersion || selectedApi.productVersion}</p>
              </div>
              <div className="p-5 space-y-2.5 text-sm border-b border-gray-800">
                <div className="flex justify-between">
                  <span className="text-gray-400">API ID</span>
                  <span className="text-white font-mono text-xs">{selectedApi.id}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Group ID</span>
                  <span className="text-gray-400 font-mono text-xs">{selectedApi.groupId || '—'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Endpoint URI</span>
                  <span className="text-white text-xs break-all max-w-48">{selectedApi.endpoint?.uri || selectedApi.endpointUri || '—'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Proxy</span>
                  <span className="text-white">{selectedApi.endpoint?.proxyUri ? 'Yes' : 'No'}</span>
                </div>
              </div>
              <div className="px-5 py-3 border-b border-gray-800">
                <h4 className="text-gray-300 font-medium text-sm">Applied Policies ({policies.length})</h4>
              </div>
              <div className="max-h-48 overflow-y-auto divide-y divide-gray-800">
                {policies.length > 0 ? (
                  policies.map((p, i) => (
                    <div key={i} className="px-5 py-2.5">
                      <p className="text-white text-sm font-medium">{p.template?.name || p.name || p.policyTemplateId}</p>
                      <p className="text-gray-500 text-xs">v{p.template?.version || p.version} · {p.disabled ? 'Disabled' : 'Active'}</p>
                    </div>
                  ))
                ) : (
                  <p className="px-5 py-6 text-center text-gray-500 text-sm">No policies applied.</p>
                )}
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