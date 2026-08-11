import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { ArrowLeft, RefreshCw, Copy, Check, Clock, Database, Server, Settings, Globe, Search, Eye, EyeOff, Zap, Play, Square, RotateCcw, AlertTriangle, X, Key, Package, ChevronDown, ExternalLink, Activity } from 'lucide-react';
import api from '../services/api';
import CpsSettingsModal from '../components/CpsSettingsModal';
import PingTestPanel from '../components/PingTestPanel';
import { useCpsCredentialStore } from '../context/CpsCredentialStoreContext';

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
  const { getSecret, hasCredentials: hasCpsCsvCredentials, getAllCredentials } = useCpsCredentialStore();
  const [cpsCredsResolved, setCpsCredsResolved] = useState(false);

  // Feature 3: resolve BG name and env name for context badges
  const [bgName, setBgName] = useState('');
  const [resolvedEnvName, setResolvedEnvName] = useState('');
  useEffect(() => {
    if (!orgId) return;
    api.get('/organizations/business-groups').then(r => {
      const groups = r.data?.data || [];
      const match = groups.find(g => g.id === orgId);
      if (match) setBgName(match.name);
    }).catch(() => {});
  }, [orgId]);
  useEffect(() => {
    if (!orgId || !envId) return;
    api.get(`/environments/${orgId}`).then(r => {
      const envs = r.data?.data || r.data?.environments || r.data || [];
      const match = (Array.isArray(envs) ? envs : []).find(e => e.id === envId);
      if (match) setResolvedEnvName(match.name);
    }).catch(() => {});
  }, [orgId, envId]);

  // CH2 schedulers from dedicated /schedulers endpoint
  const [ch2Schedulers, setCh2Schedulers] = useState(null);
  const [schedulersLoading, setSchedulersLoading] = useState(false);
  // CPS properties fetched specifically to resolve ${...} placeholders in scheduler expressions
  const [cpsSchedulerProps, setCpsSchedulerProps] = useState({});
  const [cpsSecureSchedulerLoading, setCpsSecureSchedulerLoading] = useState(false);

  // Ping spec from Exchange (auto-fetched when app has application.ref)
  const [pingSpec, setPingSpec] = useState(null);
  const [pingSpecLoading, setPingSpecLoading] = useState(false);

  // Feature 4: contracts tab state
  const [contractsLoading, setContractsLoading] = useState(false);
  const [contracts, setContracts] = useState(null);
  const [contractsError, setContractsError] = useState('');
  const [contractApiInstanceId, setContractApiInstanceId] = useState(null);

  // Feature 4: load contracts — defined here (before early returns) to satisfy Rules of Hooks.
  // Resolves the API Manager instance the same way PingTestPanel does:
  //   Step 1 — extract CPS config from ARM deployment properties
  //   Step 2 — post CPS credentials so the CPS server accepts the fetch
  //   Step 3 — fetch CPS non-secure to discover the Autodiscovery api.id
  //   Step 4 — pass apiId to /health/auto-credentials for a direct Layer 1 lookup
  //   Step 5 — fetch contracts for the matched API Manager instance
  const loadContracts = useCallback(async () => {
    if (!orgId || !envId) return;
    setContractsLoading(true);
    setContractsError('');
    setContracts(null);
    try {
      const appData = app;
      let apiId;

      // ── Step 1-3: get api.id from CPS non-secure properties ──────────────
      if (appData) {
        const ds = appData.target?.deploymentSettings || {};
        const appCfg = appData.application?.configuration || {};
        const propsSvc = appCfg['mule.agent.application.properties.service'] || {};
        const armProps = {
          ...appData.properties,
          ...(propsSvc.properties || {}),
          ...(ds.properties || {}),
          ...(ds.environmentVariables || ds.environmentVars || {}),
        };
        const cpsUrl  = armProps['cps.configServerBaseUrl'] || armProps['config.server.base.url'] || '';
        const cpsKey  = armProps['cps.projectName'] || armProps['cloudhub.api.name'] || appData.name || '';
        const cpsPfx  = armProps['cps.prefix'] || armProps['cps.environment'] || '';
        const cpsCId  = armProps['cps.clientId'] || armProps['cps.client_id'] ||
                        armProps['cps.client.id'] || armProps['cps.apiClientId'] || '';

        if (cpsUrl && cpsKey) {
          // Post CPS creds to backend session if available
          if (cpsCId && hasCpsCsvCredentials) {
            const secret = getSecret(cpsCId);
            if (secret) {
              try {
                const credKey = `${cpsUrl.trim().replace(/\/+$/, '').replace(/\/api\/v2\/?$/, '')}::${orgId}`;
                await api.post('/cps/credentials', { credentials: { [credKey]: { clientId: cpsCId, clientSecret: secret } } });
              } catch {}
            }
          }
          try {
            const r = await api.get('/cps/fetch', { params: { baseUrl: cpsUrl, type: 'non-secure', keys: cpsKey, ...(cpsPfx && { environment: cpsPfx }), bgOrgId: orgId } });
            const data = r.data;
            let props = {};
            if (Array.isArray(data?.responses)) data.responses.forEach(r2 => Object.assign(props, r2.properties || {}));
            else if (Array.isArray(data)) data.forEach(r2 => { if (r2?.properties) Object.assign(props, r2.properties); });
            else if (data && typeof data === 'object') {
              const fv = Object.values(data)[0];
              props = (fv && typeof fv === 'object') ? Object.values(data).reduce((m, v) => (v && typeof v === 'object' ? Object.assign(m, v) : m), {}) : data;
            }
            // Find numeric api.id
            const findId = () => {
              if ('api.id' in props && /^\d+$/.test(String(props['api.id']).trim())) return String(props['api.id']).trim();
              const e1 = Object.entries(props).find(([k]) => k.endsWith('.api.id'));
              if (e1 && /^\d+$/.test(String(e1[1]).trim())) return String(e1[1]).trim();
              const e2 = Object.entries(props).find(([k, v]) => k.endsWith('.id') && /^\d+$/.test(String(v).trim()));
              if (e2) return String(e2[1]).trim();
              if ('id' in props && /^\d+$/.test(String(props['id']).trim())) return String(props['id']).trim();
              return null;
            };
            apiId = findId();
          } catch {}
        }
      }

      // ── Step 4: find API Manager instance (Layer 1 if apiId, else fuzzy) ─
      const acRes = await api.post('/health/auto-credentials', {
        orgId, envId,
        appName: appData?.name,
        ...(apiId && { apiId }),
      });
      const instanceId = acRes.data?.matchedApis?.[0]?.id;
      if (!instanceId) {
        setContractsError('No API Manager instance found for this application. Ensure it is registered in API Manager.');
        setContractsLoading(false);
        return;
      }

      // ── Step 5: fetch contracts ───────────────────────────────────────────
      setContractApiInstanceId(instanceId);
      const contractsRes = await api.get(`/apis/${orgId}/${envId}/${instanceId}/contracts`);
      const raw = contractsRes.data?.contracts || contractsRes.data || [];
      setContracts(Array.isArray(raw) ? raw : []);
    } catch (e) {
      setContractsError(e.response?.data?.error || e.message || 'Failed to load contracts');
    }
    setContractsLoading(false);
  }, [orgId, envId, app, hasCpsCsvCredentials, getSecret]);

  // CPS state
  const [copiedCpsNs, setCopiedCpsNs] = useState(false);
  const [copiedCpsSec, setCopiedCpsSec] = useState(false);
  const [cpsLoading, setCpsLoading] = useState(false);
  const [cpsData, setCpsData] = useState(null);
  const [cpsError, setCpsError] = useState('');
  const [cpsMissingCred, setCpsMissingCred] = useState(null);
  const [showCpsSettings, setShowCpsSettings] = useState(false);
  const [cpsSearch, setCpsSearch] = useState('');
  const [cpsKeyOverride, setCpsKeyOverride] = useState('');
  const [cpsEnvOverride, setCpsEnvOverride] = useState('');
  const [cpsAttemptedUrl, setCpsAttemptedUrl] = useState('');
  const [secureLoading, setSecureLoading] = useState(false);
  const [binaryLoading, setBinaryLoading] = useState(false);
  const [cpsOpen, setCpsOpen] = useState({ ns: true, sec: false, bin: false });

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

  // Load CH2 schedulers from dedicated endpoint when infrastructure tab is opened.
  // If any scheduler expression is a ${...} placeholder, also silently fetch
  // CPS non-secure properties to resolve the actual cron values.
  const loadCh2Schedulers = useCallback(async () => {
    if (app?._type === 'ch1' || ch2Schedulers !== null) return;
    setSchedulersLoading(true);
    try {
      const res = await api.get(`/applications/cloudhub2/${orgId}/${envId}/${appId}/schedulers`);
      const items = Array.isArray(res.data) ? res.data : (res.data?.items || []);
      setCh2Schedulers(items);

      // Auto-resolve CPS properties for ${...} placeholder expressions
      const hasPlaceholders = items.some(s =>
        (s.expression || s.schedule?.expression || '').includes('${')
      );
      if (hasPlaceholders) {
        // Extract CPS config from app ARM props
        const appDs = app.target?.deploymentSettings || {};
        const appCfg2 = app.application?.configuration || {};
        const ps2 = appCfg2['mule.agent.application.properties.service'] || {};
        const rp = { ...ps2.properties, ...appDs.properties, ...appDs.environmentVariables, ...app.properties };
        const cpsBUrl = rp['cps.configServerBaseUrl'] || rp['config.server.base.url'];
        const cpsK = rp['cps.projectName'] || rp['cloudhub.api.name'] || app.name;
        const cpsE = rp['cps.prefix'] || rp['cps.environment'];
        const cpsCId = rp['cps.clientId'] || rp['cps.client_id'] || rp['cps.client.id'] || rp['cps.apiClientId'];
        if (cpsBUrl && cpsK) {
          try {
            // Post CPS credentials if available
            if (cpsCId) {
              try {
                const normBase = cpsBUrl.trim().replace(/\/+$/, '').replace(/\/api\/v2\/?$/, '');
                await api.post('/cps/credentials', { credentials: { [`${normBase}::${orgId}`]: {} } });
              } catch { /* non-fatal */ }
            }
            const cpsRes = await api.get('/cps/fetch', {
              params: { baseUrl: cpsBUrl, type: 'non-secure', keys: cpsK, ...(cpsE && { environment: cpsE }), bgOrgId: orgId }
            });
            const data = cpsRes.data;
            let flat = {};
            if (Array.isArray(data?.responses)) data.responses.forEach(r => Object.assign(flat, r.properties || {}));
            else if (Array.isArray(data)) data.forEach(r => { if (r?.properties) Object.assign(flat, r.properties); });
            else if (data && typeof data === 'object') {
              const fv = Object.values(data)[0];
              flat = (fv && typeof fv === 'object') ? Object.values(data).reduce((m, v) => (v && typeof v === 'object' ? Object.assign(m, v) : m), {}) : data;
            }
            if (Object.keys(flat).length > 0) setCpsSchedulerProps(flat);
          } catch { /* CPS not available — placeholders will show as unresolved */ }
        }
      }
    } catch {
      setCh2Schedulers([]);
    }
    setSchedulersLoading(false);
  }, [orgId, envId, appId, ch2Schedulers, app]);

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

  // Fetch Exchange ping spec — also callable manually via Refresh button.
  // NOTE: app.application.ref points to the *deployed Mule artifact* in Exchange
  // (e.g. job-ldp-ripjar-bulk-clear/1.0.3), NOT the API specification asset
  // (e.g. job-ldp-ripjar-bulk-clear-ch2-api/1.0.0). Always use appName so the
  // backend can run its name-normalisation + variant-probing to find the correct
  // API spec asset, regardless of what ref.artifactId points to.
  const fetchPingSpec = useCallback((currentApp) => {
    const a = currentApp || app;
    if (!a) return;
    setPingSpecLoading(true);
    setPingSpec(null);
    api.get('/exchange/ping-spec', {
      params: {
        orgId,
        appName: a.name,   // backend always searches Exchange by name
      }
    }).then(r => {
      setPingSpec(r.data);
      const total = r.data?.allEndpoints?.length ?? 0;
      const ping  = r.data?.pingEndpoints?.length ?? 0;
      console.log(`[pingSpec] ${a.name}: specType=${r.data?.specType}, total=${total} endpoints, ${ping} ping paths found`);
      if (total > 0 && ping === 0) {
        console.log(`[pingSpec] All paths:`, r.data.allEndpoints.map(e => `${e.method} ${e.path}`));
      }
    }).catch(err => { console.warn('[pingSpec] fetch failed:', err.message); setPingSpec(null); })
      .finally(() => setPingSpecLoading(false));
  }, [app, orgId]);

  // Don't auto-fetch — load only when user clicks the API Spec tab
  // (avoids slow Exchange searches on every app detail page open)

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
  // CH2: use dedicated /schedulers endpoint result; fallback to configuration-embedded schedulers
  // CH1: use schedules fetched at load time
  const allSchedulers = isCH1
    ? (app._ch1Schedules || [])
    : (ch2Schedulers ?? schedSvc.schedulers ?? []);
  const schedulers = schedulerSearch
    ? allSchedulers.filter((s) => {
        const q = schedulerSearch.toLowerCase();
        const flow = (s.flow || s.flowName || s.name || '').toLowerCase();
      const cron = (s.schedule?.cronExpression || s.schedule?.expression || s.expression || s.cronExpression || '').toLowerCase();
      const freq = String(s.frequency || s.schedule?.frequency || s.schedule?.period || '').toLowerCase();
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
  const cpsClientId = allProps['cps.clientId'] || allProps['cps.client_id'] || allProps['cps.client.id'] || allProps['cps.apiClientId'] || '';
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
    setCpsCredsResolved(false);

    // ── Auto-resolve CPS credentials from the imported CSV ────────────────
    if (hasCpsCsvCredentials) {
      const normBase = cpsBaseUrl.trim().replace(/\/+$/, '').replace(/\/api\/v2\/?$/, '');
      const urlBgKey = `${normBase}::${orgId}`;
      let resolved = false;

      // Strategy 1: look up the specific cpsClientId from ARM props
      if (cpsClientId) {
        const secret = getSecret(cpsClientId);
        if (secret) {
          try {
            await api.post('/cps/credentials', { credentials: { [urlBgKey]: { clientId: cpsClientId, clientSecret: secret } } });
            setCpsCredsResolved(true);
            resolved = true;
          } catch { /* non-fatal */ }
        } else {
          console.log(`[CPS auto-resolve] cpsClientId "${cpsClientId.slice(0,8)}…" not found in imported CSV`);
        }
      }

      // Strategy 2: try ALL credentials from the store (URL-based key)
      // Useful when the app's ARM props don't have cps.clientId or
      // the clientId doesn't match the CSV format.
      if (!resolved) {
        const allCreds = getAllCredentials();
        for (const { clientId, clientSecret } of allCreds) {
          try {
            // Post using URL-only key (shared across BGs for this server)
            await api.post('/cps/credentials', { credentials: { [normBase]: { clientId, clientSecret } } });
            setCpsCredsResolved(true);
            resolved = true;
            console.log(`[CPS auto-resolve] Used URL-based fallback with clientId "${clientId.slice(0,8)}…"`);
            break; // only need one working set
          } catch { /* try next */ }
        }
      }

      if (!resolved) {
        console.log('[CPS auto-resolve] No matching credentials found in CSV — will show 422 error');
      }
    }

    try {
      // Fetch non-secure properties for this specific project key
      const nsRes = await api.get('/cps/fetch', { params: {
        baseUrl: cpsBaseUrl, type: 'non-secure', environment: useEnv,
        keys: useKey, deploymentType: cpsDepType, envName: appEnvName, bgOrgId: orgId
      }});
      const nsRaw = nsRes.data;

      // CPS response can be one of several shapes:
      // 1. { responses: [{ key, environment, properties: { k:v } }] }   ← actual API response
      // 2. [{ key, environment, properties: { k:v } }]
      // 3. { properties: [{ key, environment, properties: { k:v } }] }
      // 4. { k:v } (flat map directly)
      let flatNs = {};

      // Normalise: extract the array of property entries regardless of wrapper key
      const propsArray =
        Array.isArray(nsRaw) ? nsRaw
        : Array.isArray(nsRaw?.responses) ? nsRaw.responses
        : Array.isArray(nsRaw?.properties) ? nsRaw.properties
        : null;

      if (propsArray) {
        const match = propsArray.find((p) => p.key === useKey) || propsArray[0];
        const inner = match?.properties || match;
        if (inner && typeof inner === 'object' && !Array.isArray(inner)) {
          flatNs = inner;
        } else if (Array.isArray(inner)) {
          // Handle array of {key, value} pairs: [{key:"api.id", value:"12345"}, ...]
          inner.forEach(p => { if (p?.key != null) flatNs[String(p.key)] = p.value ?? p.val ?? ''; });
        }
      } else if (nsRaw && typeof nsRaw === 'object') {
        // Flat map or top-level object — if the first value is an object, try to unwrap
        const firstVal = Object.values(nsRaw)[0];
        if (firstVal && typeof firstVal === 'object' && !Array.isArray(firstVal)) {
          flatNs = nsRaw[useKey] || firstVal;
        } else {
          flatNs = nsRaw;
        }
      }

      // Store secure/binary keys for on-demand fetching; do NOT auto-fetch them
      // Also store the raw API response for clipboard copying
      setCpsData({
        nonSecure: flatNs,
        rawNsResponse: nsRaw,   // original CPS API response (unmodified)
        secureGroups: [],
        rawSecureResponse: null,
        binaryList: [],
        secureKeys: flatNs['cps.secure.properties'] || '',
        binaryKeys: flatNs['cps.secure.binaries'] || '',
        useEnv,  // store for later fetches
      });
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
    { id:'infrastructure', label:'Schedulers & Object Store' },
    ...(cpsBaseUrl ? [{ id:'cps', label:'CPS Config' }] : []),
    { id:'contracts', label:'Contracts' },
    { id:'apispec', label:'API Spec', badge: pingSpec?.allEndpoints?.length > 0 ? pingSpec.allEndpoints.length : undefined },
    { id:'ping', label:'Ping Test', badge: pingSpec?.pingEndpoints?.length > 0 ? pingSpec.pingEndpoints.length : undefined },
    { id:'raw', label:'Raw JSON' },
  ];

  return (
    <div className="space-y-6 min-h-screen">
      {showCpsSettings && <CpsSettingsModal
        prefilledUrl={cpsBaseUrl ? cpsBaseUrl.replace(/\/+$/, '').replace(/\/api\/v2\/?$/, '') : ''}
        prefilledBgId={orgId}
        prefilledBgName={app.environment?.organizationId === orgId ? '' : ''}
        onClose={() => { setShowCpsSettings(false); if (cpsMissingCred) { setCpsMissingCred(null); loadCpsData(); } }}
      />}
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
                {/* Feature 3: BG & Env context badges */}
                {bgName && (
                  <span className="text-xs px-2 py-0.5 rounded-full border bg-slate-800/60 text-slate-400 border-slate-700/50">
                    🏢 {bgName}
                  </span>
                )}
                {(resolvedEnvName || app.environment?.name) && (
                  <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${
                    app.environment?.type === 'production'
                      ? 'bg-green-950/40 text-green-400 border-green-800/50'
                      : 'bg-yellow-950/40 text-yellow-400 border-yellow-800/50'
                  }`}>
                    🌐 {resolvedEnvName || app.environment?.name}
                  </span>
                )}
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
            {/* Open in Exchange button — navigates to our Exchange page and auto-selects the asset */}
            {(() => {
              const ref = app.application?.ref;
              return (
                <button
                  onClick={() => navigate('/exchange', {
                    state: {
                      assetId: ref?.artifactId || app.name,
                      groupId: ref?.groupId || null,
                      version: ref?.version || null,
                      name: app.name
                    }
                  })}
                  title="View in Exchange Assets"
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium border bg-slate-800/60 text-slate-400 hover:text-emerald-300 border-slate-700/40 hover:border-emerald-700/50 hover:bg-emerald-950/30 transition-all">
                  <ExternalLink size={13} /> Exchange
                </button>
              );
            })()}
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
            onClick={() => {
            setTab(t.id);
            if (t.id === 'infrastructure' && app?._type !== 'ch1' && ch2Schedulers === null && !schedulersLoading) loadCh2Schedulers();
            if (t.id === 'cps' && !cpsData && !cpsLoading) loadCpsData();
            if (t.id === 'contracts' && contracts === null && !contractsLoading) loadContracts();
            if (t.id === 'apispec' && pingSpec === null && !pingSpecLoading) fetchPingSpec();
          }}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${tab===t.id?'bg-slate-700/80 text-white shadow-md':'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'}`}>
            {t.id === 'cps' && <Key size={11} />}
            {t.id === 'ping' && <Activity size={11} />}
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
            {/* Show "Get Cron Expressions" button when there are unresolved ${...} placeholders
                and CPS is configured for this app (even if cps.secure.properties wasn't auto-discovered) */}
            {(() => {
              const hasUnresolved = allSchedulers.some(s => {
                const expr = s.expression || s.schedule?.expression || '';
                if (!expr.startsWith('${')) return false;
                const propName = expr.slice(2, -1);
                return !cpsSchedulerProps[propName] && !cpsSchedulerProps[propName.toLowerCase()] && !allProps[propName];
              });
              // Show whenever there are unresolved placeholders AND CPS is configured
              if (!hasUnresolved || !cpsBaseUrl) return null;
              return (
                <div className="px-5 py-2.5 border-b border-slate-800/40 flex items-center justify-between bg-purple-950/10">
                  <p className="text-[10px] text-purple-400/80 flex items-center gap-1.5">
                    <Key size={9} /> Some cron expressions may be in CPS properties
                  </p>
                  <button
                    disabled={cpsSecureSchedulerLoading}
                    onClick={async () => {
                      setCpsSecureSchedulerLoading(true);
                      try {
                        // Step 1: If cps.secure.properties key is not yet known, fetch non-secure to discover it
                        let secureKeys = cpsSchedulerProps['cps.secure.properties'];
                        if (!secureKeys) {
                          try {
                            const nsRes = await api.get('/cps/fetch', {
                              params: { baseUrl: cpsBaseUrl, type: 'non-secure', keys: effectiveCpsKey, environment: effectiveCpsEnv, bgOrgId: orgId }
                            });
                            const data = nsRes.data;
                            let flat = {};
                            if (Array.isArray(data?.responses)) data.responses.forEach(r => Object.assign(flat, r.properties || {}));
                            else if (Array.isArray(data)) data.forEach(r => { if (r?.properties) Object.assign(flat, r.properties); });
                            else if (data && typeof data === 'object') {
                              const fv = Object.values(data)[0];
                              flat = (fv && typeof fv === 'object') ? Object.values(data).reduce((m, v) => (v && typeof v === 'object' ? Object.assign(m, v) : m), {}) : data;
                            }
                            if (Object.keys(flat).length > 0) {
                              setCpsSchedulerProps(prev => ({ ...prev, ...flat }));
                              secureKeys = flat['cps.secure.properties'];
                            }
                          } catch { /* continue */ }
                        }
                        if (!secureKeys) { setCpsSecureSchedulerLoading(false); return; }
                        // Step 2: Fetch secure properties using the discovered keys
                        const sr = await api.get('/cps/fetch', {
                          params: { baseUrl: cpsBaseUrl, type: 'secure', environment: effectiveCpsEnv, keys: secureKeys, bgOrgId: orgId }
                        });
                        const data = sr.data;
                        const groups = Array.isArray(data?.responses) ? data.responses
                          : Array.isArray(data?.properties) ? data.properties
                          : Array.isArray(data) ? data : [];
                        const merged = {};
                        groups.forEach(g => Object.assign(merged, g.properties || {}));
                        if (Object.keys(merged).length > 0) setCpsSchedulerProps(prev => ({ ...prev, ...merged }));
                      } catch { /* silently fail — button stays visible for retry */ }
                      setCpsSecureSchedulerLoading(false);
                    }}
                    className="flex items-center gap-1.5 text-[10px] px-2.5 py-1 bg-purple-600/20 border border-purple-700/40 text-purple-400 hover:bg-purple-600/30 rounded-lg transition-colors disabled:opacity-50 font-medium flex-shrink-0">
                    {cpsSecureSchedulerLoading
                      ? <><RefreshCw size={9} className="animate-spin" /> Loading…</>
                      : <><Key size={9} /> Get Cron Expressions</>}
                  </button>
                </div>
              );
            })()}
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
                    // CH2 uses s.schedule.expression; CH1 uses s.schedule.cronExpression or s.expression
                    const rawCron = s.schedule?.cronExpression ||
                                    s.schedule?.expression ||
                                    s.expression ||
                                    s.cronExpression;
                    // Resolve ${propName} placeholders: check runtime props first, then CPS props
                    const resolvedCron = rawCron?.replace(/\$\{([^}]+)\}/g, (match, propName) =>
                      allProps[propName] ||
                      allProps[propName.toLowerCase()] ||
                      cpsSchedulerProps[propName] ||
                      cpsSchedulerProps[propName.toLowerCase()] ||
                      cpsData?.nonSecure?.[propName] ||
                      match
                    );
                    const isUnresolvedPlaceholder = rawCron?.startsWith('${') && resolvedCron === rawCron;
                    const wasResolved = rawCron !== resolvedCron;
                    const cron = resolvedCron; // display the resolved value
                    // CH2 fixed-frequency: s.schedule.frequency; CH1: s.frequency or s.schedule.period
                    const freq = s.frequency ||
                                 s.schedule?.frequency ||
                                 (s.schedule?.period > 0 ? s.schedule.period : null);
                    const timeUnit = s.timeUnit || s.schedule?.timeUnit;
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
                          {cron && !isUnresolvedPlaceholder ? (
                            <div className="space-y-1">
                              <MetaTag color="cyan">{cron}</MetaTag>
                              {wasResolved && (
                                <p className="text-[10px] text-slate-600 font-mono" title="Property placeholder resolved from app properties">{rawCron}</p>
                              )}
                            </div>
                          ) : isUnresolvedPlaceholder ? (
                            <div className="space-y-1">
                              <MetaTag color="gray">{rawCron}</MetaTag>
                              <p className="text-[10px] text-yellow-600/80">⚠ property not in runtime props — check CPS</p>
                            </div>
                          ) : freq ? <MetaTag color="blue">{freq}{timeUnit ? ` ${timeUnit}` : ''}</MetaTag>
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
                {cpsCredsResolved && (
                  <span className="flex items-center gap-1 text-[10px] text-emerald-400 bg-emerald-500/10 border border-emerald-700/40 px-1.5 py-0.5 rounded-full">
                    <Key size={8} /> CPS creds auto-resolved
                  </span>
                )}
      {hasCpsCsvCredentials && !cpsCredsResolved && !cpsData && (
        <span className="text-[10px] text-yellow-400/70">🔑 CSV loaded — will auto-resolve on load</span>
      )}
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
              {cpsData && Object.keys(cpsData.nonSecure).length > 0 && (
                <button
                  onClick={() => {
                    // Copy the original raw CPS API response (not the parsed flat object)
                    const raw = cpsData.rawNsResponse;
                    navigator.clipboard.writeText(
                      typeof raw === 'string' ? raw : JSON.stringify(raw, null, 2)
                    );
                    setCopiedCpsNs(true);
                    setTimeout(() => setCopiedCpsNs(false), 2000);
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-emerald-400 hover:text-emerald-300 bg-emerald-950/40 border border-emerald-800/40 rounded-lg transition-colors">
                  {copiedCpsNs ? <><Check size={11} className="text-emerald-400" /> Copied!</> : <><Copy size={11} /> Non-Secure</>}
                </button>
              )}
              {cpsData && cpsData.secureGroups.length > 0 && (
                <button
                  onClick={() => {
                    // Copy the original raw secure CPS API response
                    const raw = cpsData.rawSecureResponse;
                    navigator.clipboard.writeText(
                      typeof raw === 'string' ? raw : JSON.stringify(raw, null, 2)
                    );
                    setCopiedCpsSec(true);
                    setTimeout(() => setCopiedCpsSec(false), 2000);
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-purple-400 hover:text-purple-300 bg-purple-950/40 border border-purple-800/40 rounded-lg transition-colors">
                  {copiedCpsSec ? <><Check size={11} className="text-purple-400" /> Copied!</> : <><Copy size={11} /> Secure</>}
                </button>
              )}
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

              {/* Non-secure properties — flat table from the properties object */}
              {Object.keys(cpsData.nonSecure).length > 0 && (() => {
                const CHIP_KEYS = new Set(['cps.secure.properties', 'cps.secure.binaries']);
                const searchLo = cpsSearch.toLowerCase();
                const visibleEntries = Object.entries(cpsData.nonSecure)
                  .filter(([k, v]) => !searchLo || k.toLowerCase().includes(searchLo) || String(v).toLowerCase().includes(searchLo))
                  .sort(([a], [b]) => a.localeCompare(b));

                return (
                  <GlassCard icon={Settings} title="Non-Secure Properties" count={visibleEntries.length} noPad>
                    <div className="max-h-80 overflow-y-auto">
                    <table className="w-full text-sm border-collapse">
                      <thead>
                        <tr className="bg-slate-800/50 border-b border-slate-700/40">
                          <th className="px-5 py-3 text-left text-[10px] font-bold tracking-wider text-slate-500 uppercase w-[42%]">Property Key</th>
                          <th className="px-5 py-3 text-left text-[10px] font-bold tracking-wider text-slate-500 uppercase">Value</th>
                        </tr>
                      </thead>
                      <tbody>
                        {visibleEntries.map(([k, v]) => {
                          const isChip = CHIP_KEYS.has(k);
                          const isNum = typeof v === 'number';
                          const display = v === null || v === undefined ? '—'
                            : typeof v === 'object' ? JSON.stringify(v)
                            : String(v);
                          return (
                            <tr key={k} className="group border-b border-slate-800/40 hover:bg-slate-800/30 transition-colors">
                              <td className="px-5 py-3 align-top">
                                <div className="flex items-center gap-1.5">
                                  <span className="text-slate-400 text-xs font-mono break-all">{k}</span>
                                  <CopyBtn text={k} />
                                </div>
                              </td>
                              <td className="px-5 py-3 align-top">
                                {isChip ? (
                                  <div className="flex flex-wrap gap-1">
                                    {display.split(',').map((item) => item.trim()).filter(Boolean).map((item) => (
                                      <span key={item} className={`inline-flex text-[10px] px-2 py-0.5 rounded-md font-mono border ${
                                        k === 'cps.secure.binaries'
                                          ? 'bg-orange-950/30 text-orange-300 border-orange-800/40'
                                          : 'bg-purple-950/30 text-purple-300 border-purple-800/40'
                                      }`}>{item}</span>
                                    ))}
                                    <CopyBtn text={display} />
                                  </div>
                                ) : (
                                  <div className="flex items-start gap-1.5">
                                    <span className={`text-xs font-mono break-all ${isNum ? 'text-cyan-300' : 'text-slate-200'}`}>{display}</span>
                                    <CopyBtn text={display} />
                                  </div>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    </div>
                  </GlassCard>
                );
              })()}

              {/* ── Get Secure Properties button ── */}
              {cpsData.secureKeys && cpsData.secureGroups.length === 0 && (
                <div className="flex items-center justify-between bg-purple-950/20 border border-purple-800/40 rounded-2xl px-5 py-4">
                  <div className="space-y-1">
                    <p className="text-purple-300 text-sm font-semibold flex items-center gap-2">
                      <Key size={13} /> Secure Properties
                    </p>
                    <p className="text-purple-500/70 text-xs">Keys: {cpsData.secureKeys}</p>
                  </div>
                  <button
                    disabled={secureLoading}
                    onClick={async () => {
                      setSecureLoading(true);
                      try {
                        const sr = await api.get('/cps/fetch', { params: {
                          baseUrl: cpsBaseUrl, type: 'secure', environment: cpsData.useEnv,
                          keys: cpsData.secureKeys, deploymentType: cpsDepType, envName: appEnvName, bgOrgId: orgId
                        }});
                        const raw = sr.data;
                        const groups = Array.isArray(raw?.responses) ? raw.responses
                          : Array.isArray(raw?.properties) ? raw.properties
                          : Array.isArray(raw) ? raw : [];
                        setCpsData((prev) => ({ ...prev, secureGroups: groups, rawSecureResponse: raw }));
                      } catch (e) {
                        // show error in the secure section
                        setCpsData((prev) => ({ ...prev, secureGroups: [{ key: '__error__', _error: e.response?.data?.error || e.message }] }));
                      }
                      setSecureLoading(false);
                    }}
                    className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white text-xs font-medium rounded-xl transition-colors disabled:opacity-50 flex-shrink-0"
                  >
                    {secureLoading
                      ? <><RefreshCw size={12} className="animate-spin" /> Loading…</>
                      : <><Key size={12} /> Get Secure Properties</>}
                  </button>
                </div>
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
                    <div className="max-h-64 overflow-y-auto">
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
                    </div>
                  </GlassCard>
                );
              })}

              {/* ── Binary Assets — displayed directly from cps.secure.binaries ── */}
              {cpsData.binaryKeys && (() => {
                const binaryFiles = cpsData.binaryKeys.split(',').map((f) => f.trim()).filter(Boolean)
                  .filter((f) => !cpsSearch || f.toLowerCase().includes(cpsSearch.toLowerCase()));
                if (binaryFiles.length === 0) return null;
                return (
                  <GlassCard icon={Package} title="Binary Assets" count={binaryFiles.length} noPad>
                    <div className="px-5 py-2 bg-orange-950/20 border-b border-orange-900/20">
                      <span className="text-[10px] text-orange-400/70">Binary files configured in <code className="text-orange-400">cps.secure.binaries</code></span>
                    </div>
                    <table className="w-full text-sm border-collapse">
                      <thead>
                        <tr className="bg-slate-800/50 border-b border-slate-700/40">
                          <th className="px-5 py-3 text-left text-[10px] font-bold tracking-wider text-slate-500 uppercase">File Name</th>
                          <th className="px-5 py-3 text-left text-[10px] font-bold tracking-wider text-slate-500 uppercase">Extension</th>
                        </tr>
                      </thead>
                      <tbody>
                        {binaryFiles.map((fileName, i) => {
                          const ext = fileName.includes('.') ? fileName.split('.').pop().toLowerCase() : '—';
                          const extColor = ext === 'jks' ? 'bg-blue-950/30 text-blue-300 border-blue-800/40'
                            : ext === 'pem' ? 'bg-green-950/30 text-green-300 border-green-800/40'
                            : ext === 'gpg' || ext === 'pgp' ? 'bg-purple-950/30 text-purple-300 border-purple-800/40'
                            : ext === 'crt' || ext === 'cer' ? 'bg-cyan-950/30 text-cyan-300 border-cyan-800/40'
                            : 'bg-slate-800/40 text-slate-400 border-slate-700/40';
                          return (
                            <tr key={i} className="group border-b border-slate-800/40 hover:bg-slate-800/30 transition-colors">
                              <td className="px-5 py-3">
                                <div className="flex items-center gap-1.5">
                                  <span className="text-slate-200 text-xs font-mono">{fileName}</span>
                                  <CopyBtn text={fileName} />
                                </div>
                              </td>
                              <td className="px-5 py-3">
                                <span className={`inline-flex text-[10px] px-2 py-0.5 rounded-md font-mono border uppercase ${extColor}`}>{ext}</span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </GlassCard>
                );
              })()}
            </div>
          )}
        </div>
      )}

      {/* ── CONTRACTS ───────────────────────────────── */}
      {tab==='contracts' && (
        <div className="space-y-5">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-white font-semibold text-sm">API Consumer Contracts</h2>
              <p className="text-slate-500 text-xs mt-0.5">
                Client applications approved to consume this API instance
                {contractApiInstanceId && <span className="ml-2 font-mono text-slate-600">API ID: {contractApiInstanceId}</span>}
              </p>
            </div>
            <button onClick={loadContracts} disabled={contractsLoading}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-slate-400 hover:text-white bg-slate-800/60 border border-slate-700/40 rounded-lg transition-colors">
              <RefreshCw size={11} className={contractsLoading ? 'animate-spin' : ''} />
              {contracts ? 'Refresh' : 'Load'}
            </button>
          </div>

          {contractsLoading && (
            <div className="flex items-center justify-center py-16 gap-3 text-slate-500">
              <RefreshCw size={18} className="animate-spin" />
              <span className="text-sm">Loading contracts…</span>
            </div>
          )}

          {contractsError && !contractsLoading && (
            <div className="flex items-start gap-3 bg-slate-900/60 border border-slate-800/60 rounded-2xl px-5 py-4">
              <AlertTriangle size={16} className="text-yellow-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-slate-300 text-sm font-medium">No contracts available</p>
                <p className="text-slate-500 text-xs mt-1">{contractsError}</p>
              </div>
            </div>
          )}

          {contracts !== null && !contractsLoading && !contractsError && (
            contracts.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 gap-3 bg-slate-900/50 border border-slate-800/60 rounded-2xl">
                <Key size={36} className="text-slate-700" />
                <p className="text-slate-500 text-sm">No approved contracts for this API instance</p>
              </div>
            ) : (
              <GlassCard icon={Key} title="Consumer Contracts" count={contracts.length} noPad>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm border-collapse">
                    <thead>
                      <tr className="bg-slate-800/50 border-b border-slate-700/40">
                        {['Client App', 'Client ID', 'Status', 'SLA Tier', 'Requested'].map(h => (
                          <th key={h} className="px-5 py-3 text-left text-[10px] font-bold tracking-wider text-slate-500 uppercase">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {contracts.map((c, i) => {
                        const status = (c.status || 'UNKNOWN').toUpperCase();
                        const statusCls = status === 'APPROVED'
                          ? 'bg-emerald-950/50 text-emerald-300 border-emerald-700/50'
                          : status === 'REVOKED'
                          ? 'bg-red-950/50 text-red-300 border-red-700/50'
                          : 'bg-yellow-950/50 text-yellow-300 border-yellow-700/50';
                        const clientId =
                          c.application?.coreServicesId ||
                          c.application?.clientId ||
                          c.clientApplication?.coreServicesId ||
                          c.clientId || '—';
                        const slaTier = c.tier?.name || c.slaTier?.name || c.tierLabel || '—';
                        const reqDate = c.requestedAt || c.createdDate
                          ? new Date(c.requestedAt || c.createdDate).toLocaleDateString()
                          : '—';
                        return (
                          <tr key={i} className="border-b border-slate-800/40 hover:bg-slate-800/30 transition-colors">
                            <td className="px-5 py-3">
                              <p className="text-slate-200 text-xs font-medium">{c.application?.name || c.clientApplication?.name || '—'}</p>
                              {c.application?.description && (
                                <p className="text-slate-600 text-[10px] mt-0.5 truncate max-w-xs">{c.application.description}</p>
                              )}
                            </td>
                            <td className="px-5 py-3">
                              <div className="flex items-center gap-1.5">
                                <span className="font-mono text-xs text-slate-300 break-all">{clientId}</span>
                                {clientId !== '—' && <CopyBtn text={String(clientId)} />}
                              </div>
                            </td>
                            <td className="px-5 py-3">
                              <span className={`inline-flex text-[10px] px-2 py-0.5 rounded-full border font-bold ${statusCls}`}>{status}</span>
                            </td>
                            <td className="px-5 py-3 text-slate-400 text-xs">{slaTier}</td>
                            <td className="px-5 py-3 text-slate-500 text-xs">{reqDate}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </GlassCard>
            )
          )}

          {contracts === null && !contractsLoading && !contractsError && (
            <div className="flex flex-col items-center justify-center py-16 gap-4 bg-slate-900/50 border border-slate-800/60 rounded-2xl">
              <Key size={32} className="text-slate-700" />
              <p className="text-slate-500 text-sm">Click <strong>Load</strong> to fetch consumer contracts from API Manager</p>
              <button onClick={loadContracts}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-xl transition-colors">
                <Key size={13} /> Load Contracts
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── PING TEST ───────────────────────────────── */}
      {tab==='ping' && (
        <PingTestPanel
          appName={app.name}
          isCH1={isCH1}
          orgId={orgId}
          envId={envId}
          ch2IngressUrl={
            httpInbound.publicUrl ||
            endpoints.find(e => e.access === 'external')?.url ||
            endpoints[0]?.url ||
            null
          }
          defaultClientId={
            allProps['client_id'] ||
            allProps['clientId'] ||
            allProps['client.id'] ||
            ''
          }
          defaultClientSecret={
            allProps['client_secret'] ||
            allProps['clientSecret'] ||
            allProps['client.secret'] ||
            ''
          }
          cpsBaseUrl={cpsBaseUrl || ''}
          cpsClientId={cpsClientId || ''}
          cpsKey={effectiveCpsKey || ''}
          cpsEnv={effectiveCpsEnv || ''}
          pingSpec={pingSpec}
          pingSpecLoading={pingSpecLoading}
        />
      )}

      {/* ── API SPEC ────────────────────────────────── */}
      {tab==='apispec' && (
        <div className="space-y-5">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-white font-semibold text-sm flex items-center gap-2">
                <Globe size={14} className="text-blue-400" /> API Specification — Exchange
              </h2>
              <p className="text-slate-500 text-xs mt-0.5">
                {pingSpecLoading ? 'Searching Exchange and parsing spec…' :
                  pingSpec ? <>
                    <span className="text-slate-400">{pingSpec.assetName}</span>
                    {' · '}{pingSpec.specType?.toUpperCase()} · {pingSpec.allEndpoints?.length ?? 0} endpoints
                    {pingSpec.pingEndpoints?.length > 0 && (
                      <span className="ml-2 text-emerald-400 font-medium">
                        · {pingSpec.pingEndpoints.length} ping path{pingSpec.pingEndpoints.length !== 1 ? 's' : ''} found
                      </span>
                    )}
                  </> : 'No spec available — app may not have an Exchange asset linked'}
              </p>
            </div>
            <button onClick={() => fetchPingSpec()} disabled={pingSpecLoading}
              title="Re-fetch API spec from Exchange"
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-slate-400 hover:text-white bg-slate-800/60 border border-slate-700/40 rounded-lg transition-colors disabled:opacity-50">
              <RefreshCw size={11} className={pingSpecLoading ? 'animate-spin' : ''} />
              {pingSpec ? 'Refresh' : 'Fetch Spec'}
            </button>
          </div>

          {pingSpecLoading && (
            <div className="flex items-center justify-center py-16 gap-3 text-slate-500">
              <RefreshCw size={18} className="animate-spin" />
              <span className="text-sm">Searching Exchange and parsing API spec…</span>
            </div>
          )}

          {!pingSpecLoading && !pingSpec && (
            <div className="flex flex-col items-center justify-center py-16 gap-3 bg-slate-900/50 border border-slate-800/60 rounded-2xl">
              <Globe size={32} className="text-slate-700" />
              <p className="text-slate-500 text-sm">No Exchange spec found for this application</p>
              <p className="text-slate-600 text-xs">The app needs an Exchange asset linked via <code>application.ref</code> in its ARM descriptor</p>
            </div>
          )}

          {pingSpec && !pingSpecLoading && (
            <>
              {/* Ping endpoints highlighted */}
              {pingSpec.pingEndpoints?.length > 0 && (
                <GlassCard icon={Activity} title="Ping / Health Endpoints" count={pingSpec.pingEndpoints.length} accent="blue" noPad>
                  <div className="px-5 py-2 bg-emerald-950/20 border-b border-emerald-900/20">
                    <span className="text-[10px] text-emerald-400/80">
                      These endpoints will be tried first during ping tests. Required query params are auto-filled.
                    </span>
                  </div>
                  <table className="w-full text-sm border-collapse">
                    <thead>
                      <tr className="bg-slate-800/50 border-b border-slate-700/40">
                        {['Method', 'Path', 'Query Params', 'Headers', 'Description'].map(h => (
                          <th key={h} className="px-4 py-3 text-left text-[10px] font-bold tracking-wider text-slate-500 uppercase">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {pingSpec.pingEndpoints.map((ep, i) => (
                        <tr key={i} className="border-b border-slate-800/40 hover:bg-slate-800/20 transition-colors">
                          <td className="px-4 py-3">
                            <span className={`text-[10px] px-2 py-0.5 rounded font-bold border ${
                              ep.method === 'GET' ? 'bg-blue-950/40 text-blue-300 border-blue-700/40' :
                              ep.method === 'POST' ? 'bg-green-950/40 text-green-300 border-green-700/40' :
                              'bg-slate-800/60 text-slate-300 border-slate-700/40'
                            }`}>{ep.method}</span>
                          </td>
                          <td className="px-4 py-3 font-mono text-xs text-cyan-300">{ep.path}</td>
                          <td className="px-4 py-3">
                            {ep.queryParams?.length > 0 ? (
                              <div className="flex flex-wrap gap-1">
                                {ep.queryParams.map(p => (
                                  <span key={p.name} title={`${p.description}${p.example ? ` (e.g. ${p.example})` : ''}`}
                                    className={`text-[10px] px-1.5 py-0.5 rounded border font-mono ${p.required ? 'bg-orange-950/40 text-orange-300 border-orange-700/40' : 'bg-slate-800/60 text-slate-400 border-slate-700/40'}`}>
                                    {p.name}{p.required ? '*' : ''}
                                  </span>
                                ))}
                              </div>
                            ) : <span className="text-slate-700 text-xs">—</span>}
                          </td>
                                  <td className="px-4 py-3">
                            {ep.headers?.length > 0 ? (
                              <div className="flex flex-wrap gap-1">
                                {ep.headers.map(h => (
                                  <span key={h.name} title={h.description}
                                    className={`text-[10px] px-1.5 py-0.5 rounded border font-mono ${h.required ? 'bg-purple-950/40 text-purple-300 border-purple-700/40' : 'bg-slate-800/60 text-slate-400 border-slate-700/40'}`}>
                                    {h.name}{h.required ? '*' : ''}
                                  </span>
                                ))}
                              </div>
                            ) : <span className="text-slate-700 text-xs">—</span>}
                          </td>
                          <td className="px-4 py-3 text-slate-400 text-xs">{ep.description || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </GlassCard>
              )}

              {/* All endpoints table */}
              {pingSpec.allEndpoints?.length > 0 && (
                <GlassCard icon={Globe} title="All Endpoints" count={pingSpec.allEndpoints.length} noPad>
                  <div className="max-h-[50vh] overflow-y-auto">
                    <table className="w-full text-sm border-collapse">
                      <thead className="sticky top-0">
                        <tr className="bg-slate-800/90 border-b border-slate-700/40">
                          {['Method', 'Path', 'Query Params', 'Headers', 'Description'].map(h => (
                            <th key={h} className="px-4 py-2.5 text-left text-[10px] font-bold tracking-wider text-slate-500 uppercase">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {pingSpec.allEndpoints.map((ep, i) => {
                          const isPing = pingSpec.pingEndpoints?.some(p => p.path === ep.path && p.method === ep.method);
                          return (
                            <tr key={i} className={`border-b border-slate-800/40 hover:bg-slate-800/20 transition-colors ${isPing ? 'bg-emerald-950/10' : ''}`}>
                              <td className="px-4 py-2.5">
                                <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold border ${
                                  ep.method === 'GET' ? 'bg-blue-950/40 text-blue-300 border-blue-700/40' :
                                  ep.method === 'POST' ? 'bg-green-950/40 text-green-300 border-green-700/40' :
                                  ep.method === 'PUT' ? 'bg-yellow-950/40 text-yellow-300 border-yellow-700/40' :
                                  ep.method === 'DELETE' ? 'bg-red-950/40 text-red-300 border-red-700/40' :
                                  'bg-slate-800/60 text-slate-300 border-slate-700/40'
                                }`}>{ep.method}</span>
                              </td>
                              <td className="px-4 py-2.5">
                                <span className={`font-mono text-xs ${isPing ? 'text-emerald-300' : 'text-slate-300'}`}>{ep.path}</span>
                                {isPing && <span className="ml-1.5 text-[9px] text-emerald-500">● ping</span>}
                              </td>
                              <td className="px-4 py-2.5">
                                {ep.queryParams?.length > 0 ? (
                                  <div className="flex flex-wrap gap-1">
                                    {ep.queryParams.map(p => (
                                      <span key={p.name} title={p.description}
                                        className={`text-[9px] px-1 py-0.5 rounded border font-mono ${p.required ? 'bg-orange-950/30 text-orange-300 border-orange-700/40' : 'bg-slate-800/60 text-slate-500 border-slate-700/40'}`}>
                                        {p.name}
                                      </span>
                                    ))}
                                  </div>
                                ) : <span className="text-slate-700 text-[10px]">—</span>}
                              </td>
                              <td className="px-4 py-2.5">
                                {ep.headers?.length > 0 ? (
                                  <div className="flex flex-wrap gap-1">
                                    {ep.headers.map(h => (
                                      <span key={h.name} title={h.description}
                                        className="text-[9px] px-1 py-0.5 rounded border font-mono bg-slate-800/60 text-slate-500 border-slate-700/40">
                                        {h.name}
                                      </span>
                                    ))}
                                  </div>
                                ) : <span className="text-slate-700 text-[10px]">—</span>}
                              </td>
                              <td className="px-4 py-2.5 text-slate-500 text-xs max-w-xs truncate">{ep.description || '—'}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <div className="px-5 py-2 border-t border-slate-800/60 text-[10px] text-slate-600">
                    * = required · <span className="text-orange-400/70">orange</span> = required query param · <span className="text-purple-400/70">purple</span> = required header · <span className="text-emerald-400/60">● ping</span> = health check endpoint
                  </div>
                </GlassCard>
              )}

              {pingSpec.pingEndpoints?.length === 0 && (
                <div className="flex items-start gap-3 bg-slate-900/60 border border-slate-800/60 rounded-2xl px-5 py-4">
                  <AlertTriangle size={14} className="text-yellow-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-slate-300 text-sm font-medium">No ping/health endpoints detected</p>
                    <p className="text-slate-500 text-xs mt-1">
                      The spec doesn't contain paths matching: ping, health, status, liveness, readiness, or heartbeat.
                      The dashboard will still try the standard paths: <code className="text-slate-400">/api/v1/ping → /api/v2/ping → /api/ping → /ping</code>
                    </p>
                  </div>
                </div>
              )}
            </>
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
