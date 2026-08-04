import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { ArrowLeft, RefreshCw, Copy, Clock, Database, Server, Settings, Globe, Search } from 'lucide-react';
import StatusBadge from '../components/StatusBadge';
import api from '../services/api';

/* ── Design tokens ─────────────────────────────────────── */
const card = 'rounded-2xl border border-gray-700/40 bg-gray-900/60 backdrop-blur-sm overflow-hidden';
const cardHeader = 'flex items-center gap-3 px-6 py-4 border-b border-gray-700/40 bg-gray-800/40';

/* Key-value row for non-table contexts (overview/infra) */
const KV = ({ label, value, mono, full }) => (
  <div className={`flex ${full ? 'flex-col gap-1' : 'items-start justify-between gap-4'} py-3 border-b border-gray-800/50 last:border-0`}>
    <span className="text-gray-500 text-xs font-semibold uppercase tracking-wider flex-shrink-0">{label}</span>
    <span className={`${mono ? 'font-mono text-xs' : 'text-sm'} text-gray-200 break-all text-right leading-relaxed`}>
      {value ?? <span className="text-gray-700">—</span>}
    </span>
  </div>
);

/* Table row for property tables */
const TR = ({ k, v }) => (
  <tr className="border-b border-gray-800/40 hover:bg-blue-500/3 transition-colors group">
    <td className="px-5 py-3 align-top">
      <span className="text-gray-400 text-xs font-mono break-all leading-relaxed group-hover:text-gray-300 transition-colors">{k}</span>
    </td>
    <td className="px-5 py-3 align-top">
      <span className="text-gray-200 text-xs font-mono break-all leading-relaxed bg-gray-800/60 px-2 py-0.5 rounded">{v}</span>
    </td>
  </tr>
);

/* Premium section card */
const Card = ({ icon: Icon, title, count, color = 'blue', children, noPad }) => (
  <div className={card}>
    <div className={cardHeader}>
      <div className={`p-1.5 rounded-lg ${color === 'blue' ? 'bg-blue-500/15' : color === 'purple' ? 'bg-purple-500/15' : 'bg-gray-500/15'}`}>
        {Icon && <Icon size={14} className={color === 'blue' ? 'text-blue-400' : color === 'purple' ? 'text-purple-400' : 'text-gray-400'} />}
      </div>
      <h3 className="text-white font-semibold text-sm">{title}</h3>
      {count != null && (
        <span className="ml-auto text-xs px-2.5 py-0.5 rounded-full bg-gray-700/60 text-gray-400 font-medium">{count}</span>
      )}
    </div>
    <div className={noPad ? '' : 'px-6 py-4'}>{children}</div>
  </div>
);

