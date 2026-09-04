import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { useCredentialStore } from '../context/CredentialStoreContext';
import { useCpsCredentialStore } from '../context/CpsCredentialStoreContext';
import { useNavigate } from 'react-router-dom';
import { Search, RefreshCw, ChevronRight, AlertTriangle, X, SlidersHorizontal, FileSpreadsheet, Activity, CheckCircle2, XCircle, Clock, ShieldCheck, UploadCloud, ExternalLink } from 'lucide-react';
import CredentialImportButton from '../components/CredentialImportButton';
import StatusBadge from '../components/StatusBadge';
import Select from '../components/Select';
import { applyBgFilter } from '../components/BgFilterModal';
import { applyEnvFilter } from '../components/EnvFilterModal';
import CpsExportModal from '../components/CpsExportModal';
import PingResultCard from '../components/PingResultCard';
import CopyBtn from '../components/CopyBtn';
import api from '../services/api';
import { getCachedSWR, setCached, bustCache } from '../services/apiCache';
import { CK } from '../services/cacheKeys';
import { availableActions, ACTION_CONFIG, ENV_BADGE, generateTxId } from '../utils/appUtils';
import { findOAuth2Url, flattenCpsResponse } from '../utils/cpsHelpers';

const ENV_TAG_COLOR = {
  production: 'bg-green-500/20 text-green-400',
  sandbox: 'bg-yellow-500/20 text-yellow-400'
};

/* ── Open app in Anypoint Platform ────────────────────────── */
// Opens the app in CloudHub using a 2-step approach:
//   Step 1 — Switch to the correct Business Group via the Anypoint home URL.
//   Step 2 — After the BG switch settles, navigate to the app using the
//             env-in-path URL format: /console/home/{envId}/applications/...
//             This is the canonical CloudHub URL when inside an environment.
//
// If the env selector still appears (Anypoint Platform limitation when no env
// is cached for this BG in the current browser session), the tooltip shows
// exactly which environment to click — one click lands on the app.
function openInAnypoint(e, app, fallbackBgId) {
  e.stopPropagation();
  // Copy the app name to clipboard so the user can paste it into CloudHub's
  // search box if the "Choose Environment" page appears before the app.
  try { navigator.clipboard.writeText(app.name); } catch { /* non-fatal */ }
  const orgId = app._bgId || fallbackBgId || '';
  const envId = app.environment?.id || '';

  // Env-in-path URL: this is the format Anypoint uses when you are already
  // inside an environment — it encodes the env context in the hash path.
  const envAppUrl = envId
    ? (app.deploymentType === 'CloudHub 2.0'
        ? `https://anypoint.mulesoft.com/cloudhub/#/console/home/${envId}/applications/runtimeFabric/${app.id}/settings`
        : `https://anypoint.mulesoft.com/cloudhub/#/console/home/${envId}/applications/cloudhub/${app.id}/settings`)
    : (app.deploymentType === 'CloudHub 2.0'
        ? `https://anypoint.mulesoft.com/cloudhub/#/console/applications/runtimeFabric/${app.id}/settings`
        : `https://anypoint.mulesoft.com/cloudhub/#/console/applications/cloudhub/${app.id}/settings`);

  if (!orgId) {
    window.open(envAppUrl, '_blank', 'noreferrer');
    return;
  }

  // Step 1: Switch Business Group
  const win = window.open(
    `https://anypoint.mulesoft.com/home/organizations/${orgId}/`,
    '_blank'
  );

  if (win) {
    // Step 2: After BG switch completes, navigate to the app with env in path.
    // 4s gives enough time for the BG-switch redirect chain to fully settle.
    setTimeout(() => {
      try { win.location.href = envAppUrl; }
      catch { window.open(envAppUrl, '_blank', 'noreferrer'); }
    }, 4000);
  } else {
    window.open(envAppUrl, '_blank', 'noreferrer');
  }
}

/* ── Single-app Confirm Modal ──────────────────────────────── */
function ConfirmModal({ state, onConfirm, onCancel, loading }) {
  if (!state) return null;
  const { action, app } = state;
  const { Icon, label, bulkCls } = ACTION_CONFIG[action];
  const dangerous = action === 'stop';
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6 w-full max-w-md shadow-2xl mx-4">
        <div className="flex items-start gap-4">
          <div className={`p-2.5 rounded-xl flex-shrink-0 border ${dangerous ? 'bg-red-950/60 border-red-800/40' : 'bg-blue-950/60 border-blue-800/40'}`}>
            <AlertTriangle size={18} className={dangerous ? 'text-red-400' : 'text-blue-400'} />
          </div>
          <div className="flex-1">
            <h3 className="text-white font-semibold text-base mb-1">{label} Application?</h3>
            <p className="text-gray-400 text-sm">
              Are you sure you want to <span className="font-medium text-white">{label.toLowerCase()}</span>{' '}
              <span className="font-mono text-blue-300 text-xs bg-blue-950/40 px-1.5 py-0.5 rounded">{app.name}</span>?
            </p>
            {dangerous && <p className="text-red-400/80 text-xs mt-2">⚠ This will stop all running flows and connections.</p>}
          </div>
          <button onClick={onCancel} className="text-gray-600 hover:text-gray-300 flex-shrink-0"><X size={16} /></button>
        </div>
        <div className="flex justify-end gap-3 mt-6">
          <button onClick={onCancel} disabled={loading}
            className="px-4 py-2 text-sm text-gray-400 hover:text-white bg-gray-800 hover:bg-gray-700 rounded-lg disabled:opacity-50 transition-colors">
            Cancel
          </button>
          <button onClick={onConfirm} disabled={loading}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg disabled:opacity-50 transition-colors ${bulkCls}`}>
            {loading
              ? <><span className="animate-spin rounded-full h-3.5 w-3.5 border-b-2 border-white" /> Working…</>
              : <><Icon size={13} /> Confirm {label}</>}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Bulk Confirm Modal ─────────────────────────────────────── */
function BulkConfirmModal({ state, onConfirm, onCancel, loading, results }) {
  if (!state) return null;
  const { action, apps } = state;
  const { Icon, label, bulkCls } = ACTION_CONFIG[action];
  const dangerous = action === 'stop';
  const isDone = !!results;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6 w-full max-w-lg shadow-2xl mx-4">
        <div className="flex items-start gap-4 mb-4">
          <div className={`p-2.5 rounded-xl flex-shrink-0 border ${dangerous ? 'bg-red-950/60 border-red-800/40' : 'bg-blue-950/60 border-blue-800/40'}`}>
            <AlertTriangle size={18} className={dangerous ? 'text-red-400' : 'text-blue-400'} />
          </div>
          <div className="flex-1">
            <h3 className="text-white font-semibold text-base mb-1">
              {isDone ? 'Results' : `${label} ${apps.length} Application${apps.length !== 1 ? 's' : ''}?`}
            </h3>
            {!isDone && (
              <p className="text-gray-400 text-sm">
                This will <span className="text-white font-medium">{label.toLowerCase()}</span> the following applications:
              </p>
            )}
            {dangerous && !isDone && (
              <p className="text-red-400/80 text-xs mt-1">⚠ This will stop all running flows and connections for each app.</p>
            )}
          </div>
          <button onClick={onCancel} disabled={loading} className="text-gray-600 hover:text-gray-300 flex-shrink-0">
            <X size={16} />
          </button>
        </div>

        {/* App list with per-app result indicators */}
        <div className="max-h-52 overflow-y-auto space-y-1.5 mb-5 pr-1">
          {apps.map((app) => {
            const r = results?.[app.id];
            return (
              <div key={app.id} className="flex items-center justify-between bg-gray-800/60 border border-gray-700/40 rounded-lg px-3 py-2 gap-2">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <span className={`w-2 h-2 rounded-full flex-shrink-0 ${ENV_BADGE[app.environment?.type] || 'bg-gray-400'}`} />
                  <span className="text-gray-200 text-xs font-medium truncate">{app.name}</span>
                  <span className="text-gray-600 text-xs flex-shrink-0 hidden sm:inline">({app.environment?.name})</span>
                </div>
                <div className="flex-shrink-0">
                  {r ? (
                    r.success
                      ? <span className="text-emerald-400 text-xs font-medium">✓ Done</span>
                      : <span className="text-red-400 text-xs font-medium" title={r.error}>✗ Failed</span>
                  ) : loading ? (
                    <span className="animate-spin rounded-full h-3 w-3 border-b-2 border-blue-400 block" />
                  ) : (
                    <span className="text-gray-600 text-xs">Pending</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Summary when done */}
        {isDone && (
          <div className="flex gap-3 mb-4 text-xs">
            <span className="text-emerald-400 font-medium">
              ✓ {Object.values(results).filter((r) => r.success).length} succeeded
            </span>
            {Object.values(results).filter((r) => !r.success).length > 0 && (
              <span className="text-red-400 font-medium">
                ✗ {Object.values(results).filter((r) => !r.success).length} failed
              </span>
            )}
          </div>
        )}

        <div className="flex justify-end gap-3">
          <button onClick={onCancel} disabled={loading}
            className="px-4 py-2 text-sm text-gray-400 hover:text-white bg-gray-800 hover:bg-gray-700 rounded-lg disabled:opacity-50 transition-colors">
            {isDone ? 'Close' : 'Cancel'}
          </button>
          {!isDone && (
            <button onClick={onConfirm} disabled={loading}
              className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg disabled:opacity-50 transition-colors ${bulkCls}`}>
              {loading
                ? <><span className="animate-spin rounded-full h-3.5 w-3.5 border-b-2 border-white" /> Working…</>
                : <><Icon size={13} /> {label} All {apps.length}</>}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Bulk Ping Modal ────────────────────────────────────────── */
