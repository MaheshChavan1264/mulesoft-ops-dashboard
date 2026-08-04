import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { Search, RefreshCw, ChevronRight } from 'lucide-react';
import StatusBadge from '../components/StatusBadge';
import Select from '../components/Select';
import api from '../services/api';

const ENV_BADGE = { production: 'bg-green-400', sandbox: 'bg-yellow-400', design: 'bg-blue-400' };
const ENV_TAG_COLOR = {
  production: 'bg-green-500/20 text-green-400',
  sandbox: 'bg-yellow-500/20 text-yellow-400'
};

export default function ApplicationsPage() {
  const { orgId } = useAuth();
  const navigate = useNavigate();

  const [businessGroups, setBusinessGroups] = useState([]);
  const [selectedBg, setSelectedBg] = useState('');
  const [environments, setEnvironments] = useState([]);
  const [apps, setApps] = useState([]);
  const [loading, setLoading] = useState(false);
  const [bgLoading, setBgLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterEnv, setFilterEnv] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterType, setFilterType] = useState('');
  const [error, setError] = useState('');

  useEffect(() => { if (orgId) loadBusinessGroups(); }, [orgId]);
  useEffect(() => { if (selectedBg) loadApps(selectedBg); }, [selectedBg]);

  const loadBusinessGroups = async () => {
    setBgLoading(true);
    try {
      const res = await api.get('/organizations/business-groups');
      const groups = res.data.data || [];
      setBusinessGroups(groups);
      const root = groups.find((g) => !g.parentId) || groups[0];
      setSelectedBg(root?.id || orgId);
    } catch { setSelectedBg(orgId); }
    setBgLoading(false);
  };

  const loadApps = async (bgId) => {
    setLoading(true);
    setError('');
    setFilterEnv('');
    try {
      const [appsRes, envsRes] = await Promise.all([
        api.get(`/applications/summary/${bgId}`),
        api.get(`/environments/${bgId}`)
      ]);
      setApps(appsRes.data.data || []);
      setEnvironments(envsRes.data.data || []);
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to load applications.');
      setApps([]);
    }
    setLoading(false);
  };

  const filtered = apps.filter((a) => {
    const matchSearch = !search || a.name?.toLowerCase().includes(search.toLowerCase());
    const matchEnv = !filterEnv || a.environment?.id === filterEnv;
    const matchStatus = !filterStatus || (a.status || '').toUpperCase() === filterStatus.toUpperCase();
    const matchType = !filterType || a.deploymentType === filterType;
    return matchSearch && matchEnv && matchStatus && matchType;
  });

  // Build BG select options with hierarchy indent
  const bgOptions = businessGroups.map((g) => ({
    value: g.id,
    label: g.name,
    indent: !!g.parentId,
    tag: !g.parentId ? 'Root' : undefined,
    tagColor: 'bg-blue-500/20 text-blue-400'
  }));

  // Build env select options with colored badges
  const envOptions = [
    { value: '', label: 'All Environments' },
    ...environments.map((e) => ({
      value: e.id,
      label: e.name,
      badge: true,
      badgeColor: ENV_BADGE[e.type] || 'bg-gray-400',
      tag: e.type,
      tagColor: ENV_TAG_COLOR[e.type] || 'bg-gray-700 text-gray-400'
    }))
  ];

  const statusOptions = [
    { value: '', label: 'All Statuses' },
    { value: 'RUNNING', label: 'Running', badge: true, badgeColor: 'bg-green-400' },
    { value: 'APPLIED', label: 'Applied', badge: true, badgeColor: 'bg-cyan-400' },
    { value: 'APPLYING', label: 'Applying', badge: true, badgeColor: 'bg-cyan-300' },
    { value: 'FAILED', label: 'Failed', badge: true, badgeColor: 'bg-red-400' },
    { value: 'STOPPED', label: 'Stopped', badge: true, badgeColor: 'bg-gray-400' },
    { value: 'DEPLOYING', label: 'Deploying', badge: true, badgeColor: 'bg-blue-400' },
    { value: 'UPDATING', label: 'Updating', badge: true, badgeColor: 'bg-purple-400' },
    { value: 'STARTING', label: 'Starting', badge: true, badgeColor: 'bg-blue-300' },
    { value: 'STOPPING', label: 'Stopping', badge: true, badgeColor: 'bg-orange-400' },
    { value: 'PARTIALLY_STARTED', label: 'Partial', badge: true, badgeColor: 'bg-yellow-400' },
    { value: 'PARTIALLY_RUNNING', label: 'Partial', badge: true, badgeColor: 'bg-yellow-400' }
  ];

  const typeOptions = [
    { value: '', label: 'All Deployment Types' },
    { value: 'CloudHub 2.0', label: 'CloudHub 2.0', tag: 'CH2', tagColor: 'bg-blue-500/20 text-blue-400' },
    { value: 'CloudHub 1.0', label: 'CloudHub 1.0', tag: 'CH1', tagColor: 'bg-purple-500/20 text-purple-400' }
  ];

  const selectedBgName = businessGroups.find((g) => g.id === selectedBg)?.name || 'Organization';

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-white">Applications</h1>
          <p className="text-gray-400 text-sm mt-1">
            {loading ? 'Loading...' : `${apps.length} integrations in ${selectedBgName}`}
          </p>
        </div>
        <button onClick={() => loadApps(selectedBg)} disabled={loading || bgLoading}
          className="flex items-center gap-2 text-sm text-gray-400 hover:text-white bg-gray-800 px-3 py-2 rounded-lg disabled:opacity-50">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {/* Business Group selector */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl px-5 py-4">
        <p className="text-xs text-gray-500 uppercase tracking-wider mb-2 font-medium">Business Group</p>
        <Select
          value={selectedBg}
          onChange={(v) => { setSelectedBg(v); setSearch(''); setFilterStatus(''); setFilterType(''); }}
          options={bgOptions}
          placeholder="Select business group..."
          searchable={businessGroups.length > 5}
          disabled={bgLoading}
        />
      </div>

      {/* Filters row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {/* Search */}
        <div className="relative sm:col-span-2 lg:col-span-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
          <input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search applications..."
            className="w-full bg-gray-900 border border-gray-700 rounded-lg pl-9 pr-4 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500" />
        </div>
        <div>
          <Select value={filterEnv} onChange={setFilterEnv} options={envOptions} placeholder="Environment" searchable />
        </div>
        <div>
          <Select value={filterStatus} onChange={setFilterStatus} options={statusOptions} placeholder="Status" />
        </div>
        <div>
          <Select value={filterType} onChange={setFilterType} options={typeOptions} placeholder="Type" />
        </div>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 text-red-400 text-sm">{error}</div>
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
                <tr key={`${app.id}-${idx}`}
                  className="border-t border-gray-800 hover:bg-gray-800/30 cursor-pointer"
                  onClick={() => navigate(`/applications/${selectedBg}/${app.environment?.id}/${app.id}`)}>
                  <td className="px-5 py-3 text-white font-medium">{app.name}</td>
                  <td className="px-5 py-3"><StatusBadge status={app.status} /></td>
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-1.5">
                      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${ENV_BADGE[app.environment?.type] || 'bg-gray-400'}`} />
                      <span className="text-gray-300">{app.environment?.name}</span>
                    </div>
                  </td>
                  <td className="px-5 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded font-medium ${
                      app.deploymentType === 'CloudHub 2.0' ? 'bg-blue-500/20 text-blue-400' : 'bg-purple-500/20 text-purple-400'
                    }`}>{app.deploymentType}</span>
                  </td>
                  <td className="px-5 py-3 text-gray-400 font-mono text-xs">{app.muleVersion || '—'}</td>
                  <td className="px-5 py-3 text-gray-500 text-xs">
                    {app.lastModifiedDate ? new Date(app.lastModifiedDate).toLocaleDateString() : '—'}
                  </td>
                  <td className="px-5 py-3 text-gray-600"><ChevronRight size={14} /></td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={7} className="px-5 py-12 text-center text-gray-500">
                  {apps.length === 0 ? `No applications found in ${selectedBgName}.` : 'No applications match your filters.'}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      {filtered.length > 0 && (
        <p className="text-xs text-gray-600 text-right">Showing {filtered.length} of {apps.length}</p>
      )}
    </div>
  );
}