import React, { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCw, Activity, ShieldCheck } from 'lucide-react';
import { useCredentialStore } from '../../../context/CredentialStoreContext';
import { useCpsCredentialStore } from '../../../context/CpsCredentialStoreContext';
import Modal from '../../../components/ui/Modal';
import CredentialImportButton from '../../../components/shared/CredentialImportButton';
import PingResultCard from '../../ping-test/PingResultCard';
import { getCloudhub2AppDetail, getCloudhub1AppDetail } from '../../../services/applicationsService';
import { postCpsCredentialsRaw, fetchCpsProperties } from '../../../services/cpsService';
import { getAutoCredentials, getAutoContractCreds, getOAuth2Token, pingApp as pingAppRequest } from '../../../services/healthService';
import { generateTxId } from '../../../utils/appUtils';
import { findOAuth2Url, flattenCpsResponse, extractCpsConfig } from '../../../utils/cpsHelpers';

/**
 * BulkPingModal — runs ping tests across a selected set of applications,
 * auto-resolving credentials from API Manager/CPS where possible.
 *
 * Extracted from features/applications/ApplicationsPage.jsx — see
 * FRONTEND_ARCHITECTURE_REVIEW.md §10 folder-structure recommendation.
 */
export default function BulkPingModal({ apps, onClose }) {
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
        const r = await getCloudhub2AppDetail(bgId, envId, app.id);
        armDetail = r.data;
      } else {
        const r = await getCloudhub1AppDetail(envId, app.id, bgId);
        armDetail = { name: app.name, properties: r.data?.properties || {} };
      }

      // CPS connection config — delegate to the shared extractCpsConfig()
      // instead of an inline fallback chain, so this modal resolves CPS
      // config identically to CpsComparisonPage/GlobalSearchPage — see
      // FRONTEND_ARCHITECTURE_REVIEW.md §1 finding #7.
      const cpsConfig = extractCpsConfig(armDetail);
      const cpsBaseUrl = cpsConfig.cpsBaseUrl;
      const cpsClientId = cpsConfig.cpsClientId;
      const cpsKey = cpsConfig.cpsKey || app.name || '';
      const cpsEnv = cpsConfig.cpsEnv || '';

      if (!cpsBaseUrl || !cpsKey) return {}; // no CPS config → skip

      // ── Step 2a: Post CPS credentials to backend session ──────────────────
      // Without this step the CPS fetch returns 422 for apps whose CPS
      // server requires OAuth. Mirror the logic in CpsComparisonPage.
      if (cpsClientId && hasCpsCreds) {
        const secret = getCpsSecret(cpsClientId);
        if (secret) {
          try {
            const credKey = `${cpsBaseUrl.trim().replace(/\/+$/, '').replace(/\/api\/v2\/?$/, '')}::${bgId}`;
            await postCpsCredentialsRaw({
              credentials: { [credKey]: { clientId: cpsClientId, clientSecret: secret } },
            });
          } catch { /* non-fatal — CPS fetch will fail with 422 if creds are wrong */ }
        }
      }

      // ── Step 2b: Fetch CPS non-secure properties ──────────────────────────
      const data = await fetchCpsProperties({
        baseUrl: cpsBaseUrl,
        type: 'non-secure',
        keys: cpsKey,
        ...(cpsEnv && { environment: cpsEnv }),
        bgOrgId: bgId,
      });

      // Flatten the CPS response to a plain {key: value} map
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

          const data = await getAutoCredentials({
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
                const cd = await getAutoContractCreds({
                  orgId: bgId, envId, apiId: apiInstanceId,
                  envType: app.environment?.type || '',
                });
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
          const r = await getCloudhub2AppDetail(bgId, envId, app.id);
          // Delegate to the shared extractCpsConfig() — see
          // FRONTEND_ARCHITECTURE_REVIEW.md §1 finding #7.
          const cpsConfig = extractCpsConfig(r.data);
          cpsBaseUrl = cpsConfig.cpsBaseUrl;
          cpsKey = cpsConfig.cpsKey || app.name;
          cpsEnv = cpsConfig.cpsEnv || '';
        } catch { return null; }
        if (!cpsBaseUrl || !cpsKey) return null;
        let tokenUrl = null;
        try {
          const nsData = await fetchCpsProperties({ baseUrl: cpsBaseUrl, type: 'non-secure', keys: cpsKey, ...(cpsEnv && { environment: cpsEnv }), bgOrgId: bgId });
          const nsProps = flattenCpsResponse(nsData);
          tokenUrl = findOAuth2Url(nsProps) || null;
          if (!tokenUrl) {
            // Scan ALL secure keys for an OAuth2 token URL (not just jwt/auth named keys)
            const secKeys = (nsProps['cps.secure.properties'] || '').split(',').map(k => k.trim()).filter(Boolean);
            if (secKeys.length > 0) {
              const srData = await fetchCpsProperties({ baseUrl: cpsBaseUrl, type: 'secure', keys: secKeys.join(','), ...(cpsEnv && { environment: cpsEnv }), bgOrgId: bgId });
              const groups = Array.isArray(srData?.responses) ? srData.responses : Array.isArray(srData) ? srData : [];
              for (const g of groups) { const u = findOAuth2Url(g.properties || {}); if (u) { tokenUrl = u; break; } }
            }
          }
        } catch { return null; }
        if (!tokenUrl) return null;
        const tr = await getOAuth2Token({ tokenUrl, clientId: appClientId, clientSecret: appClientSecret });
        return tr?.access_token || null;
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
          const detail = await getCloudhub2AppDetail(app._bgId, app.environment.id, app.id);
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
        const data = await pingAppRequest({
          targetType: isCH1 ? 'CH1' : 'CH2',
          appName: app.name,
          ch2IngressUrl,
          clientId: useClientId,
          clientSecret: useClientSecret,
          transactionId: transactionId.trim() && transactionId.trim() !== 'smokeTest' ? transactionId.trim() : generateTxId(),
          envType: app.environment?.type || '',
          envName: app.environment?.name || '',
          orgId: app._bgId,
          envId: app.environment?.id,
        });

        // If ping returned 4xx (PARTIAL), try auto-fetching JWT and retrying
        if (data.status === 'PARTIAL' && data.httpStatus >= 400 && data.httpStatus < 500 && !isCH1) {
          const jwt = await fetchJwtForApp(app, useClientId, useClientSecret);
          if (jwt) {
            try {
              const jwtData = await pingAppRequest({
                targetType: 'CH2',
                appName: app.name,
                ch2IngressUrl,
                bearerToken: jwt,
                transactionId: transactionId.trim() && transactionId.trim() !== 'smokeTest' ? transactionId.trim() : generateTxId(),
                envType: app.environment?.type || '',
                envName: app.environment?.name || '',
                orgId: app._bgId,
                envId: app.environment?.id,
              });
              return { appId: app.id, result: { ...jwtData, _jwtUsed: true } };
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

  return (
    <Modal
      onClose={onClose}
      size="lg"
      icon={Activity}
      accent="teal"
      title="Bulk Ping Test"
      subtitle={`${apps.length} application${apps.length !== 1 ? 's' : ''} selected`}
      headerExtra={<CredentialImportButton compact />}
      bodyClassName="!px-0 !py-0 space-y-0"
      footer={
        <>
          <p className="text-gray-400 dark:text-gray-500 text-[11px] hidden sm:block">Pings /api/v1/ping → /api/v2/ping → /api/ping → /ping in order</p>
          <div className="flex items-center gap-2.5 ml-auto">
            <button onClick={onClose} className="px-4 py-2.5 text-sm font-medium text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 bg-white dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 border border-gray-200 dark:border-gray-700 rounded-xl transition-colors">Close</button>
            <button onClick={runAll} disabled={running || resolving}
              className="flex items-center gap-2 px-5 py-2.5 text-sm font-semibold bg-gradient-to-b from-teal-500 to-teal-600 hover:from-teal-400 hover:to-teal-500 disabled:opacity-50 text-white rounded-xl shadow-md shadow-teal-500/30 hover:shadow-lg hover:shadow-teal-500/40 ring-1 ring-inset ring-white/20 transition-all duration-200 hover:-translate-y-0.5 active:translate-y-0">
              {resolving ? <><RefreshCw size={13} className="animate-spin" /> Resolving…</> : running ? <><RefreshCw size={13} className="animate-spin" /> Running…</> : <><Activity size={13} /> Run All Pings</>}
            </button>
          </div>
        </>
      }
    >
      {/* Credential inputs */}
      <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-700/60 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="text-[10px] text-gray-400 dark:text-gray-500 uppercase tracking-wider font-bold block mb-1.5">
              client_id <span className="normal-case font-medium text-gray-400 dark:text-gray-500">(overrides auto)</span>
            </label>
            <input value={clientId} onChange={e => setClientId(e.target.value)} placeholder="leave blank to auto-resolve"
              className="w-full bg-gray-50 dark:bg-gray-900/60 border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2 text-xs text-gray-700 dark:text-gray-300 font-mono placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/15 transition-all" />
          </div>
          <div>
            <label className="text-[10px] text-gray-400 dark:text-gray-500 uppercase tracking-wider font-bold block mb-1.5">client_secret</label>
            <div className="relative">
              <input value={clientSecret} onChange={e => setClientSecret(e.target.value)} type={showSecret ? 'text' : 'password'} placeholder="optional"
                className="w-full bg-gray-50 dark:bg-gray-900/60 border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2 pr-8 text-xs text-gray-700 dark:text-gray-300 font-mono placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/15 transition-all" />
              <button onClick={() => setShowSecret(!showSecret)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 text-xs transition-colors">{showSecret ? '🙈' : '👁'}</button>
            </div>
          </div>
          <div>
            <label className="text-[10px] text-gray-400 dark:text-gray-500 uppercase tracking-wider font-bold block mb-1.5">x-transaction-id</label>
            <input value={transactionId} onChange={e => setTransactionId(e.target.value)} placeholder="smokeTest"
              className="w-full bg-gray-50 dark:bg-gray-900/60 border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2 text-xs text-gray-700 dark:text-gray-300 font-mono placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/15 transition-all" />
          </div>
        </div>
        {/* Credential import status */}
        {hasCredentials && !clientId.trim() && (
          <div className="flex items-center gap-1.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
            <ShieldCheck size={11} />
            Credentials CSV loaded — will auto-resolve per app from API Manager
          </div>
        )}
      </div>

      {/* Resolving banner */}
      {resolving && (
        <div className="px-6 py-2.5 border-b border-gray-100 dark:border-gray-700/60 flex items-center gap-2 text-xs font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-50/40 dark:bg-emerald-500/5">
          <RefreshCw size={12} className="animate-spin" />
          Resolving credentials from API Manager…
        </div>
      )}

      {/* Progress summary */}
      {done > 0 && (
        <div className="px-6 py-3 border-b border-gray-100 dark:border-gray-700/60 flex items-center gap-2.5 text-xs flex-wrap">
          <span className="font-semibold text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-700/60 px-2 py-1 rounded-lg">{done}/{apps.length} tested</span>
          {success > 0 && <span className="font-semibold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-500/10 px-2 py-1 rounded-lg">✓ {success} healthy</span>}
          {partial > 0 && <span className="font-semibold text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-500/10 px-2 py-1 rounded-lg">~ {partial} partial</span>}
          {failed > 0 && <span className="font-semibold text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-500/10 px-2 py-1 rounded-lg">✗ {failed} failed</span>}
          {Object.keys(autoResolvedMap).length > 0 && (
            <span className="flex items-center gap-1 font-semibold text-gray-500 dark:text-gray-400">
              <ShieldCheck size={11} className="text-emerald-500" />{Object.keys(autoResolvedMap).length} auto-creds
            </span>
          )}
        </div>
      )}

      {/* Results list — each app gets a full PingResultCard */}
      <div className="p-4 space-y-3 bg-gray-50/40 dark:bg-gray-900/20">
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
    </Modal>
  );
}
