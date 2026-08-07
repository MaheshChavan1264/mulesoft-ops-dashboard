import { useState, useCallback } from 'react';
import { Activity, RefreshCw, CheckCircle2, XCircle, AlertCircle, ChevronDown, ChevronRight, Clock, Globe, Wifi, WifiOff, Key, Eye, EyeOff, ShieldCheck, Wand2 } from 'lucide-react';
import api from '../services/api';
import { useCredentialStore } from '../context/CredentialStoreContext';
import { useCpsCredentialStore } from '../context/CpsCredentialStoreContext';
import CredentialImportButton from './CredentialImportButton';

/**
 * PingTestPanel
 *
 * Props:
 *   appName             {string}  – application name
 *   isCH1               {boolean} – true for CloudHub 1.0
 *   ch2IngressUrl       {string}  – public ingress URL for CH2 apps
 *   orgId               {string}  – deployment BG org ID
 *   envId               {string}  – deployment environment ID
 *   defaultClientId     {string}  – pre-fill client_id from app properties
 *   defaultClientSecret {string}  – pre-fill client_secret from app properties
 */

const API_MGR_ORG_KEY = 'mule_dashboard_api_mgr_org_id';

export default function PingTestPanel({
  appName, isCH1, ch2IngressUrl, orgId, envId,
  defaultClientId = '', defaultClientSecret = '',
  // CPS connection props (passed from ApplicationDetailPage) — used to
  // look up the api.id from CPS non-secure before calling auto-credentials
  cpsBaseUrl = '', cpsClientId = '', cpsKey = '', cpsEnv = '',
}) {
  const { hasCredentials, resolveFromCandidates } = useCredentialStore();
  const { getSecret: getCpsSecret, hasCredentials: hasCpsCreds } = useCpsCredentialStore();

  const [clientId, setClientId] = useState(defaultClientId);
  const [clientSecret, setClientSecret] = useState(defaultClientSecret);
  const [transactionId, setTransactionId] = useState('smokeTest');
  const [showSecret, setShowSecret] = useState(false);
  const [queryParams, setQueryParams] = useState('');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [showAttempts, setShowAttempts] = useState(false);
  const [autoResolving, setAutoResolving] = useState(false);
  const [autoResolved, setAutoResolved] = useState(null);

  // API Manager BG org ID override — persisted to localStorage so user sets it once.
  const [apiMgrOrgId, setApiMgrOrgId] = useState(
    () => localStorage.getItem(API_MGR_ORG_KEY) || ''
  );
  const [showApiMgrInput, setShowApiMgrInput] = useState(false);

  const saveApiMgrOrgId = (val) => {
    setApiMgrOrgId(val);
    if (val.trim()) localStorage.setItem(API_MGR_ORG_KEY, val.trim());
    else localStorage.removeItem(API_MGR_ORG_KEY);
  };

  // ── Helper: flatten a CPS non-secure response to {key:value} ──────────
  const flattenCpsProps = (data) => {
    if (!data) return {};
    let props = {};
    if (Array.isArray(data?.responses)) {
      data.responses.forEach(r => Object.assign(props, r.properties || {}));
    } else if (Array.isArray(data)) {
      data.forEach(r => { if (r?.properties) Object.assign(props, r.properties); });
    } else if (data && typeof data === 'object') {
      const fv = Object.values(data)[0];
      props = (fv && typeof fv === 'object')
        ? Object.values(data).reduce((m, v) => (v && typeof v === 'object' ? Object.assign(m, v) : m), {})
        : data;
    }
    return props;
  };

  // ── Helper: extract the API Manager instance id from CPS properties ────
  const extractApiId = (props) => {
    if ('api.id' in props) {
      const v = String(props['api.id']).trim();
      if (/^\d+$/.test(v)) return v;
    }
    const dotApiId = Object.entries(props).find(([k]) => k.endsWith('.api.id'));
    if (dotApiId && /^\d+$/.test(String(dotApiId[1]).trim())) return String(dotApiId[1]).trim();
    const dotId = Object.entries(props).find(([k, v]) => k.endsWith('.id') && /^\d+$/.test(String(v).trim()));
    if (dotId) return String(dotId[1]).trim();
    if ('id' in props && /^\d+$/.test(String(props['id']).trim())) return String(props['id']).trim();
    return null;
  };

  // Auto-fill credentials from API Manager + CSV sheet
  // Strategy:
  //   1. If CPS props are available, fetch non-secure to get api.id → Layer 1 direct lookup
  //   2. Fall back to paginated fuzzy name matching (Layer 3)
  const autoFillCredentials = useCallback(async () => {
    if (!hasCredentials || !orgId || !envId) return;
    setAutoResolving(true);
    setAutoResolved(null);
    try {
      const body = { orgId, envId, appName };
      if (apiMgrOrgId.trim() && apiMgrOrgId.trim() !== orgId) {
        body.apiMgrOrgId = apiMgrOrgId.trim();
      }

      // ── Step 1: get api.id from CPS non-secure ────────────────────────
      if (cpsBaseUrl && cpsKey) {
        // First ensure CPS credentials are posted to the backend session
        if (cpsClientId && hasCpsCreds) {
          const secret = getCpsSecret(cpsClientId);
          if (secret) {
            try {
              const credKey = `${cpsBaseUrl.trim().replace(/\/+$/, '').replace(/\/api\/v2\/?$/, '')}::${orgId}`;
              await api.post('/cps/credentials', { credentials: { [credKey]: { clientId: cpsClientId, clientSecret: secret } } });
            } catch { /* non-fatal */ }
          }
        }
        try {
          const r = await api.get('/cps/fetch', {
            params: { baseUrl: cpsBaseUrl, type: 'non-secure', keys: cpsKey, ...(cpsEnv && { environment: cpsEnv }), bgOrgId: orgId },
          });
          const apiId = extractApiId(flattenCpsProps(r.data));
          if (apiId) {
            body.apiId = apiId;
            console.log(`[PingTestPanel] autoFillCredentials — found apiId=${apiId} from CPS for "${appName}"`);
          }
        } catch { /* CPS fetch failed — continue without apiId */ }
      }

      const { data } = await api.post('/health/auto-credentials', body);
      if (data.found && data.matchInfo?.length > 0) {
        const matched = resolveFromCandidates(data.matchInfo.map(m => m.clientId));
        if (matched) {
          const meta = data.matchInfo.find(m => m.clientId === matched.clientId);
          setClientId(matched.clientId);
          setClientSecret(matched.clientSecret);
          setAutoResolved({
            clientId: matched.clientId,
            apiInstanceName: meta?.apiInstanceName || '—',
            contractApp: meta?.contractApp || '—',
          });
        } else {
          setAutoResolved({ error: 'API Manager found a match, but no credential in your CSV matches the approved contract.' });
        }
      } else {
        setAutoResolved({ error: 'No matching API Manager instance found for this app.' });
      }
    } catch (err) {
      setAutoResolved({ error: err.message });
    }
    setAutoResolving(false);
  }, [hasCredentials, orgId, envId, appName, apiMgrOrgId, resolveFromCandidates]);

  const targetType = isCH1 ? 'CH1' : 'CH2';
  const displayBase = isCH1
    ? `https://${appName}.api.sfdcbt.net`
    : ch2IngressUrl || '(no ingress URL detected)';

  const runPing = async () => {
    setLoading(true);
    setResult(null);
    setError(null);
    setShowAttempts(false);
    try {
      const { data } = await api.post('/health/ping', {
        targetType,
        appName,
        ch2IngressUrl: isCH1 ? undefined : ch2IngressUrl,
        clientId: clientId.trim() || undefined,
        clientSecret: clientSecret.trim() || undefined,
        transactionId: transactionId.trim() || 'smokeTest',
        queryParams: queryParams.trim() || undefined,
      });
      setResult(data);
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Ping request failed');
    } finally {
      setLoading(false);
    }
  };

  const badgeConfig = {
    SUCCESS: { icon: <CheckCircle2 size={15} className="text-emerald-400" />, label: 'Healthy / Reachable', cls: 'bg-emerald-950/50 border-emerald-700/50 text-emerald-300', dot: 'bg-emerald-400', ping: true },
    PARTIAL: { icon: <AlertCircle  size={15} className="text-yellow-400"  />, label: 'Reachable (non-2xx)', cls: 'bg-yellow-950/50 border-yellow-700/50 text-yellow-300',  dot: 'bg-yellow-400', ping: false },
    FAILED:  { icon: <XCircle      size={15} className="text-red-400"     />, label: 'Unreachable',         cls: 'bg-red-950/50 border-red-700/50 text-red-300',           dot: 'bg-red-500',    ping: false },
  };
  const badge = result ? badgeConfig[result.status] || badgeConfig.FAILED : null;
  const latencyColor = (ms) => !ms ? 'text-slate-400' : ms < 300 ? 'text-emerald-400' : ms < 1000 ? 'text-yellow-400' : 'text-red-400';

  return (
    <div className="space-y-5">
      {/* Config panel */}
      <div className="bg-slate-900/60 border border-slate-800/60 rounded-2xl px-5 py-4 space-y-4">

        {/* Header row */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="space-y-1.5 flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <Activity size={13} className="text-cyan-400" />
              <span className="text-white text-sm font-semibold">Ping / Health Check</span>
              <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium border ${isCH1 ? 'bg-purple-950/50 text-purple-300 border-purple-700/50' : 'bg-blue-950/50 text-blue-300 border-blue-700/50'}`}>
                {isCH1 ? 'CloudHub 1.0' : 'CloudHub 2.0'}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <Globe size={11} className="text-slate-500" />
              <span className="text-slate-400 text-xs font-mono break-all">{displayBase}</span>
            </div>
            <p className="text-slate-600 text-[11px]">
              Tries: <span className="text-slate-500">/api/v1/ping → /api/v2/ping → /api/ping → /ping</span>
            </p>
          </div>
          <button onClick={runPing} disabled={loading || (!isCH1 && !ch2IngressUrl)}
            className="flex items-center gap-2 px-4 py-2.5 bg-cyan-700 hover:bg-cyan-600 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-xl transition-colors flex-shrink-0">
            {loading ? <><RefreshCw size={14} className="animate-spin" /> Pinging…</> : <><Wifi size={14} /> Run Ping Test</>}
          </button>
        </div>

        {/* Query params row — Feature 5: smart ping URL resolution */}
        <div className="pt-1 border-t border-slate-800/60">
          <label className="text-[10px] text-slate-500 uppercase tracking-wider font-medium flex items-center gap-1 mb-1">
            <Globe size={9} /> Query Parameters <span className="normal-case text-slate-600 font-normal">(optional — appended to every ping path)</span>
          </label>
          <input
            value={queryParams}
            onChange={e => setQueryParams(e.target.value)}
            placeholder="e.g. checkDb=true&type=health"
            className="w-full bg-slate-800/60 border border-slate-700/50 rounded-lg px-3 py-1.5 text-xs text-slate-200 font-mono placeholder-slate-600 focus:outline-none focus:border-cyan-600/50"
          />
        </div>

        {/* Credentials row */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="space-y-1">
            <label className="text-[10px] text-slate-500 uppercase tracking-wider font-medium flex items-center gap-1">
              <Key size={9} /> client_id
            </label>
            <input value={clientId} onChange={e => { setClientId(e.target.value); setAutoResolved(null); }}
              placeholder="optional"
              className="w-full bg-slate-800/60 border border-slate-700/50 rounded-lg px-3 py-1.5 text-xs text-slate-200 font-mono placeholder-slate-600 focus:outline-none focus:border-cyan-600/50" />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] text-slate-500 uppercase tracking-wider font-medium flex items-center gap-1">
              <Key size={9} /> client_secret
            </label>
            <div className="relative">
              <input value={clientSecret} onChange={e => setClientSecret(e.target.value)}
                type={showSecret ? 'text' : 'password'}
                placeholder="optional"
                className="w-full bg-slate-800/60 border border-slate-700/50 rounded-lg px-3 py-1.5 pr-8 text-xs text-slate-200 font-mono placeholder-slate-600 focus:outline-none focus:border-cyan-600/50" />
              <button onClick={() => setShowSecret(!showSecret)} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300">
                {showSecret ? <EyeOff size={12} /> : <Eye size={12} />}
              </button>
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-[10px] text-slate-500 uppercase tracking-wider font-medium">x-transaction-id</label>
            <input value={transactionId} onChange={e => setTransactionId(e.target.value)}
              placeholder="smokeTest"
              className="w-full bg-slate-800/60 border border-slate-700/50 rounded-lg px-3 py-1.5 text-xs text-slate-200 font-mono placeholder-slate-600 focus:outline-none focus:border-cyan-600/50" />
          </div>
        </div>

        {/* CSV import + auto-fill row */}
        <div className="space-y-2 pt-1 border-t border-slate-800/40">
          <div className="flex items-center justify-between flex-wrap gap-2">

            {/* Left: import button + auto-fill buttons */}
            <div className="flex items-center gap-2 flex-wrap">
              {/* Always visible — lets user import CSV directly from this page */}
              <CredentialImportButton compact />

              {/* Auto-fill and BG config — only shown after CSV is loaded */}
              {hasCredentials && (
                <>
                  <button
                    onClick={autoFillCredentials}
                    disabled={autoResolving || !orgId || !envId}
                    title="Auto-fill credentials from API Manager contracts + your loaded CSV"
                    className="flex items-center gap-1.5 text-[10px] px-2.5 py-1.5 bg-emerald-500/10 border border-emerald-700/40 text-emerald-400 hover:bg-emerald-500/20 rounded-lg transition-colors disabled:opacity-50 font-medium"
                  >
                    {autoResolving
                      ? <><RefreshCw size={9} className="animate-spin" /> Resolving…</>
                      : <><Wand2 size={9} /> Auto-fill from API Manager</>}
                  </button>
                  <button
                    onClick={() => setShowApiMgrInput(v => !v)}
                    title="Configure API Manager Business Group (if different from deployment BG)"
                    className={`text-[10px] px-1.5 py-1 rounded border transition-colors ${
                      apiMgrOrgId.trim()
                        ? 'bg-blue-500/10 border-blue-700/40 text-blue-400'
                        : 'bg-slate-800 border-slate-700 text-slate-500 hover:text-slate-300'
                    }`}
                  >
                    {apiMgrOrgId.trim() ? '🏢 API Mgr BG set' : '⚙ API Mgr BG'}
                  </button>
                </>
              )}
            </div>

            {/* Right: auto-resolve status */}
            {autoResolved && !autoResolved.error && (
              <span className="flex items-center gap-1 text-[10px] text-emerald-400/80">
                <ShieldCheck size={9} />
                {autoResolved.apiInstanceName} → {autoResolved.contractApp}
              </span>
            )}
            {autoResolved?.error && (
              <span className="text-[10px] text-yellow-500/80">{autoResolved.error}</span>
            )}
          </div>

          {/* API Manager BG override input — expandable */}
          {hasCredentials && showApiMgrInput && (
            <div className="bg-slate-800/40 border border-slate-700/40 rounded-lg px-3 py-2.5 space-y-1.5">
              <p className="text-[10px] text-slate-400">
                If your API Manager is in a <strong className="text-slate-300">different Business Group</strong> than this app's deployment, enter that BG's Org ID below. Saved for all ping tests.
              </p>
              <div className="flex items-center gap-2">
                <input
                  value={apiMgrOrgId}
                  onChange={e => saveApiMgrOrgId(e.target.value)}
                  placeholder={`Default: ${orgId} (deployment BG)`}
                  className="flex-1 bg-slate-800 border border-slate-700/50 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 font-mono placeholder-slate-600 focus:outline-none focus:border-blue-600/50"
                />
                {apiMgrOrgId.trim() && (
                  <button
                    onClick={() => saveApiMgrOrgId('')}
                    className="text-slate-500 hover:text-red-400 text-[10px] px-2 py-1.5 rounded border border-slate-700 hover:border-red-700/40 transition-colors"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* CH2 no-URL warning */}
      {!isCH1 && !ch2IngressUrl && (
        <div className="flex items-center gap-3 bg-yellow-950/30 border border-yellow-800/50 rounded-xl px-4 py-3 text-yellow-400 text-sm">
          <AlertCircle size={15} className="flex-shrink-0" />
          <span>No public ingress URL found for this CH2 app. Check the <strong>Infra & Config</strong> tab.</span>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="flex items-center gap-3 bg-red-950/30 border border-red-800/50 rounded-xl px-4 py-3 text-red-400 text-sm">
          <WifiOff size={15} className="flex-shrink-0" /><span>{error}</span>
        </div>
      )}

      {/* Result */}
      {result && badge && (
        <div className="space-y-4">
          <div className={`flex items-center justify-between flex-wrap gap-3 rounded-2xl border px-5 py-4 ${badge.cls}`}>
            <div className="flex items-center gap-3">
              <span className="relative flex h-3 w-3 flex-shrink-0">
                {badge.ping && <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-60 ${badge.dot}`} />}
                <span className={`relative inline-flex rounded-full h-3 w-3 ${badge.dot}`} />
              </span>
              <div className="flex items-center gap-2">{badge.icon}<span className="font-semibold text-sm">{badge.label}</span></div>
            </div>
            {result.responseTimeMs != null && (
              <span className={`font-mono text-sm font-bold ${latencyColor(result.responseTimeMs)}`}>{result.responseTimeMs}ms</span>
            )}
          </div>

          <div className="bg-slate-900/60 border border-slate-800/60 rounded-2xl overflow-hidden">
            <table className="w-full text-sm">
              <tbody>
                {[
                  ['Active Endpoint', result.activeEndpoint ? <span className="font-mono text-xs text-cyan-300 break-all">{result.activeEndpoint}</span> : <span className="text-slate-600">—</span>],
                  ['HTTP Status', result.httpStatus != null ? <span className={`font-mono text-sm font-bold ${result.httpStatus < 300 ? 'text-emerald-400' : result.httpStatus < 500 ? 'text-yellow-400' : 'text-red-400'}`}>{result.httpStatus}</span> : <span className="text-slate-600">—</span>],
                  ['Response Time', result.responseTimeMs != null ? <span className={`font-mono font-bold ${latencyColor(result.responseTimeMs)}`}>{result.responseTimeMs}ms</span> : <span className="text-slate-600">—</span>],
                  ['Target Type', <span className={`text-xs px-2 py-0.5 rounded-full font-semibold border ${isCH1 ? 'bg-purple-950/50 text-purple-300 border-purple-700/50' : 'bg-blue-950/50 text-blue-300 border-blue-700/50'}`}>{isCH1 ? 'CloudHub 1.0' : 'CloudHub 2.0'}</span>],
                ].map(([label, value]) => (
                  <tr key={label} className="border-b border-slate-800/40 last:border-0">
                    <td className="px-5 py-3 w-40 text-[10px] font-bold tracking-wider text-slate-500 uppercase">{label}</td>
                    <td className="px-5 py-3">{value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {result.payload && (
              <div className="border-t border-slate-800/40 px-5 py-4">
                <p className="text-[10px] font-bold tracking-wider text-slate-500 uppercase mb-2">Response Payload</p>
                <pre className="bg-[#0B0F17] rounded-xl px-4 py-3 text-xs text-emerald-400/90 overflow-auto max-h-40 font-mono leading-relaxed border border-slate-800/60">
                  {typeof result.payload === 'string' ? result.payload : JSON.stringify(result.payload, null, 2)}
                </pre>
              </div>
            )}
            {result.error && (
              <div className="border-t border-slate-800/40 px-5 py-3 flex items-center gap-2 text-red-400 text-xs">
                <XCircle size={12} className="flex-shrink-0" />{result.error}
              </div>
            )}
          </div>

          {result.attempts && result.attempts.length > 0 && (
            <div className="bg-slate-900/40 border border-slate-800/60 rounded-2xl overflow-hidden">
              <button onClick={() => setShowAttempts(!showAttempts)}
                className="w-full flex items-center justify-between px-5 py-3 text-slate-400 hover:text-white text-xs font-semibold transition-colors">
                <div className="flex items-center gap-2">
                  <Clock size={12} />Ping Attempt Log ({result.attempts.length} path{result.attempts.length !== 1 ? 's' : ''} tried)
                </div>
                {showAttempts ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </button>
              {showAttempts && (
                <div className="border-t border-slate-800/40">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-slate-800/50">
                        <th className="px-5 py-2 text-left text-[10px] font-bold tracking-wider text-slate-500 uppercase">URL</th>
                        <th className="px-5 py-2 text-left text-[10px] font-bold tracking-wider text-slate-500 uppercase">Status</th>
                        <th className="px-5 py-2 text-left text-[10px] font-bold tracking-wider text-slate-500 uppercase">Latency</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.attempts.map((a, i) => (
                        <tr key={i} className="border-t border-slate-800/30 hover:bg-slate-800/20">
                          <td className="px-5 py-2.5 font-mono text-slate-300 break-all">{a.url}</td>
                          <td className="px-5 py-2.5">
                            {a.error
                              ? <span className="text-red-400">{a.error}</span>
                              : <span className={`font-bold ${a.httpStatus < 300 ? 'text-emerald-400' : a.httpStatus < 500 ? 'text-yellow-400' : 'text-red-400'}`}>{a.httpStatus}</span>}
                          </td>
                          <td className={`px-5 py-2.5 font-mono ${latencyColor(a.responseTimeMs)}`}>
                            {a.responseTimeMs != null ? `${a.responseTimeMs}ms` : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {!result && !loading && !error && (
        <div className="flex flex-col items-center justify-center py-16 gap-4">
          <Activity size={36} className="text-slate-700" />
          <p className="text-slate-500 text-sm">Click <strong>Run Ping Test</strong> to check if the app is reachable</p>
          <p className="text-slate-600 text-xs">Will test: <span className="text-slate-500 font-mono">{displayBase}/api/v1/ping</span> and fallbacks</p>
        </div>
      )}
    </div>
  );
}