function BulkPingModal({ apps, onClose }) {
  const navigate = useNavigate();
  const { hasCredentials, resolveFromCandidates } = useCredentialStore();
  const { getSecret: getCpsSecret, hasCredentials: hasCpsCreds } = useCpsCredentialStore();
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [transactionId, setTransactionId] = useState('smokeTest');
  const [running, setRunning] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [results, setResults] = useState({});
  const [autoResolvedMap, setAutoResolvedMap] = useState({});
  const [showSecret, setShowSecret] = useState(false);

  // ── Extract the API Manager autodiscovery ID from CPS non-secure props ───
  //
  // The team stores the autodiscovery ID in CPS non-secure properties using
  // key patterns like:
  //   <prefix>.api.id   e.g.  customer-sapi.api.id = 12345678
  //   <prefix>.id       e.g.  customer-sapi.id     = 12345678  (fallback)
  //
  // Strategy:
  //   1. Read CPS connection config (baseUrl, key, env) from the app's ARM
  //      deployment properties — same fields used by the CPS Compare page.
  //   2. Fetch CPS non-secure properties for this app.
  //   3. Find the first key ending in ".api.id" → its value is the apiId.
  //      If not found, find the first key ending in ".id" with a numeric value.
  //   4. On any failure (CPS unreachable, no CPS config) return {} so the
  //      caller falls through to fuzzy name matching (Layers 3-5).
  const fetchAppApiProps = useCallback(async (app) => {
    const bgId = app._bgId;
    const envId = app.environment?.id;
    if (!bgId || !envId) return {};

    try {
      // ── Step 1: Get ARM detail to extract CPS connection properties ────────
      let armDetail = null;
      if (app.deploymentType === 'CloudHub 2.0') {
        const r = await api.get(`/applications/cloudhub2/${bgId}/${envId}/${app.id}`);
        armDetail = r.data;
      } else {
        const r = await api.get(`/applications/cloudhub1/${envId}/${app.id}`, { params: { orgId: bgId } });
        armDetail = { name: app.name, properties: r.data?.properties || {} };
      }

      // Merge all ARM property sources (same logic as extractCpsProps in CpsComparisonPage)
      const ds = armDetail?.target?.deploymentSettings || {};
      const appCfg = armDetail?.application?.configuration || {};
      const propsSvc = appCfg['mule.agent.application.properties.service'] || {};
      const allArmProps = {
        ...armDetail?.properties,
        ...(propsSvc.properties || {}),
        ...(ds.properties || {}),
        ...(ds.environmentVariables || ds.environmentVars || {}),
      };

      const cpsBaseUrl  = allArmProps['cps.configServerBaseUrl'] || allArmProps['config.server.base.url'] || '';
      const cpsKey      = allArmProps['cps.projectName'] || allArmProps['cloudhub.api.name'] || app.name || '';
      const cpsEnv      = allArmProps['cps.prefix'] || allArmProps['cps.environment'] || '';
      const cpsClientId = allArmProps['cps.clientId'] || allArmProps['cps.client_id'] ||
                          allArmProps['cps.client.id'] || allArmProps['cps.apiClientId'] || '';

      if (!cpsBaseUrl || !cpsKey) return {}; // no CPS config → skip

      // ── Step 2a: Post CPS credentials to backend session ──────────────────
      // Without this step the CPS fetch returns 422 for apps whose CPS
      // server requires OAuth. Mirror the logic in CpsComparisonPage.
      if (cpsClientId && hasCpsCreds) {
        const secret = getCpsSecret(cpsClientId);
        if (secret) {
          try {
            const credKey = `${cpsBaseUrl.trim().replace(/\/+$/, '').replace(/\/api\/v2\/?$/, '')}::${bgId}`;
            await api.post('/cps/credentials', {
              credentials: { [credKey]: { clientId: cpsClientId, clientSecret: secret } },
            });
          } catch { /* non-fatal — CPS fetch will fail with 422 if creds are wrong */ }
        }
      }

      // ── Step 2b: Fetch CPS non-secure properties ──────────────────────────
      const cpsRes = await api.get('/cps/fetch', {
        params: {
          baseUrl: cpsBaseUrl,
          type: 'non-secure',
          keys: cpsKey,
          ...(cpsEnv && { environment: cpsEnv }),
          bgOrgId: bgId,
        },
      });

      // Flatten the CPS response to a plain {key: value} map
      const data = cpsRes.data;
      let cpsProps = {};
      if (Array.isArray(data?.responses)) {
        data.responses.forEach(r => Object.assign(cpsProps, r.properties || {}));
      } else if (Array.isArray(data)) {
        data.forEach(r => { if (r?.properties) Object.assign(cpsProps, r.properties); });
        if (Object.keys(cpsProps).length === 0 && typeof data[0] !== 'object') cpsProps = {};
      } else if (data && typeof data === 'object') {
        const firstVal = Object.values(data)[0];
        cpsProps = (firstVal && typeof firstVal === 'object') ?
          Object.values(data).reduce((m, v) => (v && typeof v === 'object' ? Object.assign(m, v) : m), {}) :
          data;
      }

      // ── Step 3: Find the autodiscovery ID ─────────────────────────────────
      const cpsKeys = Object.keys(cpsProps);
      //console.log(`[fetchAppApiProps] ${app.name} — CPS keys: [${cpsKeys.join(', ')}]`);

      // Priority 1: exact key "api.id"
      if ('api.id' in cpsProps) {
        const val = String(cpsProps['api.id']).trim();
        if (val && /^\d+$/.test(val)) {
          console.log(`[fetchAppApiProps] ${app.name} — found apiId via exact "api.id": ${val}`);
          return { apiId: val };
        }
      }

      // Priority 2: key ending with ".api.id"  →  e.g. customer-sapi.api.id
      const dotApiIdEntry = Object.entries(cpsProps).find(([k]) => k.endsWith('.api.id'));
      if (dotApiIdEntry) {
        const val = String(dotApiIdEntry[1]).trim();
        if (val && /^\d+$/.test(val)) {
          console.log(`[fetchAppApiProps] ${app.name} — found apiId via "${dotApiIdEntry[0]}": ${val}`);
          return { apiId: val };
        }
      }

      // Priority 3: key ending with ".id" whose value is purely numeric
      // e.g.  sapi-workday-ar-refunds.id = 12345678
      // (Numeric-only check avoids matching client.id, secret.id which hold UUIDs)
      const dotIdEntry = Object.entries(cpsProps).find(([k, v]) =>
        k.endsWith('.id') && /^\d+$/.test(String(v).trim())
      );
      if (dotIdEntry) {
        const val = String(dotIdEntry[1]).trim();
        console.log(`[fetchAppApiProps] ${app.name} — found apiId via "${dotIdEntry[0]}": ${val}`);
        return { apiId: val };
      }

      // Priority 4: bare "id" key with numeric value
      // (handles case where CPS flattening strips the group-name prefix)
      if ('id' in cpsProps) {
        const val = String(cpsProps['id']).trim();
        if (/^\d+$/.test(val)) {
          console.log(`[fetchAppApiProps] ${app.name} — found apiId via bare "id": ${val}`);
          return { apiId: val };
        }
      }

      console.log(`[fetchAppApiProps] ${app.name} — no matching id key found in CPS props, falling back to fuzzy match`);
      return {}; // no autodiscovery ID found in CPS — use fuzzy matching
    } catch (err) {
      console.warn(`[fetchAppApiProps] ${app.name} — error fetching CPS: ${err.message}`);
      return {};
    }
  }, []);

  // Resolve credentials from API Manager + CSV sheet for each app (in parallel).
  // Strategy (in priority order):
  //   1. Fetch app's Autodiscovery api.id → pass to backend for direct lookup (Layer 1)
  //   2. Pass assetId if found → backend uses it for filtered search (Layer 2)
  //   3. Backend falls back to paginated fuzzy name search (Layers 3-5)
  const resolveAllCredentials = useCallback(async () => {
    if (!hasCredentials || clientId.trim()) return {};
    const settled = await Promise.allSettled(
      apps.map(async (app) => {
        const bgId = app._bgId;
        const envId = app.environment?.id;
        if (!bgId || !envId) return null;
        try {
          // Fetch Autodiscovery properties (api.id) in parallel with cred resolution
          const { apiId, assetId } = await fetchAppApiProps(app);

          const { data } = await api.post('/health/auto-credentials', {
            orgId: bgId,
            envId,
            appName: app.name,
            ...(apiId   && { apiId }),    // Layer 1: direct instance lookup
            ...(assetId && { assetId }),  // Layer 2: asset-filtered search
          });
          if (data.found && data.matchInfo?.length > 0) {
            const matched = resolveFromCandidates(data.matchInfo.map(m => m.clientId));
            if (matched) {
              const meta = data.matchInfo.find(m => m.clientId === matched.clientId);
              return {
                appId: app.id,
                ...matched,
                apiInstanceName: meta?.apiInstanceName || '—',
                contractApp: meta?.contractApp || '—',
                resolvedLayer: data.resolvedLayer,
                source: 'csv',
              };
            }
            // CSV lookup failed — try auto-contract-creds as fallback
            const apiInstanceId = data.matchedApis?.[0]?.id;
            if (apiInstanceId) {
              try {
                const contractRes = await api.post('/health/auto-contract-creds', {
                  orgId: bgId, envId, apiId: apiInstanceId,
                  envType: app.environment?.type || '',
                });
                const cd = contractRes.data;
                // Only use credentials if the contract is APPROVED.
                // If pending, do NOT ping with these creds — the API will reject them.
                if (cd.clientId && cd.clientSecret && cd.contractStatus === 'approved') {
                  return {
                    appId: app.id,
                    clientId: cd.clientId,
                    clientSecret: cd.clientSecret,
                    apiInstanceName: data.matchedApis[0]?.label || '—',
                    contractApp: cd.appName || '—',
                    resolvedLayer: 'contract',
                    contractStatus: cd.contractStatus,
                    source: 'contract',
                  };
                }
                // Contract is pending — mark app as skipped so the ping is NOT run
                if (cd.contractStatus === 'pending') {
                  console.log(`[BulkPing] Contract pending for ${app.name} (app: ${cd.appName}) — skipping ping`);
                  return {
                    appId: app.id,
                    clientId: null,
                    clientSecret: null,
                    apiInstanceId: apiInstanceId,  // saved for retry after approval
                    contractApp: cd.appName || '—',
                    apiInstanceName: data.matchedApis[0]?.label || '—',
                    source: 'contract-pending',
                    contractStatus: 'pending',
                  };
                }
              } catch { /* contract fallback failed — skip */ }
            }
          }
          return null;
        } catch { return null; }
      })
    );
    const resolved = {};
    settled.forEach(r => { if (r.status === 'fulfilled' && r.value) resolved[r.value.appId] = r.value; });
    return resolved;
  }, [hasCredentials, resolveFromCandidates, apps, clientId, fetchAppApiProps]);

  const runAll = async () => {
    setRunning(false);
    setResults({});
    setAutoResolvedMap({});

    // Step 1: auto-resolve credentials in parallel for all apps
    let resolvedCreds = {};
    if (hasCredentials && !clientId.trim()) {
      setResolving(true);
      resolvedCreds = await resolveAllCredentials();
      setAutoResolvedMap(resolvedCreds);
      setResolving(false);
    }

    setRunning(true);
    const collectedResults = {};

    // ── Auto-fetch JWT for a single app (CPS non-secure → secure scan) ──────
    const fetchJwtForApp = async (app, appClientId, appClientSecret) => {
      if (!appClientId || !appClientSecret) return null;
      const bgId = app._bgId;
      const envId = app.environment?.id;
      try {
        let cpsBaseUrl = '', cpsKey = '', cpsEnv = '';
        try {
          const r = await api.get(`/applications/cloudhub2/${bgId}/${envId}/${app.id}`);
          const ds = r.data?.target?.deploymentSettings || {};
          const appCfg = r.data?.application?.configuration || {};
          const ps = appCfg['mule.agent.application.properties.service'] || {};
          const rp = { ...r.data?.properties, ...(ps.properties || {}), ...(ds.runtimeProperties || {}), ...(ds.properties || {}), ...(ds.environmentVariables || {}) };
          cpsBaseUrl = rp['cps.configServerBaseUrl'] || rp['config.server.base.url'] || '';
          cpsKey = rp['cps.projectName'] || rp['cloudhub.api.name'] || app.name;
          cpsEnv = rp['cps.prefix'] || rp['cps.environment'] || '';
        } catch { return null; }
        if (!cpsBaseUrl || !cpsKey) return null;
        let tokenUrl = null;
        try {
          const nsRes = await api.get('/cps/fetch', { params: { baseUrl: cpsBaseUrl, type: 'non-secure', keys: cpsKey, ...(cpsEnv && { environment: cpsEnv }), bgOrgId: bgId } });
          const nsProps = flattenCpsResponse(nsRes.data);
          tokenUrl = findOAuth2Url(nsProps) || null;
          if (!tokenUrl) {
            // Scan ALL secure keys for an OAuth2 token URL (not just jwt/auth named keys)
            const secKeys = (nsProps['cps.secure.properties'] || '').split(',').map(k => k.trim()).filter(Boolean);
            if (secKeys.length > 0) {
              const sr = await api.get('/cps/fetch', { params: { baseUrl: cpsBaseUrl, type: 'secure', keys: secKeys.join(','), ...(cpsEnv && { environment: cpsEnv }), bgOrgId: bgId } });
              const groups = Array.isArray(sr.data?.responses) ? sr.data.responses : Array.isArray(sr.data) ? sr.data : [];
              for (const g of groups) { const u = findOAuth2Url(g.properties || {}); if (u) { tokenUrl = u; break; } }
            }
          }
        } catch { return null; }
        if (!tokenUrl) return null;
        const tr = await api.post('/health/oauth2-token', { tokenUrl, clientId: appClientId, clientSecret: appClientSecret });
        return tr.data?.access_token || null;
      } catch { return null; }
    };

    /**
     * Ping a single app and return its result.
     * Fetches CH2 ingress URL on-demand, uses resolved or manual credentials.
     * If initial ping returns 4xx and CPS is configured, auto-fetches JWT and retries.
     */
    const pingApp = async (app) => {
      const isCH1 = app.deploymentType !== 'CloudHub 2.0';
      let ch2IngressUrl = undefined;

      if (!isCH1 && app._bgId && app.environment?.id && app.id) {
        try {
          const detail = await api.get(`/applications/cloudhub2/${app._bgId}/${app.environment.id}/${app.id}`);
          const ds = detail.data?.target?.deploymentSettings || {};
          const httpInbound = ds.http?.inbound || {};
          const endpoints = httpInbound.endpoints || [];
          ch2IngressUrl =
            httpInbound.publicUrl ||
            endpoints.find(e => e.access === 'external')?.url ||
            endpoints[0]?.url ||
            undefined;
        } catch {}
      }

      const auto = resolvedCreds[app.id];

      // Skip ping entirely for apps with a pending contract approval
      if (auto?.source === 'contract-pending') {
        return {
          appId: app.id,
          result: {
            status: 'SKIPPED_CONTRACT_PENDING',
            error: `Contract pending approval for "${auto.contractApp}". Approve in API Manager, then use the Retry button.`,
            contractApp: auto.contractApp,
            apiInstanceId: auto.apiInstanceId,
          },
        };
      }

      const useClientId     = clientId.trim()     || auto?.clientId     || undefined;
      const useClientSecret = clientSecret.trim() || auto?.clientSecret || undefined;

      try {
        const { data } = await api.post('/health/ping', {
          targetType: isCH1 ? 'CH1' : 'CH2',
          appName: app.name,
          ch2IngressUrl,
          clientId: useClientId,
          clientSecret: useClientSecret,
          transactionId: transactionId.trim() && transactionId.trim() !== 'smokeTest' ? transactionId.trim() : generateTxId(),
          envType: app.environment?.type || '',
          envName: app.environment?.name || '',
        });

        // If ping returned 4xx (PARTIAL), try auto-fetching JWT and retrying
        if (data.status === 'PARTIAL' && data.httpStatus >= 400 && data.httpStatus < 500 && !isCH1) {
          const jwt = await fetchJwtForApp(app, useClientId, useClientSecret);
          if (jwt) {
            try {
              const jwtData = await api.post('/health/ping', {
                targetType: 'CH2',
                appName: app.name,
                ch2IngressUrl,
                bearerToken: jwt,
                transactionId: transactionId.trim() && transactionId.trim() !== 'smokeTest' ? transactionId.trim() : generateTxId(),
                envType: app.environment?.type || '',
                envName: app.environment?.name || '',
              });
              return { appId: app.id, result: { ...jwtData.data, _jwtUsed: true } };
            } catch { /* fall through to original result */ }
          }
        }

        return { appId: app.id, result: data };
      } catch (err) {
        return { appId: app.id, result: { status: 'FAILED', error: err.message } };
      }
    };

    // Run pings in parallel batches of 10 to balance speed vs rate limiting.
    // 100 apps → ~10 batches × ~5s avg = ~50s total (vs ~500s sequential).
    const BATCH_SIZE = 10;
    for (let i = 0; i < apps.length; i += BATCH_SIZE) {
      const batch = apps.slice(i, i + BATCH_SIZE);
      const batchResults = await Promise.allSettled(batch.map(pingApp));
      batchResults.forEach(r => {
        if (r.status === 'fulfilled') {
          const { appId, result } = r.value;
          collectedResults[appId] = result;
          setResults(prev => ({ ...prev, [appId]: result }));
        }
      });
    }

    setRunning(false);
    // Navigate to Ping Test Results page with full results + auto-resolved credential info
    navigate('/ping-test', { state: { preloadedResults: collectedResults, preloadedApps: apps, autoResolvedMap: resolvedCreds } });
    onClose();
  };

  const done = Object.keys(results).length;
  const success = Object.values(results).filter(r => r.status === 'SUCCESS').length;
  const partial = Object.values(results).filter(r => r.status === 'PARTIAL').length;
  const failed = Object.values(results).filter(r => r.status === 'FAILED').length;

  const latencyColor = ms => !ms ? 'text-gray-500' : ms < 300 ? 'text-green-400' : ms < 1000 ? 'text-yellow-400' : 'text-red-400';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-2xl shadow-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800 flex-shrink-0">
          <div className="flex items-center gap-3">
            <Activity size={16} className="text-cyan-400" />
            <span className="text-white font-semibold">Bulk Ping Test</span>
            <span className="text-xs text-gray-500 bg-gray-800 px-2 py-0.5 rounded-full">{apps.length} apps</span>
          </div>
          <div className="flex items-center gap-3">
            <CredentialImportButton compact />
            <button onClick={onClose} className="text-gray-500 hover:text-gray-300"><X size={16} /></button>
          </div>
        </div>

        {/* Credential inputs */}
        <div className="px-6 py-4 border-b border-gray-800 flex-shrink-0 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="text-[10px] text-gray-500 uppercase tracking-wider font-medium block mb-1">
                client_id <span className="normal-case text-gray-600">(overrides auto)</span>
              </label>
              <input value={clientId} onChange={e => setClientId(e.target.value)} placeholder="leave blank to auto-resolve"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-xs text-gray-200 font-mono focus:outline-none focus:border-cyan-600/50" />
            </div>
            <div>
              <label className="text-[10px] text-gray-500 uppercase tracking-wider font-medium block mb-1">client_secret</label>
              <div className="relative">
                <input value={clientSecret} onChange={e => setClientSecret(e.target.value)} type={showSecret ? 'text' : 'password'} placeholder="optional"
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 pr-8 text-xs text-gray-200 font-mono focus:outline-none focus:border-cyan-600/50" />
                <button onClick={() => setShowSecret(!showSecret)} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 text-xs">{showSecret ? '🙈' : '👁'}</button>
              </div>
            </div>
            <div>
              <label className="text-[10px] text-gray-500 uppercase tracking-wider font-medium block mb-1">x-transaction-id</label>
              <input value={transactionId} onChange={e => setTransactionId(e.target.value)} placeholder="smokeTest"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-xs text-gray-200 font-mono focus:outline-none focus:border-cyan-600/50" />
            </div>
          </div>
          {/* Credential import status */}
          {hasCredentials && !clientId.trim() && (
            <div className="flex items-center gap-1.5 text-[10px] text-emerald-400/80">
              <ShieldCheck size={10} />
              Credentials CSV loaded — will auto-resolve per app from API Manager
            </div>
          )}
        </div>

        {/* Resolving banner */}
        {resolving && (
          <div className="px-6 py-2 border-b border-gray-800 flex items-center gap-2 text-xs text-emerald-400 flex-shrink-0">
            <RefreshCw size={11} className="animate-spin" />
            Resolving credentials from API Manager…
          </div>
        )}

        {/* Progress summary */}
        {done > 0 && (
          <div className="px-6 py-3 border-b border-gray-800 flex items-center gap-4 text-xs flex-shrink-0">
            <span className="text-gray-500">{done}/{apps.length} tested</span>
            {success > 0 && <span className="text-green-400 font-medium">✓ {success} healthy</span>}
            {partial > 0 && <span className="text-yellow-400 font-medium">~ {partial} partial</span>}
            {failed > 0 && <span className="text-red-400 font-medium">✗ {failed} failed</span>}
            {Object.keys(autoResolvedMap).length > 0 && (
              <span className="flex items-center gap-1 text-emerald-400/70 font-medium">
                <ShieldCheck size={10} />{Object.keys(autoResolvedMap).length} auto-creds
              </span>
            )}
          </div>
        )}

        {/* Results list — each app gets a full PingResultCard */}
        <div className="overflow-y-auto flex-1 p-4 space-y-3">
          {apps.map(app => (
            <PingResultCard
              key={app.id}
              app={app}
              result={results[app.id]}
              loading={running && !results[app.id]}
              autoResolved={autoResolvedMap[app.id]}
            />
          ))}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-800 flex items-center justify-between flex-shrink-0">
          <p className="text-gray-600 text-xs">Pings /api/v1/ping → /api/v2/ping → /api/ping → /ping in order</p>
          <div className="flex items-center gap-3">
            <button onClick={onClose} className="px-4 py-2 text-sm text-gray-400 hover:text-white bg-gray-800 rounded-lg">Close</button>
            <button onClick={runAll} disabled={running || resolving}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-cyan-700 hover:bg-cyan-600 disabled:opacity-50 text-white rounded-lg">
              {resolving ? <><RefreshCw size={13} className="animate-spin" /> Resolving…</> : running ? <><RefreshCw size={13} className="animate-spin" /> Running…</> : <><Activity size={13} /> Run All Pings</>}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Standalone fetch helper used by the SWR background-refresh path in loadApps.
 * Fetches apps + envs for the given BG IDs, merges them, stores in cache,
 * and returns { mergedApps, mergedEnvs }.
 * Does NOT touch any React state — callers apply the result themselves.
 */
async function _fetchAndCacheApps(bgId, bgIds, cacheKey) {
  const [appsResults, envsResults] = await Promise.all([
    Promise.allSettled(bgIds.map((id) => api.get(`/applications/summary/${id}`))),
    Promise.allSettled(bgIds.map((id) => api.get(`/environments/${id}`))),
  ]);

  const mergedApps = [];
  const mergedEnvs = [];
  const seenApps = new Set();
  const seenEnvs = new Set();

  appsResults.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      (r.value.data.data || []).forEach((a) => {
        const key = `${a.id}|${a.environment?.id || ''}`;
        if (!seenApps.has(key)) { seenApps.add(key); mergedApps.push({ ...a, _bgId: bgIds[i] }); }
      });
    }
  });
  envsResults.forEach((r) => {
    if (r.status === 'fulfilled') {
      (r.value.data.data || []).forEach((e) => {
        if (!seenEnvs.has(e.id)) { seenEnvs.add(e.id); mergedEnvs.push(e); }
      });
    }
  });

  // Refresh the cache entry with a 3-min freshness window
  setCached(cacheKey, { apps: mergedApps, envs: mergedEnvs }, 3 * 60 * 1000);
  return { mergedApps, mergedEnvs };
}

