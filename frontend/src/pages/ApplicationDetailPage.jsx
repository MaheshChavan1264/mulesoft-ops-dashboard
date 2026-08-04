import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { ArrowLeft, RefreshCw, Copy, Clock, Database, Server, Settings, Globe, Search } from 'lucide-react';
import StatusBadge from '../components/StatusBadge';
import api from '../services/api';

const card = 'rounded-2xl border border-gray-700/40 bg-gray-900/60 overflow-hidden';

const KV = ({ label, value, mono }) => (
  <div className="flex items-start justify-between gap-4 py-3 border-b border-gray-800/50 last:border-0">
    <span className="text-gray-500 text-xs font-semibold uppercase tracking-wider flex-shrink-0 pt-0.5">{label}</span>
    <span className={`${mono ? 'font-mono text-xs' : 'text-sm'} text-gray-200 break-all text-right leading-relaxed`}>
      {value != null && value !== '' ? value : <span className="text-gray-700">—</span>}
    </span>
  </div>
);

const TR = ({ k, v }) => (
  <tr className="border-b border-gray-800/40 hover:bg-gray-800/30 transition-colors">
    <td className="px-5 py-3 align-top w-[42%]">
      <span className="text-gray-400 text-xs font-mono break-all leading-relaxed">{k}</span>
    </td>
    <td className="px-5 py-3 align-top">
      <span className="text-gray-200 text-xs font-mono break-all bg-gray-800/60 px-2 py-0.5 rounded leading-relaxed">{v}</span>
    </td>
  </tr>
);

