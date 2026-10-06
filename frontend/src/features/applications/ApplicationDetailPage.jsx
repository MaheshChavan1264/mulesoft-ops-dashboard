import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { ArrowLeft, RefreshCw, Copy, Check, Clock, Database, Server, Settings, Globe, Search, Eye, EyeOff, Zap, AlertTriangle, X, Key, Package, ChevronDown, ExternalLink, Activity, Share2, ShieldCheck, Trash2, GitBranch, Layers, Hash, Boxes } from 'lucide-react';
import {
  getBusinessGroups, getEnvironments, getCloudhub2AppDetail, getCloudhub1AppDetail,
  getPrivateSpaceDetail, getCloudhub1Schedules, getCloudhub2Schedulers, getCloudhub1StaticIps,
  runCloudhub1SchedulerNow, runCloudhub2SchedulerNow, runCloudhub1Action, runCloudhub2Action,
  setCloudhub1SchedulerEnabled, setCloudhub2SchedulerEnabled,
  getContracts, updateContractStatus, deleteContract,
} from '../../services/applicationsService';
import { getCachedSWR, setCached, bustCache } from '../../services/apiCache';
import { CK } from '../../services/cacheKeys';
import { postCpsCredentialsRaw, fetchCpsProperties, resolveAndPostCpsCredentials } from '../../services/cpsService';
import { getAutoCredentials } from '../../services/healthService';
import { getExchangePingSpec } from '../../services/exchangeService';
import CpsSettingsModal from '../cps/CpsSettingsModal';
import CpsRawJsonModal from '../cps/CpsRawJsonModal';
import PostmanJsonViewer from '../../components/shared/PostmanJsonViewer';
import PingTestPanel from '../ping-test/PingTestPanel';
import CopyBtn from '../../components/shared/CopyBtn';
import { useCpsCredentialStore } from '../../context/CpsCredentialStoreContext';
import { availableActions, ACTION_CONFIG } from '../../utils/appUtils';
import { extractCpsConfig, guessCpsEnvFromAppEnvironment } from '../../utils/cpsHelpers';
import ConfirmActionModal from '../../components/ui/ConfirmActionModal';
import TableHeader from '../../components/ui/TableHeader';
import { getErrorMessage } from '../../services/http';
import cronstrue from 'cronstrue';
import {
  getNextCronRun, CopyGroupBtn, SecretVal, TAG_COLORS, MetaTag, NS_DOT_COLORS, PulseDot, KVRow,
  CARD_ACCENTS, GlassCard, HERO_ACTION_ACCENTS, HeroActionBtn, STAT_TILE_ACCENTS, StatTile, SectionLabel,
  AppConfirmModal, SchedulerConfirmModal, SchedulerToggleConfirmModal, BulkSchedulerToggleConfirmModal, BulkSchedulerRunConfirmModal, ContractConfirmModal,
} from './shared';
import PropertiesTab from './tabs/PropertiesTab';
import DependenciesTab from './tabs/DependenciesTab';
import InfrastructureTab from './tabs/InfrastructureTab';
import CpsConfigTab from './tabs/CpsConfigTab';
import ContractsTab from './tabs/ContractsTab';
import ApiSpecTab from './tabs/ApiSpecTab';
import OverviewTab from './tabs/OverviewTab';

// App detail cache eviction window — short because `status` can change at
// any time (user action in another tab, Anypoint auto-scaling, etc.);
// freshness (no-refetch-at-all) is governed by apiCache.js's global 3-min
// FRESH_MS, same convention as ApplicationsPage's CK.apps/CK.bgs caches.
const APP_DETAIL_STALE_MS = 5 * 60 * 1000;
// Same rationale for the CPS non-secure properties auto-fetched below —
// these change far less often than app status, but 5 min keeps the same
// convention as the app-detail cache above.
const CPS_NS_STALE_MS = 5 * 60 * 1000;
// Lazy ("tab click") data caches — schedulers/contracts can change, but far
// less often than app status; API/ping specs come from Exchange and rarely
// change at all, so they get a longer window.
const SCHEDULERS_STALE_MS = 5 * 60 * 1000;
const CONTRACTS_STALE_MS  = 5 * 60 * 1000;
const PING_SPEC_STALE_MS  = 10 * 60 * 1000;

/**
 * Fetch the full app-detail "bundle" (CH2 deployment + Private Space
 * outbound IPs, or the CH1 fallback shape) with no component-state
 * side effects — a pure (orgId, envId, appId) → data function so it can be
 * cached/replayed by apiCache.js's SWR primitives in `load()` below.
 */
async function fetchAppBundle(orgId, envId, appId, forceRefresh = false) {
  try {
    const res = await getCloudhub2AppDetail(orgId, envId, appId, forceRefresh);
    const app = res.data;
    let ch2PrivateIPs = [];
    // CH2 Private Space static outbound IPs
    const targetId = app?.target?.targetId || '';
    const isPrivate = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(targetId);
    if (isPrivate) {
      try {
        const psRes = await getPrivateSpaceDetail(orgId, targetId);
        const ips = psRes.data?.network?.outboundStaticIps || [];
        if (Array.isArray(ips) && ips.length) ch2PrivateIPs = ips.filter(Boolean);
      } catch { /* not accessible */ }
    }
    return { app, ch2PrivateIPs };
  } catch {
    const res2 = await getCloudhub1AppDetail(envId, appId, orgId, forceRefresh);
    const c = res2.data;
    let sch = [];
    try {
      const sr = await getCloudhub1Schedules(envId, appId, orgId);
      sch = Array.isArray(sr.data) ? sr.data : (sr.data?.schedules || []);
    } catch {}
    // Fetch actual static IP addresses from dedicated endpoint when enabled
    let staticIPs = [];
    if (c.staticIPsEnabled) {
      try {
        const sipRes = await getCloudhub1StaticIps(envId, appId, orgId);
        const sipArr = Array.isArray(sipRes.data) ? sipRes.data
          : (sipRes.data?.staticIps || sipRes.data?.staticIPs || sipRes.data?.items || []);
        staticIPs = sipArr
          .map(s => typeof s === 'string' ? s : (s.ipAddress || s.staticIPAddress || s.address || s.ip))
          .filter(Boolean);
      } catch { /* endpoint not available — fall through to raw field check */ }
    }
    // Fallback: check raw response field names (some API versions include them inline)
    if (staticIPs.length === 0) {
      const rawIPs = c.staticIPs || c.staticIps || c.staticIPAddresses || c.ipAddresses || [];
      if (Array.isArray(rawIPs) && rawIPs.length > 0) {
        staticIPs = rawIPs.map(s => typeof s === 'string' ? s : (s.ipAddress || s.address || s.ip)).filter(Boolean);
      }
    }
    const app = { _type:'ch1', id:c.domain, name:c.domain, status:c.status, region:c.region,
      muleVersion:typeof c.muleVersion==='string'?c.muleVersion:c.muleVersion?.version,
      lastModifiedDate:c.lastUpdateTime?new Date(c.lastUpdateTime).toISOString():null,
      properties:c.properties||{}, persistentQueues:c.persistentQueues,
      staticIPsEnabled:c.staticIPsEnabled,
      staticIPs,
      loggingCustomLog4JEnabled:c.loggingCustomLog4JEnabled,
      monitoringEnabled:c.monitoringAutoRestart??c.monitoringEnabled,
      workers:{ amount:typeof c.workers==='number'?c.workers:c.workers?.amount, type:c.workerType||c.workers?.type },
      _ch1Schedules:sch, _raw:c };
    return { app, ch2PrivateIPs: [] };
  }
}

/* ── Main component ────────────────────────────────────── */

