import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { Search, RefreshCw, ChevronRight } from 'lucide-react';
import StatusBadge from '../components/StatusBadge';
import api from '../services/api';

export default function ApplicationsPage() {
  const { orgId } = useAuth();
  const navigate = useNavigate();
  const [apps, setApps] = useState([]);
  const [environments, setEnvironments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterEnv, setFilterEnv] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (orgId) load();
  }, [orgId]);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const [appsRes, envsRes] = await Promise.all([
        api.get(`/applications/summary/${orgId}`),
        api.get(`/environments/${orgId}`)
      ]);
      setApps(appsRes.data.data || []);
      setEnvironments(envsRes.data.data || []);
    } catch (e) {
      setError('Failed to load applications.');
    }
    setLoading(false);
  };

  const filtered = apps.filter((a) => {
    const matchSearch = !search || a.name?.toLowerCase().includes(search.toLowerCase());
    const matchEnv = !filterEnv || a.environment?.id === filterEnv;
    const matchStatus = !filterStatus || (a.status || '').toLowerCase() === filterStatus.toLowerCase();
    return matchSearch && matchEnv && matchStatus;
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Applications</h1>
          <p className="text-gray-400 text-sm mt-1">{apps.length} integrations across all environments</p>
        </div>
        <button onClick={load} className="flex items-center gap-2 text-sm text-gray-400 hover:text-white bg-gray-800 px-3 py-2 rounded-lg">
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-48">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search applications..."
            className="w-full bg-gray-900 border border-gray-700 rounded-lg pl-9 pr-4 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
          />
        </div>
        <select
          value={filterEnv}
          onChange={(e) => setFilterEnv(e.target.value)}
          className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
        >
          <option value="">All Environments</option>
          {environments.map((e) => (
            <option key={e.id} value={e.id}>{e.name}</option>
          ))}
        </select>
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
        >
          <option value="">All Statuses</option>
          <option value="running">Running</option>
          <option value="failed">Failed</option>
          <option value="stopped">Stopped</option>
          <option value="deploying">Deploying</option>
        </select>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3 text-red-400 text-sm">{error}</div>
      )}

      {loading ? (
        <div className="flex items-center justify-center h-48">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
        </div>
      ) : (
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-800/50 text-gray-400 text-xs uppercase tracking-wider">
                <th className="text-left px-5 py-3 font-medium">Application</th>
                <th className="text-left px-5 py-3 font-medium">Status</th>
                <th className="text-left px-5 py-3 font-medium">Environment</th>
                <th className="text-left px-5 py-3 font-medium">Type</th>
                <th className="text-left px-5 py-3 font-medium">Mule Version</th>
                <th className="text-left px-5 py-3 font-medium">Last Modified</th>
                <th className="px-5 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((app, idx) => (
                <tr
                  key={`${app.id}-${idx}`}
                  className="border-t border-gray-800 hover:bg-gray-800/30 cursor-pointer"
                  onClick={() => navigate(`/applications/${app.environment?.id}/${app.id}`)}
                >
                  <td className="px-5 py-3 text-white font-medium">{app.name}</td>
                  <td className="px-5 py-3"><StatusBadge status={app.status} /></td>
                  <td className="px-5 py-3">
                    <span className="text-gray-300">{app.environment?.name}</span>
                    {app.environment?.type && (
                      <span className={`ml-2 text-xs px-1.5 py-0.5 rounded ${
                        app.environment.type === 'production' ? 'bg-green-500/20 text-green-400' : 'bg-gray-700 text-gray-400'
                      }`}>{app.environment.type}</span>
                    )}
                  </td>
                  <td className="px-5 py-3 text-gray-400">{app.deploymentType}</td>
                  <td className="px-5 py-3 text-gray-400 font-mono text-xs">{app.muleVersion || '—'}</td>
                  <td className="px-5 py-3 text-gray-500 text-xs">
                    {app.lastModifiedDate ? new Date(app.lastModifiedDate).toLocaleDateString() : '—'}
                  </td>
                  <td className="px-5 py-3 text-gray-600"><ChevronRight size={14} /></td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-5 py-12 text-center text-gray-500">
                    {search || filterEnv || filterStatus ? 'No applications match your filters.' : 'No applications found.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}