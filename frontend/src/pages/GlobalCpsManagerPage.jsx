import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Database, Search, ShieldCheck, RefreshCw, AlertTriangle, Key, Upload, FileUp, Settings, X, Download, Trash2, Code } from 'lucide-react';
import Select from '../components/Select';
import GlobalCpsCsvUpload from '../components/GlobalCpsCsvUpload';
import { useCpsCredentialStore } from '../context/CpsCredentialStoreContext';
import { PropertyTable, SecureGroupEditor, AuthTabWithSearch } from './CpsManagerPage';
import CpsBinaryUploadPanel from '../components/CpsBinaryUploadPanel';
import CpsImportModal from '../components/CpsImportModal';
import CpsDeleteProjectModal from '../components/CpsDeleteProjectModal';
import CpsRawJsonModal from '../components/CpsRawJsonModal';
import api from '../services/api';
import axios from 'axios';
import { flattenCpsResponse } from '../utils/cpsHelpers';
import { mockNonSecureResponse, mockSecureResponse } from '../utils/mockCpsData';
import { isDemoMode } from '../utils/demoMode';
import { downloadJson } from '../utils/appUtils';

const PROP_TYPE_TABS = [
  { id: 'non-secure', label: 'Non-Secure' },
  { id: 'secure', label: 'Secure' },
  { id: 'binaries', label: 'Binaries' },
  { id: 'auth', label: '🔐 Access Control' },
];

const CPS_URLS = {
  ch1: {
    uat: import.meta.env.VITE_CPS_CH1_UAT || 'https://cps-server-uat.internalapi.sfdcbt.net',
    prod: import.meta.env.VITE_CPS_CH1_PROD || 'https://cps-server.internalapi.sfdcbt.net'
  },
  ch2: {
    uat: import.meta.env.VITE_CPS_CH2_UAT || 'https://ch2-uat-cps.example.com',
    prod: import.meta.env.VITE_CPS_CH2_PROD || 'https://ch2-prod-cps.example.com'
  }
};

