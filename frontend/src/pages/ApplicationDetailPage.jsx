import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { ArrowLeft, RefreshCw, Copy } from 'lucide-react';
import StatusBadge from '../components/StatusBadge';
import api from '../services/api';

const PropRow = ({ label, value }) => (
  <div className="flex items-start py-2.5 border-b border-gray-800 last:border-0">
    <span className="text-gray-400 text-sm w-48 flex-shrink-0">{label}</span>
    <span className="text-white text-sm font-mono break-all">{value ?? '—'}</span>
  </div>
);

export default function ApplicationDetailPage() {
  const { orgId: authOrgId } = useAuth();
  const { orgId: paramOrgId, envId, appId } = useParams();
  // Use org from URL if provided (app may belong to a sub-org/BG), fall back to auth org
  const orgId = paramOrgId || authOrgId;
  const navigate = useNavigate();
  const [app, setApp] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('overview');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (orgId && envId && appId) load();
  }, [orgId, envId, appId]);

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.get(`/applications/cloudhub2/${orgId}/${envId}/${appId}`);
      setApp(res.data);
    } catch (e) {
      try {
        const res2 = await api.get(`/applications/cloudhub1/${envId}/${appId}/properties`);
        setApp({ name: res2.data.appName, ...res2.data, _type: 'ch1' });
      } catch {
        setApp(null);
      }
    }
    setLoading(false);
  };

  const copyJson = () => {
    navigator.clipboard.writeText(JSON.stringify(app, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  if (!app) {
    return (
      <div className="space-y-4">
        <button onClick={() => navigate('/applications')} className="flex items-center gap-2 text-gray-400 hover:text-white text-sm">
          <ArrowLeft size={16} /> Back
        </button>
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-8 text-center text-red-400">
          Application not found or access denied.
        </div>
      </div>
    );
  }

  const tabs = ['overview', 'properties', 'raw'];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/applications')} className="text-gray-400 hover:text-white">
            <ArrowLeft size={18} />
          </button>
          <div>
            <h1 className="text-xl font-bold text-white">{app.name}</h1>
            <p className="text-gray-400 text-sm">Application Details</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={app.status} />
          <button onClick={load} className="text-gray-400 hover:text-white bg-gray-800 p-2 rounded-lg">
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-800 p-1 rounded-lg w-fit">
        {tabs.map((t) => (
          <button
            key={t}
            onClick={() => setActiveTab(t)}
            className={`px-4 py-1.5 rounded-md text-sm font-medium capitalize transition-colors ${
              activeTab === t ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
        {activeTab === 'overview' && (
          <div>
            <h3 className="text-white font-semibold mb-3">General Information</h3>
            <PropRow label="Application ID" value={app.id || appId} />
            <PropRow label="Name" value={app.name} />
            <PropRow label="Status" value={app.status} />
            <PropRow label="Mule Version" value={app.target?.deploymentSettings?.runtimeVersion || app.muleVersion} />
            <PropRow label="Deployment Type" value={app._type === 'ch1' ? 'CloudHub 1.0' : 'CloudHub 2.0'} />
            <PropRow label="Region" value={app.target?.region || app.region} />
            <PropRow label="Replicas" value={app.target?.deploymentSettings?.updateStrategy?.replicas} />
            <PropRow label="Workers" value={app.workers?.amount} />
            <PropRow label="Worker Type" value={app.workers?.type?.name} />
            <PropRow label="Last Modified" value={app.lastModifiedDate ? new Date(app.lastModifiedDate).toLocaleString() : undefined} />
          </div>
        )}

        {activeTab === 'properties' && (
          <div>
            <h3 className="text-white font-semibold mb-3">Configuration Properties</h3>
            {app.properties && Object.keys(app.properties).length > 0 ? (
              <div>
                {Object.entries(app.properties).map(([key, val]) => (
                  <PropRow key={key} label={key} value={String(val)} />
                ))}
              </div>
            ) : (
              <p className="text-gray-500 text-sm py-4">No properties configured or accessible.</p>
            )}
            {app.target?.deploymentSettings?.environmentVars && (
              <div className="mt-4">
                <h4 className="text-gray-300 font-medium mb-2 text-sm">Environment Variables</h4>
                {Object.entries(app.target.deploymentSettings.environmentVars).map(([key, val]) => (
                  <PropRow key={key} label={key} value={String(val)} />
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'raw' && (
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-white font-semibold">Raw JSON</h3>
              <button onClick={copyJson} className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-white bg-gray-800 px-3 py-1.5 rounded-lg">
                <Copy size={12} /> {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
            <pre className="bg-gray-950 rounded-lg p-4 text-xs text-green-400 overflow-auto max-h-[500px] font-mono">
              {JSON.stringify(app, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}