export default function ApplicationsPage() {
  const { orgId } = useAuth();
  const navigate = useNavigate();

  const [allBusinessGroups, setAllBusinessGroups] = useState([]);
  // Persist BG selection in localStorage so it survives navigation
  const [selectedBg, setSelectedBg] = useState(
    () => localStorage.getItem('mule_dashboard_selected_bg') || ''
  );
  // Keep localStorage in sync whenever selectedBg changes
  useEffect(() => {
    if (selectedBg) localStorage.setItem('mule_dashboard_selected_bg', selectedBg);
  }, [selectedBg]);
  const [environments, setEnvironments] = useState([]);
  const [apps, setApps] = useState([]);
  const [loading, setLoading] = useState(false);
  const [bgLoading, setBgLoading] = useState(true);
  const [search, setSearch] = useState('');
  // Persist selected environment across navigation (like selectedBg)
  const [filterEnv, setFilterEnv] = useState(
    () => localStorage.getItem('mule_dashboard_filter_env') || ''
  );
  useEffect(() => {
    if (filterEnv) localStorage.setItem('mule_dashboard_filter_env', filterEnv);
    else localStorage.removeItem('mule_dashboard_filter_env');
  }, [filterEnv]);
  useEffect(() => {
    if (!filterEnv || environments.length === 0) return;
    if (!environments.some(e => e.id === filterEnv)) setFilterEnv('');
  }, [environments]);
  // Persist status and type filters
  const [filterStatus, setFilterStatus] = useState(
    () => localStorage.getItem('mule_dashboard_filter_status') || ''
  );
  useEffect(() => {
    if (filterStatus) localStorage.setItem('mule_dashboard_filter_status', filterStatus);
    else localStorage.removeItem('mule_dashboard_filter_status');
  }, [filterStatus]);
  const [filterType, setFilterType] = useState(
    () => localStorage.getItem('mule_dashboard_filter_type') || ''
  );
  useEffect(() => {
    if (filterType) localStorage.setItem('mule_dashboard_filter_type', filterType);
    else localStorage.removeItem('mule_dashboard_filter_type');
  }, [filterType]);
  // ── Env filter version ────────────────────────────────────────────────────
  // Increments whenever the EnvFilterModal saves a new selection to localStorage.
  // This triggers the `filtered` useMemo to re-run and pick up the new filter.
  const [envFilterVersion, setEnvFilterVersion] = useState(0);
  const [bgFilterVersion, setBgFilterVersion] = useState(0); // eslint-disable-line no-unused-vars
  useEffect(() => {
    const handler = () => setEnvFilterVersion(v => v + 1);
    window.addEventListener('envFilterChanged', handler);
    return () => window.removeEventListener('envFilterChanged', handler);
  }, []);
  useEffect(() => {
    const handler = () => setBgFilterVersion(v => v + 1);
    window.addEventListener('bgFilterChanged', handler);
    return () => window.removeEventListener('bgFilterChanged', handler);
  }, []);

  const [error, setError] = useState('');
  const [showExport, setShowExport] = useState(false);
  const [showBulkPing, setShowBulkPing] = useState(false);

  // Single-app action states
  const [actionLoading, setActionLoading] = useState({});
  const [confirmState, setConfirmState] = useState(null);
  const [actionResult, setActionResult] = useState(null);

  // Multi-select states
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [bulkConfirm, setBulkConfirm] = useState(null);
  const [bulkLoading, setBulkLoading] = useState(false);
  const [bulkResults, setBulkResults] = useState(null);

  // CSV upload state — matched app names from uploaded file
  const [csvMatchedNames, setCsvMatchedNames] = useState(null); // null = not uploaded
  const [csvFileName, setCsvFileName] = useState('');
  const csvInputRef = useRef(null);
  // Feature 1: column sort state
  const [sortColumn, setSortColumn] = useState('');
  const [sortDir, setSortDir]       = useState('asc');

  const handleSort = (col) => {
    if (sortColumn === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortColumn(col); setSortDir('asc'); }
  };

  const SortIcon = ({ col }) => {
    if (sortColumn !== col) return <span className="text-gray-700 ml-0.5">⇅</span>;
    return <span className="text-blue-400 ml-0.5">{sortDir === 'asc' ? '↑' : '↓'}</span>;
  };

  const handleCsvUpload = useCallback((e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCsvFileName(file.name);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target.result || '';
      const lines = text.split(/\r?\n/).filter(Boolean);
      if (lines.length === 0) { setCsvMatchedNames([]); return; }
      const header = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, '').toLowerCase());
      const nameColIdx = header.findIndex(h => ['appname', 'name', 'domain', 'application'].includes(h));
      let rawNames;
      if (nameColIdx >= 0) {
        rawNames = lines.slice(1).map(l => l.split(',')[nameColIdx]?.trim().replace(/^"|"$/g, '')).filter(Boolean);
      } else {
        rawNames = lines.map(l => l.split(',')[0]?.trim().replace(/^"|"$/g, '')).filter(Boolean);
      }
      const normalised = rawNames.map(n => n.toLowerCase());
      setCsvMatchedNames(normalised);

      // Auto-select matched apps
      setApps(current => {
        const matched = current.filter(a =>
          normalised.some(n => a.name.toLowerCase().includes(n) || n.includes(a.name.toLowerCase()))
        );
        setSelectedIds(new Set(matched.map(a => a.id)));
        return current;
      });
    };
    reader.readAsText(file);
    e.target.value = '';
  }, []);

  useEffect(() => { if (orgId) loadBusinessGroups(); }, [orgId]);
  // Only re-load when selectedBg changes AND BGs are already loaded.
  // On initial mount, loadBusinessGroups calls loadApps directly with fresh BGs,
  // so this effect should only fire for subsequent user-driven BG changes.
  useEffect(() => {
    if (selectedBg && allBusinessGroups.length > 0) loadApps(selectedBg);
  }, [selectedBg]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setSelectedIds(new Set()); }, [selectedBg]);

  const loadBusinessGroups = async () => {
    setBgLoading(true);
    try {
      const cacheKey = CK.bgs(orgId);
      const swr = getCachedSWR(cacheKey);
      if (swr) {
        // Render instantly from cache (stale or fresh) — no spinner shown
        setAllBusinessGroups(swr.data);
        const savedBg = localStorage.getItem('mule_dashboard_selected_bg');
        const isValidSaved = savedBg && (savedBg === '__all__' || swr.data.some(g => g.id === savedBg));
        const newBg = isValidSaved ? savedBg : '__all__';
        setSelectedBg(newBg);
        setBgLoading(false);
        await loadApps(newBg, false, swr.data);
        // If stale, silently refresh in background without blocking the UI
        if (swr.stale) {
          api.get('/organizations/business-groups')
            .then(r => {
              const fresh = r.data.data || [];
              setCached(cacheKey, fresh, 30 * 60 * 1000);
              setAllBusinessGroups(fresh);
            })
            .catch(() => {});
        }
        return;
      }
      const res = await api.get('/organizations/business-groups');
      const groups = res.data.data || [];
      // BGs rarely change — store with a 30-min eviction window
      setCached(cacheKey, groups, 30 * 60 * 1000);
      setAllBusinessGroups(groups);
      const savedBg = localStorage.getItem('mule_dashboard_selected_bg');
      const isValidSaved = savedBg && (savedBg === '__all__' || groups.some(g => g.id === savedBg));
      const newBg = isValidSaved ? savedBg : '__all__';
      setSelectedBg(newBg);
      // Call loadApps with fresh BGs directly — avoids stale allBusinessGroups closure
      await loadApps(newBg, false, groups);
    } catch { setSelectedBg(orgId); }
    setBgLoading(false);
  };

  const loadApps = async (bgId, forceRefresh = false, bgsOverride) => {
    // bgsOverride: pass fresh BGs when called directly from loadBusinessGroups
    // to avoid stale closure when allBusinessGroups state hasn't updated yet
    const visible = applyBgFilter(bgsOverride || allBusinessGroups);
    const bgIds = bgId === '__all__'
      ? (visible.length > 0 ? visible.map(g => g.id) : [orgId])
      : [bgId];

    // ── Frontend cache — SWR (stale-while-revalidate) ────────────────────────
    // Render instantly from any usable cached value, then silently re-fetch
    // in the background when the entry is older than FRESH_MS (3 min).
    if (!forceRefresh) {
      const cacheKey = CK.apps(bgId, bgIds);
      const swr = getCachedSWR(cacheKey);
      if (swr) {
        setApps(swr.data.apps);
        setEnvironments(swr.data.envs);
        setError(swr.data.apps.length === 0 ? 'No applications found.' : '');
        setSelectedIds(new Set());
        if (swr.stale) {
          // Background refresh — no loading spinner, UI stays responsive
          _fetchAndCacheApps(bgId, bgIds, cacheKey).then(({ mergedApps, mergedEnvs }) => {
            setApps(mergedApps);
            setEnvironments(mergedEnvs);
            if (mergedApps.length === 0) setError('No applications found.');
          }).catch(() => {});
        }
        return; // instant — no network call blocks the UI
      }
    }
    // ─────────────────────────────────────────────────────────────────────────

    setLoading(true);
    setError('');
    setSelectedIds(new Set());
    try {
      const params = forceRefresh ? { params: { refresh: 'true' } } : {};
      const [appsResults, envsResults] = await Promise.all([
        Promise.allSettled(bgIds.map(id => api.get(`/applications/summary/${id}`, params))),
        Promise.allSettled(bgIds.map(id => api.get(`/environments/${id}`))),
      ]);

      const mergedApps = [];
      const mergedEnvs = [];
      const seenApps = new Set();
      const seenEnvs = new Set();

      appsResults.forEach((r, i) => {
        if (r.status === 'fulfilled') {
          (r.value.data.data || []).forEach(a => {
            const key = `${a.id}|${a.environment?.id || ''}`;
            if (!seenApps.has(key)) { seenApps.add(key); mergedApps.push({ ...a, _bgId: bgIds[i] }); }
          });
        }
      });
      envsResults.forEach(r => {
        if (r.status === 'fulfilled') {
          (r.value.data.data || []).forEach(e => {
            if (!seenEnvs.has(e.id)) { seenEnvs.add(e.id); mergedEnvs.push(e); }
          });
        }
      });

      setApps(mergedApps);
      setEnvironments(mergedEnvs);
      if (mergedApps.length === 0) setError('No applications found.');

      // Store in frontend cache — 3-min freshness window (app status changes often)
      const cacheKey = CK.apps(bgId, bgIds);
      setCached(cacheKey, { apps: mergedApps, envs: mergedEnvs }, 3 * 60 * 1000);
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to load applications.');
      setApps([]);
    }
    setLoading(false);
  };

  /* ── Single-app action ─────────────────────────────── */
  const requestAction = (e, app, action) => {
    e.stopPropagation();
    setActionResult(null);
    setConfirmState({ app, action });
  };

  const executeAction = async () => {
    if (!confirmState) return;
    const { app, action } = confirmState;
    setActionLoading((prev) => ({ ...prev, [app.id]: action }));
    try {
      const isCH2 = app.deploymentType === 'CloudHub 2.0';
      const envId = app.environment?.id;
      const appBgId = app._bgId || (selectedBg !== '__all__' ? selectedBg : orgId);
      if (isCH2) {
        await api.post(`/applications/cloudhub2/${appBgId}/${envId}/${app.id}/action`, { action });
      } else {
        await api.post(`/applications/cloudhub1/${envId}/${app.id}/action?orgId=${appBgId}`, { action });
      }
      const nextStatus = action === 'start' ? 'RUNNING' : action === 'stop' ? 'STOPPED' : 'DEPLOYING';
      setApps((prev) => prev.map((a) => a.id === app.id ? { ...a, status: nextStatus } : a));
      bustCache(CK.PREFIX.apps); // invalidate cached lists so Refresh picks up real status
      setActionResult({ success: true, message: `✓ ${app.name}: ${action} initiated` });
    } catch (e) {
      setActionResult({ success: false, message: `✗ Failed to ${action} ${app.name}: ${e.response?.data?.error || e.message}` });
    } finally {
      setActionLoading((prev) => ({ ...prev, [app.id]: null }));
      setConfirmState(null);
      setTimeout(() => setActionResult(null), 6000);
    }
  };

  /* ── Multi-select ──────────────────────────────────── */
  const filtered = useMemo(() => {
    // Env filter modal: build a Set of visible env IDs from localStorage.
    // Called inside the memo so it always reads the current localStorage value
    // when envFilterVersion changes (i.e. after the modal saves).
    const visEnvIds = new Set(applyEnvFilter(environments).map(e => e.id));
    const envModalActive = environments.length > 0 && visEnvIds.size < environments.length;

    return apps.filter((a) => {
      // If env filter modal is active, only show apps whose environment is visible
      if (envModalActive && !visEnvIds.has(a.environment?.id)) return false;
      const matchSearch = !search || a.name?.toLowerCase().includes(search.toLowerCase());
      const matchEnv = !filterEnv || a.environment?.id === filterEnv;
      const matchStatus = !filterStatus || (a.status || '').toUpperCase() === filterStatus.toUpperCase();
      const matchType = !filterType || a.deploymentType === filterType;
      return matchSearch && matchEnv && matchStatus && matchType;
    });
  }, [apps, environments, search, filterEnv, filterStatus, filterType, envFilterVersion]);

  const allSelected = filtered.length > 0 && filtered.every((a) => selectedIds.has(a.id));
  const someSelected = !allSelected && filtered.some((a) => selectedIds.has(a.id));
  // selectedApps is derived from ALL loaded apps (not just filtered) so that
  // selections persist when the user changes env/status/type/search filters.
  // This allows selecting apps from multiple environments and pinging them all.
  const selectedApps = apps.filter((a) => selectedIds.has(a.id));

  // Feature 2: status summary counts from current filtered set
  const statusSummary = useMemo(() => {
    const c = {};
    filtered.forEach(a => { const s = (a.status || 'UNKNOWN').toUpperCase(); c[s] = (c[s] || 0) + 1; });
    return c;
  }, [filtered]);

  // Feature 7: status counts from ALL loaded apps (for filter dropdown badges)
  const statusCountsAll = useMemo(() => {
    const c = {};
    apps.forEach(a => { const s = (a.status || 'UNKNOWN').toUpperCase(); c[s] = (c[s] || 0) + 1; });
    return c;
  }, [apps]);

  // Selected rows float to the top, then apply column sort (Feature 1)
  const displayFiltered = useMemo(() => {
    let result = selectedIds.size === 0 ? [...filtered] : [...filtered].sort((a, b) => {
      const aS = selectedIds.has(a.id) ? 0 : 1;
      const bS = selectedIds.has(b.id) ? 0 : 1;
      return aS - bS;
    });
    if (sortColumn) {
      const getValue = (a) => {
        if (sortColumn === 'name')         return (a.name || '').toLowerCase();
        if (sortColumn === 'status')       return (a.status || '').toLowerCase();
        if (sortColumn === 'environment')  return (a.environment?.name || '').toLowerCase();
        if (sortColumn === 'type')         return (a.deploymentType || '').toLowerCase();
        if (sortColumn === 'muleVersion')  return (a.muleVersion || '').toLowerCase();
        if (sortColumn === 'lastModified') return a.lastModifiedDate || '';
        return '';
      };
      result.sort((a, b) => {
        const cmp = String(getValue(a)).localeCompare(String(getValue(b)));
        return sortDir === 'asc' ? cmp : -cmp;
      });
    }
    return result;
  }, [filtered, selectedIds, sortColumn, sortDir]);

  const toggleRow = (e, appId) => {
    e.stopPropagation();
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(appId) ? next.delete(appId) : next.add(appId);
      return next;
    });
  };

  const toggleAll = (e) => {
    e.stopPropagation();
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allSelected || someSelected) {
        filtered.forEach((a) => next.delete(a.id));
      } else {
        filtered.forEach((a) => next.add(a.id));
      }
      return next;
    });
  };

  /* ── Bulk action ───────────────────────────────────── */
  const requestBulkAction = (action) => {
    setBulkResults(null);
    setBulkConfirm({ action, apps: selectedApps });
  };

  const executeBulkAction = async () => {
    if (!bulkConfirm) return;
    const { action, apps: targets } = bulkConfirm;
    setBulkLoading(true);
    setBulkResults(null);

    const settled = await Promise.allSettled(
      targets.map((app) => {
        const isCH2 = app.deploymentType === 'CloudHub 2.0';
        const envId = app.environment?.id;
        const appBgId = app._bgId || (selectedBg !== '__all__' ? selectedBg : orgId);
        if (isCH2) {
          return api.post(`/applications/cloudhub2/${appBgId}/${envId}/${app.id}/action`, { action });
        } else {
          return api.post(`/applications/cloudhub1/${envId}/${app.id}/action?orgId=${appBgId}`, { action });
        }
      })
    );

    const resultMap = {};
    const nextStatus = action === 'start' ? 'RUNNING' : action === 'stop' ? 'STOPPED' : 'DEPLOYING';

    targets.forEach((app, i) => {
      const r = settled[i];
      resultMap[app.id] = r.status === 'fulfilled'
        ? { success: true }
        : { success: false, error: r.reason?.response?.data?.error || r.reason?.message || 'Failed' };
    });

    // Optimistic update for successful ones
    setApps((prev) => prev.map((a) => resultMap[a.id]?.success ? { ...a, status: nextStatus } : a));
    bustCache(CK.PREFIX.apps); // invalidate cached lists after bulk status change
    setBulkResults(resultMap);
    setBulkLoading(false);
    // Keep only failed ones selected
    setSelectedIds((prev) => {
      const next = new Set(prev);
      targets.forEach((a) => { if (resultMap[a.id]?.success) next.delete(a.id); });
      return next;
    });
  };

  const bulkActions = useMemo(() => {
    if (selectedApps.length === 0) return [];
    const canStart   = selectedApps.some((a) => availableActions(a.status).includes('start'));
    const canStop    = selectedApps.some((a) => availableActions(a.status).includes('stop'));
    const canRestart = selectedApps.some((a) => availableActions(a.status).includes('restart'));
    return [
      ...(canStart   ? ['start']   : []),
      ...(canStop    ? ['stop']    : []),
      ...(canRestart ? ['restart'] : [])
    ];
  }, [selectedApps]);

  /* ── Select options ────────────────────────────────── */
  // Apply BG filter to the visible list
  const visibleGroups = applyBgFilter(allBusinessGroups);
  const filterActive = visibleGroups.length < allBusinessGroups.length;

  // Apply Env filter to the loaded environments
  const visibleEnvs = applyEnvFilter(environments);
  const envFilterActive = visibleEnvs.length < environments.length;

  const bgOptions = [
    { value: '__all__', label: 'All Organizations', tag: `${visibleGroups.length}`, tagColor: 'bg-gray-700 text-gray-300' },
    ...visibleGroups.map((g) => ({
      value: g.id, label: g.name, indent: !!g.parentId,
      tag: !g.parentId ? 'Root' : undefined, tagColor: 'bg-blue-500/20 text-blue-400'
    })),
  ];

  const envOptions = [
    { value: '', label: 'All Environments' },
    ...visibleEnvs.map((e) => ({
      value: e.id, label: e.name, badge: true,
      badgeColor: ENV_BADGE[e.type] || 'bg-gray-400',
      tag: e.type, tagColor: ENV_TAG_COLOR[e.type] || 'bg-gray-700 text-gray-400'
    }))
  ];

  // Feature 7: status options with live counts from all loaded apps
  const statusOptions = [
    { value: '', label: 'All Statuses' },
    ...[
      { value: 'RUNNING',           label: 'Running',   badgeColor: 'bg-green-400' },
      { value: 'APPLIED',           label: 'Applied',   badgeColor: 'bg-cyan-400' },
      { value: 'FAILED',            label: 'Failed',    badgeColor: 'bg-red-400' },
      { value: 'STOPPED',           label: 'Stopped',   badgeColor: 'bg-gray-400' },
      { value: 'DEPLOYING',         label: 'Deploying', badgeColor: 'bg-blue-400' },
      { value: 'UPDATING',          label: 'Updating',  badgeColor: 'bg-purple-400' },
      { value: 'STARTING',          label: 'Starting',  badgeColor: 'bg-blue-300' },
      { value: 'STOPPING',          label: 'Stopping',  badgeColor: 'bg-orange-400' },
      { value: 'PARTIALLY_STARTED', label: 'Partial',   badgeColor: 'bg-yellow-400' },
    ].map(s => ({
      ...s,
      badge: true,
      label: statusCountsAll[s.value]
        ? `${s.label} (${statusCountsAll[s.value]})`
        : s.label,
    })),
  ];

  const typeOptions = [
    { value: '', label: 'All Deployment Types' },
    { value: 'CloudHub 2.0', label: 'CloudHub 2.0', tag: 'CH2', tagColor: 'bg-blue-500/20 text-blue-400' },
    { value: 'CloudHub 1.0', label: 'CloudHub 1.0', tag: 'CH1', tagColor: 'bg-purple-500/20 text-purple-400' }
  ];

  const selectedBgName = selectedBg === '__all__'
    ? 'All Organizations'
    : visibleGroups.find((g) => g.id === selectedBg)?.name || 'Organization';

  return (
    <div className="space-y-5">
      {/* Modals */}
      <ConfirmModal
        state={confirmState}
        onConfirm={executeAction}
        onCancel={() => setConfirmState(null)}
        loading={!!actionLoading[confirmState?.app?.id]}
      />
      <BulkConfirmModal
        state={bulkConfirm}
        onConfirm={executeBulkAction}
        onCancel={() => { setBulkConfirm(null); setBulkResults(null); }}
        loading={bulkLoading}
        results={bulkResults}
      />

      {/* Bulk Ping Modal */}
      {showBulkPing && (
        <BulkPingModal
          apps={selectedApps.length > 0 ? selectedApps : filtered}
          onClose={() => setShowBulkPing(false)}
        />
      )}

      {/* CPS Export Modal */}
      {showExport && (
        <CpsExportModal
          apps={selectedApps.length > 0 ? selectedApps : filtered}
          bgOrgId={selectedBg !== '__all__' ? selectedBg : (selectedApps[0]?._bgId || orgId)}
          bgName={selectedBgName}
          selectedEnvId={filterEnv || ''}
          envName={filterEnv ? (environments.find(e=>e.id===filterEnv)?.name || '') : (filtered[0]?.environment?.name || '')}
          filterSummary={[
            selectedApps.length > 0 ? `${selectedApps.length} selected apps` : null,
            filterEnv ? `Env: ${environments.find(e=>e.id===filterEnv)?.name || filterEnv}` : null,
            filterStatus ? `Status: ${filterStatus}` : null,
            filterType ? `Type: ${filterType}` : null,
            search ? `Search: "${search}"` : null
          ].filter(Boolean).join(' · ')}
          onClose={() => setShowExport(false)}
        />
      )}

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-white">Applications</h1>
          <p className="text-gray-400 text-sm mt-1">
            {loading ? 'Loading...' : `${apps.length} integrations in ${selectedBgName}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Hidden CSV file input */}
          <input ref={csvInputRef} type="file" accept=".csv,text/csv" onChange={handleCsvUpload} className="hidden" />
          {/* CSV upload button */}
          <button onClick={() => csvInputRef.current?.click()}
            title="Upload a CSV of app names to auto-select matching apps"
            className="flex items-center gap-2 text-sm text-blue-400 hover:text-blue-300 bg-blue-950/40 hover:bg-blue-950/60 border border-blue-800/50 px-3 py-2 rounded-lg transition-colors">
            <UploadCloud size={14} /> Upload CSV
          </button>
          <button onClick={() => setShowBulkPing(true)} disabled={loading || filtered.length === 0}
            title={selectedApps.length > 0 ? `Ping ${selectedApps.length} selected apps` : 'Ping all visible apps'}
            className="flex items-center gap-2 text-sm text-cyan-400 hover:text-cyan-300 bg-cyan-950/40 hover:bg-cyan-950/60 border border-cyan-800/50 px-3 py-2 rounded-lg disabled:opacity-40 transition-colors">
            <Activity size={14} />
            {selectedApps.length > 0 ? `Ping (${selectedApps.length})` : 'Ping Test'}
          </button>
          <button onClick={() => setShowExport(true)} disabled={loading || apps.length === 0}
            title={selectedApps.length > 0 ? `Export CPS for ${selectedApps.length} selected apps` : 'Export CPS Properties to Excel'}
            className="flex items-center gap-2 text-sm text-emerald-400 hover:text-emerald-300 bg-emerald-950/40 hover:bg-emerald-950/60 border border-emerald-800/50 px-3 py-2 rounded-lg disabled:opacity-40 transition-colors">
            <FileSpreadsheet size={14} /> {selectedApps.length > 0 ? `Export CPS (${selectedApps.length})` : 'Export CPS'}
          </button>
          <button onClick={() => loadApps(selectedBg, true)} disabled={loading || bgLoading}
            className="flex items-center gap-2 text-sm text-gray-400 hover:text-white bg-gray-800 px-3 py-2 rounded-lg disabled:opacity-50">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>
      </div>

      {/* Single-app toast */}
      {actionResult && (
        <div className={`flex items-center justify-between px-4 py-3 rounded-xl border text-sm ${
          actionResult.success ? 'bg-emerald-950/40 border-emerald-800/50 text-emerald-300' : 'bg-red-950/40 border-red-800/50 text-red-300'
        }`}>
          <span>{actionResult.message}</span>
          <button onClick={() => setActionResult(null)} className="ml-4 opacity-60 hover:opacity-100"><X size={14} /></button>
        </div>
      )}

      {/* CSV match banner */}
      {csvMatchedNames !== null && (
        <div className={`flex items-center justify-between flex-wrap gap-3 px-4 py-3 rounded-xl border text-sm ${
          selectedIds.size > 0 ? 'bg-blue-950/30 border-blue-800/50' : 'bg-gray-900 border-gray-800'
        }`}>
          <div className="flex items-center gap-3">
            <UploadCloud size={14} className="text-blue-400 flex-shrink-0" />
            <span className="text-gray-300 text-xs">
              <span className="font-mono text-gray-500">{csvFileName}</span>{' — '}
              {selectedIds.size > 0
                ? <span className="text-blue-300 font-semibold">{selectedIds.size} app{selectedIds.size !== 1 ? 's' : ''} matched & selected</span>
                : <span className="text-gray-500">No apps matched</span>}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {selectedIds.size > 0 && (
              <button onClick={() => setShowBulkPing(true)}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-cyan-700 hover:bg-cyan-600 text-white rounded-lg transition-colors font-medium">
                <Activity size={10} /> Ping ({selectedIds.size})
              </button>
            )}
            <button onClick={() => { setCsvMatchedNames(null); setCsvFileName(''); setSelectedIds(new Set()); }}
              className="text-gray-600 hover:text-gray-300 transition-colors">
              <X size={14} />
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 text-red-400 text-sm">{error}</div>
      )}

      {/* Business Group selector */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl px-5 py-4">
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs text-gray-500 uppercase tracking-wider font-medium">Business Group</p>
          {filterActive && (
            <span className="text-[10px] text-blue-400 font-medium">
              {visibleGroups.length}/{allBusinessGroups.length} shown (filtered)
            </span>
          )}
        </div>
        <Select
          value={selectedBg}
          onChange={(v) => {
            setSelectedBg(v);
            setSearch('');
            setFilterEnv('');
            setFilterStatus('');
            setFilterType('');
            localStorage.removeItem('mule_dashboard_filter_status');
            localStorage.removeItem('mule_dashboard_filter_type');
            localStorage.removeItem('mule_dashboard_filter_env');
          }}
          options={bgOptions}
          placeholder="Select business group..."
          searchable={visibleGroups.length > 5}
          disabled={bgLoading}
        />
      </div>

      {/* Filters */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="relative sm:col-span-2 lg:col-span-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
          <input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search applications..."
            className="w-full bg-gray-900 border border-gray-700 rounded-lg pl-9 pr-4 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500" />
        </div>
        <div><Select value={filterEnv} onChange={setFilterEnv} options={envOptions} placeholder="Environment" searchable /></div>
        <div><Select value={filterStatus} onChange={setFilterStatus} options={statusOptions} placeholder="Status" /></div>
        <div><Select value={filterType} onChange={setFilterType} options={typeOptions} placeholder="Type" /></div>
      </div>

      {/* Bulk action toolbar — appears when rows are selected */}
      {selectedApps.length > 0 && (
        <div className="flex items-center justify-between flex-wrap gap-3 px-4 py-3 bg-blue-950/40 border border-blue-800/50 rounded-xl">
          <div className="flex items-center gap-3">
            <span className="text-blue-300 text-sm font-medium">
              {selectedApps.length} application{selectedApps.length !== 1 ? 's' : ''} selected
            </span>
            <button
              onClick={() => setSelectedIds(new Set())}
              className="text-blue-500 hover:text-blue-300 text-xs underline underline-offset-2">
              Clear
            </button>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-blue-500 text-xs hidden sm:inline">Bulk action:</span>
            {bulkActions.map((action) => {
              const { Icon, label, bulkCls } = ACTION_CONFIG[action];
              return (
                <button key={action} onClick={() => requestBulkAction(action)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${bulkCls}`}>
                  <Icon size={12} /> {label} All
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Feature 2: Status Summary Bar — clickable chips filter the table */}
      {!loading && filtered.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 px-1">
          {[
            { s: 'RUNNING',   color: 'bg-green-500/20 text-green-400 border-green-700/30 hover:bg-green-500/30' },
            { s: 'APPLIED',   color: 'bg-cyan-500/20 text-cyan-400 border-cyan-700/30 hover:bg-cyan-500/30' },
            { s: 'FAILED',    color: 'bg-red-500/20 text-red-400 border-red-700/30 hover:bg-red-500/30' },
            { s: 'STOPPED',   color: 'bg-gray-500/20 text-gray-400 border-gray-700/30 hover:bg-gray-500/30' },
            { s: 'DEPLOYING', color: 'bg-blue-500/20 text-blue-400 border-blue-700/30 hover:bg-blue-500/30' },
            { s: 'UPDATING',  color: 'bg-purple-500/20 text-purple-400 border-purple-700/30 hover:bg-purple-500/30' },
            { s: 'STARTING',  color: 'bg-blue-400/20 text-blue-300 border-blue-600/30 hover:bg-blue-400/30' },
            { s: 'STOPPING',  color: 'bg-orange-500/20 text-orange-400 border-orange-700/30 hover:bg-orange-500/30' },
            { s: 'PARTIALLY_STARTED', color: 'bg-yellow-500/20 text-yellow-400 border-yellow-700/30 hover:bg-yellow-500/30' },
          ].filter(({ s }) => statusSummary[s] > 0).map(({ s, color }) => (
            <button
              key={s}
              onClick={() => setFilterStatus(filterStatus === s ? '' : s)}
              className={`flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-lg border transition-all ${color} ${
                filterStatus === s ? 'ring-1 ring-inset ring-current opacity-100' : 'opacity-70 hover:opacity-100'
              }`}>
              <span className="font-semibold">{statusSummary[s]}</span>
              <span>{s.charAt(0) + s.slice(1).toLowerCase().replace('_started', '')}</span>
            </button>
          ))}
          {filterStatus && (
            <button onClick={() => setFilterStatus('')} className="text-[10px] text-gray-600 hover:text-gray-300 underline underline-offset-2 transition-colors">
              Clear
            </button>
          )}
        </div>
      )}

      {loading ? (
        /* Feature 1.1: skeleton table rows matching the real table structure */
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-800/50 text-gray-400 text-xs uppercase tracking-wider">
                <th className="px-4 py-3 w-10" />
                <th className="text-left px-4 py-3">Application</th>
                <th className="text-left px-4 py-3">Status</th>
                <th className="text-left px-4 py-3">Environment</th>
                <th className="text-left px-4 py-3">Type</th>
                <th className="text-left px-4 py-3">Mule Version</th>
                <th className="text-left px-4 py-3">Last Modified</th>
                <th className="px-4 py-3 text-center">Actions</th>
              </tr>
            </thead>
            <tbody>
              {[...Array(8)].map((_, i) => (
                <tr key={i} className="border-t border-gray-800 animate-pulse">
                  <td className="px-4 py-3.5"><div className="w-4 h-4 rounded bg-gray-800" /></td>
                  <td className="px-4 py-3.5">
                    <div className="flex items-center gap-2">
                      <div className="h-3 rounded bg-gray-800" style={{ width: `${100 + (i % 5) * 30}px` }} />
                    </div>
                  </td>
                  <td className="px-4 py-3.5"><div className="h-5 w-20 rounded-full bg-gray-800" /></td>
                  <td className="px-4 py-3.5">
                    <div className="flex items-center gap-1.5">
                      <div className="w-2 h-2 rounded-full bg-gray-700" />
                      <div className="h-3 w-24 rounded bg-gray-800" />
                    </div>
                  </td>
                  <td className="px-4 py-3.5"><div className="h-5 w-24 rounded bg-gray-800" /></td>
                  <td className="px-4 py-3.5"><div className="h-3 w-16 rounded bg-gray-800" /></td>
                  <td className="px-4 py-3.5"><div className="h-3 w-20 rounded bg-gray-800" /></td>
                  <td className="px-4 py-3.5"><div className="h-6 w-14 rounded-lg bg-gray-800 mx-auto" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          {/* Feature 6: overflow-y-auto on this inner div makes sticky thead work.
              The outer div keeps overflow-hidden for border-radius clipping. */}
          <div className="overflow-y-auto max-h-[72vh]">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10">
              <tr className="bg-gray-800/95 text-gray-400 text-xs uppercase tracking-wider backdrop-blur-sm">
                {/* Select-all checkbox */}
                <th className="px-4 py-3 w-10" onClick={toggleAll}>
                  <div className={`w-4 h-4 rounded border flex items-center justify-center cursor-pointer transition-colors ${
                    allSelected ? 'bg-blue-600 border-blue-500' : someSelected ? 'bg-blue-900/60 border-blue-600' : 'border-gray-600 hover:border-blue-500'
                  }`}>
                    {allSelected && <span className="text-white text-[10px] font-bold leading-none">✓</span>}
                    {someSelected && <span className="text-blue-400 text-[10px] font-bold leading-none">–</span>}
                  </div>
                </th>
                {/* Feature 1: sortable column headers */}
                <th className="text-left px-4 py-3 font-medium cursor-pointer hover:text-white select-none" onClick={() => handleSort('name')}>
                  Application <SortIcon col="name" />
                </th>
                <th className="text-left px-4 py-3 font-medium cursor-pointer hover:text-white select-none" onClick={() => handleSort('status')}>
                  Status <SortIcon col="status" />
                </th>
                <th className="text-left px-4 py-3 font-medium cursor-pointer hover:text-white select-none" onClick={() => handleSort('environment')}>
                  Environment <SortIcon col="environment" />
                </th>
                <th className="text-left px-4 py-3 font-medium cursor-pointer hover:text-white select-none" onClick={() => handleSort('type')}>
                  Type <SortIcon col="type" />
                </th>
                <th className="text-left px-4 py-3 font-medium cursor-pointer hover:text-white select-none" onClick={() => handleSort('muleVersion')}>
                  Mule Version <SortIcon col="muleVersion" />
                </th>
                <th className="text-left px-4 py-3 font-medium cursor-pointer hover:text-white select-none" onClick={() => handleSort('lastModified')}>
                  Last Modified <SortIcon col="lastModified" />
                </th>
                <th className="px-4 py-3 font-medium text-center">Actions</th>
              </tr>
            </thead>
            <tbody>
              {displayFiltered.map((app, idx) => {
                const actions = availableActions(app.status);
                const isActing = !!actionLoading[app.id];
                const isChecked = selectedIds.has(app.id);

                return (
                  <tr key={`${app.id}-${idx}`}
                    className={`border-t border-gray-800 hover:bg-gray-800/30 cursor-pointer transition-colors ${isChecked ? 'bg-blue-950/20' : (() => {
                      const st = (app.status || '').toUpperCase();
                      if (st === 'FAILED')    return 'border-l-2 border-l-red-600 bg-red-950/10';
                      if (st === 'DEPLOYING') return 'border-l-2 border-l-blue-500/60 bg-blue-950/5';
                      if (st === 'UPDATING')  return 'border-l-2 border-l-purple-500/60 bg-purple-950/5';
                      if (st === 'STARTING')  return 'border-l-2 border-l-blue-400/50';
                      if (st === 'STOPPING')  return 'border-l-2 border-l-orange-500/50';
                      if (st === 'STOPPED')   return 'border-l-2 border-l-gray-600/30';
                      return '';
                    })()}`}
                    onClick={() => navigate(`/applications/${app._bgId || (selectedBg !== '__all__' ? selectedBg : orgId)}/${app.environment?.id}/${app.id}`)}>
                    {/* Checkbox */}
                    <td className="px-4 py-3" onClick={(e) => toggleRow(e, app.id)}>
                      <div className={`w-4 h-4 rounded border flex items-center justify-center cursor-pointer transition-colors ${
                        isChecked ? 'bg-blue-600 border-blue-500' : 'border-gray-600 hover:border-blue-500'
                      }`}>
                        {isChecked && <span className="text-white text-[10px] font-bold leading-none">✓</span>}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1 group">
                        <span className="text-white font-medium">{app.name}</span>
                        <CopyBtn text={app.name} />
                        <button
                          type="button"
                          title={`Open in Anypoint Platform${app.environment?.name ? ` — ${app.environment.name}` : ''} (app name copied to clipboard)`}
                          onClick={(e) => openInAnypoint(e, app, selectedBg !== '__all__' ? selectedBg : orgId)}
                          className="opacity-0 group-hover:opacity-100 ml-0.5 text-gray-500 hover:text-blue-400 transition-all flex-shrink-0"
                        >
                          <ExternalLink size={11} />
                        </button>
                      </div>
                    </td>
                    <td className="px-4 py-3"><StatusBadge status={app.status} /></td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${ENV_BADGE[app.environment?.type] || 'bg-gray-400'}`} />
                        <span className="text-gray-300">{app.environment?.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded font-medium ${
                        app.deploymentType === 'CloudHub 2.0' ? 'bg-blue-500/20 text-blue-400' : 'bg-purple-500/20 text-purple-400'
                      }`}>{app.deploymentType}</span>
                    </td>
                    <td className="px-4 py-3 text-gray-400 font-mono text-xs">{app.muleVersion || '—'}</td>
                    <td className="px-4 py-3 text-xs" title={app.lastModifiedDate ? new Date(app.lastModifiedDate).toLocaleString() : ''}>
                      {/* Feature 10: relative time with absolute date as tooltip */}
                      {app.lastModifiedDate ? (() => {
                        const diff = Date.now() - new Date(app.lastModifiedDate).getTime();
                        const days = Math.floor(diff / 86400000);
                        const hours = Math.floor(diff / 3600000);
                        const mins = Math.floor(diff / 60000);
                        const rel = days > 0 ? `${days}d ago` : hours > 0 ? `${hours}h ago` : mins > 0 ? `${mins}m ago` : 'just now';
                        return <span className="text-gray-500 tabular-nums">{rel}</span>;
                      })() : <span className="text-gray-700">—</span>}
                    </td>
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-center gap-1">
                        {isActing ? (
                          <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-400" />
                        ) : actions.length > 0 ? (
                          actions.map((action) => {
                            const { Icon, label, btnCls } = ACTION_CONFIG[action];
                            return (
                              <button key={action} title={label}
                                onClick={(e) => requestAction(e, app, action)}
                                className={`p-1.5 rounded-lg border transition-all ${btnCls}`}>
                                <Icon size={13} />
                              </button>
                            );
                          })
                        ) : (
                          <ChevronRight size={14} className="text-gray-600" />
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {displayFiltered.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-5 py-12 text-center text-gray-500">
                    {apps.length === 0
                      ? `No applications found in ${selectedBgName}.`
                      : 'No applications match your filters.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          </div>
        </div>
      )}

      {filtered.length > 0 && (
        <p className="text-xs text-gray-600 text-right">
          {selectedApps.length > 0 && <span className="text-blue-500 mr-2">{selectedApps.length} selected ·</span>}
          Showing {filtered.length} of {apps.length}
        </p>
      )}
    </div>
  );
}
