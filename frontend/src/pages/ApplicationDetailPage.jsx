import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { ArrowLeft, RefreshCw, Copy, Check, Clock, Database, Server, Settings, Globe, Search, Eye, EyeOff, Zap, Play, Square, RotateCcw, AlertTriangle, X, Key, Package } from 'lucide-react';
import api from '../services/api';
import CpsSettingsModal from '../components/CpsSettingsModal';

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

/* ── Action helpers ────────────────────────────────────── */
const availableActions = (status) => {
  const s = (status || '').toUpperCase();
  if (['RUNNING', 'STARTED', 'PARTIALLY_STARTED', 'PARTIALLY_RUNNING'].includes(s)) return ['stop', 'restart'];
  if (['STOPPED', 'FAILED', 'DEPLOY_FAILED', 'UNDEPLOYED', 'NOT_RUNNING'].includes(s)) return ['start'];
  return [];
};

const ACTION_CONFIG = {
  start:   { label: 'Start',   Icon: Play,      cls: 'text-emerald-400 border-emerald-800/50 hover:bg-emerald-950/60 hover:text-emerald-300' },
  stop:    { label: 'Stop',    Icon: Square,    cls: 'text-red-400    border-red-800/50    hover:bg-red-950/60    hover:text-red-300' },
  restart: { label: 'Restart', Icon: RotateCcw, cls: 'text-blue-400   border-blue-800/50   hover:bg-blue-950/60   hover:text-blue-300' }
};

