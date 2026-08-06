import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { Server, CheckCircle, XCircle, Globe, SlidersHorizontal } from 'lucide-react';
import StatCard from '../components/StatCard';
import Select from '../components/Select';
import BgFilterModal, { applyBgFilter } from '../components/BgFilterModal';
import api from '../services/api';
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend,
  BarChart, Bar, XAxis, YAxis
} from 'recharts';

const PIE_COLORS = ['#22c55e', '#ef4444', '#6b7280', '#3b82f6'];

export default function DashboardPage() {
  const { orgId } = useAuth();

  const [allBusinessGroups, setAllBusinessGroups] = useState([]);
  const [selectedBg, setSelectedBg] = useState('');
  const [bgLoading, setBgLoading] = useState(true);
  const [showBgFilter, setShowBgFilter] = useState(false);

  const [metrics, setMetrics] = useState(null);
  const [environments, setEnvironments] = useState([]);
  const [exchangeSummary, setExchangeSummary] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => { if (orgId) loadBusinessGroups(); }, [orgId]);
  useEffect(() => { if (selectedBg) loadData(selectedBg); }, [selectedBg]);

  const loadBusinessGroups = async () => {
    setBgLoading(true);
    try {
      const res = await api.get('/organizations/business-groups');
      const groups = res.data.data || [];
      setAllBusinessGroups(groups);
      // Default to "All" so aggregated data shows from the start
      setSelectedBg('__all__');
    } catch {
      setSelectedBg(orgId);
    }
    setBgLoading(false);
  };

  const loadData = async (bgId) => {
    setLoading(true);
    const visible = applyBgFilter(allBusinessGroups);
    const rootOrg = allBusinessGroups.find((g) => !g.parentId);
    const exchangeOrgId = rootOrg?.id || orgId;

    if (bgId === '__all__') {
      // Load metrics from all visible BGs in parallel, then aggregate
      const bgIds = visible.length > 0 ? visible.map(g => g.id) : [orgId];
      const [metricsResults, envsResults, exchangeRes] = await Promise.all([
        Promise.allSettled(bgIds.map(id => api.get(`/metrics/summary/${id}`))),
        Promise.allSettled(bgIds.map(id => api.get(`/environments/${id}`))),
        api.get(`/exchange/org/${exchangeOrgId}/summary`).catch(() => null),
      ]);

      // Aggregate metrics
      const aggregated = { totalApplications: 0, running: 0, failed: 0, stopped: 0, environments: 0 };
      metricsResults.forEach(r => {
        if (r.status === 'fulfilled') {
          const s = r.value.data.summary || {};
          aggregated.totalApplications += s.totalApplications || 0;
          aggregated.running += s.running || 0;
          aggregated.failed += s.failed || 0;
          aggregated.stopped += s.stopped || 0;
        }
      });

      // Merge environments (deduplicate)
      const mergedEnvs = [];
      const seenEnvs = new Set();
      envsResults.forEach(r => {
        if (r.status === 'fulfilled') {
          (r.value.data.data || []).forEach(e => {
            if (!seenEnvs.has(e.id)) { seenEnvs.add(e.id); mergedEnvs.push(e); }
          });
        }
      });
      aggregated.environments = mergedEnvs.length;

      setMetrics(aggregated);
      setEnvironments(mergedEnvs);
      setExchangeSummary(exchangeRes?.data?.assetCounts || null);
    } else {
      // Single BG
      const [metricsRes, envsRes, exchangeRes] = await Promise.allSettled([
        api.get(`/metrics/summary/${bgId}`),
        api.get(`/environments/${bgId}`),
        api.get(`/exchange/org/${exchangeOrgId}/summary`)
      ]);
      setMetrics(metricsRes.status === 'fulfilled' ? metricsRes.value.data.summary : null);
      setEnvironments(envsRes.status === 'fulfilled' ? envsRes.value.data.data || [] : []);
      setExchangeSummary(exchangeRes.status === 'fulfilled' ? exchangeRes.value.data.assetCounts : null);
    }

    setLoading(false);
  };

  const visibleGroups = applyBgFilter(allBusinessGroups);

  const bgOptions = [
    { value: '__all__', label: 'All Organizations', tag: `${visibleGroups.length}`, tagColor: 'bg-gray-700 text-gray-300' },
    ...visibleGroups.map((g) => ({
      value: g.id,
      label: g.name,
      indent: !!g.parentId,
      tag: !g.parentId ? 'Root' : undefined,
      tagColor: 'bg-blue-500/20 text-blue-400'
    }))
  ];

  const selectedBgName = selectedBg === '__all__'
    ? 'All Organizations'
    : visibleGroups.find((g) => g.id === selectedBg)?.name || 'Organization';

  const statusChartData = metrics
    ? [
        { name: 'Running', value: metrics.running || 0 },
        { name: 'Failed', value: metrics.failed || 0 },
        { name: 'Stopped', value: metrics.stopped || 0 }
      ].filter((d) => d.value > 0)
    : [];

  const exchangeChartData = exchangeSummary
    ? Object.entries(exchangeSummary)
        .filter(([, count]) => count > 0)
        .map(([type, count]) => ({ type, count }))
    : [];

  const filterActive = applyBgFilter(allBusinessGroups).length < allBusinessGroups.length;

  return (
    <div className="space-y-6">
      {showBgFilter && (
        <BgFilterModal
          businessGroups={allBusinessGroups}
          onClose={() => setShowBgFilter(false)}
          onSaved={() => {
            const visible = applyBgFilter(allBusinessGroups);
            if (selectedBg !== '__all__' && !visible.find((g) => g.id === selectedBg)) {
              setSelectedBg('__all__');
            }
          }}
        />
      )}

      {/* Header + BG selector */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-xl font-bold text-white">Dashboard</h1>
          <p className="text-gray-400 text-sm mt-1">
            Overview for <span className="text-blue-400">{selectedBgName}</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-64">
            <Select
              value={selectedBg}
              onChange={setSelectedBg}
              options={bgOptions}
              placeholder="Select business group..."
              searchable={visibleGroups.length > 5}
              disabled={bgLoading}
            />
          </div>
          <button
            onClick={() => setShowBgFilter(true)}
            title="Configure visible business groups"
            className={`p-2 rounded-lg border transition-all flex-shrink-0 ${
              filterActive
                ? 'bg-blue-600/20 border-blue-600/50 text-blue-400 hover:bg-blue-600/30'
                : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-white hover:border-gray-600'
            }`}
          >
            <SlidersHorizontal size={15} />
          </button>
        </div>
      </div>

      {filterActive && (
        <div className="flex items-center justify-between bg-blue-950/30 border border-blue-800/40 rounded-xl px-4 py-2.5 text-xs">
          <span className="text-blue-300">
            <SlidersHorizontal size={11} className="inline mr-1.5" />
            Showing {visibleGroups.length} of {allBusinessGroups.length} business groups
          </span>
          <button onClick={() => setShowBgFilter(true)} className="text-blue-400 hover:text-blue-200 underline underline-offset-2">
            Manage filter
          </button>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard title="Total Applications" value={metrics?.totalApplications ?? '—'} icon={Server} color="blue" />
            <StatCard title="Running" value={metrics?.running ?? '—'} icon={CheckCircle} color="green" />
            <StatCard title="Failed" value={metrics?.failed ?? '—'} icon={XCircle} color="red" />
            <StatCard title="Environments" value={metrics?.environments ?? environments.length} icon={Globe} color="purple" subtitle={selectedBgName} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
              <h3 className="text-white font-semibold mb-4">Application Status</h3>
              {statusChartData.length > 0 ? (
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie data={statusChartData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label>
                      {statusChartData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                    </Pie>
                    <Tooltip contentStyle={{ background: '#1f2937', border: '1px solid #374151', borderRadius: 8 }} />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-40 text-gray-500 text-sm">
                  {metrics?.totalApplications === 0 ? `No applications in ${selectedBgName}` : 'No status data available'}
                </div>
              )}
            </div>

            <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
              <h3 className="text-white font-semibold mb-4">Exchange Assets</h3>
              {exchangeChartData.length > 0 ? (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={exchangeChartData} margin={{ top: 0, right: 10, left: -20, bottom: 0 }}>
                    <XAxis dataKey="type" tick={{ fill: '#9ca3af', fontSize: 10 }} />
                    <YAxis tick={{ fill: '#9ca3af', fontSize: 10 }} />
                    <Tooltip contentStyle={{ background: '#1f2937', border: '1px solid #374151', borderRadius: 8 }} />
                    <Bar dataKey="count" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-40 text-gray-500 text-sm">No exchange data</div>
              )}
            </div>
          </div>

          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
            <h3 className="text-white font-semibold mb-4">
              Environments ({environments.length})
              <span className="text-gray-500 text-xs font-normal ml-2">in {selectedBgName}</span>
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-gray-400 border-b border-gray-800">
                    <th className="text-left py-2 pr-4 font-medium">Name</th>
                    <th className="text-left py-2 pr-4 font-medium">Type</th>
                    <th className="text-left py-2 font-medium">ID</th>
                  </tr>
                </thead>
                <tbody>
                  {environments.map((env) => (
                    <tr key={env.id} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                      <td className="py-2.5 pr-4 text-white font-medium flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full ${env.type === 'production' ? 'bg-green-400' : 'bg-yellow-400'}`} />
                        {env.name}
                      </td>
                      <td className="py-2.5 pr-4">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${env.type === 'production' ? 'bg-green-500/20 text-green-400' : 'bg-yellow-500/20 text-yellow-400'}`}>
                          {env.type}
                        </span>
                      </td>
                      <td className="py-2.5 text-gray-500 font-mono text-xs">{env.id}</td>
                    </tr>
                  ))}
                  {environments.length === 0 && (
                    <tr>
                      <td colSpan={3} className="py-8 text-center text-gray-500">
                        No environments found in {selectedBgName}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
