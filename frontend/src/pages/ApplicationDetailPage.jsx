import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { ArrowLeft, RefreshCw, Copy, Check, Clock, Database, Server, Settings, Globe, Search, Eye, EyeOff, Zap } from 'lucide-react';
import api from '../services/api';

/* ── Micro components ──────────────────────────────────── */

const CopyBtn = ({ text }) => {
  const [done, setDone] = useState(false);
  const copy = () => { navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500); };
  return (
    <button onClick={copy} className="opacity-0 group-hover:opacity-100 p-1 rounded-md text-slate-500 hover:text-slate-300 hover:bg-slate-700/60 transition-all flex-shrink-0">
      {done ? <Check size={10} className="text-emerald-400"/> : <Copy size={10}/>}
    </button>
  );
};

const SecretVal = ({ value }) => {
  const [show, setShow] = useState(false);
  const isSecret = /^\*+$/.test(String(value));
  return (
    <span className="flex items-center gap-1.5">
      <span className="font-mono text-xs text-slate-200 break-all">{show || !isSecret ? String(value) : '••••••••••••'}</span>
      {isSecret && (
        <button onClick={() => setShow(!show)} className="text-slate-500 hover:text-slate-300 flex-shrink-0">
          {show ? <EyeOff size={11}/> : <Eye size={11}/>}
        </button>
      )}
    </span>
  );
};

const MetaTag = ({ children, color = 'cyan' }) => {
  const c = { cyan:'text-cyan-400 border-cyan-800/40 bg-cyan-950/30', blue:'text-blue-400 border-blue-800/40 bg-blue-950/30',
    purple:'text-purple-400 border-purple-800/40 bg-purple-950/30', green:'text-emerald-400 border-emerald-800/40 bg-emerald-950/30',
    red:'text-red-400 border-red-800/40 bg-red-950/30', gray:'text-slate-400 border-slate-700/40 bg-slate-800/40' }[color];
  return <span className={`font-mono text-[11px] px-2 py-0.5 rounded-md border ${c} leading-none`}>{children}</span>;
};