export default function ApplicationDetailPage() {
  const { orgId: authOrgId } = useAuth();
  const { orgId: paramOrgId, envId, appId } = useParams();
  const orgId = paramOrgId || authOrgId;
  const navigate = useNavigate();
  const [app, setApp] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('overview');
  const [copied, setCopied] = useState(false);
  const [propSearch, setPropSearch] = useState('');

  useEffect(() => { if (orgId && envId && appId) load(); }, [orgId, envId, appId]);

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.get(`/applications/cloudhub2/${orgId}/${envId}/${appId}`);
      setApp(res.data);
    } catch {
      try {
        const res2 = await api.get(`/applications/cloudhub1/${envId}/${appId}`, { params: { orgId } });
        const c = res2.data;
        let sch = [];
        try {
          const sr = await api.get(`/applications/cloudhub1/${envId}/${appId}/schedules`, { params: { orgId } });
          sch = Array.isArray(sr.data) ? sr.data : (sr.data?.schedules || []);
        } catch {}
        setApp({ _type:'ch1', id:c.domain, name:c.domain, status:c.status, region:c.region,
          muleVersion: typeof c.muleVersion === 'string' ? c.muleVersion : c.muleVersion?.version,
          lastModifiedDate: c.lastUpdateTime ? new Date(c.lastUpdateTime).toISOString() : null,
          properties:c.properties||{}, persistentQueues:c.persistentQueues,
          staticIPsEnabled:c.staticIPsEnabled, loggingCustomLog4JEnabled:c.loggingCustomLog4JEnabled,
          monitoringEnabled:c.monitoringAutoRestart??c.monitoringEnabled,
          workers:{ amount:typeof c.workers==='number'?c.workers:c.workers?.amount, type:c.workerType||c.workers?.type },
          _ch1Schedules:sch, _raw:c });
      } catch { setApp(null); }
    }
    setLoading(false);
  };

  const copyJson = () => { navigator.clipboard.writeText(JSON.stringify(app,null,2)); setCopied(true); setTimeout(()=>setCopied(false),2000); };

  if (loading) return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" /></div>;

  if (!app) return (
    <div className="space-y-4">
      <button onClick={() => navigate('/applications')} className="flex items-center gap-2 text-gray-400 hover:text-white text-sm"><ArrowLeft size={16}/> Back</button>
      <div className="bg-red-500/10 border border-red-500/30 rounded-2xl p-10 text-center text-red-400">Application not found or access denied.</div>
    </div>
  );

  const ds = app.target?.deploymentSettings || {};
  const appCfg = app.application?.configuration || {};
  const propsSvc = appCfg['mule.agent.application.properties.service'] || {};
  const schedSvc = appCfg['mule.agent.scheduling.service'] || {};
  const runtimeProps = propsSvc.properties || {};
  const secureProps = propsSvc.secureProperties || {};
  const isCH1 = app._type === 'ch1';
  const schedulers = isCH1 ? (app._ch1Schedules||[]) : (schedSvc.schedulers||[]);
  const httpInbound = ds.http?.inbound || {};
  const endpoints = httpInbound.endpoints || [];
  const envVars = ds.environmentVariables || ds.environmentVars || {};
  const replicas = app.target?.replicas ?? ds.replicas;
  const osEnabled = ds.persistentObjectStore ?? ds.hasPersistentObjectStore ?? false;
  const replicaList = app.replicas || [];

  const allProps = { ...runtimeProps, ...ds.properties, ...envVars, ...app.properties };
  const filteredProps = Object.entries(allProps).filter(([k]) =>
    !propSearch || k.toLowerCase().includes(propSearch.toLowerCase())
  );

  const tabs = [
    { id:'overview', label:'Overview' },
    { id:'properties', label:'Properties', badge: Object.keys(allProps).length },
    { id:'infrastructure', label:'Infra & Config' },
    { id:'raw', label:'Raw JSON' },
  ];

  const statusColor = {
    RUNNING:'text-green-400 bg-green-500/10 border-green-500/20',
    STARTED:'text-green-400 bg-green-500/10 border-green-500/20',
    FAILED:'text-red-400 bg-red-500/10 border-red-500/20',
    STOPPED:'text-gray-400 bg-gray-500/10 border-gray-500/20',
    DEPLOYING:'text-blue-400 bg-blue-500/10 border-blue-500/20',
  };
  const rStatus = app.application?.status || app.status || '';
  const sc = statusColor[rStatus] || 'text-gray-400 bg-gray-500/10 border-gray-500/20';

  return (
    <div className="space-y-6 max-w-7xl">
      {/* ── Premium header ────────────────────────────── */}
      <div className="relative rounded-2xl border border-gray-700/40 bg-gradient-to-br from-gray-900 via-gray-900 to-blue-950/30 p-6 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-r from-blue-600/5 via-transparent to-purple-600/5 pointer-events-none" />
        <div className="relative flex items-start justify-between flex-wrap gap-4">
          <div className="flex items-start gap-4">
            <button onClick={() => navigate('/applications')}
              className="mt-1 text-gray-500 hover:text-white p-2 rounded-xl hover:bg-gray-800 transition-all flex-shrink-0">
              <ArrowLeft size={16}/>
            </button>
            <div>
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-2xl font-bold text-white tracking-tight">{app.name}</h1>
                <span className={`text-xs px-2.5 py-1 rounded-full font-semibold border ${isCH1 ? 'bg-purple-500/15 text-purple-300 border-purple-500/25' : 'bg-blue-500/15 text-blue-300 border-blue-500/25'}`}>
                  {isCH1 ? 'CloudHub 1.0' : 'CloudHub 2.0'}
                </span>
                <span className={`text-xs px-2.5 py-1 rounded-full font-semibold border ${sc}`}>{rStatus || 'Unknown'}</span>
              </div>
              <p className="text-gray-500 text-xs mt-1.5 font-mono">{app.id}</p>
              {app.application?.ref && (
                <p className="text-gray-400 text-xs mt-1">{app.application.ref.artifactId} <span className="text-gray-600">v{app.application.ref.version}</span></p>
              )}
            </div>
          </div>
          <button onClick={load} className="text-gray-500 hover:text-white bg-gray-800/60 border border-gray-700/40 p-2.5 rounded-xl hover:bg-gray-700 transition-all">
            <RefreshCw size={15}/>
          </button>
        </div>
      </div>

      {/* ── Tabs ──────────────────────────────────────── */}
      <div className="flex gap-1 bg-gray-800/40 border border-gray-700/30 p-1 rounded-xl w-fit">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              tab === t.id ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/40' : 'text-gray-400 hover:text-white hover:bg-gray-700/50'
            }`}>
            {t.label}
            {t.badge > 0 && <span className={`text-xs px-1.5 py-0.5 rounded-full font-semibold ${tab===t.id?'bg-blue-500 text-white':'bg-gray-700 text-gray-400'}`}>{t.badge}</span>}
          </button>
        ))}
      </div>

      {/* ── OVERVIEW ──────────────────────────────────── */}
      {tab === 'overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <Card icon={Server} title="General Information" color="blue">
            {isCH1 ? (<>
              <KV label="App ID" value={app.id} mono />
              <KV label="Status" value={app.status} />
              <KV label="Mule Version" value={app.muleVersion} mono />
              <KV label="Region" value={app.region} />
              <KV label="Workers" value={app.workers?.amount!=null?String(app.workers.amount):undefined} />