import { useState, useCallback } from 'react';
import { Activity, RefreshCw, CheckCircle2, XCircle, AlertCircle, ChevronDown, ChevronRight, Clock, Globe, Wifi, WifiOff, Key, Eye, EyeOff, ShieldCheck, Wand2, Lock, Zap, X } from 'lucide-react';
import api from '../services/api';
import { useCredentialStore } from '../context/CredentialStoreContext';
import { useCpsCredentialStore } from '../context/CpsCredentialStoreContext';
import CredentialImportButton from './CredentialImportButton';

const API_MGR_ORG_KEY = 'mule_dashboard_api_mgr_org_id';

export default function PingTestPanel({
  appName, isCH1, ch2IngressUrl, orgId, envId,
  defaultClientId = '', defaultClientSecret = '',
  cpsBaseUrl = '', cpsClientId = '', cpsKey = '', cpsEnv = '',
  pingSpec = null, pingSpecLoading = false,
}) {
  const { hasCredentials, resolveFromCandidates } = useCredentialStore();
  const { getSecret: getCpsSecret, hasCredentials: hasCpsCreds } = useCpsCredentialStore();

  const [clientId, setClientId] = useState(defaultClientId);
  const [clientSecret, setClientSecret] = useState(defaultClientSecret);
  const [showSecret, setShowSecret] = useState(false);
  const [autoResolving, setAutoResolving] = useState(false);
  const [autoResolved, setAutoResolved] = useState(null);

  const [authMode, setAuthMode] = useState('client-credentials');
  const [bearerToken, setBearerToken] = useState('');
  const [tokenUrl, setTokenUrl] = useState('');
  const [tokenClientId, setTokenClientId] = useState('');
  const [tokenClientSecret, setTokenClientSecret] = useState('');
  const [fetchingToken, setFetchingToken] = useState(false);
  const [tokenError, setTokenError] = useState(null);
  const [tokenExpiresIn, setTokenExpiresIn] = useState(null);
  const [showTokenHelper, setShowTokenHelper] = useState(false);
  const [autoConfiguringJwt, setAutoConfiguringJwt] = useState(false);
  const [gettingJwt, setGettingJwt] = useState(false);
  const [jwtError, setJwtError] = useState(null);
  const [jwtTokenUrl, setJwtTokenUrl] = useState(''); // stored once found, reused on refresh

  const [transactionId, setTransactionId] = useState('smokeTest');
  const [queryParams, setQueryParams] = useState('');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [showAttempts, setShowAttempts] = useState(false);

  const [apiMgrOrgId, setApiMgrOrgId] = useState(() => localStorage.getItem(API_MGR_ORG_KEY) || '');
  const [showApiMgrInput, setShowApiMgrInput] = useState(false);

  const saveApiMgrOrgId = (val) => {
    setApiMgrOrgId(val);
    if (val.trim()) localStorage.setItem(API_MGR_ORG_KEY, val.trim());
    else localStorage.removeItem(API_MGR_ORG_KEY);
  };

  const flattenCpsProps = (data) => {
    if (!data) return {};
    let props = {};
    if (Array.isArray(data?.responses)) data.responses.forEach(r => Object.assign(props, r.properties || {}));
    else if (Array.isArray(data)) data.forEach(r => { if (r?.properties) Object.assign(props, r.properties); });
    else if (data && typeof data === 'object') {
      const fv = Object.values(data)[0];
      props = (fv && typeof fv === 'object') ? Object.values(data).reduce((m, v) => (v && typeof v === 'object' ? Object.assign(m, v) : m), {}) : data;
    }
    return props;
  };

  const extractApiId = (props) => {
    if ('api.id' in props) { const v = String(props['api.id']).trim(); if (/^\d+$/.test(v)) return v; }
    const e1 = Object.entries(props).find(([k]) => k.endsWith('.api.id'));
    if (e1 && /^\d+$/.test(String(e1[1]).trim())) return String(e1[1]).trim();
    const e2 = Object.entries(props).find(([k, v]) => k.endsWith('.id') && /^\d+$/.test(String(v).trim()));
    if (e2) return String(e2[1]).trim();
    if ('id' in props && /^\d+$/.test(String(props['id']).trim())) return String(props['id']).trim();
    return null;
  };

  const autoFillCredentials = useCallback(async () => {
    if (!hasCredentials || !orgId || !envId) return;
    setAutoResolving(true);
    setAutoResolved(null);
    try {
      const body = { orgId, envId, appName };
      if (apiMgrOrgId.trim() && apiMgrOrgId.trim() !== orgId) body.apiMgrOrgId = apiMgrOrgId.trim();
      if (cpsBaseUrl && cpsKey) {
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
          const r = await api.get('/cps/fetch', { params: { baseUrl: cpsBaseUrl, type: 'non-secure', keys: cpsKey, ...(cpsEnv && { environment: cpsEnv }), bgOrgId: orgId } });
          const apiId = extractApiId(flattenCpsProps(r.data));
          if (apiId) body.apiId = apiId;
        } catch { /* continue */ }
      }
      const { data } = await api.post('/health/auto-credentials', body);
      if (data.found && data.matchInfo?.length > 0) {
        const matched = resolveFromCandidates(data.matchInfo.map(m => m.clientId));
        if (matched) {
          const meta = data.matchInfo.find(m => m.clientId === matched.clientId);
          setClientId(matched.clientId); setClientSecret(matched.clientSecret);
          setAutoResolved({ clientId: matched.clientId, apiInstanceName: meta?.apiInstanceName || '—', contractApp: meta?.contractApp || '—', source: 'csv' });
          setAutoResolving(false); return;
        }
        const apiInstanceId = data.matchedApis?.[0]?.id;
        if (apiInstanceId) {
          try {
            const cd = (await api.post('/health/auto-contract-creds', { orgId, envId, apiId: apiInstanceId })).data;
            if (cd.clientId && cd.clientSecret) {
              setClientId(cd.clientId); setClientSecret(cd.clientSecret);
              setAutoResolved({ clientId: cd.clientId, apiInstanceName: data.matchedApis[0]?.label || '—', contractApp: cd.appName || '—', source: cd.contractStatus === 'approved' ? 'contract' : 'contract-pending', contractStatus: cd.contractStatus });
              setAutoResolving(false); return;
            }
            if (cd.contractStatus === 'pending') { setAutoResolved({ error: `Contract requested for "${cd.appName}" — awaiting approval.` }); setAutoResolving(false); return; }
          } catch (e) { console.warn('[PingTestPanel] auto-contract-creds:', e.message); }
        }
        setAutoResolved({ error: 'API Manager found a match but no credential could be resolved. Import a CSV or create an Exchange app.' });
      } else {
        setAutoResolved({ error: 'No matching API Manager instance found for this app.' });
      }
    } catch (err) { setAutoResolved({ error: err.message }); }
    setAutoResolving(false);
  }, [hasCredentials, orgId, envId, appName, apiMgrOrgId, resolveFromCandidates]);

  const fetchOAuth2Token = async () => {
    if (!tokenUrl || !tokenClientId || !tokenClientSecret) return;
    setFetchingToken(true); setTokenError(null); setTokenExpiresIn(null);
    try {
      const { data } = await api.post('/health/oauth2-token', { tokenUrl: tokenUrl.trim(), clientId: tokenClientId.trim(), clientSecret: tokenClientSecret.trim() });
      setBearerToken(data.access_token);
      setTokenExpiresIn(data.expires_in || null);
    } catch (err) { setTokenError(err.response?.data?.error || err.message || 'Failed to fetch token'); }
    finally { setFetchingToken(false); }
  };

  // ── One-click: scan CPS → fetch JWT → switch to Bearer mode ─────────────
  const getJwtToken = async () => {
    if (!clientId || !clientSecret) {
      setJwtError('Auto-fill credentials from API Manager first, then click Get JWT Token');
      return;
    }
    setGettingJwt(true);
    setJwtError(null);

    const findOAuth2Url = (props) => {
      for (const [k, v] of Object.entries(props || {})) {
        const val = String(v || '');
        if (val.startsWith('http') && (
          val.includes('/oauth2/') || val.includes('okta.com') ||
          (val.includes('/token') && (k.toLowerCase().includes('jwt') || k.toLowerCase().includes('oauth') || k.toLowerCase().includes('token') || k.toLowerCase().includes('auth')))
        )) return val;
      }
      return '';
    };

    try {
      let foundTokenUrl = jwtTokenUrl; // reuse previously discovered URL

      if (!foundTokenUrl && cpsBaseUrl && cpsKey) {
        // Scan CPS non-secure first
        const nsRes = await api.get('/cps/fetch', {
          params: { baseUrl: cpsBaseUrl, type: 'non-secure', keys: cpsKey, ...(cpsEnv && { environment: cpsEnv }), bgOrgId: orgId }
        });
        const nsProps = flattenCpsProps(nsRes.data);
        foundTokenUrl = findOAuth2Url(nsProps);

        // If not found in non-secure, try CPS secure (jwt-auth-details group)
        if (!foundTokenUrl) {
          const secureKeys = (nsProps['cps.secure.properties'] || '').split(',').map(k => k.trim()).filter(Boolean);
          const jwtKey = secureKeys.find(k => k.toLowerCase().includes('jwt') || k.toLowerCase().includes('auth'));
          if (jwtKey) {
            try {
              if (cpsClientId && hasCpsCreds) {
                const secret = getCpsSecret(cpsClientId);
                if (secret) {
                  const credKey = `${cpsBaseUrl.trim().replace(/\/+$/, '').replace(/\/api\/v2\/?$/, '')}::${orgId}`;
                  await api.post('/cps/credentials', { credentials: { [credKey]: { clientId: cpsClientId, clientSecret: secret } } });
                }
              }
              const sr = await api.get('/cps/fetch', { params: { baseUrl: cpsBaseUrl, type: 'secure', keys: jwtKey, ...(cpsEnv && { environment: cpsEnv }), bgOrgId: orgId } });
              const sg = Array.isArray(sr.data?.responses) ? sr.data.responses : Array.isArray(sr.data?.properties) ? sr.data.properties : Array.isArray(sr.data) ? sr.data : [];
              for (const g of sg) { const u = findOAuth2Url(g.properties || {}); if (u) { foundTokenUrl = u; break; } }
            } catch { /* continue */ }
          }
        }
      }

      if (!foundTokenUrl) {
        setJwtError('No OAuth2 token URL found in CPS. Ensure jwt-auth-details secure group is configured.');
        setGettingJwt(false);
        return;
      }
      setJwtTokenUrl(foundTokenUrl); // cache for re-fetches

      // Fetch JWT token using resolved client credentials
      const { data } = await api.post('/health/oauth2-token', {
        tokenUrl: foundTokenUrl,
        clientId: clientId.trim(),
        clientSecret: clientSecret.trim(),
      });
      setBearerToken(data.access_token);
      setTokenExpiresIn(data.expires_in || null);
      setAuthMode('bearer-token');

    } catch (err) {
      setJwtError(err.response?.data?.error || err.message || 'Failed to get JWT token');
    } finally {
      setGettingJwt(false);
    }
  };

  // isJwtRequired: show banner on PARTIAL (any 4xx reachable response)
  const isJwtRequired = (r) => r?.status === 'PARTIAL';
  // autoConfigureJwt: banner button now just calls getJwtToken directly
  const autoConfigureJwt = async () => { setAutoConfiguringJwt(true); await getJwtToken(); setAutoConfiguringJwt(false); };

  const targetType = isCH1 ? 'CH1' : 'CH2';
  const displayBase = isCH1 ? `https://${appName}.api.sfdcbt.net` : ch2IngressUrl || '(no ingress URL detected)';

  const runPing = async () => {
    setLoading(true); setResult(null); setError(null); setShowAttempts(false);
    try {
      const { data } = await api.post('/health/ping', {
        targetType, appName,
        ch2IngressUrl: isCH1 ? undefined : ch2IngressUrl,
        ...(authMode === 'bearer-token'
          ? { bearerToken: bearerToken.trim() || undefined }
          : { clientId: clientId.trim() || undefined, clientSecret: clientSecret.trim() || undefined }),
        transactionId: transactionId.trim() || 'smokeTest',
        queryParams: queryParams.trim() || undefined,
      });
      setResult(data);
    } catch (err) { setError(err.response?.data?.error || err.message || 'Ping request failed'); }
    finally { setLoading(false); }
  };

  const badgeConfig = {
    SUCCESS: { icon: <CheckCircle2 size={15} className="text-emerald-400" />, label: 'Healthy / Reachable', cls: 'bg-emerald-950/50 border-emerald-700/50 text-emerald-300', dot: 'bg-emerald-400', ping: true },
    PARTIAL: { icon: <AlertCircle  size={15} className="text-yellow-400"  />, label: 'Reachable (non-2xx)', cls: 'bg-yellow-950/50 border-yellow-700/50 text-yellow-300',  dot: 'bg-yellow-400', ping: false },
    FAILED:  { icon: <XCircle      size={15} className="text-red-400"     />, label: 'Unreachable',         cls: 'bg-red-950/50 border-red-700/50 text-red-300',           dot: 'bg-red-500',    ping: false },
  };
  const badge = result ? badgeConfig[result.status] || badgeConfig.FAILED : null;
  const latencyColor = (ms) => !ms ? 'text-slate-400' : ms < 300 ? 'text-emerald-400' : ms < 1000 ? 'text-yellow-400' : 'text-red-400';

  const inputCls = 'w-full bg-slate-800/60 border border-slate-700/50 rounded-lg px-3 py-1.5 text-xs text-slate-200 font-mono placeholder-slate-600 focus:outline-none focus:border-cyan-600/50';
  const blueInputCls = 'w-full bg-slate-800/60 border border-slate-700/50 rounded-lg px-3 py-1.5 text-xs text-slate-200 font-mono placeholder-slate-600 focus:outline-none focus:border-blue-600/50';

  return (
    <div className="space-y-5">
      <div className="bg-slate-900/60 border border-slate-800/60 rounded-2xl px-5 py-4 space-y-4">

        {/* Header */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="space-y-1.5 flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <Activity size={13} className="text-cyan-400" />
              <span className="text-white text-sm font-semibold">Ping / Health Check</span>
              <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium border ${isCH1 ? 'bg-purple-950/50 text-purple-300 border-purple-700/50' : 'bg-blue-950/50 text-blue-300 border-blue-700/50'}`}>
                {isCH1 ? 'CloudHub 1.0' : 'CloudHub 2.0'}
              </span>
              {authMode === 'bearer-token' && (
                <span className="text-[10px] px-2 py-0.5 rounded-full font-medium border bg-indigo-950/50 text-indigo-300 border-indigo-700/50 flex items-center gap-1">
                  <Lock size={8} /> JWT Auth
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              <Globe size={11} className="text-slate-500" />
              <span className="text-slate-400 text-xs font-mono break-all">{displayBase}</span>
            </div>
            <p className="text-slate-600 text-[11px]">Tries: <span className="text-slate-500">/api/v1/ping → /api/v2/ping → /api/ping → /ping</span></p>
          </div>
          <button onClick={runPing} disabled={loading || (!isCH1 && !ch2IngressUrl)}
            className="flex items-center gap-2 px-4 py-2.5 bg-cyan-700 hover:bg-cyan-600 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-xl transition-colors flex-shrink-0">
            {loading ? <><RefreshCw size={14} className="animate-spin" /> Pinging…</> : <><Wifi size={14} /> Run Ping Test</>}
          </button>
        </div>

        {/* Exchange spec hint */}
        {(pingSpecLoading || pingSpec) && (
          <div className="pt-1 border-t border-slate-800/60">
            {pingSpecLoading ? (
              <div className="flex items-center gap-1.5 text-[10px] text-slate-500"><RefreshCw size={9} className="animate-spin" /> Fetching API spec from Exchange…</div>
            ) : pingSpec?.pingEndpoints?.length > 0 ? (
              <div className="bg-blue-950/20 border border-blue-800/40 rounded-lg px-3 py-2 space-y-1.5">
                <p className="text-[10px] text-blue-300 font-medium flex items-center gap-1"><Globe size={9} /> Spec-detected ping endpoint{pingSpec.pingEndpoints.length > 1 ? 's' : ''}</p>
                <div className="flex flex-wrap gap-1.5">
                  {pingSpec.pingEndpoints.map((ep, i) => {
                    const requiredQp = (ep.queryParams || []).filter(p => p.required);
                    const qpString = requiredQp.map(p => `${p.name}=${p.example || p.type || ''}`).join('&');
                    return (
                      <button key={i} onClick={() => { if (qpString) setQueryParams(qpString); }}
                        title={qpString ? `Click to auto-fill: ${qpString}` : ep.path}
                        className="flex items-center gap-1 text-[10px] px-2 py-1 bg-blue-900/30 border border-blue-700/40 rounded text-blue-300 hover:bg-blue-900/50 transition-colors font-mono">
                        <span className="text-blue-500">{ep.method}</span>
                        <span>{ep.path}</span>
                        {requiredQp.length > 0 && <span className="text-orange-400 ml-0.5">+{requiredQp.length}p</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : pingSpec ? <p className="text-[10px] text-slate-600">No ping/health endpoint in spec — using standard paths</p> : null}
          </div>
        )}

        {/* Query params */}
        <div className={pingSpec || pingSpecLoading ? '' : 'pt-1 border-t border-slate-800/60'}>
          <label className="text-[10px] text-slate-500 uppercase tracking-wider font-medium flex items-center gap-1 mb-1">
            <Globe size={9} /> Query Parameters <span className="normal-case text-slate-600 font-normal">(optional)</span>
          </label>
          <input value={queryParams} onChange={e => setQueryParams(e.target.value)} placeholder="e.g. checkDb=true&type=health" className={inputCls} />
        </div>

        {/* Auth Mode + Credentials */}
        <div className="space-y-3">
          {/* Mode toggle */}
          <div className="flex items-center gap-0.5 bg-slate-800/60 rounded-lg p-0.5 w-fit border border-slate-700/40">
            <button onClick={() => setAuthMode('client-credentials')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${authMode === 'client-credentials' ? 'bg-slate-700 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'}`}>
              <Key size={10} /> Client ID / Secret
            </button>
            <button onClick={() => setAuthMode('bearer-token')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${authMode === 'bearer-token' ? 'bg-blue-700/80 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'}`}>
              <Lock size={10} /> Bearer Token (JWT)
            </button>
          </div>

          {authMode === 'client-credentials' ? (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1">
                <label className="text-[10px] text-slate-500 uppercase tracking-wider font-medium flex items-center gap-1"><Key size={9} /> client_id</label>
                <input value={clientId} onChange={e => { setClientId(e.target.value); setAutoResolved(null); }} placeholder="optional" className={inputCls} />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] text-slate-500 uppercase tracking-wider font-medium flex items-center gap-1"><Key size={9} /> client_secret</label>
                <div className="relative">
                  <input value={clientSecret} onChange={e => setClientSecret(e.target.value)} type={showSecret ? 'text' : 'password'} placeholder="optional"
                    className="w-full bg-slate-800/60 border border-slate-700/50 rounded-lg px-3 py-1.5 pr-8 text-xs text-slate-200 font-mono placeholder-slate-600 focus:outline-none focus:border-cyan-600/50" />
                  <button onClick={() => setShowSecret(!showSecret)} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300">
                    {showSecret ? <EyeOff size={12} /> : <Eye size={12} />}
                  </button>
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-[10px] text-slate-500 uppercase tracking-wider font-medium">x-transaction-id</label>
                <input value={transactionId} onChange={e => setTransactionId(e.target.value)} placeholder="smokeTest" className={inputCls} />
              </div>
            </div>
          ) : (
            /* ── Bearer Token (JWT) mode ── */
            <div className="space-y-3">
              <div className="space-y-1">
                <label className="text-[10px] text-slate-500 uppercase tracking-wider font-medium flex items-center gap-1"><Lock size={9} /> Bearer Token (JWT / OAuth2)</label>
                <div className="relative">
                  <textarea value={bearerToken} onChange={e => setBearerToken(e.target.value)} rows={3}
                    placeholder="Paste your JWT or access_token here, or use the OAuth2 helper below to fetch one automatically…"
                    className="w-full bg-slate-800/60 border border-slate-700/50 rounded-lg px-3 py-2 text-xs text-slate-200 font-mono placeholder-slate-600 focus:outline-none focus:border-blue-600/50 resize-y pr-8" />
                  {bearerToken && (
                    <button onClick={() => { setBearerToken(''); setTokenExpiresIn(null); }} title="Clear"
                      className="absolute top-2 right-2 text-slate-500 hover:text-slate-300 bg-slate-800/80 rounded p-0.5"><X size={11} /></button>
                  )}
                </div>
                {tokenExpiresIn && <p className="text-[10px] text-emerald-500">✓ Token fetched — expires in {tokenExpiresIn}s</p>}
                {bearerToken && !tokenExpiresIn && <p className="text-[10px] text-blue-400/70">🎟 Will send as <code className="text-blue-300">Authorization: Bearer …</code></p>}
              </div>
              <div className="space-y-1 w-48">
                <label className="text-[10px] text-slate-500 uppercase tracking-wider font-medium">x-transaction-id</label>
                <input value={transactionId} onChange={e => setTransactionId(e.target.value)} placeholder="smokeTest" className={inputCls} />
              </div>
              {/* OAuth2 helper */}
              <div className="border border-slate-700/40 rounded-xl overflow-hidden">
                <button onClick={() => setShowTokenHelper(!showTokenHelper)}
                  className="w-full flex items-center justify-between px-4 py-2.5 bg-slate-800/40 hover:bg-slate-800/70 text-slate-400 hover:text-white text-xs font-medium transition-colors">
                  <div className="flex items-center gap-1.5"><Zap size={10} className="text-blue-400" /><span>Get token from OAuth2 endpoint</span><span className="text-slate-600 font-normal">(client_credentials)</span></div>
                  {showTokenHelper ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                </button>
                {showTokenHelper && (
                  <div className="px-4 py-3 space-y-3 bg-slate-800/20 border-t border-slate-700/40">
                    <div className="space-y-1">
                      <label className="text-[10px] text-slate-500 uppercase tracking-wider">Token URL</label>
                      <input value={tokenUrl} onChange={e => setTokenUrl(e.target.value)} placeholder="https://auth.example.com/oauth/token" className={blueInputCls} />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <label className="text-[10px] text-slate-500 uppercase tracking-wider">Client ID</label>
                        <input value={tokenClientId} onChange={e => setTokenClientId(e.target.value)} placeholder="client_id" className={blueInputCls} />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] text-slate-500 uppercase tracking-wider">Client Secret</label>
                        <input type="password" value={tokenClientSecret} onChange={e => setTokenClientSecret(e.target.value)} placeholder="client_secret" className={blueInputCls} />
                      </div>
                    </div>
                    {tokenError && <p className="text-[10px] text-red-400 flex items-center gap-1"><XCircle size={10} /> {tokenError}</p>}
                    <button onClick={fetchOAuth2Token} disabled={fetchingToken || !tokenUrl || !tokenClientId || !tokenClientSecret}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-medium rounded-lg transition-colors">
                      {fetchingToken ? <><RefreshCw size={10} className="animate-spin" /> Fetching…</> : <><Zap size={10} /> Fetch Token → fill above</>}
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* CSV import + auto-fill (client-credentials mode only) */}
        {authMode === 'client-credentials' && (
          <div className="space-y-2 pt-1 border-t border-slate-800/40">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2 flex-wrap">
                <CredentialImportButton compact />
                {hasCredentials && (
                  <>
                    <button onClick={autoFillCredentials} disabled={autoResolving || !orgId || !envId}
                      title="Auto-fill credentials from API Manager contracts + your loaded CSV"
                      className="flex items-center gap-1.5 text-[10px] px-2.5 py-1.5 bg-emerald-500/10 border border-emerald-700/40 text-emerald-400 hover:bg-emerald-500/20 rounded-lg transition-colors disabled:opacity-50 font-medium">
                      {autoResolving ? <><RefreshCw size={9} className="animate-spin" /> Resolving…</> : <><Wand2 size={9} /> Auto-fill from API Manager</>}
                    </button>
                  </>
                )}
                {/* Get JWT Token — one-click CPS scan + OAuth2 token fetch */}
                {cpsBaseUrl && (
                  <button onClick={getJwtToken} disabled={gettingJwt}
                    title="Scan CPS for OAuth2 token URL, fetch JWT and switch to Bearer Token mode"
                    className="flex items-center gap-1.5 text-[10px] px-2.5 py-1.5 bg-indigo-500/10 border border-indigo-700/40 text-indigo-400 hover:bg-indigo-500/20 rounded-lg transition-colors disabled:opacity-50 font-medium">
                    {gettingJwt ? <><RefreshCw size={9} className="animate-spin" /> Getting JWT…</> : <><Lock size={9} /> Get JWT Token</>}
                  </button>
                )}
                {hasCredentials && (
                  <button onClick={() => setShowApiMgrInput(v => !v)}
                    className={`text-[10px] px-1.5 py-1 rounded border transition-colors ${apiMgrOrgId.trim() ? 'bg-blue-500/10 border-blue-700/40 text-blue-400' : 'bg-slate-800 border-slate-700 text-slate-500 hover:text-slate-300'}`}>
                    {apiMgrOrgId.trim() ? '🏢 API Mgr BG set' : '⚙ API Mgr BG'}
                  </button>
                )}
              </div>
              {autoResolved && !autoResolved.error && (
                <span className={`flex items-center gap-1 text-[10px] ${autoResolved.source === 'contract-pending' ? 'text-yellow-400/80' : 'text-emerald-400/80'}`}>
                  <ShieldCheck size={9} />
                  {autoResolved.source === 'contract' ? '🔑 contract: ' : autoResolved.source === 'contract-pending' ? '⏳ pending: ' : ''}
                  {autoResolved.apiInstanceName} → {autoResolved.contractApp}
                </span>
              )}
              {autoResolved?.source === 'contract-pending' && (
                <button onClick={autoFillCredentials} disabled={autoResolving}
                  className="flex items-center gap-1 text-[10px] px-2 py-1 bg-yellow-900/30 border border-yellow-700/40 text-yellow-300 hover:bg-yellow-900/50 rounded transition-colors">
                  {autoResolving ? <RefreshCw size={9} className="animate-spin" /> : <RefreshCw size={9} />} Re-check Approval
                </button>
              )}
              {autoResolved?.error && <span className="text-[10px] text-yellow-500/80">{autoResolved.error}</span>}
              {jwtError && <span className="text-[10px] text-red-400/80 flex items-center gap-1"><XCircle size={9} /> {jwtError}</span>}
            </div>
            {hasCredentials && showApiMgrInput && (
              <div className="bg-slate-800/40 border border-slate-700/40 rounded-lg px-3 py-2.5 space-y-1.5">
                <p className="text-[10px] text-slate-400">If your API Manager is in a <strong className="text-slate-300">different Business Group</strong>, enter that BG Org ID below. Saved for all ping tests.</p>
                <div className="flex items-center gap-2">
                  <input value={apiMgrOrgId} onChange={e => saveApiMgrOrgId(e.target.value)} placeholder={`Default: ${orgId}`}
                    className="flex-1 bg-slate-800 border border-slate-700/50 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 font-mono placeholder-slate-600 focus:outline-none focus:border-blue-600/50" />
                  {apiMgrOrgId.trim() && <button onClick={() => saveApiMgrOrgId('')} className="text-slate-500 hover:text-red-400 text-[10px] px-2 py-1.5 rounded border border-slate-700 hover:border-red-700/40 transition-colors">Clear</button>}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {!isCH1 && !ch2IngressUrl && (
        <div className="flex items-center gap-3 bg-yellow-950/30 border border-yellow-800/50 rounded-xl px-4 py-3 text-yellow-400 text-sm">
          <AlertCircle size={15} className="flex-shrink-0" /><span>No public ingress URL found for this CH2 app. Check the <strong>Infra & Config</strong> tab.</span>
        </div>
      )}
      {error && (
        <div className="flex items-center gap-3 bg-red-950/30 border border-red-800/50 rounded-xl px-4 py-3 text-red-400 text-sm">
          <WifiOff size={15} className="flex-shrink-0" /><span>{error}</span>
        </div>
      )}

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
            {result.responseTimeMs != null && <span className={`font-mono text-sm font-bold ${latencyColor(result.responseTimeMs)}`}>{result.responseTimeMs}ms</span>}
          </div>
          {/* JWT auto-configure banner — shown when 401/403 with token indicators */}
          {isJwtRequired(result) && authMode === 'client-credentials' && (
            <div className="flex items-start justify-between gap-4 bg-indigo-950/30 border border-indigo-800/40 rounded-xl px-4 py-3">
              <div className="flex items-start gap-3">
                <Lock size={14} className="text-indigo-400 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-indigo-300 text-sm font-medium">JWT / Bearer Auth Required</p>
                  <p className="text-indigo-500/80 text-xs mt-1">
                    The API returned <strong className="text-indigo-300">{result.httpStatus}</strong> — this app likely requires a Bearer Token (JWT).
                    Click to auto-configure: scans CPS for the Okta OAuth2 token URL and pre-fills your current client credentials.
                  </p>
                </div>
              </div>
              <button onClick={autoConfigureJwt} disabled={autoConfiguringJwt}
                className="flex-shrink-0 flex items-center gap-1.5 px-3 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-medium rounded-lg transition-colors">
                {autoConfiguringJwt ? <><RefreshCw size={10} className="animate-spin" /> Configuring…</> : <><Zap size={10} /> Auto-Configure JWT</>}
              </button>
            </div>
          )}

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
            {result.error && <div className="border-t border-slate-800/40 px-5 py-3 flex items-center gap-2 text-red-400 text-xs"><XCircle size={12} className="flex-shrink-0" />{result.error}</div>}
          </div>
          {result.attempts?.length > 0 && (
            <div className="bg-slate-900/40 border border-slate-800/60 rounded-2xl overflow-hidden">
              <button onClick={() => setShowAttempts(!showAttempts)}
                className="w-full flex items-center justify-between px-5 py-3 text-slate-400 hover:text-white text-xs font-semibold transition-colors">
                <div className="flex items-center gap-2"><Clock size={12} />Ping Attempt Log ({result.attempts.length} path{result.attempts.length !== 1 ? 's' : ''} tried)</div>
                {showAttempts ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </button>
              {showAttempts && (
                <div className="border-t border-slate-800/40">
                  <table className="w-full text-xs">
                    <thead><tr className="bg-slate-800/50">
                      <th className="px-5 py-2 text-left text-[10px] font-bold tracking-wider text-slate-500 uppercase">URL</th>
                      <th className="px-5 py-2 text-left text-[10px] font-bold tracking-wider text-slate-500 uppercase">Status</th>
                      <th className="px-5 py-2 text-left text-[10px] font-bold tracking-wider text-slate-500 uppercase">Latency</th>
                    </tr></thead>
                    <tbody>
                      {result.attempts.map((a, i) => (
                        <tr key={i} className="border-t border-slate-800/30 hover:bg-slate-800/20">
                          <td className="px-5 py-2.5 font-mono text-slate-300 break-all">{a.url}</td>
                          <td className="px-5 py-2.5">{a.error ? <span className="text-red-400">{a.error}</span> : <span className={`font-bold ${a.httpStatus < 300 ? 'text-emerald-400' : a.httpStatus < 500 ? 'text-yellow-400' : 'text-red-400'}`}>{a.httpStatus}</span>}</td>
                          <td className={`px-5 py-2.5 font-mono ${latencyColor(a.responseTimeMs)}`}>{a.responseTimeMs != null ? `${a.responseTimeMs}ms` : '—'}</td>
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
