import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { RefreshCw, Globe, ChevronDown, ChevronUp } from 'lucide-react';
import api from '../services/api';

export default function EnvironmentsPage() {
  const { orgId } = useAuth();
  const [environments, setEnvironments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState({});
  const [appCounts, setAppCounts] = useState({});

  useEffect(() => {
    if (orgId) load();
  }, [orgId]);

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.get(`/environments/${orgId}`);
      const envs = res.data.data || [];
      setEnvironments(envs);
      // Load app counts per environment
      const counts = {};
      await Promise.all(
        envs.map(async (env) => {
          try {
            const appsRes = await api.get(`/applications/cloudhub2/${orgId}/${env.id}`, {
              params: { limit: 1 }
            });
            counts[env.id] = appsRes.data.total || 0;
          } catch {
            counts[env.id] = '—';
          }
        })
      );
      setAppCounts(counts);
    } catch (e) {
      setEnvironments([]);
    }
    setLoading(false);
  };

  const toggleExpand = (id) => setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));

  const typeColor = (type) => {
    if (type === 'production') return 'bg-green-500/20 text-green-400';
    if (type === 'sandbox') return 'bg-yellow-500/20 text-yellow-400';
    return 'bg-blue-500/20 text-blue-400';
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Environments</h1>
          <p className="text-gray-400 text-sm mt-1">{environments.length} environments in this organization</p>
        </div>
        <button onClick={load} className="flex items-center gap-2 text-sm text-gray-400 hover:text-white bg-gray-800 px-3 py-2 rounded-lg">
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {environments.map((env) => (
          <div key={env.id} className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
            <div className="p-5">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Globe size={18} className="text-blue-400" />
                  <h3 className="text-white font-semibold">{env.name}</h3>
                </div>
                <span className={`px-2 py-0.5 rounded text-xs font-medium ${typeColor(env.type)}`}>
                  {env.type}
                </span>
              </div>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-400">Applications</span>
                  <span className="text-white font-medium">{appCounts[env.id] ?? '—'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Client ID Required</span>
                  <span className="text-white">{env.isProduction ? 'Yes' : 'No'}</span>
                </div>
              </div>
            </div>
            <div
              className="px-5 py-3 bg-gray-800/40 border-t border-gray-800 cursor-pointer flex items-center justify-between"
              onClick={() => toggleExpand(env.id)}
            >
              <span className="text-xs text-gray-400">Environment ID</span>
              {expanded[env.id] ? <ChevronUp size={14} className="text-gray-400" /> : <ChevronDown size={14} className="text-gray-400" />}
            </div>
            {expanded[env.id] && (
              <div className="px-5 py-3 bg-gray-800/20 border-t border-gray-800">
                <p className="text-xs text-gray-500 font-mono break-all">{env.id}</p>
              </div>
            )}
          </div>
        ))}
        {environments.length === 0 && (
          <div className="col-span-3 py-16 text-center text-gray-500">No environments found.</div>
        )}
      </div>
    </div>
  );
}