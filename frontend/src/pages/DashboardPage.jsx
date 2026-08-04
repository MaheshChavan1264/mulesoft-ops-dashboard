import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { Server, CheckCircle, XCircle, StopCircle, Globe, Package } from 'lucide-react';
import StatCard from '../components/StatCard';
import api from '../services/api';
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend,
  BarChart, Bar, XAxis, YAxis
} from 'recharts';

const PIE_COLORS = ['#22c55e', '#ef4444', '#6b7280', '#3b82f6'];

export default function DashboardPage() {
  const { orgId, orgName } = useAuth();
  const [metrics, setMetrics] = useState(null);
  const [environments, setEnvironments] = useState([]);
  const [exchangeSummary, setExchangeSummary] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (orgId) loadData();
  }, [orgId]);

  const loadData = async () => {
    setLoading(true);
    const [metricsRes, envsRes, exchangeRes] = await Promise.allSettled([
      api.get(`/metrics/summary/${orgId}`),
      api.get(`/environments/${orgId}`),
      api.get(`/exchange/org/${orgId}/summary`)
    ]);
    if (metricsRes.status === 'fulfilled') setMetrics(metricsRes.value.data.summary);
    if (envsRes.status === 'fulfilled') setEnvironments(envsRes.value.data.data || []);
    if (exchangeRes.status === 'fulfilled') setExchangeSummary(exchangeRes.value.data.assetCounts);
    setLoading(false);
  };

  const statusChartData = metrics
    ? [
        { name: 'Running', value: metrics.running },
        { name: 'Failed', value: metrics.failed },
        { name: 'Stopped', value: metrics.stopped }
      ].filter((d) => d.value > 0)
    : [];

  const exchangeChartData = exchangeSummary
    ? Object.entries(exchangeSummary).map(([type, count]) => ({ type, count }))
    : [];

  const envTypeGroups = environments.reduce((acc, e) => {
    acc[e.type] = (acc[e.type] || 0) + 1;
    return acc;
  }, {});

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-white">Dashboard</h1>
        <p className="text-gray-400 text-sm mt-1">Overview for <span className="text-blue-400">{orgName}</span></p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Total Applications" value={metrics?.totalApplications ?? '—'} icon={Server} color="blue" />
        <StatCard title="Running" value={metrics?.running ?? '—'} icon={CheckCircle} color="green" />
        <StatCard title="Failed" value={metrics?.failed ?? '—'} icon={XCircle} color="red" />
        <StatCard title="Environments" value={metrics?.environments ?? environments.length} icon={Globe} color="purple" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Status Pie */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <h3 className="text-white font-semibold mb-4">Application Status</h3>
          {statusChartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={statusChartData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label>
                  {statusChartData.map((_, i) => (
                    <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ background: '#1f2937', border: '1px solid #374151', borderRadius: 8 }} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-40 text-gray-500 text-sm">No application data</div>
          )}
        </div>

        {/* Exchange Assets Bar */}
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

      {/* Environments Table */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
        <h3 className="text-white font-semibold mb-4">Environments ({environments.length})</h3>
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
                  <td className="py-2.5 pr-4 text-white font-medium">{env.name}</td>
                  <td className="py-2.5 pr-4">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                      env.type === 'production'
                        ? 'bg-green-500/20 text-green-400'
                        : env.type === 'sandbox'
                        ? 'bg-yellow-500/20 text-yellow-400'
                        : 'bg-blue-500/20 text-blue-400'
                    }`}>
                      {env.type}
                    </span>
                  </td>
                  <td className="py-2.5 text-gray-500 font-mono text-xs">{env.id}</td>
                </tr>
              ))}
              {environments.length === 0 && (
                <tr><td colSpan={3} className="py-8 text-center text-gray-500">No environments found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}