export default function ApplicationDetailPage() {
  const { orgId: authOrgId } = useAuth();
  const { orgId: paramOrgId, envId, appId } = useParams();
  const orgId = paramOrgId || authOrgId;
  const navigate = useNavigate();
  const location = useLocation();
  const [app, setApp] = useState(null);
  const [loading, setLoading] = useState(true);
  // Lands directly on the Infrastructure tab when arriving via the
  // Schedulers dashboard's "Resolve from CPS →" link (see SchedulersPage.jsx's
  // onNavigateToApp) instead of defaulting to Overview and making the user
  // click into "Schedulers" themselves.
  const [tab, setTab] = useState(() => location.state?.openInfrastructureTab ? 'infrastructure' : 'overview');
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
    // Reuses ApplicationsPage's CK.bgs(orgId) cache — if the user came from
    // the Applications list (the common path), this is an instant hit with
    // zero network calls instead of re-fetching the same BG list again.
    const cacheKey = CK.bgs(orgId);
    const applyBgs = (groups) => {
      const match = (groups || []).find(g => g.id === orgId);
      if (match) setBgName(match.name);
    };
    const swr = getCachedSWR(cacheKey);
    if (swr) {
      applyBgs(swr.data);
      if (!swr.stale) return;
    }
    getBusinessGroups().then(r => {
      const groups = r.data?.data || [];
      setCached(cacheKey, groups, 30 * 60 * 1000);
      applyBgs(groups);
    }).catch(() => {});
  }, [orgId]);
  useEffect(() => {
    if (!orgId || !envId) return;
    // Reuses the same CK.envs(orgId) cache key ApplicationsPage's env fetch
    // would populate, with the same instant-render-then-revalidate pattern.
    const cacheKey = CK.envs(orgId);
    const applyEnvs = (envs) => {
      const match = (Array.isArray(envs) ? envs : []).find(e => e.id === envId);
      if (match) setResolvedEnvName(match.name);
    };
    const swr = getCachedSWR(cacheKey);
    if (swr) {
      applyEnvs(swr.data);
      if (!swr.stale) return;
    }
    getEnvironments(orgId).then(r => {
      const envs = r.data?.data || r.data?.environments || r.data || [];
      setCached(cacheKey, envs, 30 * 60 * 1000);
      applyEnvs(envs);
    }).catch(() => {});
  }, [orgId, envId]);

  // CH2 schedulers from dedicated /schedulers endpoint
  const [ch2PrivateIPs, setCh2PrivateIPs] = useState([]);
  const [ch2Schedulers, setCh2Schedulers] = useState(null);
  const [schedulersLoading, setSchedulersLoading] = useState(false);
  // CPS properties fetched specifically to resolve ${...} placeholders in scheduler expressions
  const [cpsSchedulerProps, setCpsSchedulerProps] = useState({});
  const [cpsSecureSchedulerLoading, setCpsSecureSchedulerLoading] = useState(false);
  // Scheduler trigger state
  const [triggerLoadingSet, setTriggerLoadingSet] = useState(new Set());
  const [triggerResult, setTriggerResult] = useState(null);
  const [schedulerConfirmKey, setSchedulerConfirmKey] = useState(null);
  // Scheduler enable/disable state
  const [toggleLoadingSet, setToggleLoadingSet] = useState(new Set());
  const [schedulerToggleConfirm, setSchedulerToggleConfirm] = useState(null); // { schedulerKey, nextEnabled }
  // Bulk scheduler selection + enable/disable state
  const [selectedSchedulers, setSelectedSchedulers] = useState(new Set());
  const [bulkSchedulerToggleConfirm, setBulkSchedulerToggleConfirm] = useState(null); // { schedulerKeys, nextEnabled }
  const [bulkToggleLoading, setBulkToggleLoading] = useState(false);
  const [bulkSchedulerRunConfirm, setBulkSchedulerRunConfirm] = useState(null); // { schedulerKeys }
  const [bulkRunLoading, setBulkRunLoading] = useState(false);

  // Ping spec from Exchange (auto-fetched when app has application.ref)
  const [pingSpec, setPingSpec] = useState(null);
  const [pingSpecLoading, setPingSpecLoading] = useState(false);

  // Feature 4: contracts tab state
  const [contractsLoading, setContractsLoading] = useState(false);
  const [contracts, setContracts] = useState(null);
  const [contractsError, setContractsError] = useState('');
  const [contractApiInstanceId, setContractApiInstanceId] = useState(null);
  const [contractActionLoading, setContractActionLoading] = useState(null); // contractId being actioned
  const [contractActionResult, setContractActionResult] = useState(null);   // { success, message }
  const [contractConfirmState, setContractConfirmState] = useState(null);   // { contractId, action, appName }

  // Feature 4: load contracts — defined here (before early returns) to satisfy Rules of Hooks.
  // Resolves the API Manager instance the same way PingTestPanel does:
  //   Step 1 — extract CPS config from ARM deployment properties
  //   Step 2 — post CPS credentials so the CPS server accepts the fetch
  //   Step 3 — fetch CPS non-secure to discover the Autodiscovery api.id
  //   Step 4 — pass apiId to /health/auto-credentials for a direct Layer 1 lookup
  //   Step 5 — fetch contracts for the matched API Manager instance
  const loadContracts = useCallback(async (forceRefresh = false) => {
    if (!orgId || !envId) return;

    // Pure fetch — resolves to { instanceId, contracts } or throws (with
    // `.noInstance = true` for the "not registered in API Manager" case so
    // the caller can show that exact message instead of a generic one).
    const fetchContractsBundle = async () => {
      const appData = app;
      let apiId;

      // ── Step 1-3: get api.id from CPS non-secure properties ──────────────
      if (appData) {
        // Delegate to the shared extractCpsConfig() — see
        // FRONTEND_ARCHITECTURE_REVIEW.md §1 finding #7.
        const cpsConfig = extractCpsConfig(appData);
        const cpsUrl  = cpsConfig.cpsBaseUrl;
        const cpsKey  = cpsConfig.cpsKey || appData.name || '';
        const cpsPfx  = cpsConfig.cpsEnv;
        const cpsCId  = cpsConfig.cpsClientId;

        if (cpsUrl && cpsKey) {
          // Post CPS creds to backend session if available
          if (cpsCId && hasCpsCsvCredentials) {
            const secret = getSecret(cpsCId);
            if (secret) {
              try {
                const credKey = `${cpsUrl.trim().replace(/\/+$/, '').replace(/\/api\/v2\/?$/, '')}::${orgId}`;
                await postCpsCredentialsRaw({ credentials: { [credKey]: { clientId: cpsCId, clientSecret: secret } } });
              } catch {}
            }
          }
          try {
            const data = await fetchCpsProperties({ baseUrl: cpsUrl, type: 'non-secure', keys: cpsKey, ...(cpsPfx && { environment: cpsPfx }), bgOrgId: orgId });
            let props = {};
            if (Array.isArray(data?.responses)) data.responses.forEach(r2 => Object.assign(props, r2.properties || {}));
            else if (Array.isArray(data)) data.forEach(r2 => { if (r2?.properties) Object.assign(props, r2.properties); });
            else if (data && typeof data === 'object') {
              const fv = Object.values(data)[0];
              props = (fv && typeof fv === 'object') ? Object.values(data).reduce((m, v) => (v && typeof v === 'object' ? Object.assign(m, v) : m), {}) : data;
            }
            // Find numeric api.id
            const findId = () => {
              const isValidId = v => /^\d+$/.test(String(v).trim()) && String(v).trim() !== '0';
              if ('api.id' in props && isValidId(props['api.id'])) return String(props['api.id']).trim();
              const e1 = Object.entries(props).find(([k]) => k.endsWith('.api.id'));
              if (e1 && isValidId(e1[1])) return String(e1[1]).trim();
              const e2 = Object.entries(props).find(([k, v]) => k.endsWith('.id') && isValidId(v));
              if (e2) return String(e2[1]).trim();
              if ('id' in props && isValidId(props['id'])) return String(props['id']).trim();
              return null;
            };
            apiId = findId();
          } catch {}
        }
      }

      // ── Step 4: find API Manager instance (Layer 1 if apiId, else fuzzy) ─
      const acData = await getAutoCredentials({
        orgId, envId,
        appName: appData?.name,
        ...(apiId && { apiId }),
      });
      const instanceId = acData?.matchedApis?.[0]?.id;
      if (!instanceId) {
        const err = new Error('No API Manager instance found for this application. Ensure it is registered in API Manager.');
        err.noInstance = true;
        throw err;
      }

      // ── Step 5: fetch contracts ───────────────────────────────────────────
      const contractsRes = await getContracts(orgId, envId, instanceId);
      const raw = contractsRes.data?.contracts || contractsRes.data || [];
      return { instanceId, contracts: Array.isArray(raw) ? raw : [] };
    };

    const cacheKey = CK.contracts(orgId, envId, appId);
    const applyBundle = (bundle) => {
      setContractApiInstanceId(bundle.instanceId);
      setContracts(bundle.contracts);
    };

    if (!forceRefresh) {
      const swr = getCachedSWR(cacheKey);
      if (swr) {
        applyBundle(swr.data);
        setContractsError('');
        if (swr.stale) {
          fetchContractsBundle().then(bundle => {
            setCached(cacheKey, bundle, CONTRACTS_STALE_MS);
            applyBundle(bundle);
          }).catch(() => {}); // keep showing stale data on a silent bg failure
        }
        return;
      }
    }

    setContractsLoading(true);
    setContractsError('');
    setContracts(null);
    try {
      const bundle = await fetchContractsBundle();
      setCached(cacheKey, bundle, CONTRACTS_STALE_MS);
      applyBundle(bundle);
    } catch (e) {
      setContractsError(e.noInstance ? e.message : getErrorMessage(e, 'Failed to load contracts'));
    }
    setContractsLoading(false);
  }, [orgId, envId, appId, app, hasCpsCsvCredentials, getSecret]);

  // Contract action handler (approve / revoke / delete)
  const handleContractAction = useCallback(async () => {
    if (!contractConfirmState || !contractApiInstanceId) return;
    const { contractId, action, appName } = contractConfirmState;
    setContractActionLoading(contractId);
    try {
      if (action === 'delete') {
        await deleteContract(orgId, envId, contractApiInstanceId, contractId);
        setContracts(prev => Array.isArray(prev)
          ? prev.filter(c => c.id !== contractId)
          : prev
        );
        setContractActionResult({
          success: true,
          message: `✓ Contract for "${appName}" deleted successfully`,
        });
      } else {
        const newStatus = action === 'approve' ? 'APPROVED' : 'REVOKED';
        await updateContractStatus(orgId, envId, contractApiInstanceId, contractId, newStatus);
        setContracts(prev => Array.isArray(prev)
          ? prev.map(c => (c.id === contractId ? { ...c, status: newStatus } : c))
          : prev
        );
        setContractActionResult({
          success: true,
          message: `✓ Contract for "${appName}" ${action === 'approve' ? 'approved' : 'revoked'} successfully`,
        });
      }
    } catch (e) {
      setContractActionResult({
        success: false,
        message: `✗ Failed to ${action} contract: ${getErrorMessage(e)}`,
      });
    } finally {
      // Invalidate the cached contracts bundle — the optimistic update above
      // only patches local state; the next load (tab revisit, back-nav)
      // should see the real post-action contract list/status.
      bustCache(CK.contracts(orgId, envId, appId));
      setContractActionLoading(null);
      setContractConfirmState(null);
      setTimeout(() => setContractActionResult(null), 6000);
    }
  }, [contractConfirmState, contractApiInstanceId, orgId, envId, appId]);

  // CPS state
  const [copiedCpsNs, setCopiedCpsNs] = useState(false);
  const [copiedCpsSec, setCopiedCpsSec] = useState(false);
  const [cpsLoading, setCpsLoading] = useState(false);
  const [cpsData, setCpsData] = useState(null);
  const [cpsError, setCpsError] = useState('');
  const [cpsMissingCred, setCpsMissingCred] = useState(null);
  const [showCpsSettings, setShowCpsSettings] = useState(false);
  const [rawJsonView, setRawJsonView] = useState(null); // { title: string, data: any }
  const [cpsSearch, setCpsSearch] = useState('');
  const [depSearch, setDepSearch] = useState('');
  const [cpsKeyOverride, setCpsKeyOverride] = useState('');
  const [cpsEnvOverride, setCpsEnvOverride] = useState('');
  const [cpsAttemptedUrl, setCpsAttemptedUrl] = useState('');
  const [secureLoading, setSecureLoading] = useState(false);
  const [binaryLoading, setBinaryLoading] = useState(false);
  const [cpsOpen, setCpsOpen] = useState({ ns: true, sec: false, bin: false });

  const load = useCallback(async (forceRefresh = false) => {
    // Reset all per-app fetched/derived state before loading. The route
    // (`applications/:orgId/:envId/:appId`) has no `key`, so React Router
    // reuses this same mounted component when navigating directly from one
    // app's detail page to another's — without this reset, `cpsData` (and
    // the scheduler/contract/ping caches) would still hold the PREVIOUS
    // app's data, and loadCpsData()'s "already loaded" guard would then
    // skip fetching the new app's CPS properties entirely, making it look
    // like CPS never auto-loads without a manual tab visit + Refresh. This
    // must run on every call regardless of whether the app bundle itself
    // below is served from cache.
    setCpsData(null); setCpsError(''); setCpsMissingCred(null); setCpsAttemptedUrl('');
    setCpsCredsResolved(false);
    setCpsKeyOverride(''); setCpsEnvOverride('');
    setCh2Schedulers(null); setCpsSchedulerProps({});
    setContracts(null); setContractsError(''); setContractApiInstanceId(null);
    setPingSpec(null);

    const applyBundle = (bundle) => {
      setApp(bundle.app);
      setCh2PrivateIPs(bundle.ch2PrivateIPs || []);
    };
    const cacheKey = CK.appDetail(orgId, envId, appId);

    // ── Frontend cache — SWR (stale-while-revalidate) ──────────────────────
    // Mirrors ApplicationsPage's loadApps/loadBusinessGroups pattern: render
    // instantly from any usable cached value (fresh OR stale-but-unexpired),
    // then silently re-fetch in the background when stale so the page never
    // shows the loading spinner on a repeat visit to an already-seen app.
    if (!forceRefresh) {
      const swr = getCachedSWR(cacheKey);
      if (swr) {
        applyBundle(swr.data);
        setLoading(false);
        if (swr.stale) {
          fetchAppBundle(orgId, envId, appId).then(bundle => {
            setCached(cacheKey, bundle, APP_DETAIL_STALE_MS);
            applyBundle(bundle);
          }).catch(() => {});
        }
        return;
      }
    }
    // ───────────────────────────────────────────────────────────────────────

    setLoading(true);
    setApp(null);
    try {
      const bundle = await fetchAppBundle(orgId, envId, appId, forceRefresh);
      setCached(cacheKey, bundle, APP_DETAIL_STALE_MS);
      applyBundle(bundle);
    } catch {
      setApp(null);
    }
    setLoading(false);
  }, [orgId, envId, appId]);

  // Load CH2 schedulers from dedicated endpoint when infrastructure tab is opened.
  // If any scheduler expression is a ${...} placeholder, also silently fetch
  // CPS non-secure properties to resolve the actual cron values.
  const loadCh2Schedulers = useCallback(async (forceRefresh = false) => {
    if (app?._type === 'ch1') return;

    // Pure fetch — no component-state side effects besides the
    // CPS-placeholder resolution (which is cheap, idempotent, and safe to
    // re-run on every call including background refreshes).
    const fetchItems = async () => {
      const res = await getCloudhub2Schedulers(orgId, envId, appId);
      const items = Array.isArray(res.data) ? res.data
        : (res.data?.schedulers || res.data?.items || []);
      if (items.length > 0) {
        console.log('[Schedulers] raw sample item:', JSON.stringify(items[0], null, 2));
      }
      return items;
    };

    const resolvePlaceholders = async (items) => {
      const hasPlaceholders = items.some(s =>
        (s.expression || s.schedule?.expression || '').includes('${')
      );
      if (!hasPlaceholders) return;
      // `app` can still be null here if this fires before the app bundle
      // finishes loading (e.g. landing directly on this tab via the
      // Schedulers dashboard's "Resolve from CPS →" link, which sets the
      // initial tab to 'infrastructure' before `load()` resolves). Without
      // this guard, `app.name` below throws synchronously — uncaught by the
      // try/catch further down since it's before it — and the exception
      // propagates up to loadCh2Schedulers' own catch, which then wipes the
      // just-fetched real scheduler list back to `[]`. Bail out instead;
      // the effect that calls loadCh2Schedulers re-fires once `app` loads.
      if (!app) return;
      // Extract CPS config from app ARM props — delegate to the shared
      // extractCpsConfig() — see FRONTEND_ARCHITECTURE_REVIEW.md §1 finding #7.
      const cpsConfig2 = extractCpsConfig(app);
      const cpsBUrl = cpsConfig2.cpsBaseUrl;
      const cpsK = cpsConfig2.cpsKey || app.name;
      const cpsE = cpsConfig2.cpsEnv;
      const cpsCId = cpsConfig2.cpsClientId;
      if (!cpsBUrl || !cpsK) return;
      try {
        // Post CPS credentials if available
        if (cpsCId) {
          try {
            const normBase = cpsBUrl.trim().replace(/\/+$/, '').replace(/\/api\/v2\/?$/, '');
            await postCpsCredentialsRaw({ credentials: { [`${normBase}::${orgId}`]: {} } });
          } catch { /* non-fatal */ }
        }
        const data = await fetchCpsProperties({ baseUrl: cpsBUrl, type: 'non-secure', keys: cpsK, ...(cpsE && { environment: cpsE }), bgOrgId: orgId });
        let flat = {};
        if (Array.isArray(data?.responses)) data.responses.forEach(r => Object.assign(flat, r.properties || {}));
        else if (Array.isArray(data)) data.forEach(r => { if (r?.properties) Object.assign(flat, r.properties); });
        else if (data && typeof data === 'object') {
          const fv = Object.values(data)[0];
          flat = (fv && typeof fv === 'object') ? Object.values(data).reduce((m, v) => (v && typeof v === 'object' ? Object.assign(m, v) : m), {}) : data;
        }
        if (Object.keys(flat).length > 0) setCpsSchedulerProps(flat);
      } catch { /* CPS not available — placeholders will show as unresolved */ }
    };

    const cacheKey = CK.schedulers(orgId, envId, appId);
    if (!forceRefresh) {
      const swr = getCachedSWR(cacheKey);
      if (swr) {
        setCh2Schedulers(swr.data);
        resolvePlaceholders(swr.data).catch(() => {});
        if (swr.stale) {
          fetchItems().then(items => {
            setCached(cacheKey, items, SCHEDULERS_STALE_MS);
            setCh2Schedulers(items);
          }).catch(() => {});
        }
        return;
      }
    }

    setSchedulersLoading(true);
    try {
      const items = await fetchItems();
      setCached(cacheKey, items, SCHEDULERS_STALE_MS);
      setCh2Schedulers(items);
      await resolvePlaceholders(items);
    } catch {
      setCh2Schedulers([]);
    }
    setSchedulersLoading(false);
  }, [orgId, envId, appId, app]);

  useEffect(() => { if (orgId && envId && appId) load(); }, [load]);

  // Mirrors the Infrastructure-tab load-trigger inside the tab-click handler
  // below, but fires on mount too — needed because `tab` can start as
  // 'infrastructure' already (landing here via the Schedulers dashboard's
  // "Resolve from CPS →" link sets that as the initial state), in which case
  // the click handler never runs to kick off the fetch.
  // Requires `app` to be loaded first (not just `ch2Schedulers === null`) —
  // calling this before `app` resolves meant `app?._type !== 'ch1'` was
  // trivially true (undefined !== 'ch1'), firing the CH2 fetch even for
  // apps that turn out to be CH1, and racing resolvePlaceholders against a
  // still-null `app`.
  useEffect(() => {
    if (tab === 'infrastructure' && app && app._type !== 'ch1' && ch2Schedulers === null && !schedulersLoading) {
      loadCh2Schedulers();
    }
  }, [tab, app, ch2Schedulers, schedulersLoading]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── CPS auto-load on page open ───────────────────────────────────────────
  // `loadCpsData` is defined after the early-return guards (it closes over
  // render-time derived values). We keep a ref to its latest version so this
  // effect can call it safely once the app data arrives.
  const loadCpsDataRef = useRef(null);

  useEffect(() => {
    if (!app || loading) return;
    // Derive cpsBaseUrl from raw app data so we know whether CPS is
    // configured — delegate to the shared extractCpsConfig() — see
    // FRONTEND_ARCHITECTURE_REVIEW.md §1 finding #7.
    const _url = extractCpsConfig(app).cpsBaseUrl;
    // Only auto-load when CPS is configured and data isn't already present
    if (_url && loadCpsDataRef.current) loadCpsDataRef.current();
    // `loading` is also a dependency (not just `app`): for CH2 apps deployed
    // to a Private Space, `load()` awaits a second request (static IPs)
    // between `setApp(...)` and `setLoading(false)`, so `app` changes on an
    // intermediate render where `loading` is still true — the component's
    // early-return guard skips the line that syncs `loadCpsDataRef.current`
    // on that render, leaving the ref null and silently no-op-ing this
    // effect. Re-running once `loading` flips to false retries with the by
    // -then-populated ref instead of only ever firing on the stale pass.
  }, [app, loading]); // eslint-disable-line react-hooks/exhaustive-deps

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
        await runCloudhub1Action(envId, appId, orgId, action);
      } else {
        await runCloudhub2Action(orgId, envId, appId, action);
      }
      const nextStatus = action === 'start' ? 'RUNNING' : action === 'stop' ? 'STOPPED' : 'DEPLOYING';
      setApp((prev) => prev ? { ...prev,
        status: nextStatus,
        application: prev.application ? { ...prev.application, status: nextStatus } : prev.application
      } : prev);
      // Invalidate the cached app-detail bundle so the next load (back-nav,
      // tab revisit) re-fetches real status from Anypoint instead of
      // replaying a now-outdated cached snapshot.
      bustCache(CK.appDetail(orgId, envId, appId));
      setActionResult({ success: true, message: `✓ ${app.name}: ${action} initiated successfully` });
    } catch (e) {
      setActionResult({ success: false, message: `✗ Failed to ${action}: ${getErrorMessage(e)}` });
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
  const fetchPingSpec = useCallback((currentApp, forceRefresh = false) => {
    const a = currentApp || app;
    if (!a) return;

    const cacheKey = CK.pingSpec(orgId, a.name);
    if (!forceRefresh) {
      const swr = getCachedSWR(cacheKey);
      if (swr) {
        setPingSpec(swr.data);
        if (swr.stale) {
          getExchangePingSpec({ orgId, appName: a.name }).then(r => {
            setCached(cacheKey, r.data, PING_SPEC_STALE_MS);
            setPingSpec(r.data);
          }).catch(() => {});
        }
        return;
      }
    }

    setPingSpecLoading(true);
    setPingSpec(null);
    getExchangePingSpec({
      orgId,
      appName: a.name,   // backend always searches Exchange by name
    }).then(r => {
      setCached(cacheKey, r.data, PING_SPEC_STALE_MS);
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

  // Trigger a scheduler to run immediately (Run Now)
  const triggerScheduler = useCallback(async (schedulerKey) => {
    if (!schedulerKey) return;
    setTriggerLoadingSet(prev => new Set([...prev, schedulerKey]));
    setTriggerResult(null);
    try {
      if (app?._type === 'ch1') {
        await runCloudhub1SchedulerNow(envId, appId, schedulerKey, orgId);
      } else {
        await runCloudhub2SchedulerNow(orgId, envId, appId, schedulerKey);
      }
      setTriggerResult({ success: true, message: `✓ Scheduler "${schedulerKey}" triggered successfully` });
    } catch (e) {
      setTriggerResult({ success: false, message: `✗ Failed to trigger "${schedulerKey}": ${getErrorMessage(e)}` });
    } finally {
      setTriggerLoadingSet(prev => { const next = new Set(prev); next.delete(schedulerKey); return next; });
      setTimeout(() => setTriggerResult(null), 5000);
    }
  }, [app, orgId, envId, appId]);

  // Enable or disable a scheduler
  const toggleScheduler = useCallback(async () => {
    if (!schedulerToggleConfirm) return;
    const { schedulerKey, nextEnabled } = schedulerToggleConfirm;
    setToggleLoadingSet(prev => new Set([...prev, schedulerKey]));
    setTriggerResult(null);
    try {
      if (app?._type === 'ch1') {
        await setCloudhub1SchedulerEnabled(envId, appId, schedulerKey, orgId, nextEnabled);
        setApp(prev => ({
          ...prev,
          _ch1Schedules: (prev._ch1Schedules || []).map(s =>
            (s.id === schedulerKey || s.name === schedulerKey) ? { ...s, enabled: nextEnabled } : s
          ),
        }));
      } else {
        await setCloudhub2SchedulerEnabled(orgId, envId, appId, schedulerKey, nextEnabled);
        // flowName is the real Mulesoft AMC identifier (matches schedulerKey
        // derivation in InfrastructureTab.jsx) — name/flow kept as fallbacks
        // for older/alternate response shapes.
        setCh2Schedulers(prev => (prev || []).map(s =>
          (s.flowName === schedulerKey || s.name === schedulerKey || s.flow === schedulerKey) ? { ...s, enabled: nextEnabled } : s
        ));
      }
      // Both the per-app scheduler cache (this tab) and the aggregate
      // Schedulers-dashboard cache embed this same enabled/disabled flag —
      // bust both so a toggle here isn't silently reverted by a stale read
      // on the other page within the SWR freshness window.
      bustCache(CK.schedulers(orgId, envId, appId));
      bustCache(CK.PREFIX.allSchedulers);
      setTriggerResult({ success: true, message: `✓ Scheduler "${schedulerKey}" ${nextEnabled ? 'enabled' : 'disabled'} successfully` });
    } catch (e) {
      setTriggerResult({ success: false, message: `✗ Failed to ${nextEnabled ? 'enable' : 'disable'} "${schedulerKey}": ${getErrorMessage(e)}` });
    } finally {
      setToggleLoadingSet(prev => { const next = new Set(prev); next.delete(schedulerKey); return next; });
      setSchedulerToggleConfirm(null);
      setTimeout(() => setTriggerResult(null), 5000);
    }
  }, [schedulerToggleConfirm, app, orgId, envId, appId]);

  // Enable or disable multiple schedulers at once (fires one PUT per scheduler
  // in parallel — the Anypoint API has no bulk endpoint, see backend route).
  const bulkToggleSchedulers = useCallback(async () => {
    if (!bulkSchedulerToggleConfirm) return;
    const { schedulerKeys, nextEnabled } = bulkSchedulerToggleConfirm;
    if (!schedulerKeys?.length) return;
    setBulkToggleLoading(true);
    setToggleLoadingSet(prev => new Set([...prev, ...schedulerKeys]));
    setTriggerResult(null);
    const results = await Promise.allSettled(schedulerKeys.map(key =>
      app?._type === 'ch1'
        ? setCloudhub1SchedulerEnabled(envId, appId, key, orgId, nextEnabled)
        : setCloudhub2SchedulerEnabled(orgId, envId, appId, key, nextEnabled)
    ));
    const succeeded = new Set(schedulerKeys.filter((_, i) => results[i].status === 'fulfilled'));
    const failedCount = schedulerKeys.length - succeeded.size;
    if (app?._type === 'ch1') {
      setApp(prev => ({
        ...prev,
        _ch1Schedules: (prev._ch1Schedules || []).map(s => {
          const key = s.id || s.name;
          return succeeded.has(key) ? { ...s, enabled: nextEnabled } : s;
        }),
      }));
    } else {
      setCh2Schedulers(prev => (prev || []).map(s => {
        const key = s.flowName || s.name || s.flow;
        return succeeded.has(key) ? { ...s, enabled: nextEnabled } : s;
      }));
    }
    // See toggleScheduler above — same dual-cache invalidation requirement.
    bustCache(CK.schedulers(orgId, envId, appId));
    bustCache(CK.PREFIX.allSchedulers);
    setTriggerResult(failedCount === 0
      ? { success: true, message: `✓ ${succeeded.size} scheduler${succeeded.size !== 1 ? 's' : ''} ${nextEnabled ? 'enabled' : 'disabled'} successfully` }
      : { success: false, message: `⚠ ${succeeded.size} succeeded, ${failedCount} failed to ${nextEnabled ? 'enable' : 'disable'}` });
    setToggleLoadingSet(prev => { const next = new Set(prev); schedulerKeys.forEach(k => next.delete(k)); return next; });
    setSelectedSchedulers(prev => { const next = new Set(prev); succeeded.forEach(k => next.delete(k)); return next; });
    setBulkToggleLoading(false);
    setBulkSchedulerToggleConfirm(null);
    setTimeout(() => setTriggerResult(null), 6000);
  }, [bulkSchedulerToggleConfirm, app, orgId, envId, appId]);

  // Trigger multiple schedulers to run immediately at once (fires one POST
  // per scheduler in parallel — same no-bulk-endpoint reasoning as
  // bulkToggleSchedulers above).
  const bulkRunSchedulers = useCallback(async () => {
    if (!bulkSchedulerRunConfirm) return;
    const { schedulerKeys } = bulkSchedulerRunConfirm;
    if (!schedulerKeys?.length) return;
    setBulkRunLoading(true);
    setTriggerLoadingSet(prev => new Set([...prev, ...schedulerKeys]));
    setTriggerResult(null);
    const results = await Promise.allSettled(schedulerKeys.map(key =>
      app?._type === 'ch1'
        ? runCloudhub1SchedulerNow(envId, appId, key, orgId)
        : runCloudhub2SchedulerNow(orgId, envId, appId, key)
    ));
    const succeeded = schedulerKeys.filter((_, i) => results[i].status === 'fulfilled').length;
    const failedCount = schedulerKeys.length - succeeded;
    setTriggerResult(failedCount === 0
      ? { success: true, message: `✓ ${succeeded} scheduler${succeeded !== 1 ? 's' : ''} triggered successfully` }
      : { success: false, message: `⚠ ${succeeded} succeeded, ${failedCount} failed to trigger` });
    setTriggerLoadingSet(prev => { const next = new Set(prev); schedulerKeys.forEach(k => next.delete(k)); return next; });
    setSelectedSchedulers(new Set());
    setBulkRunLoading(false);
    setBulkSchedulerRunConfirm(null);
    setTimeout(() => setTriggerResult(null), 6000);
  }, [bulkSchedulerRunConfirm, app, orgId, envId, appId]);

  const isCH1 = app?._type === 'ch1';

  // Derived values depend only on `app`/`isCH1`/`ch2Schedulers` — none of them
  // change on unrelated keystrokes (propSearch, schedulerSearch, depSearch,
  // cpsSearch, etc.), so memoizing here avoids rebuilding allProps/CPS config
  // extraction on every render of this ~2900-line page — see
  // FRONTEND_ARCHITECTURE_REVIEW.md §8 Performance Review, finding #1.
  const derived = useMemo(() => {
    if (!app) return null;
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
    const httpInbound = ds.http?.inbound || {};
    const endpoints = httpInbound.endpoints || [];
    const envVars = ds.environmentVariables || ds.environmentVars || {};
    const replicas = app.target?.replicas ?? ds.replicas;
    const osEnabled = ds.persistentObjectStore ?? ds.hasPersistentObjectStore ?? false;
    const replicaList = app.replicas || [];
    const allProps = { ...runtimeProps, ...ds.properties, ...envVars, ...app.properties };

    // CPS computed values — delegate to the shared extractCpsConfig()
    // instead of an inline fallback chain, so this page resolves CPS config
    // identically to CpsComparisonPage/GlobalSearchPage — see
    // FRONTEND_ARCHITECTURE_REVIEW.md §1 finding #7 (correctness bug: 4
    // pages previously drifted on fallback-key ordering).
    const cpsConfig = extractCpsConfig(app);
    const cpsBaseUrl = cpsConfig.cpsBaseUrl;
    const cpsClientId = cpsConfig.cpsClientId;
    const cpsProjectName = cpsConfig.cpsKey || app.name;
    const cpsEnv = cpsConfig.cpsEnv || guessCpsEnvFromAppEnvironment(app.environment?.name, app.environment?.type);
    const appEnvName = app.environment?.name || '';
    const cpsDepType = isCH1 ? 'ch1' : 'ch2';

    return {
      actions: availableActions(app.application?.status || app.status),
      ds, appCfg, propsSvc, schedSvc, runtimeProps, secureProps,
      allSchedulers, httpInbound, endpoints, envVars, replicas, osEnabled, replicaList,
      allProps, cpsBaseUrl, cpsClientId, cpsProjectName, cpsEnv, appEnvName, cpsDepType,
    };
  }, [app, isCH1, ch2Schedulers]);

  if (loading) return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"/></div>;
  if (!app || !derived) return (
    <div className="space-y-4">
      <button onClick={()=>navigate('/applications')} className="flex items-center gap-2 text-gray-500 hover:text-gray-900 text-sm"><ArrowLeft size={16}/> Back</button>
      <div className="bg-red-50/30 border border-red-200/50 rounded-2xl p-10 text-center text-red-600">Application not found or access denied.</div>
    </div>
  );

  const {
    actions, ds, appCfg, propsSvc, schedSvc, runtimeProps, secureProps,
    allSchedulers, httpInbound, endpoints, envVars, replicas, osEnabled, replicaList,
    allProps, cpsBaseUrl, cpsClientId, cpsProjectName, cpsEnv, appEnvName, cpsDepType,
  } = derived;

  const schedulers = schedulerSearch
    ? allSchedulers.filter((s) => {
        const q = schedulerSearch.toLowerCase();
        const flow = (s.flow || s.flowName || s.name || '').toLowerCase();
      const cron = (s.schedule?.cronExpression || s.schedule?.expression || s.expression || s.cronExpression || '').toLowerCase();
      const freq = String(s.frequency || s.schedule?.frequency || s.schedule?.period || '').toLowerCase();
        return flow.includes(q) || cron.includes(q) || freq.includes(q);
      })
    : allSchedulers;
  const filteredProps = Object.entries(allProps).filter(([k]) => !propSearch || k.toLowerCase().includes(propSearch.toLowerCase()));

  const effectiveCpsKey = cpsKeyOverride || cpsProjectName;
  const effectiveCpsEnv = cpsEnvOverride || cpsEnv;

  const loadCpsData = async (keyOverride, envOverride) => {
    if (!cpsBaseUrl) return;
    // isAutoTrigger: the silent on-page-open auto-load (no override args).
    // A manual call (Refresh button / key-override change) always passes
    // args, which both bypasses the "already loaded" guard below AND skips
    // the cache read further down — it always forces a fresh network fetch.
    const isAutoTrigger = !keyOverride && !envOverride;
    if (isAutoTrigger && (cpsData || cpsLoading)) return;
    const useKey = keyOverride || effectiveCpsKey;
    const useEnv = envOverride || effectiveCpsEnv;
    const cacheKey = CK.cpsNonSecure(cpsBaseUrl, cpsDepType, useEnv, useKey);

    // Pure fetch — resolves to the exact object shape `setCpsData` expects,
    // or throws. No component-state side effects (besides the credential
    // flag, which is informational and safe to set during a silent
    // background refresh too) so it can be reused for the cold-fetch path
    // AND the stale-while-revalidate background refresh without duplicating
    // the parsing logic.
    const fetchCpsBundle = async () => {
      if (hasCpsCsvCredentials) {
        const resolved = await resolveAndPostCpsCredentials({
          cpsBaseUrl, cpsClientId, scopeId: orgId,
          hasCredentials: hasCpsCsvCredentials, getSecret, getAllCredentials,
        });
        setCpsCredsResolved(resolved);
        if (!resolved) {
          console.log('[CPS auto-resolve] No matching credentials found in CSV — will show 422 error');
        }
      }

      // Fetch non-secure properties for this specific project key
      const nsRaw = await fetchCpsProperties({
        baseUrl: cpsBaseUrl, type: 'non-secure', environment: useEnv,
        keys: useKey, deploymentType: cpsDepType, envName: appEnvName, bgOrgId: orgId
      });

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
      return {
        nonSecure: flatNs,
        rawNsResponse: nsRaw,   // original CPS API response (unmodified)
        secureGroups: [],
        rawSecureResponse: null,
        binaryList: [],
        secureKeys: flatNs['cps.secure.properties'] || '',
        binaryKeys: flatNs['cps.secure.binaries'] || '',
        useEnv,  // store for later fetches
      };
    };

    // ── Frontend cache — SWR (stale-while-revalidate) ──────────────────────
    // Only the silent auto-trigger consults the cache; manual Refresh/key
    // override calls always hit the network, matching the existing "guard"
    // comment's intent above.
    if (isAutoTrigger) {
      const swr = getCachedSWR(cacheKey);
      if (swr) {
        setCpsData(swr.data);
        if (swr.stale) {
          fetchCpsBundle().then(bundle => {
            setCached(cacheKey, bundle, CPS_NS_STALE_MS);
            setCpsData(bundle);
          }).catch((err) => console.warn('[CPS] BG refresh failed:', err.message));
        }
        return;
      }
    }
    // ───────────────────────────────────────────────────────────────────────

    setCpsLoading(true); setCpsError(''); setCpsMissingCred(null); setCpsData(null); setCpsAttemptedUrl('');
    setCpsCredsResolved(false);
    try {
      const bundle = await fetchCpsBundle();
      setCached(cacheKey, bundle, CPS_NS_STALE_MS);
      setCpsData(bundle);
    } catch (e) {
      if (e.response?.status === 422 || e.response?.data?.needsConfig) {
        setCpsMissingCred(e.response.data.credKey);
      } else {
        setCpsError(getErrorMessage(e, 'CPS fetch failed'));
        setCpsAttemptedUrl(e.response?.data?.attemptedUrl || '');
      }
    }
    setCpsLoading(false);
  };
  // Keep the ref in sync with the latest closure so the auto-load useEffect
  // always calls the version that closes over the current derived values.
  loadCpsDataRef.current = loadCpsData;

  const rStatus = (app.application?.status || app.status || '').toUpperCase();
  const isRunning = rStatus === 'RUNNING' || rStatus === 'STARTED';

  const statusStyle = { RUNNING:'text-emerald-700 bg-emerald-50/50 border-emerald-300/50 shadow-emerald-900/30',
    STARTED:'text-emerald-700 bg-emerald-50/50 border-emerald-300/50 shadow-emerald-900/30',
    FAILED:'text-red-700 bg-red-50/50 border-red-300/50 shadow-red-900/30',
    STOPPED:'text-gray-500 bg-gray-100/50 border-gray-300/50',
    DEPLOYING:' text-blue-700 bg-blue-50/50 border-blue-300/50 shadow-blue-900/30',
    APPLIED:'text-cyan-700 bg-cyan-50/50 border-cyan-300/50' }[rStatus] || 'text-gray-500 bg-gray-100/50 border-gray-300/50';

  // Feature 14: tab badges with live counts
  const tabs = [
    { id:'overview', label:'Overview' },
    { id:'properties', label:'Properties', badge: Object.keys(allProps).length },
    ...(cpsBaseUrl ? [{ id:'cps', label:'CPS Config', badge: cpsData ? (cpsError ? '⚠' : '✓') : undefined, badgeErr: !!cpsError }] : []),
    { id:'infrastructure', label:'Schedulers', badge: allSchedulers.length > 0 ? allSchedulers.length : undefined },
    { id:'dependencies', label:'Dependencies' },
    { id:'contracts', label:'Contracts', badge: contracts !== null && !contractsError ? contracts.length : undefined },
    { id:'apispec', label:'API Spec', badge: pingSpec?.allEndpoints?.length > 0 ? pingSpec.allEndpoints.length : undefined },
    { id:'ping', label:'Ping Test', badge: pingSpec?.pingEndpoints?.length > 0 ? pingSpec.pingEndpoints.length : undefined },
    { id:'raw', label:'Raw JSON' },
  ];

  return (
    <div className="space-y-6 min-h-screen">
      {/* Feature 3: Breadcrumb navigation */}
      <nav className="flex items-center gap-1.5 text-[11px] text-gray-400 dark:text-gray-500 flex-wrap">
        <button onClick={() => navigate('/applications')}
          className="hover:text-sf-600 dark:hover:text-sf-400 transition-colors">Applications</button>
        {bgName && (
          <>
            <span>/</span>
            <span className="text-gray-400 dark:text-gray-500">{bgName}</span>
          </>
        )}
        {(resolvedEnvName || app.environment?.name) && (
          <>
            <span>/</span>
            <span className={`font-medium ${app.environment?.type === 'production' ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>
              {resolvedEnvName || app.environment?.name}
            </span>
          </>
        )}
        <span>/</span>
        <span className="text-gray-600 dark:text-gray-300 font-medium truncate max-w-xs">{app.name}</span>
      </nav>

      {showCpsSettings && <CpsSettingsModal
        prefilledUrl={cpsBaseUrl ? cpsBaseUrl.replace(/\/+$/, '').replace(/\/api\/v2\/?$/, '') : ''}
        prefilledBgId={orgId}
        prefilledBgName={app.environment?.organizationId === orgId ? '' : ''}
        onClose={() => { setShowCpsSettings(false); if (cpsMissingCred) { setCpsMissingCred(null); loadCpsData(); } }}
      />}
      <CpsRawJsonModal
        isOpen={!!rawJsonView}
        onClose={() => setRawJsonView(null)}
        initialJson={rawJsonView?.data}
        title={rawJsonView?.title || 'Raw JSON'}
        description="View the exact JSON response returned by the CPS API."
        readOnly={true}
      />
      <AppConfirmModal
        state={confirmState}
        onConfirm={executeAction}
        onCancel={() => setConfirmState(null)}
        loading={!!actionLoading}
      />
      <SchedulerConfirmModal
        schedulerKey={schedulerConfirmKey}
        onConfirm={() => { triggerScheduler(schedulerConfirmKey); setSchedulerConfirmKey(null); }}
        onCancel={() => setSchedulerConfirmKey(null)}
        loading={triggerLoadingSet.has(schedulerConfirmKey)}
      />
      <SchedulerToggleConfirmModal
        state={schedulerToggleConfirm}
        onConfirm={toggleScheduler}
        onCancel={() => setSchedulerToggleConfirm(null)}
        loading={toggleLoadingSet.has(schedulerToggleConfirm?.schedulerKey)}
      />
      <BulkSchedulerToggleConfirmModal
        state={bulkSchedulerToggleConfirm}
        onConfirm={bulkToggleSchedulers}
        onCancel={() => setBulkSchedulerToggleConfirm(null)}
        loading={bulkToggleLoading}
      />
      <BulkSchedulerRunConfirmModal
        state={bulkSchedulerRunConfirm}
        onConfirm={bulkRunSchedulers}
        onCancel={() => setBulkSchedulerRunConfirm(null)}
        loading={bulkRunLoading}
      />
      <ContractConfirmModal
        state={contractConfirmState}
        onConfirm={handleContractAction}
        onCancel={() => setContractConfirmState(null)}
        loading={!!contractActionLoading}
      />

      {/* Action toast */}
      {actionResult && (
        <div className={`flex items-center justify-between px-4 py-3 rounded-xl border text-sm ${
          actionResult.success
            ? 'bg-emerald-50/40 border-emerald-200/50 text-emerald-700'
            : 'bg-red-50/40 border-red-200/50 text-red-700'
        }`}>
          <span>{actionResult.message}</span>
          <button onClick={() => setActionResult(null)} className="ml-4 opacity-60 hover:opacity-100"><X size={14} /></button>
        </div>
      )}

      {/* ── Hero Header ─────────────────────────────── */}
      <div className="relative rounded-2xl border border-gray-200/60 dark:border-gray-700/60 overflow-hidden shadow-lg shadow-gray-900/5 dark:shadow-black/20">
        <div className="absolute top-0 left-0 right-0 h-[3px] bg-gradient-to-r from-sf-500 via-sfteal-400 to-sfpurple-500 z-10"/>
        <div className="absolute inset-0 bg-gradient-to-br from-sf-50 via-white to-sfteal-50/50 dark:from-gray-900 dark:via-gray-900 dark:to-gray-800"/>
        <div className="absolute inset-0 dark:hidden" style={{background:'radial-gradient(ellipse at 70% 50%, rgba(1,118,211,0.06) 0%, transparent 60%)'}}/>
        <div className="absolute inset-0 hidden dark:block" style={{background:'radial-gradient(ellipse at 70% 50%, rgba(1,118,211,0.12) 0%, transparent 60%)'}}/>
        {isRunning && <div className="absolute top-0 right-0 w-96 h-96 bg-emerald-500/5 rounded-full blur-3xl pointer-events-none"/>}
        <div className="relative p-6 flex items-start justify-between flex-wrap gap-4">
          <div className="flex items-start gap-4">
            <button onClick={()=>navigate('/applications')} className="mt-0.5 p-2 rounded-xl text-gray-400 dark:text-gray-500 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-white dark:hover:bg-gray-800 border border-transparent hover:border-gray-200/60 dark:hover:border-gray-700/60 hover:shadow-sm transition-all">
              <ArrowLeft size={16}/>
            </button>
            <div className={`mt-0.5 flex items-center justify-center w-11 h-11 rounded-2xl flex-shrink-0 shadow-lg ring-1 ring-white/20 ${isCH1 ? 'bg-gradient-to-br from-sfpurple-500 to-sfpurple-700 shadow-sfpurple-500/30' : 'bg-gradient-to-br from-sf-500 to-sf-700 shadow-sf-500/30'}`}>
              <Package size={19} className="text-white" />
            </div>
            <div>
              <div className="flex items-center gap-3 flex-wrap mb-2">
                <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100 tracking-tight">{app.name}</h1>
                <span className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full font-semibold border shadow-lg ${statusStyle}`}>
                  <PulseDot active={isRunning}/> {rStatus || 'Unknown'}
                </span>
                <span className={`text-xs px-2.5 py-1 rounded-full font-semibold border ${isCH1?'bg-sfpurple-50 dark:bg-sfpurple-500/10 text-sfpurple-700 dark:text-sfpurple-300 border-sfpurple-200/60 dark:border-sfpurple-400/20':'bg-sf-50 dark:bg-sf-500/10 text-sf-700 dark:text-sf-300 border-sf-200/60 dark:border-sf-400/20'}`}>
                  {isCH1?'CloudHub 1.0':'CloudHub 2.0'}
                </span>
                {/* Feature 3: BG & Env context badges */}
                {bgName && (
                  <span className="text-xs px-2 py-0.5 rounded-full border bg-gray-100/70 dark:bg-gray-800/60 text-gray-500 dark:text-gray-400 border-gray-200/60 dark:border-gray-700/60">
                    🏢 {bgName}
                  </span>
                )}
                {(resolvedEnvName || app.environment?.name) && (
                  <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${
                    app.environment?.type === 'production'
                      ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-200/60 dark:border-emerald-400/20'
                      : 'bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-200/60 dark:border-amber-400/20'
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
                  <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white/70 dark:bg-gray-800/60 border border-gray-200/70 dark:border-gray-700/60">
                    <span className="animate-spin rounded-full h-3.5 w-3.5 border-b-2 border-sf-500" />
                    <span className="text-gray-500 dark:text-gray-400 text-xs">Working…</span>
                  </div>
                ) : actions.map((action) => {
                  const { Icon, label, detailCls } = ACTION_CONFIG[action];
                  return (
                    <button key={action} title={label} onClick={() => requestAction(action)}
                      className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border bg-white/70 dark:bg-gray-800/60 shadow-sm transition-all ${detailCls}`}>
                      <Icon size={13} /> {label}
                    </button>
                  );
                })}
              </div>
            )}
            {/* API Manager shortcut — pre-selects the current BG + env (+ API instance if known) */}
            <HeroActionBtn
              icon={ShieldCheck}
              label="API Manager"
              accent="sf"
              title="Open API Manager filtered to this environment"
              onClick={() => {
                localStorage.setItem('mule_apimgr_bg', orgId);
                if (envId) localStorage.setItem('mule_apimgr_env', envId);
                if (contractApiInstanceId) {
                  localStorage.setItem('mule_apimgr_instance', String(contractApiInstanceId));
                } else if (app?.name) {
                  // No instance ID yet (contracts not loaded) — pre-fill search with app name
                  // so the API Manager page auto-filters to likely matching instances.
                  localStorage.setItem('mule_apimgr_search', app.name);
                }
                navigate('/api-manager');
              }}
            />
            {/* CPS Manager shortcut — navigates with pre-selected BG+Env+App */}
            <HeroActionBtn
              icon={Database}
              label="CPS Manager"
              accent="sfteal"
              title="Open this app in CPS Manager"
              onClick={() => navigate('/cps-manager', {
                state: {
                  cpsAutoSelect: {
                    bgId: orgId,
                    envId: envId,
                    compositeId: `${appId}|${envId}|${orgId}`,
                    appName: app.name,
                  },
                },
              })}
            />
            {/* Open in Exchange button — navigates to our Exchange page and auto-selects the asset */}
            {(() => {
              const ref = app.application?.ref;
              return (
                <HeroActionBtn
                  icon={ExternalLink}
                  label="Exchange"
                  accent="emerald"
                  title="View in Exchange Assets"
                  onClick={() => navigate('/exchange', {
                    state: {
                      assetId: ref?.artifactId || app.name,
                      groupId: ref?.groupId || null,
                      version: ref?.version || null,
                      name: app.name
                    }
                  })}
                />
              );
            })()}
            {/* Open in Anypoint Platform:
                Step 1 — switch BG via home/organizations/{orgId}/
                Step 2 — navigate to env-in-path URL after 4s
                If env selector appears, the tooltip tells the user exactly which env to click. */}
            <HeroActionBtn
              icon={ExternalLink}
              label="Anypoint"
              accent="sf"
              title={
                resolvedEnvName || app.environment?.name
                  ? `Open in Anypoint Platform — app name copied to clipboard. If prompted, select "${resolvedEnvName || app.environment?.name}"`
                  : 'Open in Anypoint Platform — app name copied to clipboard'
              }
              onClick={() => {
                // Copy the app name to clipboard so the user can paste it into
                // CloudHub's search box if the env-selector page appears first.
                try { navigator.clipboard.writeText(app.name); } catch { /* non-fatal */ }
                const envName = resolvedEnvName || app.environment?.name || '';
                const envAppUrl = envId
                  ? (isCH1
                      ? `https://anypoint.mulesoft.com/cloudhub/#/console/home/${envId}/applications/cloudhub/${appId}/settings`
                      : `https://anypoint.mulesoft.com/cloudhub/#/console/home/${envId}/applications/runtimeFabric/${appId}/settings`)
                  : (isCH1
                      ? `https://anypoint.mulesoft.com/cloudhub/#/console/applications/cloudhub/${appId}/settings`
                      : `https://anypoint.mulesoft.com/cloudhub/#/console/applications/runtimeFabric/${appId}/settings`);

                if (!orgId) { window.open(envAppUrl, '_blank', 'noreferrer'); return; }

                const win = window.open(
                  `https://anypoint.mulesoft.com/home/organizations/${orgId}/`,
                  '_blank'
                );
                if (win) {
                  setTimeout(() => {
                    try { win.location.href = envAppUrl; }
                    catch { window.open(envAppUrl, '_blank', 'noreferrer'); }
                  }, 4000);
                } else {
                  window.open(envAppUrl, '_blank', 'noreferrer');
                }
              }}
            />
            <button onClick={() => load(true)} title="Refresh" className="p-2.5 rounded-xl text-gray-400 dark:text-gray-500 hover:text-gray-900 dark:hover:text-gray-100 bg-white/70 dark:bg-gray-800/60 border border-gray-200/70 dark:border-gray-700/60 hover:bg-white dark:hover:bg-gray-800 hover:shadow-md transition-all">
              <RefreshCw size={14}/>
            </button>
          </div>
        </div>
      </div>

      {/* ── Segmented Tabs ──────────────────────────── */}
      <div className="bg-white/80 dark:bg-gray-900/60 backdrop-blur-md p-1.5 rounded-2xl border border-gray-200/70 dark:border-gray-700/60 w-fit flex gap-1 shadow-sm overflow-x-auto max-w-full">
        {tabs.map(t => (
          <button key={t.id}
            onClick={() => {
            setTab(t.id);
            if (t.id === 'infrastructure' && app?._type !== 'ch1' && ch2Schedulers === null && !schedulersLoading) loadCh2Schedulers();
            if (t.id === 'cps' && !cpsData && !cpsLoading) loadCpsData();
            if (t.id === 'contracts' && contracts === null && !contractsLoading) loadContracts();
            if (t.id === 'apispec' && pingSpec === null && !pingSpecLoading) fetchPingSpec();
          }}
            className={`relative flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition-all ${tab===t.id?'bg-gradient-to-br from-sf-500 to-sf-600 text-white shadow-md shadow-sf-500/30':'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100/70 dark:hover:bg-gray-800/60'}`}>
            {t.id === 'cps' && <Key size={11} />}
            {t.id === 'ping' && <Activity size={11} />}
            {t.label}
            {t.badge && (
              <span className={`text-[10px] px-1.5 py-0.5 rounded-md font-bold ${
                t.badgeErr ? 'bg-red-100 dark:bg-red-500/20 text-red-600 dark:text-red-400' :
                t.badge === '✓' ? 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400' :
                tab===t.id ? 'bg-white/25 text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400'
              }`}>{t.badge}</span>
            )}
          </button>
        ))}
      </div>

      {/* ── OVERVIEW ────────────────────────────────── */}
      {tab==='overview' && (
        <OverviewTab
          app={app} ds={ds} isCH1={isCH1} isRunning={isRunning} rStatus={rStatus}
          replicas={replicas} replicaList={replicaList} osEnabled={osEnabled}
          httpInbound={httpInbound} endpoints={endpoints} ch2PrivateIPs={ch2PrivateIPs}
        />
      )}

      {/* ── PROPERTIES ──────────────────────────────── */}
      {tab==='properties' && (
        <PropertiesTab
          allProps={allProps}
          filteredProps={filteredProps}
          propSearch={propSearch}
          setPropSearch={setPropSearch}
          secureProps={secureProps}
        />
      )}

      {/* ── INFRA & CONFIG ───────────────────────────── */}
      {tab==='infrastructure' && (
        <InfrastructureTab
          appId={appId}
          isCH1={isCH1}
          allSchedulers={allSchedulers}
          schedulers={schedulers}
          isRunning={isRunning}
          rStatus={rStatus}
          cpsSchedulerProps={cpsSchedulerProps}
          setCpsSchedulerProps={setCpsSchedulerProps}
          cpsBaseUrl={cpsBaseUrl}
          cpsClientId={cpsClientId}
          effectiveCpsKey={effectiveCpsKey}
          effectiveCpsEnv={effectiveCpsEnv}
          orgId={orgId}
          cpsSecureSchedulerLoading={cpsSecureSchedulerLoading}
          setCpsSecureSchedulerLoading={setCpsSecureSchedulerLoading}
          triggerResult={triggerResult}
          setTriggerResult={setTriggerResult}
          schedulerSearch={schedulerSearch}
          setSchedulerSearch={setSchedulerSearch}
          allProps={allProps}
          cpsData={cpsData}
          triggerLoadingSet={triggerLoadingSet}
          setSchedulerConfirmKey={setSchedulerConfirmKey}
          toggleLoadingSet={toggleLoadingSet}
          setSchedulerToggleConfirm={setSchedulerToggleConfirm}
          selectedSchedulers={selectedSchedulers}
          setSelectedSchedulers={setSelectedSchedulers}
          setBulkSchedulerToggleConfirm={setBulkSchedulerToggleConfirm}
          setBulkSchedulerRunConfirm={setBulkSchedulerRunConfirm}
        />
      )}

      {/* ── CPS CONFIG ──────────────────────────────── */}
      {tab==='cps' && cpsBaseUrl && (
        <CpsConfigTab
          cpsData={cpsData}
          setCpsData={setCpsData}
          cpsEnv={cpsEnv}
          cpsEnvOverride={cpsEnvOverride}
          setCpsEnvOverride={setCpsEnvOverride}
          cpsKeyOverride={cpsKeyOverride}
          setCpsKeyOverride={setCpsKeyOverride}
          cpsCredsResolved={cpsCredsResolved}
          hasCpsCsvCredentials={hasCpsCsvCredentials}
          cpsBaseUrl={cpsBaseUrl}
          effectiveCpsEnv={effectiveCpsEnv}
          effectiveCpsKey={effectiveCpsKey}
          setCpsError={setCpsError}
          cpsMissingCred={cpsMissingCred}
          cpsError={cpsError}
          cpsAttemptedUrl={cpsAttemptedUrl}
          cpsLoading={cpsLoading}
          loadCpsData={loadCpsData}
          setShowCpsSettings={setShowCpsSettings}
          setRawJsonView={setRawJsonView}
          copiedCpsNs={copiedCpsNs}
          setCopiedCpsNs={setCopiedCpsNs}
          copiedCpsSec={copiedCpsSec}
          setCopiedCpsSec={setCopiedCpsSec}
          cpsSearch={cpsSearch}
          setCpsSearch={setCpsSearch}
          secureLoading={secureLoading}
          setSecureLoading={setSecureLoading}
          getAllCredentials={getAllCredentials}
          cpsDepType={cpsDepType}
          appEnvName={appEnvName}
          orgId={orgId}
          isCH1={isCH1}
        />
      )}

      {/* ── DEPENDENCIES ────────────────────────────── */}
      {tab==='dependencies' && (
        <DependenciesTab
          app={app}
          allProps={allProps}
          cpsData={cpsData}
          cpsBaseUrl={cpsBaseUrl}
          depSearch={depSearch}
          setDepSearch={setDepSearch}
          setTab={setTab}
          loadCpsData={loadCpsData}
        />
      )}

      {/* ── CONTRACTS ───────────────────────────────── */}
      {tab==='contracts' && (
        <ContractsTab
          contracts={contracts}
          contractApiInstanceId={contractApiInstanceId}
          orgId={orgId}
          envId={envId}
          navigate={navigate}
          loadContracts={loadContracts}
          contractsLoading={contractsLoading}
          contractActionResult={contractActionResult}
          setContractActionResult={setContractActionResult}
          contractsError={contractsError}
          contractActionLoading={contractActionLoading}
          setContractConfirmState={setContractConfirmState}
        />
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
          envType={app.environment?.type || ''}
          envName={resolvedEnvName || app.environment?.name || ''}
        />
      )}

      {/* ── API SPEC ────────────────────────────────── */}
      {tab==='apispec' && (
        <ApiSpecTab pingSpec={pingSpec} pingSpecLoading={pingSpecLoading} fetchPingSpec={fetchPingSpec} />
      )}

      {/* ── RAW JSON ────────────────────────────────── */}
      {tab==='raw' && (
        <GlassCard icon={Copy} title="Raw JSON">
          <PostmanJsonViewer data={app} />
        </GlassCard>
      )}
    </div>
  );
}