const PulseDot = ({ active }) => (
  <span className="relative flex h-2 w-2 flex-shrink-0">
    {active && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60"/>}
    <span className={`relative inline-flex rounded-full h-2 w-2 ${active ? 'bg-emerald-400' : 'bg-slate-600'}`}/>
  </span>
);

const KVRow = ({ label, value, mono, secret }) => (
  <div className="group flex items-start gap-3 py-2.5 px-4 rounded-lg hover:bg-slate-800/50 transition-colors -mx-4">
    <span className="text-[10px] font-bold tracking-wider text-slate-500 uppercase flex-shrink-0 w-40 pt-0.5">{label}</span>
    <div className="flex items-start gap-1.5 flex-1 min-w-0">
      {secret ? <SecretVal value={value}/> :
        <span className={`${mono?'font-mono text-xs text-slate-200':'text-sm text-slate-200'} break-all leading-relaxed`}>
          {value != null && value !== '' ? value : <span className="text-slate-700">—</span>}
        </span>
      }
      {value && <CopyBtn text={String(value)}/>}
    </div>
  </div>
);

const GlassCard = ({ icon: Icon, title, count, accent, children, noPad }) => (
  <div className={`rounded-2xl border bg-slate-900/50 backdrop-blur-md transition-all overflow-hidden ${accent==='blue'?'border-blue-800/50 shadow-blue-900/20':accent==='purple'?'border-purple-800/50 shadow-purple-900/20':'border-slate-800/80 hover:border-slate-700/60'} shadow-xl`}>
    <div className={`flex items-center gap-3 px-5 py-4 border-b ${accent==='blue'?'border-blue-800/30 bg-blue-900/10':accent==='purple'?'border-purple-800/30 bg-purple-900/10':'border-slate-800/60 bg-slate-800/20'}`}>
      {Icon && <div className={`p-1.5 rounded-lg ${accent==='blue'?'bg-blue-500/15':accent==='purple'?'bg-purple-500/15':'bg-slate-700/60'}`}>
        <Icon size={13} className={accent==='blue'?'text-blue-400':accent==='purple'?'text-purple-400':'text-slate-400'}/>
      </div>}
      <span className="text-slate-100 font-semibold text-sm">{title}</span>
      {count != null && <span className="ml-auto text-[11px] px-2 py-0.5 rounded-full bg-slate-800/80 text-slate-500 font-medium border border-slate-700/40">{count}</span>}
    </div>
    <div className={noPad?'':'px-5 py-4'}>{children}</div>
  </div>
);

/* ── Main component ────────────────────────────────────── */

export default function ApplicationDetailPage() {
  const { orgId: authOrgId } = useAuth();
  const { orgId: paramOrgId, envId, appId } = useParams();
  const orgId = paramOrgId || authOrgId;
  const navigate = useNavigate();
  const [app, setApp] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('overview');
  const [propSearch, setPropSearch] = useState('');

  const load = useCallback(async () => {
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
          muleVersion:typeof c.muleVersion==='string'?c.muleVersion:c.muleVersion?.version,
          lastModifiedDate:c.lastUpdateTime?new Date(c.lastUpdateTime).toISOString():null,
          properties:c.properties||{}, persistentQueues:c.persistentQueues,
          staticIPsEnabled:c.staticIPsEnabled, loggingCustomLog4JEnabled:c.loggingCustomLog4JEnabled,
          monitoringEnabled:c.monitoringAutoRestart??c.monitoringEnabled,
          workers:{ amount:typeof c.workers==='number'?c.workers:c.workers?.amount, type:c.workerType||c.workers?.type },
          _ch1Schedules:sch, _raw:c });
      } catch { setApp(null); }
    }
    setLoading(false);
  }, [orgId, envId, appId]);

  useEffect(() => { if (orgId && envId && appId) load(); }, [load]);

  if (loading) return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"/></div>;
  if (!app) return (
    <div className="space-y-4">
      <button onClick={()=>navigate('/applications')} className="flex items-center gap-2 text-slate-400 hover:text-white text-sm"><ArrowLeft size={16}/> Back</button>
      <div className="bg-red-950/30 border border-red-800/50 rounded-2xl p-10 text-center text-red-400">Application not found or access denied.</div>
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
  const rStatus = (app.application?.status || app.status || '').toUpperCase();
  const isRunning = rStatus === 'RUNNING' || rStatus === 'STARTED';

  const statusStyle = { RUNNING:'text-emerald-300 bg-emerald-950/50 border-emerald-700/50 shadow-emerald-900/30',
    STARTED:'text-emerald-300 bg-emerald-950/50 border-emerald-700/50 shadow-emerald-900/30',
    FAILED:'text-red-300 bg-red-950/50 border-red-700/50 shadow-red-900/30',
    STOPPED:'text-slate-400 bg-slate-800/50 border-slate-700/50',
    DEPLOYING:'text-blue-300 bg-blue-950/50 border-blue-700/50 shadow-blue-900/30',
    APPLIED:'text-cyan-300 bg-cyan-950/50 border-cyan-700/50' }[rStatus] || 'text-slate-400 bg-slate-800/50 border-slate-700/50';

  const tabs = [
    { id:'overview', label:'Overview' },
    { id:'properties', label:'Properties', badge:Object.keys(allProps).length },
    { id:'infrastructure', label:'Infra & Config' },
    { id:'raw', label:'Raw JSON' },
  ];

  return (
    <div className="space-y-6 min-h-screen">
      {/* ── Hero Header ─────────────────────────────── */}
      <div className="relative rounded-2xl border border-slate-800/60 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-slate-900 via-[#0B0F17] to-blue-950/20"/>
        <div className="absolute inset-0" style={{background:'radial-gradient(ellipse at 70% 50%, rgba(59,130,246,0.06) 0%, transparent 60%)'}}/>
        {isRunning && <div className="absolute top-0 right-0 w-96 h-96 bg-emerald-500/3 rounded-full blur-3xl pointer-events-none"/>}
        <div className="relative p-6 flex items-start justify-between flex-wrap gap-4">
          <div className="flex items-start gap-4">
            <button onClick={()=>navigate('/applications')} className="mt-0.5 p-2 rounded-xl text-slate-500 hover:text-white hover:bg-slate-800/80 border border-transparent hover:border-slate-700/50 transition-all">
              <ArrowLeft size={16}/>
            </button>
            <div>
              <div className="flex items-center gap-3 flex-wrap mb-2">
                <h1 className="text-xl font-bold text-white tracking-tight">{app.name}</h1>
                <span className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full font-semibold border shadow-lg ${statusStyle}`}>
                  <PulseDot active={isRunning}/> {rStatus || 'Unknown'}
                </span>
                <span className={`text-xs px-2.5 py-1 rounded-full font-semibold border ${isCH1?'bg-purple-950/50 text-purple-300 border-purple-700/50':'bg-blue-950/50 text-blue-300 border-blue-700/50'}`}>
                  {isCH1?'CloudHub 1.0':'CloudHub 2.0'}
                </span>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <MetaTag color="gray">{app.id}</MetaTag>
                {app.application?.ref && <MetaTag color="blue">{app.application.ref.artifactId} v{app.application.ref.version}</MetaTag>}
                {(app.region||ds.runtime?.version) && <MetaTag color="cyan">{ds.runtime?.version||ds.runtimeVersion||app.muleVersion}</MetaTag>}
              </div>
            </div>
          </div>
          <button onClick={load} className="p-2.5 rounded-xl text-slate-500 hover:text-white bg-slate-800/60 border border-slate-700/40 hover:bg-slate-700/60 transition-all">
            <RefreshCw size={14}/>
          </button>
        </div>
      </div>

      {/* ── Segmented Tabs ──────────────────────────── */}
      <div className="bg-slate-900 p-1 rounded-xl border border-slate-800 w-fit flex gap-0.5">
        {tabs.map(t => (
          <button key={t.id} onClick={()=>setTab(t.id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${tab===t.id?'bg-slate-700/80 text-white shadow-md':'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'}`}>
            {t.label}
            {t.badge>0 && <span className={`text-[10px] px-1.5 py-0.5 rounded-md font-bold ${tab===t.id?'bg-blue-500/30 text-blue-300':'bg-slate-800 text-slate-500'}`}>{t.badge}</span>}
          </button>
        ))}
      </div>

      {/* ── OVERVIEW ────────────────────────────────── */}
      {tab==='overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <GlassCard icon={Server} title="General Information" accent="blue">
            {isCH1 ? (<>
              <KVRow label="App ID" value={app.id} mono />
              <KVRow label="Status" value={app.status} />
              <KVRow label="Mule Version" value={app.muleVersion} mono />
              <KVRow label="Region" value={app.region} mono />
              <KVRow label="Workers" value={app.workers?.amount!=null?String(app.workers.amount):undefined} />
              <KVRow label="Worker Type" value={typeof app.workers?.type==='string'?app.workers.type:app.workers?.type?.name} />
              <KVRow label="Last Modified" value={app.lastModifiedDate?new Date(app.lastModifiedDate).toLocaleString():undefined} />
            </>) : (<>
              <KVRow label="Runtime Status" value={app.application?.status} />
              <KVRow label="Desired State" value={app.application?.desiredState} />
              <KVRow label="Deployment Status" value={app.status} />
              <KVRow label="Mule Version" value={ds.runtime?.version||ds.runtimeVersion} mono />
              <KVRow label="Java" value={ds.runtime?.java?`Java ${ds.runtime.java}`:undefined} mono />
              <KVRow label="Release Channel" value={ds.runtime?.releaseChannel} />
              <KVRow label="vCores" value={app.application?.vCores!=null?String(app.application.vCores):undefined} />
              <KVRow label="Replicas" value={replicas!=null?String(replicas):undefined} />
              <KVRow label="Update Strategy" value={typeof ds.updateStrategy==='string'?ds.updateStrategy:undefined} />
              <KVRow label="Artifact" value={app.application?.ref?`${app.application.ref.artifactId} v${app.application.ref.version}`:undefined} />
              <KVRow label="Last Modified" value={app.lastModifiedDate?new Date(app.lastModifiedDate).toLocaleString():undefined} />
            </>)}
          </GlassCard>

          {replicaList.length>0 && (
            <GlassCard icon={Server} title="Replica Instances" count={replicaList.length}>
              <div className="space-y-2">
                {replicaList.map(r => (
                  <div key={r.id} className="flex items-center justify-between bg-slate-800/40 border border-slate-700/30 rounded-xl px-4 py-3 gap-3">
                    <span className="text-slate-300 text-xs font-mono truncate">{r.id}</span>
                    <MetaTag color={r.state==='STARTED'||r.state==='RUNNING'?'green':'gray'}>{r.state}</MetaTag>
                  </div>
                ))}
              </div>
            </GlassCard>
          )}
        </div>
      )}

      {/* ── PROPERTIES ──────────────────────────────── */}
      {tab==='properties' && (
        <div className="space-y-4">
          <div className="relative">
            <Search size={13} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none"/>
            <input value={propSearch} onChange={e=>setPropSearch(e.target.value)} placeholder="Filter properties by key…"
              className="w-full bg-slate-900/60 border border-slate-800/80 rounded-xl pl-10 pr-4 py-2.5 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-blue-600/50 focus:bg-slate-900"/>
          </div>

          <GlassCard icon={Settings} title="Properties" count={filteredProps.length} noPad>
            {filteredProps.length>0 ? (
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-slate-800/50 border-b border-slate-700/40">
                    <th className="px-5 py-3 text-left text-[10px] font-bold tracking-wider text-slate-500 uppercase w-[42%]">Property Key</th>
                    <th className="px-5 py-3 text-left text-[10px] font-bold tracking-wider text-slate-500 uppercase">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredProps.sort(([a],[b])=>a.localeCompare(b)).map(([k,v]) => (
                    <tr key={k} className="group border-b border-slate-800/40 hover:bg-slate-800/30 transition-colors">
                      <td className="px-5 py-3 align-top">
                        <div className="flex items-center gap-1.5">
                          <span className="text-slate-400 text-xs font-mono break-all leading-relaxed">{k}</span>
                          <CopyBtn text={k}/>
                        </div>
                      </td>
                      <td className="px-5 py-3 align-top">
                        <div className="flex items-start gap-1.5">
                          <SecretVal value={String(v)}/>
                          <CopyBtn text={String(v)}/>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <div className="px-5 py-8 text-center text-slate-600 text-sm">{propSearch?`No matches for "${propSearch}"`:'No properties found'}</div>}
          </GlassCard>

          {Object.keys(secureProps).length>0 && (
            <GlassCard icon={Settings} title="Secure Properties" count={Object.keys(secureProps).length} noPad>
              <div className="px-5 py-2.5 bg-orange-950/20 border-b border-orange-900/20">
                <span className="text-xs text-orange-400/70">⚠ Values are redacted by Anypoint Platform</span>
              </div>
              <table className="w-full text-sm border-collapse">
                <tbody>
                  {Object.entries(secureProps).map(([k,v]) => (
                    <tr key={k} className="group border-b border-slate-800/40 hover:bg-slate-800/30 transition-colors">
                      <td className="px-5 py-3 w-[42%]"><span className="text-slate-400 text-xs font-mono">{k}</span></td>
                      <td className="px-5 py-3"><SecretVal value={String(v)}/></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </GlassCard>
          )}
        </div>
      )}

      {/* ── INFRA & CONFIG ───────────────────────────── */}
      {tab==='infrastructure' && (
        <div className="space-y-5">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <GlassCard icon={Database} title="Object Store & Settings">
              <KVRow label="Persistent Object Store" value={osEnabled?'✅ Enabled':'❌ Disabled'} />
              {isCH1 && <KVRow label="Persistent Queues" value={app.persistentQueues!=null?String(app.persistentQueues):undefined} />}
              {isCH1 && <KVRow label="Monitoring" value={app.monitoringEnabled!=null?String(app.monitoringEnabled):undefined} />}
              {isCH1 && <KVRow label="Custom Log4j" value={app.loggingCustomLog4JEnabled!=null?String(app.loggingCustomLog4JEnabled):undefined} />}
              {!isCH1 && <KVRow label="AM Log Forwarding" value={ds.disableAmLogForwarding!=null?String(!ds.disableAmLogForwarding):undefined} />}
            </GlassCard>

            <GlassCard icon={Clock} title="Schedulers" count={schedulers.length} accent="purple" noPad>
            {schedulers.length>0 ? (
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-slate-800/50 border-b border-slate-700/40">
                    {['Flow Name','Cron Expression','Last Run','State'].map(h=>(
                      <th key={h} className="px-5 py-3 text-left text-[10px] font-bold tracking-wider text-slate-500 uppercase">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {schedulers.map((s,i) => {
                    const cron = s.schedule?.cronExpression||s.expression||s.cronExpression;
                    const freq = s.frequency||(s.schedule?.period>0?s.schedule.period:null);
                    const active = s.enabled!==false;
                    return (
                      <tr key={i} className="border-b border-slate-800/40 hover:bg-slate-800/30 transition-colors">
                        <td className="px-5 py-4 align-top">
                          <div className="flex items-center gap-2">
                            <PulseDot active={active}/>
                            <span className="text-slate-200 text-xs font-mono font-medium break-all">{s.flow||s.flowName||s.name}</span>
                          </div>
                        </td>
                        <td className="px-5 py-4 align-top">
                          {cron ? <MetaTag color="cyan">{cron}</MetaTag>
                            : freq ? <MetaTag color="blue">{freq} {s.timeUnit||s.schedule?.timeUnit}</MetaTag>
                            : <span className="text-slate-700 text-xs">—</span>}
                        </td>
                        <td className="px-5 py-4 align-top">
                          <span className="text-slate-500 text-xs">{s.lastRun?new Date(s.lastRun).toLocaleString():'—'}</span>
                        </td>
                        <td className="px-5 py-4 align-top">
                          <span className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full font-semibold border ${active?'bg-emerald-950/50 text-emerald-300 border-emerald-700/50':'bg-slate-800/60 text-slate-500 border-slate-700/50'}`}>
                            {active?'Enabled':'Disabled'}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : <div className="px-5 py-6 text-center text-slate-600 text-sm">No schedulers configured</div>}
          </GlassCard>
          </div>

          {(httpInbound.publicUrl||endpoints.length>0) && (
            <GlassCard icon={Globe} title="HTTP Endpoints" count={endpoints.length} noPad>
              <div className="px-5 py-4 border-b border-slate-800/40 space-y-1">
                {httpInbound.publicUrl && <KVRow label="Public URL" value={httpInbound.publicUrl} mono />}
                {httpInbound.internalUrl && <KVRow label="Internal URL" value={httpInbound.internalUrl} mono />}
                <KVRow label="Last Mile Security" value={httpInbound.lastMileSecurity!=null?String(httpInbound.lastMileSecurity):undefined} />
                <KVRow label="Forward SSL" value={httpInbound.forwardSslSession!=null?String(httpInbound.forwardSslSession):undefined} />
              </div>
              {endpoints.length>0 && (
                <table className="w-full text-sm border-collapse">
                  <thead><tr className="bg-slate-800/40"><th className="px-5 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-slate-500">Access</th><th className="px-5 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-slate-500">URL</th></tr></thead>
                  <tbody>
                    {endpoints.map((ep,i)=>(
                      <tr key={i} className="border-t border-slate-800/40 hover:bg-slate-800/30 group">
                        <td className="px-5 py-3"><MetaTag color={ep.access==='external'?'blue':'gray'}>{ep.access}</MetaTag></td>
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-1.5">
                            <span className="text-slate-300 text-xs font-mono break-all">{ep.url}</span>
                            <CopyBtn text={ep.url}/>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </GlassCard>
          )}
        </div>
      )}

      {/* ── RAW JSON ────────────────────────────────── */}
      {tab==='raw' && (
        <GlassCard icon={Copy} title="Raw JSON">
          <div className="flex justify-end mb-3">
            <CopyBtn text={JSON.stringify(app,null,2)}/>
          </div>
          <pre className="bg-[#0B0F17] rounded-xl p-5 text-xs text-emerald-400/90 overflow-auto max-h-[600px] font-mono leading-relaxed border border-slate-800/60">
            {JSON.stringify(app,null,2)}
          </pre>
        </GlassCard>
      )}
    </div>
  );
}