const Card = ({ icon: Icon, title, count, color = 'blue', noPad, children }) => (
  <div className={card}>
    <div className="flex items-center gap-3 px-6 py-4 border-b border-gray-700/40 bg-gray-800/40">
      <div className={`p-1.5 rounded-lg ${color==='blue'?'bg-blue-500/15':color==='purple'?'bg-purple-500/15':'bg-gray-500/15'}`}>
        {Icon && <Icon size={14} className={color==='blue'?'text-blue-400':color==='purple'?'text-purple-400':'text-gray-400'} />}
      </div>
      <h3 className="text-white font-semibold text-sm">{title}</h3>
      {count != null && <span className="ml-auto text-xs px-2.5 py-0.5 rounded-full bg-gray-700/60 text-gray-400 font-medium">{count}</span>}
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
          muleVersion: typeof c.muleVersion==='string'?c.muleVersion:c.muleVersion?.version,
          lastModifiedDate: c.lastUpdateTime?new Date(c.lastUpdateTime).toISOString():null,
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

  if (loading) return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"/></div>;

  if (!app) return (
    <div className="space-y-4">
      <button onClick={()=>navigate('/applications')} className="flex items-center gap-2 text-gray-400 hover:text-white text-sm"><ArrowLeft size={16}/> Back</button>
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
  const schedulers = isCH1?(app._ch1Schedules||[]):(schedSvc.schedulers||[]);
  const httpInbound = ds.http?.inbound || {};
  const endpoints = httpInbound.endpoints || [];
  const envVars = ds.environmentVariables || ds.environmentVars || {};
  const replicas = app.target?.replicas ?? ds.replicas;
  const osEnabled = ds.persistentObjectStore ?? ds.hasPersistentObjectStore ?? false;
  const replicaList = app.replicas || [];
  const allProps = { ...runtimeProps, ...ds.properties, ...envVars, ...app.properties };
  const filteredProps = Object.entries(allProps).filter(([k]) => !propSearch || k.toLowerCase().includes(propSearch.toLowerCase()));
  const rStatus = app.application?.status || app.status || '';
  const sc = { RUNNING:'bg-green-500/15 text-green-300 border-green-500/25', STARTED:'bg-green-500/15 text-green-300 border-green-500/25',
    FAILED:'bg-red-500/15 text-red-300 border-red-500/25', STOPPED:'bg-gray-500/15 text-gray-300 border-gray-500/25',
    DEPLOYING:'bg-blue-500/15 text-blue-300 border-blue-500/25' }[rStatus] || 'bg-gray-500/15 text-gray-300 border-gray-500/25';

  const tabs = [
    { id:'overview', label:'Overview' },
    { id:'properties', label:'Properties', badge:Object.keys(allProps).length },
    { id:'infrastructure', label:'Infra & Config' },
    { id:'raw', label:'Raw JSON' },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="relative rounded-2xl border border-gray-700/40 bg-gradient-to-br from-gray-900 via-gray-900 to-blue-950/20 p-6 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-r from-blue-500/4 via-transparent to-purple-500/4 pointer-events-none"/>
        <div className="relative flex items-start justify-between flex-wrap gap-4">
          <div className="flex items-start gap-4">
            <button onClick={()=>navigate('/applications')} className="mt-1 p-2 rounded-xl text-gray-500 hover:text-white hover:bg-gray-800 transition-all flex-shrink-0">
              <ArrowLeft size={16}/>
            </button>
            <div>
              <div className="flex items-center gap-2.5 flex-wrap">
                <h1 className="text-2xl font-bold text-white tracking-tight">{app.name}</h1>
                <span className={`text-xs px-2.5 py-1 rounded-full font-semibold border ${isCH1?'bg-purple-500/15 text-purple-300 border-purple-500/25':'bg-blue-500/15 text-blue-300 border-blue-500/25'}`}>
                  {isCH1?'CloudHub 1.0':'CloudHub 2.0'}
                </span>
                <span className={`text-xs px-2.5 py-1 rounded-full font-semibold border ${sc}`}>{rStatus||'Unknown'}</span>
              </div>
              <p className="text-gray-500 text-xs mt-1.5 font-mono">{app.id}</p>
              {app.application?.ref && <p className="text-gray-400 text-xs mt-1">{app.application.ref.artifactId} <span className="text-gray-600">v{app.application.ref.version}</span></p>}
            </div>
          </div>
          <button onClick={load} className="p-2.5 rounded-xl text-gray-500 hover:text-white bg-gray-800/60 border border-gray-700/40 hover:bg-gray-700 transition-all">
            <RefreshCw size={15}/>
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-800/40 border border-gray-700/30 p-1 rounded-xl w-fit">
        {tabs.map(t => (
          <button key={t.id} onClick={()=>setTab(t.id)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all ${tab===t.id?'bg-blue-600 text-white shadow-lg shadow-blue-900/40':'text-gray-400 hover:text-white hover:bg-gray-700/50'}`}>
            {t.label}
            {t.badge>0 && <span className={`text-xs px-1.5 py-0.5 rounded-full font-semibold ${tab===t.id?'bg-blue-400/30 text-white':'bg-gray-700 text-gray-400'}`}>{t.badge}</span>}
          </button>
        ))}
      </div>

      {/* OVERVIEW */}
      {tab==='overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <Card icon={Server} title="General Information" color="blue">
            {isCH1 ? (<>
              <KV label="App ID" value={app.id} mono />
              <KV label="Status" value={app.status} />
              <KV label="Mule Version" value={app.muleVersion} mono />
              <KV label="Region" value={app.region} />
              <KV label="Workers" value={app.workers?.amount!=null?String(app.workers.amount):undefined} />
              <KV label="Worker Type" value={typeof app.workers?.type==='string'?app.workers.type:app.workers?.type?.name} />
              <KV label="Last Modified" value={app.lastModifiedDate?new Date(app.lastModifiedDate).toLocaleString():undefined} />
            </>) : (<>
              <KV label="Runtime Status" value={app.application?.status} />
              <KV label="Desired State" value={app.application?.desiredState} />
              <KV label="Deployment Status" value={app.status} />
              <KV label="Mule Version" value={ds.runtime?.version||ds.runtimeVersion} mono />
              <KV label="Java" value={ds.runtime?.java?`Java ${ds.runtime.java}`:undefined} />
              <KV label="Release Channel" value={ds.runtime?.releaseChannel} />
              <KV label="vCores" value={app.application?.vCores!=null?String(app.application.vCores):undefined} />
              <KV label="Replicas" value={replicas!=null?String(replicas):undefined} />
              <KV label="Update Strategy" value={typeof ds.updateStrategy==='string'?ds.updateStrategy:undefined} />
              <KV label="Artifact" value={app.application?.ref?`${app.application.ref.artifactId} v${app.application.ref.version}`:undefined} />
              <KV label="Last Modified" value={app.lastModifiedDate?new Date(app.lastModifiedDate).toLocaleString():undefined} />
            </>)}
          </Card>

          {replicaList.length>0 ? (
            <Card icon={Server} title="Replica Instances" count={replicaList.length} color="gray">
              <div className="space-y-2">
                {replicaList.map(r => (
                  <div key={r.id} className="flex items-center justify-between bg-gray-800/40 border border-gray-700/30 rounded-xl px-4 py-3 gap-3">
                    <span className="text-gray-300 text-xs font-mono truncate">{r.id}</span>
                    <StatusBadge status={r.state}/>
                  </div>
                ))}
              </div>
            </Card>
          ) : schedulers.length>0 ? (
            <Card icon={Clock} title="Schedulers Preview" count={schedulers.length} color="purple">
              <div className="space-y-2">
                {schedulers.slice(0,4).map((s,i) => (
                  <div key={i} className="bg-gray-800/40 border border-gray-700/30 rounded-xl px-4 py-3">
                    <p className="text-white text-xs font-mono font-medium mb-1">{s.flow||s.flowName||s.name}</p>
                    {(s.schedule?.cronExpression||s.expression) && <code className="text-cyan-400 text-xs font-mono">{s.schedule?.cronExpression||s.expression}</code>}
                  </div>
                ))}
                {schedulers.length>4 && <p className="text-gray-500 text-xs text-center">+{schedulers.length-4} more in Infra tab</p>}
              </div>
            </Card>
          ) : null}
        </div>
      )}

      {/* PROPERTIES */}
      {tab==='properties' && (
        <div className="space-y-5">
          <div className="relative">
            <Search size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none"/>
            <input value={propSearch} onChange={e=>setPropSearch(e.target.value)} placeholder="Search properties…"
              className="w-full bg-gray-900/60 border border-gray-700/40 rounded-xl pl-10 pr-4 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500/50"/>
          </div>
          <Card icon={Settings} title="All Properties" count={filteredProps.length} noPad>
            {filteredProps.length>0 ? (
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-gray-800/60 border-b border-gray-700/40">
                    <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 w-[42%]">Property</th>
                    <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Value</th>
                  </tr>
                </thead>
                <tbody>{filteredProps.sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=><TR key={k} k={k} v={String(v)}/>)}</tbody>
              </table>
            ) : <div className="px-5 py-8 text-center text-gray-500 text-sm">{propSearch?`No properties matching "${propSearch}"`:'No properties found'}</div>}
          </Card>
          {Object.keys(secureProps).length>0 && (
            <Card icon={Settings} title="Secure Properties" count={Object.keys(secureProps).length} color="gray" noPad>
              <div className="px-5 py-2.5 bg-orange-950/20 border-b border-orange-900/20 text-xs text-orange-400/70">
                ⚠ Values are redacted by Anypoint Platform and cannot be retrieved via API
              </div>
              <table className="w-full text-sm border-collapse">
                <tbody>{Object.entries(secureProps).map(([k,v])=><TR key={k} k={k} v={String(v)}/>)}</tbody>
              </table>
            </Card>
          )}
        </div>
      )}

      {/* INFRA & CONFIG */}
      {tab==='infrastructure' && (
        <div className="space-y-5">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <Card icon={Server} title="Resources" color="blue">
              {!isCH1 ? (<>
                <KV label="vCores" value={app.application?.vCores!=null?String(app.application.vCores):undefined} />
                <KV label="Replicas" value={replicas!=null?String(replicas):undefined} />
                <KV label="Update Strategy" value={typeof ds.updateStrategy==='string'?ds.updateStrategy:undefined} />
                <KV label="Clustered" value={ds.clustered!=null?String(ds.clustered):undefined} />
                <KV label="Spread Replicas" value={ds.enforceDeployingReplicasAcrossNodes!=null?String(ds.enforceDeployingReplicasAcrossNodes):undefined} />
                <KV label="JVM Args" value={ds.jvm?.args||'(none)'} mono />
                <KV label="Tracing" value={ds.tracingEnabled!=null?String(ds.tracingEnabled):undefined} />
              </>) : (<>
                <KV label="Workers" value={app.workers?.amount!=null?String(app.workers.amount):undefined} />
                <KV label="Worker Type" value={typeof app.workers?.type==='string'?app.workers.type:app.workers?.type?.name} />
                <KV label="Region" value={app.region} />
              </>)}
            </Card>
            <Card icon={Database} title="Object Store & Settings" color="gray">
              <KV label="Persistent Object Store" value={osEnabled?'✅ Enabled':'❌ Disabled'} />
              {isCH1 && <KV label="Persistent Queues" value={app.persistentQueues!=null?String(app.persistentQueues):undefined} />}
              {isCH1 && <KV label="Monitoring" value={app.monitoringEnabled!=null?String(app.monitoringEnabled):undefined} />}
              {isCH1 && <KV label="Custom Log4j" value={app.loggingCustomLog4JEnabled!=null?String(app.loggingCustomLog4JEnabled):undefined} />}
              {isCH1 && <KV label="Static IPs" value={app.staticIPsEnabled!=null?String(app.staticIPsEnabled):undefined} />}
              {!isCH1 && <KV label="AM Log Forwarding" value={ds.disableAmLogForwarding!=null?String(!ds.disableAmLogForwarding):undefined} />}
            </Card>
          </div>

          <Card icon={Clock} title="Schedulers" count={schedulers.length} color="purple" noPad>
            {schedulers.length>0 ? (
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-gray-800/60 border-b border-gray-700/40">
                    <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Flow Name</th>
                    <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Cron Expression</th>
                    <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Last Run</th>
                    <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">State</th>
                  </tr>
                </thead>
                <tbody>
                  {schedulers.map((s,i) => {
                    const cron = s.schedule?.cronExpression||s.expression||s.cronExpression;
                    const freq = s.frequency||(s.schedule?.period>0?s.schedule.period:null);
                    return (
                      <tr key={i} className="border-b border-gray-800/40 hover:bg-gray-800/30 transition-colors">
                        <td className="px-5 py-3.5 align-top">
                          <span className="text-white text-xs font-mono font-medium break-all">{s.flow||s.flowName||s.name}</span>
                        </td>
                        <td className="px-5 py-3.5 align-top">
                          {cron ? <code className="text-cyan-300 bg-cyan-950/30 border border-cyan-800/25 px-2 py-1 rounded-lg font-mono text-xs">{cron}</code>
                            : freq ? <span className="text-gray-300 font-mono text-xs bg-gray-800 px-2 py-0.5 rounded">{freq} {s.timeUnit||s.schedule?.timeUnit}</span>
                            : <span className="text-gray-700 text-xs">—</span>}
                        </td>
                        <td className="px-5 py-3.5 align-top">
                          <span className="text-gray-500 text-xs">{s.lastRun?new Date(s.lastRun).toLocaleString():'—'}</span>
                        </td>
                        <td className="px-5 py-3.5 align-top">
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium border ${s.enabled!==false?'bg-green-500/15 text-green-400 border-green-500/20':'bg-gray-600/20 text-gray-400 border-gray-600/20'}`}>
                            {s.enabled!==false?'Enabled':'Disabled'}
                          </span>
                          {s.status && <p className="text-xs text-gray-600 mt-0.5">{s.status}</p>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : <div className="px-5 py-6 text-center text-gray-500 text-sm">No schedulers configured</div>}
          </Card>

          {(httpInbound.publicUrl||endpoints.length>0) && (
            <Card icon={Globe} title="HTTP Endpoints" count={endpoints.length} color="gray" noPad>
              <div className="px-6 py-4 border-b border-gray-700/30">
                {httpInbound.publicUrl && <KV label="Public URL" value={httpInbound.publicUrl} mono />}
                {httpInbound.internalUrl && <KV label="Internal URL" value={httpInbound.internalUrl} mono />}
                <KV label="Last Mile Security" value={httpInbound.lastMileSecurity!=null?String(httpInbound.lastMileSecurity):undefined} />
                <KV label="Forward SSL" value={httpInbound.forwardSslSession!=null?String(httpInbound.forwardSslSession):undefined} />
              </div>
              {endpoints.length>0 && (
                <table className="w-full text-sm border-collapse">
                  <thead><tr className="bg-gray-800/50"><th className="px-5 py-2 text-left text-xs text-gray-500 font-medium uppercase tracking-wider">Access</th><th className="px-5 py-2 text-left text-xs text-gray-500 font-medium uppercase tracking-wider">URL</th></tr></thead>
                  <tbody>
                    {endpoints.map((ep,i)=>(
                      <tr key={i} className="border-t border-gray-800/40 hover:bg-gray-800/30">
                        <td className="px-5 py-3"><span className={`text-xs px-2 py-0.5 rounded font-medium ${ep.access==='external'?'bg-blue-500/15 text-blue-400':'bg-gray-600/20 text-gray-400'}`}>{ep.access}</span></td>
                        <td className="px-5 py-3"><span className="text-white text-xs font-mono break-all">{ep.url}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
          )}
        </div>
      )}

      {/* RAW JSON */}
      {tab==='raw' && (
        <Card icon={Copy} title="Raw JSON" color="gray">
          <div className="flex justify-end mb-3">
            <button onClick={copyJson} className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-white bg-gray-800 hover:bg-gray-700 px-3 py-1.5 rounded-lg border border-gray-700/40 transition-all">
              <Copy size={12}/> {copied?'Copied!':'Copy JSON'}
            </button>
          </div>
          <pre className="bg-gray-950/80 rounded-xl p-5 text-xs text-green-400 overflow-auto max-h-[600px] font-mono leading-relaxed border border-gray-800/40">
            {JSON.stringify(app,null,2)}
          </pre>
        </Card>
      )}
    </div>
  );
}