export default function GlobalCpsManagerPage() {
  const { globalCredentials, hasGlobalCredentials, getGlobalCredential, loadGlobalFromCsv } = useCpsCredentialStore();
  const fileInputRef = useRef(null);

  const handlePremiumUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      loadGlobalFromCsv(ev.target.result);
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const [bg, setBg] = useState('');
  const [env, setEnv] = useState('uat');
  const [chVersion, setChVersion] = useState('ch1');
  const [globalSearch, setGlobalSearch] = useState('');

  const [originalProps, setOriginalProps] = useState({});
  const [pendingChanges, setPendingChanges] = useState({ added: {}, modified: {}, deleted: new Set() });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [showImport, setShowImport] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [showSecureRawJson, setShowSecureRawJson] = useState(false);
  const [saving, setSaving] = useState(false);
  
  const [activeTab, setActiveTab] = useState('non-secure');
  const [secureGroups, setSecureGroups] = useState([]);
  const [binaryKeys, setBinaryKeys] = useState([]);
  const [secureGroupSearch, setSecureGroupSearch] = useState('');
  const [lastOperation, setLastOperation] = useState(null);
  
  const [queryType, setQueryType] = useState('non-secure');
  const [hasSearched, setHasSearched] = useState(false);

  const [showOverrides, setShowOverrides] = useState(false);
  const [customHost, setCustomHost] = useState('');
  const [queryEnv, setQueryEnv] = useState('');
  const [queryKeys, setQueryKeys] = useState('');
  const [customClientId, setCustomClientId] = useState('');
  const [customClientSecret, setCustomClientSecret] = useState('');
  const bgOptions = useMemo(() => {
    return globalCredentials.map(g => ({ value: g.businessGroup, label: g.businessGroup }));
  }, [globalCredentials]);

  // Reset bg if not in options
  useEffect(() => {
    if (bgOptions.length > 0 && !bgOptions.find(o => o.value === bg)) {
      setBg(bgOptions[0].value);
    }
  }, [bgOptions, bg]);

  const cpsBaseUrl = CPS_URLS[chVersion]?.[env] || '';
  const isProd = env.toLowerCase() === 'prod';
  const hasPendingChanges = Object.keys(pendingChanges.added).length > 0 || 
                            Object.keys(pendingChanges.modified).length > 0 || 
                            pendingChanges.deleted.size > 0;
  const pendingCount = Object.keys(pendingChanges.added).length + Object.keys(pendingChanges.modified).length + pendingChanges.deleted.size;

  const fetchProperties = useCallback(async () => {
    if (!queryKeys.trim()) return;

    if (isDemoMode()) {
      loadMockData();
      return;
    }

    setLoading(true);
    setError('');
    
    // We get the credentials for the backend proxy to use if needed
    // However, our backend proxy (/api/cps/fetch) natively checks the session store
    // The credentials should be passed or we need an endpoint to seed them? 
    // Usually, CPS routes just use the baseUrl and bgOrgId in the current implementation.
    // Let's pass the specific credential in headers or body if required, or we can assume
    // the user wants us to use the global credentials to get the client id/secret.
    
    const cred = getGlobalCredential(bg, env, chVersion);

    const activeHost = customHost.trim() || cpsBaseUrl;
    const activeParams = { 
      environment: queryEnv.trim() || env, 
      keys: queryKeys.trim()
    };

    const activeHeaders = {
      client_id: customClientId.trim() || cred?.clientId,
      client_secret: customClientSecret.trim() || cred?.clientSecret,
      'Content-Type': 'application/json'
    };

    try {
      // Seed the credentials into the backend session for this specific host/BG combination
      const storageKey = `${activeHost}::${bg}`;
      await api.post('/cps/credentials', {
        credentials: {
          [storageKey]: { 
            clientId: activeHeaders.client_id || cred?.clientId, 
            clientSecret: activeHeaders.client_secret || cred?.clientSecret 
          }
        }
      });

      setOriginalProps({});
      setPendingChanges({ added: {}, modified: {}, deleted: new Set() });
      setSecureGroups([]);
      setBinaryKeys([]);
      setHasSearched(true);

      if (queryType === 'binary') {
        const keysArr = activeParams.keys.split(',').map(k => k.trim()).filter(Boolean);
        setBinaryKeys(keysArr);
        setActiveTab('binaries');
        setLoading(false);
        return;
      }

      if (queryType === 'secure') {
        try {
          const secRes = await api.get('/cps/fetch', {
            params: { baseUrl: activeHost, type: 'secure', environment: activeParams.environment, keys: activeParams.keys, bgOrgId: bg }
          });
          const groups = Array.isArray(secRes.data?.responses) ? secRes.data.responses : [];
          setSecureGroups(groups);
        } catch {}
        setActiveTab('secure');
        setLoading(false);
        return;
      }

      // Fetch via backend proxy for non-secure
      const nsRes = await api.get('/cps/fetch', {
        params: {
          baseUrl: activeHost,
          type: 'non-secure',
          bgOrgId: bg,
          ...activeParams
        }
      });
      
      const flat = flattenCpsResponse(nsRes.data, activeParams.keys);
      setOriginalProps(flat);
      setPendingChanges({ added: {}, modified: {}, deleted: new Set() });

      // Extract binary keys from non-secure
      const binStr = flat['cps.secure.binaries'] || '';
      if (binStr) setBinaryKeys(binStr.split(',').map(k => k.trim()).filter(Boolean));

      // Try to load secure
      const secStr = flat['cps.secure.properties'] || '';
      if (secStr) {
        try {
          const secRes = await api.get('/cps/fetch', {
            params: { baseUrl: activeHost, type: 'secure', environment: activeParams.environment, keys: secStr, bgOrgId: bg }
          });
          const groups = Array.isArray(secRes.data?.responses) ? secRes.data.responses : [];
          setSecureGroups(groups);
        } catch {}
      }
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to load CPS properties');
    }
    setLoading(false);
  }, [bg, queryKeys, queryEnv, customHost, customClientId, customClientSecret, env, chVersion, cpsBaseUrl, getGlobalCredential]);

  const loadMockData = () => {
    setHasSearched(true);
    
    const requestedKey = queryKeys.trim() || mockNonSecureResponse.responses[0].key;

    if (queryType === 'binary') {
      setBinaryKeys(['mock-keystore.jks', 'mock-truststore.p12']);
      setActiveTab('binaries');
      return;
    }
    if (queryType === 'secure') {
      const groups = [
        { key: requestedKey, environment: queryEnv || 'uat', properties: { "secure.password": "mock123", "secure.token": "abc" } }
      ];
      setSecureGroups(groups);
      setActiveTab('secure');
      return;
    }
    
    // Default non-secure mock
    const mockRes = {
      ...mockNonSecureResponse,
      responses: [
        {
          ...mockNonSecureResponse.responses[0],
          key: requestedKey,
          environment: queryEnv || mockNonSecureResponse.responses[0].environment
        }
      ]
    };
    
    const flat = flattenCpsResponse(mockRes, requestedKey);
    setOriginalProps(flat);
    setPendingChanges({ added: {}, modified: {}, deleted: new Set() });
    setActiveTab('non-secure');

    const binStr = flat['cps.secure.binaries'] || '';
    if (binStr) setBinaryKeys(binStr.split(',').map(k => k.trim()).filter(Boolean));

    const groups = [
        { key: requestedKey, environment: queryEnv || 'uat', properties: { "secure.password": "mock123" } }
    ];
    setSecureGroups(groups);
  };

  const updateProperty = (key, newValue) => {
    setPendingChanges(prev => {
      const next = { ...prev, added: { ...prev.added }, modified: { ...prev.modified }, deleted: new Set(prev.deleted) };
      if (key in prev.added) { next.added = { ...prev.added, [key]: newValue }; }
      else { next.modified = { ...prev.modified, [key]: newValue }; }
      return next;
    });
  };

  const addProperty = (key, value) => {
    if (!key.trim()) return;
    setPendingChanges(prev => ({
      ...prev,
      added: { ...prev.added, [key.trim()]: value },
      deleted: (() => { const s = new Set(prev.deleted); s.delete(key.trim()); return s; })(),
    }));
  };

  const markDeleted = (key) => {
    setPendingChanges(prev => {
      const next = { ...prev, added: { ...prev.added }, modified: { ...prev.modified }, deleted: new Set(prev.deleted) };
      if (key in next.added) { delete next.added[key]; }
      else { next.deleted.add(key); delete next.modified[key]; }
      return next;
    });
  };

  const discardChanges = () => setPendingChanges({ added: {}, modified: {}, deleted: new Set() });

  const saveProperties = async () => {
    if (!hasPendingChanges) return;
    setSaving(true);
    setError('');

    const cred = getGlobalCredential(bg, env, chVersion);
    const mergedProps = { ...originalProps, ...pendingChanges.modified, ...pendingChanges.added };
    pendingChanges.deleted.forEach(k => delete mergedProps[k]);

    const activeHost = customHost.trim() || cpsBaseUrl;
    const activeParams = { 
      environment: queryEnv.trim() || env, 
      keys: queryKeys.trim() 
    };

    const activeHeaders = {
      client_id: customClientId.trim() || cred?.clientId,
      client_secret: customClientSecret.trim() || cred?.clientSecret,
      'Content-Type': 'application/json'
    };

    try {
      // Seed the credentials into the backend session
      const storageKey = `${activeHost}::${bg}`;
      await api.post('/cps/credentials', {
        credentials: {
          [storageKey]: { 
            clientId: activeHeaders.client_id || cred?.clientId, 
            clientSecret: activeHeaders.client_secret || cred?.clientSecret 
          }
        }
      });

      // Write via backend proxy
      await api.post('/cps/write', {
        baseUrl: activeHost,
        type: 'non-secure',
        method: 'PUT',
        bgOrgId: bg,
        properties: mergedProps,
        ...activeParams,
        projectKey: activeParams.keys
      });
      
      setOriginalProps(mergedProps);
      setPendingChanges({ added: {}, modified: {}, deleted: new Set() });
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Save failed');
    }
    setSaving(false);
  };

  const exportJson = () => {
    if (activeTab === 'non-secure') {
      downloadJson(mergedProps, `cps-nonsecure-${queryKeys || 'export'}.json`);
    } else if (activeTab === 'secure') {
      downloadJson(secureGroups, `cps-secure-${queryKeys || 'export'}.json`);
    }
  };

  const handleImport = ({ count, mergedProps }) => {
    if (activeTab === 'non-secure') {
      alert(`Successfully imported ${count} properties.`);
      if (isDemoMode && mergedProps) {
        setOriginalProps(mergedProps);
        setPendingChanges({ added: {}, modified: {}, deleted: new Set() });
      } else {
        fetchProperties();
      }
    } else if (activeTab === 'secure') {
      alert("Bulk import for secure properties on the Global page must be done per group, which is currently unsupported here.");
    }
  };

  const mergedProps = useMemo(() => {
    const m = { ...originalProps, ...pendingChanges.modified, ...pendingChanges.added };
    pendingChanges.deleted.forEach(k => delete m[k]);
    return m;
  }, [originalProps, pendingChanges]);

  return (
    <div className="p-6 max-w-[1600px] mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Database className="text-indigo-500" />
            Global CPS Manager
          </h1>
          <p className="text-gray-400 text-sm mt-1">
            Manage Config Property Server (CPS) values across multiple business groups and environments globally.
          </p>
        </div>
        {hasGlobalCredentials && (
          <div className="flex items-center gap-3">
            <GlobalCpsCsvUpload />
          </div>
        )}
      </div>

      {!hasGlobalCredentials ? (
        <div
          style={{
            background: 'radial-gradient(ellipse at top, rgba(79, 70, 229, 0.15) 0%, rgba(15, 23, 42, 0.9) 60%, #0f172a 100%)',
            boxShadow: '0 20px 40px -15px rgba(0,0,0,0.5)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
          }}
          className="rounded-[2rem] p-12 lg:p-16 text-center flex flex-col items-center justify-center mx-auto max-w-3xl mt-12 mb-20"
        >
          <div
            style={{
              border: '1px solid rgba(59, 130, 246, 0.3)',
              background: 'radial-gradient(circle at center, rgba(59, 130, 246, 0.15) 0%, transparent 70%)',
            }}
            className="p-5 rounded-full mb-8 relative flex items-center justify-center shadow-[0_0_30px_rgba(59,130,246,0.2)]"
          >
            <FileUp size={44} className="text-blue-400" />
          </div>
          
          <h2
            style={{ letterSpacing: '-0.02em' }}
            className="text-3xl lg:text-4xl font-semibold text-white mb-4 font-sans"
          >
            Global Configuration
          </h2>
          
          <p className="max-w-xl text-base mb-10 leading-relaxed text-slate-400">
            Upload your master configuration CSV to manage properties across all business groups, <strong className="text-slate-200 font-medium">UAT/PROD</strong> environments, and <strong className="text-slate-200 font-medium">CH1/CH2</strong> versions from a single interface.
          </p>
          
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            onChange={handlePremiumUpload}
            style={{ display: 'none' }}
          />
          
          <div
            style={{
              border: '1px dashed rgba(255, 255, 255, 0.15)',
              backgroundColor: 'rgba(255, 255, 255, 0.02)'
            }}
            className="w-full max-w-lg rounded-2xl p-10 flex flex-col items-center justify-center transition-all hover:bg-white/5 cursor-pointer group"
            onClick={() => fileInputRef.current?.click()}
          >
            <button
              onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}
              style={{
                background: 'linear-gradient(180deg, #3b82f6 0%, #2563eb 100%)',
                boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.2), 0 4px 14px 0 rgba(37,99,235,0.39)',
              }}
              className="flex items-center gap-2.5 px-6 py-3 text-sm font-medium text-white rounded-lg transition-transform active:scale-95 group-hover:brightness-110 mb-4"
            >
              <Upload size={16} />
              Browse Files
            </button>
            <span className="text-sm text-slate-300 font-medium">
              Drag & drop your CSV here, or browse
            </span>
            <span className="text-xs text-slate-500 mt-2">
              Supports .csv files up to 25MB • UTF-8 encoded
            </span>
          </div>
        </div>
      ) : (
        <>
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5 space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div>
                <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                  Business Group
                </label>
                <Select
                  value={bg}
                  onChange={setBg}
                  options={bgOptions.length ? bgOptions : [{ value: '', label: 'No BGs found' }]}
                />
              </div>
              
              <div>
                <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                  Environment
                </label>
                <Select
                  value={env}
                  onChange={setEnv}
                  options={[
                    { value: 'uat', label: 'UAT' },
                    { value: 'prod', label: 'PROD' }
                  ]}
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                  CloudHub Version
                </label>
                <Select
                  value={chVersion}
                  onChange={setChVersion}
                  options={[
                    { value: 'ch1', label: 'CloudHub 1.0 (CH1)' },
                    { value: 'ch2', label: 'CloudHub 2.0 (CH2)' }
                  ]}
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                  CPS Config URL (Auto)
                </label>
                <div className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-300 font-mono flex items-center gap-2 h-[38px]">
                  <Database size={14} className="text-indigo-400 flex-shrink-0" />
                  <span className="truncate">{cpsBaseUrl}</span>
                </div>
              </div>
            </div>
            
            <div className="flex flex-wrap items-end gap-4 border-t border-gray-800 pt-5">
              <div className="flex-[1.5] min-w-[300px]">
                <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <Key size={12} className="text-gray-500" />
                  Query Type & Keys
                </label>
                <div className="flex">
                  <div className="w-[140px] flex-shrink-0">
                    <Select
                      value={queryType}
                      onChange={val => {
                        setQueryType(val);
                        if (val === 'secure') setActiveTab('secure');
                        if (val === 'binary') setActiveTab('binaries');
                        if (val === 'non-secure') setActiveTab('non-secure');
                      }}
                      options={[
                        { value: 'non-secure', label: 'Non-Secure' },
                        { value: 'secure', label: 'Secure' },
                        { value: 'binary', label: 'Binary' }
                      ]}
                      className="[&>button]:rounded-l-xl [&>button]:rounded-r-none [&>button]:border-r-0 [&>button]:h-[42px]"
                    />
                  </div>
                  <input
                    type="text"
                    value={queryKeys}
                    onChange={e => setQueryKeys(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && fetchProperties()}
                    placeholder={queryType === 'binary' ? "e.g. keystore.jks" : "e.g. my-app-v1"}
                    className="flex-1 min-w-0 bg-gray-900 border border-gray-700 rounded-r-xl px-3 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500 font-mono transition-colors"
                  />
                </div>
              </div>

              <div className="flex-[1] min-w-[200px]">
                <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                  Query: env
                </label>
                <input
                  type="text"
                  value={queryEnv}
                  onChange={e => setQueryEnv(e.target.value)}
                  placeholder={env}
                  className="w-full bg-gray-900 border border-gray-700 rounded-xl px-3 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500 font-mono transition-colors"
                />
              </div>
              <button
                onClick={() => setShowOverrides(!showOverrides)}
                className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-lg transition-colors h-[42px] border ${
                  showOverrides ? 'bg-gray-800 border-gray-600 text-white' : 'bg-transparent border-gray-700 text-gray-400 hover:text-gray-300 hover:bg-gray-800'
                }`}
              >
                <Settings size={16} />
              </button>
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    setHasSearched(false);
                    setOriginalProps({});
                    setSecureGroups([]);
                    setBinaryKeys([]);
                  }}
                  disabled={!hasSearched}
                  className="flex items-center gap-2 px-4 py-2.5 bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors h-[42px]"
                >
                  <X size={16} /> Clear
                </button>
                <button
                  onClick={fetchProperties}
                  disabled={loading || !queryKeys.trim()}
                  className="flex items-center gap-2 px-6 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors shadow-lg shadow-indigo-900/20 h-[42px]"
                >
                  {loading ? <RefreshCw size={16} className="animate-spin" /> : (hasSearched ? <RefreshCw size={16} /> : <Search size={16} />)}
                  {hasSearched ? 'Refresh' : 'Load Properties'}
                </button>
              </div>
            </div>
            
            {showOverrides && (
              <div className="bg-gray-950/50 border border-gray-800 rounded-xl p-5 space-y-5">
                <h3 className="text-sm font-semibold text-gray-300 flex items-center gap-2">
                  <Settings size={14} className="text-indigo-400" /> Advanced Request Overrides
                </h3>
                
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  {/* Host Override */}
                  <div className="space-y-4">
                    <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Host</h4>
                    <div>
                      <label className="block text-xs text-gray-400 mb-1.5">Custom CPS Host</label>
                      <input
                        type="text"
                        value={customHost}
                        onChange={e => setCustomHost(e.target.value)}
                        placeholder={cpsBaseUrl}
                        className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500 font-mono"
                      />
                    </div>
                  </div>

                  {/* Query Params Overrides */}
                  <div className="space-y-4">
                    <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Query Params</h4>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs text-gray-400 mb-1.5">env</label>
                        <input
                          type="text"
                          value={queryEnv}
                          onChange={e => setQueryEnv(e.target.value)}
                          placeholder={env}
                          className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500 font-mono"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-400 mb-1.5">keys</label>
                        <input
                          type="text"
                          value={queryKeys}
                          onChange={e => setQueryKeys(e.target.value)}
                          placeholder="e.g. my-app-v1"
                          className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500 font-mono"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Headers Overrides */}
                  <div className="space-y-4">
                    <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Auth Headers</h4>
                    <div className="space-y-3">
                      <div>
                        <label className="block text-xs text-gray-400 mb-1.5">client_id</label>
                        <input
                          type="text"
                          value={customClientId}
                          onChange={e => setCustomClientId(e.target.value)}
                          placeholder="Default from CSV"
                          className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500 font-mono"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-400 mb-1.5">client_secret</label>
                        <input
                          type="text"
                          value={customClientSecret}
                          onChange={e => setCustomClientSecret(e.target.value)}
                          placeholder="Default from CSV"
                          className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500 font-mono"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {error && (
            <div className="bg-red-950/30 border border-red-900/50 rounded-xl p-4 flex items-start gap-3">
              <AlertTriangle className="text-red-500 flex-shrink-0 mt-0.5" size={18} />
              <div className="text-sm text-red-400">{error}</div>
            </div>
          )}

          {hasSearched && (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div className="flex items-center gap-1 p-1 bg-gray-900 border border-gray-800 rounded-xl w-fit">
                  {PROP_TYPE_TABS.map(t => (
                    <button
                      key={t.id}
                      onClick={() => setActiveTab(t.id)}
                      className={`px-4 py-2 text-xs font-medium rounded-lg transition-all ${
                        activeTab === t.id
                          ? 'bg-gray-800 text-white shadow-sm'
                          : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800/50'
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
                
                <div className="flex items-center gap-2">
                  {activeTab !== 'binaries' && (
                    <>
                      <button onClick={() => setShowImport(true)}
                        className="flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300 bg-blue-950/40 border border-blue-800/50 px-2.5 py-1.5 rounded-lg transition-colors">
                        <Upload size={11} /> Import
                      </button>
                      <button onClick={exportJson}
                        className="flex items-center gap-1.5 text-xs text-emerald-400 hover:text-emerald-300 bg-emerald-950/40 border border-emerald-800/50 px-2.5 py-1.5 rounded-lg transition-colors">
                        <Download size={11} /> Export JSON
                      </button>
                    </>
                  )}
                  {activeTab !== 'auth' && (
                    <button onClick={() => setShowDelete(true)}
                      className="flex items-center gap-1.5 text-xs text-red-400 hover:text-red-300 bg-red-950/40 border border-red-800/50 px-2.5 py-1.5 rounded-lg transition-colors">
                      <Trash2 size={11} /> Delete Project
                    </button>
                  )}
                </div>
              </div>

              {activeTab === 'non-secure' && (
                <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5 space-y-4">
                  <PropertyTable
                    props={mergedProps}
                    originalProps={originalProps}
                    pendingChanges={pendingChanges}
                    search={globalSearch}
                    setSearch={setGlobalSearch}
                    onUpdate={updateProperty}
                    onDelete={markDeleted}
                    onAdd={addProperty}
                    hasPendingChanges={hasPendingChanges}
                    pendingCount={pendingCount}
                    onSave={saveProperties}
                    onDiscard={discardChanges}
                    saving={saving}
                    isProd={isProd}
                    allProps={mergedProps}
                    envStr={env}
                    keyStr={queryKeys}
                  />
                </div>
              )}

              {activeTab === 'secure' && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between bg-gray-900 border border-gray-800 rounded-xl p-4">
                    <div>
                      <h3 className="text-sm font-semibold text-white">Secure Properties</h3>
                      <p className="text-xs text-gray-500 mt-1">
                        Encrypted values that are securely stored in the CPS.
                      </p>
                    </div>
                    <button 
                      onClick={() => setShowSecureRawJson(true)}
                      className="flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300 bg-blue-950/40 border border-blue-800/50 px-3 py-1.5 rounded-lg transition-colors"
                    >
                      <Code size={12} /> Global Raw JSON
                    </button>
                  </div>

                  <div className="relative">
                    <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
                    <input
                      value={secureGroupSearch}
                      onChange={e => setSecureGroupSearch(e.target.value)}
                      placeholder={`Search groups, keys, or values... (${secureGroups.length} group${secureGroups.length !== 1 ? 's' : ''})`}
                      className="w-full bg-gray-900 border border-gray-700 rounded-xl pl-9 pr-10 py-2.5 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-cyan-600/50"
                    />
                  </div>

                  {secureGroups
                    .filter(g => {
                      if (!secureGroupSearch.trim()) return true;
                      const q = secureGroupSearch.toLowerCase();
                      if ((g.key || '').toLowerCase().includes(q)) return true;
                      if (g.properties && typeof g.properties === 'object') {
                        return Object.entries(g.properties).some(([k, v]) => 
                          k.toLowerCase().includes(q) || String(v).toLowerCase().includes(q)
                        );
                      }
                      return false;
                    })
                    .map(group => (
                      <SecureGroupEditor
                        key={group.key}
                        group={group}
                        baseUrl={customHost.trim() || cpsBaseUrl}
                        environment={queryEnv.trim() || env}
                        bgOrgId={bg}
                        isProd={isProd}
                        onResult={setLastOperation}
                        globalSearch={secureGroupSearch}
                        onGroupDeleted={deletedKey => {
                          setSecureGroups(prev => prev.filter(g => g.key !== deletedKey));
                        }}
                      />
                    ))}
                </div>
              )}

              {activeTab === 'binaries' && (
                <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
                  <CpsBinaryUploadPanel
                    baseUrl={customHost.trim() || cpsBaseUrl}
                    environment={queryEnv.trim() || env}
                    bgOrgId={bg}
                    existingKeys={binaryKeys}
                    isProd={isProd}
                    onUploaded={key => { fetchProperties(); }}
                    onResult={setLastOperation}
                  />
                </div>
              )}

              {activeTab === 'auth' && (
                <AuthTabWithSearch
                  cpsBaseUrl={customHost.trim() || cpsBaseUrl}
                  cpsEnv={queryEnv.trim() || env}
                  cpsKey={queryKeys.trim()}
                  secureGroups={secureGroups}
                  resolvedBgId={bg}
                  setLastOperation={setLastOperation}
                />
              )}
            </div>
          )}
        </>
      )}

      {/* Render Import Modal if toggled */}
      {showImport && (
        <CpsImportModal
          onClose={() => setShowImport(false)}
          baseUrl={customHost.trim() || cpsBaseUrl}
          type={activeTab}
          environment={queryEnv.trim() || env}
          projectKey={queryKeys}
          bgOrgId={bg}
          isProd={isProd}
          existingProps={mergedProps}
          onImported={handleImport}
        />
      )}

      {/* Render Delete Modal if toggled */}
      {showDelete && (
        <CpsDeleteProjectModal
          onClose={() => setShowDelete(false)}
          baseUrl={customHost.trim() || cpsBaseUrl}
          type={activeTab === 'secure' ? 'secure' : activeTab === 'binaries' ? 'binaries' : 'non-secure'}
          environment={queryEnv.trim() || env}
          projectKey={queryKeys}
          bgOrgId={bg}
          isProd={isProd}
          onResult={setLastOperation}
          onDeleted={() => {
            setShowDelete(false);
            setHasSearched(false);
            setOriginalProps({});
            setSecureGroups([]);
            setBinaryKeys([]);
            alert(`Successfully deleted properties for ${queryKeys}.`);
          }}
        />
      )}

      {/* Secure Global Raw JSON Editor */}
      {showSecureRawJson && (
        <CpsRawJsonModal
          isOpen={showSecureRawJson}
          onClose={() => setShowSecureRawJson(false)}
          initialJson={secureGroups}
          onSave={(parsedGroups) => {
            if (Array.isArray(parsedGroups)) {
               setSecureGroups(parsedGroups);
            } else {
               alert("Secure groups must be an array of objects.");
            }
          }}
          title="Global Secure Properties JSON"
          description="Edit all secure groups globally. Find and replace functionality is available."
        />
      )}
    </div>
  );
}