function AppConfirmModal({ state, onConfirm, onCancel, loading }) {
  if (!state) return null;
  const { action, appName } = state;
  const cfg = ACTION_CONFIG[action];
  const { Icon } = cfg;
  const dangerous = action === 'stop';
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 w-full max-w-md shadow-2xl mx-4">
        <div className="flex items-start gap-4">
          <div className={`p-2.5 rounded-xl flex-shrink-0 border ${dangerous ? 'bg-red-950/60 border-red-800/40' : 'bg-blue-950/60 border-blue-800/40'}`}>
            <AlertTriangle size={18} className={dangerous ? 'text-red-400' : 'text-blue-400'} />
          </div>
          <div className="flex-1">
            <h3 className="text-white font-semibold text-base mb-1">{cfg.label} Application?</h3>
            <p className="text-slate-400 text-sm">
              Are you sure you want to <span className="text-white font-medium">{cfg.label.toLowerCase()}</span>{' '}
              <span className="font-mono text-blue-300 text-xs bg-blue-950/40 px-1.5 py-0.5 rounded">{appName}</span>?
            </p>
            {dangerous && <p className="text-red-400/80 text-xs mt-2">⚠ This will stop all running flows and connections.</p>}
          </div>
          <button onClick={onCancel} className="text-slate-600 hover:text-slate-300"><X size={16} /></button>
        </div>
        <div className="flex justify-end gap-3 mt-6">
          <button onClick={onCancel} disabled={loading}
            className="px-4 py-2 text-sm text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-lg disabled:opacity-50 transition-colors">
            Cancel
          </button>
          <button onClick={onConfirm} disabled={loading}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg disabled:opacity-50 transition-colors ${dangerous ? 'bg-red-600 hover:bg-red-500 text-white' : 'bg-blue-600 hover:bg-blue-500 text-white'}`}>
            {loading
              ? <><span className="animate-spin rounded-full h-3.5 w-3.5 border-b-2 border-white" /> Working…</>
              : <><Icon size={13} /> Confirm {cfg.label}</>}
          </button>
        </div>
      </div>
    </div>
  );
}

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
  const [schedulerSearch, setSchedulerSearch] = useState('');
  const [actionLoading, setActionLoading] = useState(null);
  const [confirmState, setConfirmState] = useState(null);
  const [actionResult, setActionResult] = useState(null);
  // CPS state
  const [cpsLoading, setCpsLoading] = useState(false);
  const [cpsData, setCpsData] = useState(null);
  const [cpsError, setCpsError] = useState('');
  const [cpsMissingCred, setCpsMissingCred] = useState(null);
  const [showCpsSettings, setShowCpsSettings] = useState(false);
  const [cpsSearch, setCpsSearch] = useState('');
  const [cpsKeyOverride, setCpsKeyOverride] = useState('');
  const [cpsEnvOverride, setCpsEnvOverride] = useState('');
  const [cpsAttemptedUrl, setCpsAttemptedUrl] = useState('');

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

  const requestAction = (action) => {
    setActionResult(null);
    setConfirmState({ action, appName: app?.name });
  };

  const executeAction = async () => {
    if (!confirmState || !app) return;
    const { action } = confirmState;
    setActionLoading(action);
    try {
      if (app._type === 'ch1') {
        await api.post(`/applications/cloudhub1/${envId}/${appId}/action?orgId=${orgId}`, { action });
      } else {
        await api.post(`/applications/cloudhub2/${orgId}/${envId}/${appId}/action`, { action });
      }
      const nextStatus = action === 'start' ? 'RUNNING' : action === 'stop' ? 'STOPPED' : 'DEPLOYING';
      setApp((prev) => prev ? { ...prev,
        status: nextStatus,
        application: prev.application ? { ...prev.application, status: nextStatus } : prev.application
      } : prev);
      setActionResult({ success: true, message: `✓ ${app.name}: ${action} initiated successfully` });
    } catch (e) {
      setActionResult({ success: false, message: `✗ Failed to ${action}: ${e.response?.data?.error || e.message}` });
    } finally {
      setActionLoading(null);
      setConfirmState(null);
      setTimeout(() => setActionResult(null), 6000);
    }
  };

  const isCH1 = app?._type === 'ch1';

  if (loading) return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"/></div>;
  if (!app) return (
    <div className="space-y-4">
      <button onClick={()=>navigate('/applications')} className="flex items-center gap-2 text-slate-400 hover:text-white text-sm"><ArrowLeft size={16}/> Back</button>
      <div className="bg-red-950/30 border border-red-800/50 rounded-2xl p-10 text-center text-red-400">Application not found or access denied.</div>
    </div>
  );

  const actions = availableActions(app.application?.status || app.status);

  const ds = app.target?.deploymentSettings || {};
  const appCfg = app.application?.configuration || {};
  const propsSvc = appCfg['mule.agent.application.properties.service'] || {};
  const schedSvc = appCfg['mule.agent.scheduling.service'] || {};
  const runtimeProps = propsSvc.properties || {};
  const secureProps = propsSvc.secureProperties || {};
  const allSchedulers = isCH1?(app._ch1Schedules||[]):(schedSvc.schedulers||[]);
  const schedulers = schedulerSearch
    ? allSchedulers.filter((s) => {
        const q = schedulerSearch.toLowerCase();
        const flow = (s.flow || s.flowName || s.name || '').toLowerCase();
        const cron = (s.schedule?.cronExpression || s.expression || s.cronExpression || '').toLowerCase();
        const freq = String(s.frequency || s.schedule?.period || '').toLowerCase();
        return flow.includes(q) || cron.includes(q) || freq.includes(q);
      })
    : allSchedulers;
  const httpInbound = ds.http?.inbound || {};
  const endpoints = httpInbound.endpoints || [];
  const envVars = ds.environmentVariables || ds.environmentVars || {};
  const replicas = app.target?.replicas ?? ds.replicas;
  const osEnabled = ds.persistentObjectStore ?? ds.hasPersistentObjectStore ?? false;
  const replicaList = app.replicas || [];
  const allProps = { ...runtimeProps, ...ds.properties, ...envVars, ...app.properties };
  const filteredProps = Object.entries(allProps).filter(([k]) => !propSearch || k.toLowerCase().includes(propSearch.toLowerCase()));

  // CPS computed values — read directly from runtime properties
  const cpsBaseUrl = allProps['cps.configServerBaseUrl'] || allProps['config.server.base.url'];
  const cpsProjectName = allProps['cps.projectName'] || allProps['cloudhub.api.name'] || app.name;
  const cpsEnv = allProps['cps.prefix'] || allProps['cps.environment'] || (() => {
    // fallback: derive from Anypoint env name if cps.prefix not set
    const s = `${app.environment?.name || ''} ${app.environment?.type || ''}`.toLowerCase();
    if (/\b(prod|pd)\b/.test(s)) return 'prod';
    if (/\b(uat|ut|stg|stage|sandbox|uap)\b/.test(s)) return 'uat';
    return app.environment?.type === 'production' ? 'prod' : 'uat';
  })();
  const appEnvName = app.environment?.name || '';
  const cpsDepType = isCH1 ? 'ch1' : 'ch2';

  const effectiveCpsKey = cpsKeyOverride || cpsProjectName;
  const effectiveCpsEnv = cpsEnvOverride || cpsEnv;

  const loadCpsData = async (keyOverride, envOverride) => {
    if (!cpsBaseUrl) return;
    const useKey = keyOverride || effectiveCpsKey;
    const useEnv = envOverride || effectiveCpsEnv;
    setCpsLoading(true); setCpsError(''); setCpsMissingCred(null); setCpsData(null); setCpsAttemptedUrl('');
    try {
      let nsRaw;
      try {
        // Try specific key first
        const nsRes = await api.get('/cps/fetch', { params: { baseUrl: cpsBaseUrl, type: 'non-secure', environment: useEnv, keys: useKey, deploymentType: cpsDepType, envName: appEnvName } });
        nsRaw = nsRes.data;
      } catch (e404) {
        if (e404.response?.status === 404) {
          // Fallback: fetch all non-secure properties for this environment
          const allRes = await api.get('/cps/fetch', { params: { baseUrl: cpsBaseUrl, type: 'non-secure-all', environment: useEnv, deploymentType: cpsDepType, envName: appEnvName } });
          nsRaw = allRes.data;
          // Try to find the matching entry
          if (Array.isArray(nsRaw?.properties)) {
            const match = nsRaw.properties.find((p) => p.key === useKey || p.key?.includes(useKey));
            if (match) nsRaw = { properties: [match] };
          }
        } else throw e404;
      }
      const nsEntry = Array.isArray(nsRaw?.properties) ? (nsRaw.properties.find((p) => p.key === useKey) || nsRaw.properties[0]) : nsRaw;
      const flatNs = (nsEntry?.properties && typeof nsEntry.properties === 'object' && !Array.isArray(nsEntry.properties)) ? nsEntry.properties : (typeof nsRaw === 'object' && !Array.isArray(nsRaw) ? nsRaw : {});

      let secureGroups = [];
      const secureKeys = flatNs['cps.secure.properties'];
      if (secureKeys) {
        try {
          const sr = await api.get('/cps/fetch', { params: { baseUrl: cpsBaseUrl, type: 'secure', environment: useEnv, keys: secureKeys, deploymentType: cpsDepType, envName: appEnvName } });
          secureGroups = Array.isArray(sr.data?.properties) ? sr.data.properties : Array.isArray(sr.data) ? sr.data : [];
        } catch {}
      }

      let binaryList = [];
      const binaryKeys = flatNs['cps.secure.binaries'];
      if (binaryKeys) {
        try {
          const br = await api.get('/cps/fetch', { params: { baseUrl: cpsBaseUrl, type: 'binaries', environment: useEnv, keys: binaryKeys, deploymentType: cpsDepType, envName: appEnvName } });
          binaryList = br.data?.binaries || (Array.isArray(br.data) ? br.data : []);
        } catch {}
      }

      setCpsData({ nonSecure: flatNs, secureGroups, binaryList });
    } catch (e) {
      if (e.response?.status === 422 || e.response?.data?.needsConfig) {
        setCpsMissingCred(e.response.data.credKey);
      } else {
        setCpsError(e.response?.data?.error || e.message || 'CPS fetch failed');
        setCpsAttemptedUrl(e.response?.data?.attemptedUrl || '');
      }
    }
    setCpsLoading(false);
  };
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
    ...(cpsBaseUrl ? [{ id:'cps', label:'CPS Config' }] : []),
    { id:'raw', label:'Raw JSON' },
  ];

  return (
    <div className="space-y-6 min-h-screen">
      {showCpsSettings && <CpsSettingsModal onClose={() => { setShowCpsSettings(false); if (cpsMissingCred) { setCpsMissingCred(null); loadCpsData(); } }} />}
      <AppConfirmModal
        state={confirmState}
        onConfirm={executeAction}
        onCancel={() => setConfirmState(null)}
        loading={!!actionLoading}
      />

      {/* Action toast */}
      {actionResult && (
        <div className={`flex items-center justify-between px-4 py-3 rounded-xl border text-sm ${
          actionResult.success
            ? 'bg-emerald-950/40 border-emerald-800/50 text-emerald-300'
            : 'bg-red-950/40 border-red-800/50 text-red-300'
        }`}>
          <span>{actionResult.message}</span>
          <button onClick={() => setActionResult(null)} className="ml-4 opacity-60 hover:opacity-100"><X size={14} /></button>
        </div>
      )}

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
          <div className="flex items-center gap-2 flex-shrink-0">
            {/* Action buttons */}
            {actions.length > 0 && (
              <div className="flex items-center gap-1.5">
                {actionLoading ? (
                  <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-800/60 border border-slate-700/40">
                    <span className="animate-spin rounded-full h-3.5 w-3.5 border-b-2 border-blue-400" />
                    <span className="text-slate-400 text-xs">Working…</span>
                  </div>
                ) : actions.map((action) => {
                  const { Icon, label, cls } = ACTION_CONFIG[action];
                  return (
                    <button key={action} title={label} onClick={() => requestAction(action)}
                      className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium border bg-slate-800/60 transition-all ${cls}`}>
                      <Icon size={13} /> {label}
                    </button>
                  );
                })}
              </div>
            )}
            <button onClick={load} className="p-2.5 rounded-xl text-slate-500 hover:text-white bg-slate-800/60 border border-slate-700/40 hover:bg-slate-700/60 transition-all">
              <RefreshCw size={14}/>
            </button>
          </div>
        </div>
      </div>

      {/* ── Segmented Tabs ──────────────────────────── */}
      <div className="bg-slate-900 p-1 rounded-xl border border-slate-800 w-fit flex gap-0.5">
        {tabs.map(t => (
          <button key={t.id}
            onClick={() => { setTab(t.id); if (t.id === 'cps' && !cpsData && !cpsLoading) loadCpsData(); }}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${tab===t.id?'bg-slate-700/80 text-white shadow-md':'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'}`}>
            {t.id === 'cps' && <Key size={11} />}
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
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
            <GlassCard icon={Database} title="Object Store & Settings">
              <KVRow label="Persistent Object Store" value={osEnabled?'✅ Enabled':'❌ Disabled'} />
              {isCH1 && <KVRow label="Persistent Queues" value={app.persistentQueues!=null?String(app.persistentQueues):undefined} />}
              {isCH1 && <KVRow label="Monitoring" value={app.monitoringEnabled!=null?String(app.monitoringEnabled):undefined} />}
              {isCH1 && <KVRow label="Custom Log4j" value={app.loggingCustomLog4JEnabled!=null?String(app.loggingCustomLog4JEnabled):undefined} />}
              {!isCH1 && <KVRow label="AM Log Forwarding" value={ds.disableAmLogForwarding!=null?String(!ds.disableAmLogForwarding):undefined} />}
            </GlassCard>

            <GlassCard icon={Clock} title="Schedulers" count={allSchedulers.length} accent="purple" noPad>
            {allSchedulers.length>0 && (
              <div className="px-5 pt-4 pb-3 border-b border-slate-800/40">
                <div className="relative">
                  <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none"/>
                  <input
                    value={schedulerSearch}
                    onChange={(e) => setSchedulerSearch(e.target.value)}
                    placeholder="Filter by flow name or cron…"
                    className="w-full bg-slate-800/50 border border-slate-700/50 rounded-lg pl-8 pr-4 py-2 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-purple-600/50 focus:bg-slate-800"
                  />
                  {schedulerSearch && (
                    <button onClick={() => setSchedulerSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 text-xs">✕</button>
                  )}
                </div>
                {schedulerSearch && (
                  <p className="text-[10px] text-slate-600 mt-1.5">
                    Showing {schedulers.length} of {allSchedulers.length} scheduler{allSchedulers.length !== 1 ? 's' : ''}
                  </p>
                )}
              </div>
            )}
            {allSchedulers.length>0 ? (
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
            ) : schedulerSearch ? (
              <div className="px-5 py-6 text-center text-slate-500 text-sm">No schedulers match <span className="text-slate-400 font-mono">"{schedulerSearch}"</span></div>
            ) : (
              <div className="px-5 py-6 text-center text-slate-600 text-sm">No schedulers configured</div>
            )}
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

      {/* ── CPS CONFIG ──────────────────────────────── */}
      {tab==='cps' && cpsBaseUrl && (
        <div className="space-y-5">
          {/* Info bar */}
          <div className="flex items-center justify-between flex-wrap gap-3 bg-slate-900/60 border border-slate-800/60 rounded-2xl px-5 py-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Key size={13} className="text-blue-400" />
                <span className="text-white text-sm font-semibold">Config Property Server</span>
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium border ${cpsEnv==='prod'?'bg-emerald-950/50 text-emerald-300 border-emerald-700/50':'bg-yellow-950/50 text-yellow-300 border-yellow-700/50'}`}>{cpsEnv.toUpperCase()}</span>
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium border ${isCH1?'bg-purple-950/50 text-purple-300 border-purple-700/50':'bg-blue-950/50 text-blue-300 border-blue-700/50'}`}>{isCH1?'CH1':'CH2'}</span>
              </div>
              <p className="text-slate-500 text-xs font-mono break-all">{cpsBaseUrl}</p>
              {/* Editable key + env overrides */}
              <div className="flex flex-wrap gap-2 mt-2">
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-slate-600 uppercase tracking-wider">Env:</span>
                  <input
                    value={cpsEnvOverride || effectiveCpsEnv}
                    onChange={(e) => { setCpsEnvOverride(e.target.value); setCpsData(null); setCpsError(''); }}
                    className="bg-slate-800/60 border border-slate-700/40 rounded-lg px-2 py-1 text-xs text-slate-200 font-mono w-24 focus:outline-none focus:border-blue-600/50"
                  />
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-slate-600 uppercase tracking-wider">Key:</span>
                  <input
                    value={cpsKeyOverride || effectiveCpsKey}
                    onChange={(e) => { setCpsKeyOverride(e.target.value); setCpsData(null); setCpsError(''); }}
                    className="bg-slate-800/60 border border-slate-700/40 rounded-lg px-2 py-1 text-xs text-slate-200 font-mono w-56 focus:outline-none focus:border-blue-600/50"
                  />
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => loadCpsData(cpsKeyOverride, cpsEnvOverride)} className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-slate-400 hover:text-white bg-slate-800/60 border border-slate-700/40 rounded-lg transition-colors"><RefreshCw size={11}/> {cpsData ? 'Refresh' : 'Load'}</button>
              <button onClick={() => setShowCpsSettings(true)} className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-blue-400 hover:text-blue-300 bg-blue-950/40 border border-blue-800/40 rounded-lg transition-colors"><Key size={11}/> Configure CPS</button>
            </div>
          </div>

          {/* Missing credentials warning */}
          {cpsMissingCred && (
            <div className="flex items-center justify-between gap-4 bg-yellow-950/30 border border-yellow-800/50 rounded-xl px-5 py-4">
              <div className="flex items-center gap-3">
                <AlertTriangle size={16} className="text-yellow-400 flex-shrink-0" />
                <div>
                  <p className="text-yellow-300 text-sm font-medium">CPS credentials not configured</p>
                  <p className="text-yellow-500/80 text-xs mt-0.5">Missing <code className="bg-yellow-950/60 px-1 rounded">{cpsMissingCred}</code> credentials. Click "Configure CPS" to add them.</p>
                </div>
              </div>
              <button onClick={() => setShowCpsSettings(true)} className="flex-shrink-0 px-3 py-1.5 text-xs font-medium bg-yellow-600 hover:bg-yellow-500 text-white rounded-lg transition-colors">Configure</button>
            </div>
          )}

          {/* Error */}
          {cpsError && (
            <div className="bg-red-950/30 border border-red-800/50 rounded-xl px-5 py-4 space-y-2">
              <div className="flex items-center gap-3 text-red-300 text-sm">
                <AlertTriangle size={14} className="flex-shrink-0" /> {cpsError}
              </div>
              {cpsAttemptedUrl && (
                <div className="text-[10px] text-red-500/80 font-mono break-all border-t border-red-900/30 pt-2">
                  Attempted: {cpsAttemptedUrl}
                </div>
              )}
              <div className="text-[10px] text-red-500/60 pt-0.5">
                💡 Check the <strong>Env</strong> and <strong>Key</strong> fields above — they must match exactly what's stored in CPS.
                Check the backend console for the full URL that was called.
              </div>
            </div>
          )}

          {/* Loading */}
          {cpsLoading && (
            <div className="flex items-center justify-center py-16 gap-3 text-slate-500">
              <RefreshCw size={18} className="animate-spin" />
              <span className="text-sm">Loading CPS properties…</span>
            </div>
          )}

          {/* Not loaded yet */}
          {!cpsLoading && !cpsData && !cpsError && !cpsMissingCred && (
            <div className="flex flex-col items-center justify-center py-16 gap-4">
              <Key size={32} className="text-slate-700" />
              <p className="text-slate-500 text-sm">Click to load properties from the Config Property Server</p>
              <p className="text-slate-600 text-xs">Will fetch <code className="text-slate-500">{effectiveCpsKey}</code> in <code className="text-slate-500">{effectiveCpsEnv}</code></p>
              <button onClick={() => loadCpsData(cpsKeyOverride, cpsEnvOverride)} className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-xl transition-colors">
                <Key size={13} /> Load CPS Properties
              </button>
            </div>
          )}

          {/* CPS data loaded */}
          {cpsData && (
            <div className="space-y-5">
              {/* Search */}
              <div className="relative">
                <Search size={13} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
                <input value={cpsSearch} onChange={(e) => setCpsSearch(e.target.value)} placeholder="Filter CPS properties by key or value…"
                  className="w-full bg-slate-900/60 border border-slate-800/80 rounded-xl pl-10 pr-4 py-2.5 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-blue-600/50" />
              </div>

              {/* Non-secure properties */}
              {Object.keys(cpsData.nonSecure).length > 0 && (
                <GlassCard icon={Settings} title="Non-Secure Properties" count={Object.keys(cpsData.nonSecure).length} noPad>
                  <table className="w-full text-sm border-collapse">
                    <thead><tr className="bg-slate-800/50 border-b border-slate-700/40">
                      <th className="px-5 py-3 text-left text-[10px] font-bold tracking-wider text-slate-500 uppercase w-[42%]">Key</th>
                      <th className="px-5 py-3 text-left text-[10px] font-bold tracking-wider text-slate-500 uppercase">Value</th>
                    </tr></thead>
                    <tbody>
                      {Object.entries(cpsData.nonSecure)
                        .filter(([k, v]) => !cpsSearch || k.toLowerCase().includes(cpsSearch.toLowerCase()) || String(v).toLowerCase().includes(cpsSearch.toLowerCase()))
                        .sort(([a], [b]) => a.localeCompare(b))
                        .map(([k, v]) => (
                          <tr key={k} className="group border-b border-slate-800/40 hover:bg-slate-800/30 transition-colors">
                            <td className="px-5 py-3 align-top"><div className="flex items-center gap-1.5"><span className="text-slate-400 text-xs font-mono break-all">{k}</span><CopyBtn text={k}/></div></td>
                            <td className="px-5 py-3 align-top"><div className="flex items-start gap-1.5"><span className="text-slate-200 text-xs font-mono break-all">{String(v)}</span><CopyBtn text={String(v)}/></div></td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </GlassCard>
              )}

              {/* Secure property groups */}
              {cpsData.secureGroups.length > 0 && cpsData.secureGroups.map((group) => {
                const groupProps = group.properties || {};
                const filtered = Object.entries(groupProps).filter(([k, v]) =>
                  !cpsSearch || k.toLowerCase().includes(cpsSearch.toLowerCase()) || String(v).toLowerCase().includes(cpsSearch.toLowerCase()));
                if (filtered.length === 0 && cpsSearch) return null;
                return (
                  <GlassCard key={group.key} icon={Key} title={`🔒 ${group.key}`} count={Object.keys(groupProps).length} noPad>
                    <div className="px-5 py-2 bg-orange-950/20 border-b border-orange-900/20">
                      <span className="text-[10px] text-orange-400/70">Secure property group — treat values as sensitive</span>
                    </div>
                    <table className="w-full text-sm border-collapse">
                      <tbody>
                        {(cpsSearch ? filtered : Object.entries(groupProps).sort(([a],[b])=>a.localeCompare(b))).map(([k, v]) => (
                          <tr key={k} className="group border-b border-slate-800/40 hover:bg-slate-800/30 transition-colors">
                            <td className="px-5 py-3 w-[42%]"><span className="text-slate-400 text-xs font-mono break-all">{k}</span></td>
                            <td className="px-5 py-3"><SecretVal value={String(v)} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </GlassCard>
                );
              })}

              {/* Binaries */}
              {cpsData.binaryList.length > 0 && (
                <GlassCard icon={Package} title="Binary Assets" count={cpsData.binaryList.length} noPad>
                  <table className="w-full text-sm border-collapse">
                    <thead><tr className="bg-slate-800/50 border-b border-slate-700/40">
                      {['File Name', 'Type', 'Size', 'Last Modified'].map((h) => (
                        <th key={h} className="px-5 py-3 text-left text-[10px] font-bold tracking-wider text-slate-500 uppercase">{h}</th>
                      ))}
                    </tr></thead>
                    <tbody>
                      {cpsData.binaryList
                        .filter((b) => !cpsSearch || (b.key||'').toLowerCase().includes(cpsSearch.toLowerCase()))
                        .map((b, i) => (
                          <tr key={i} className="border-b border-slate-800/40 hover:bg-slate-800/30 transition-colors">
                            <td className="px-5 py-3"><span className="text-slate-200 text-xs font-mono">{b.key}</span></td>
                            <td className="px-5 py-3"><MetaTag color="gray">{b.contentType || '—'}</MetaTag></td>
                            <td className="px-5 py-3 text-slate-400 text-xs">{b.size ? `${(b.size/1024).toFixed(1)} KB` : '—'}</td>
                            <td className="px-5 py-3 text-slate-500 text-xs">{b.lastModified ? new Date(b.lastModified).toLocaleDateString() : '—'}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </GlassCard>
              )}
            </div>
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
