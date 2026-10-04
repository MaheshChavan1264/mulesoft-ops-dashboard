import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { usePendingPropertyChanges } from '../../hooks/usePendingPropertyChanges';
import { Database, Globe, Search, ShieldCheck, RefreshCw, AlertTriangle, Key, Upload, FileUp, Settings, X, Download, Trash2, Code } from 'lucide-react';
import Select from '../../components/ui/Select';
import GlobalCpsCsvUpload from './GlobalCpsCsvUpload';
import { useGlobalCpsCredentialStore } from '../../context/GlobalCpsCredentialStoreContext';
import { PropertyTable } from './PropertyTable';
import { SecureGroupEditor } from './SecureGroupEditor';
import { AuthTabWithSearch } from './AuthTabWithSearch';
import CpsRequestResponsePanel from './CpsRequestResponsePanel';
import CpsBinaryUploadPanel from './CpsBinaryUploadPanel';
import CpsImportModal from './CpsImportModal';
import CpsDeleteProjectModal from './CpsDeleteProjectModal';
import CpsRawJsonModal from './CpsRawJsonModal';
import { postCpsCredentialsRaw, fetchCpsProperties, writeCpsProperties } from '../../services/cpsService';
import axios from 'axios';
import { flattenCpsResponse } from '../../utils/cpsHelpers';
import { getErrorMessage } from '../../services/http';
import { mockNonSecureResponse, mockSecureResponse } from '../../services/mocks/mockCpsProperties';
import { isDemoMode } from '../../utils/demoMode';
import { downloadJson } from '../../utils/appUtils';
import PageHeader from '../../components/ui/PageHeader';

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
  const { globalCredentials, hasGlobalCredentials, getGlobalCredential, loadGlobalFromCsv } = useGlobalCpsCredentialStore();
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
  const {
    pendingChanges, setPendingChanges, mergedProps, pendingCount, hasPendingChanges,
    updateProperty, addProperty, markDeleted, discardChanges,
  } = usePendingPropertyChanges(originalProps);
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
  const [loadedParams, setLoadedParams] = useState(null);

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
  // hasPendingChanges / pendingCount come from usePendingPropertyChanges above.

  const fetchProperties = useCallback(async (isRefresh = false) => {
    const keysToUse = isRefresh && loadedParams ? loadedParams.keys : queryKeys.trim();
    const envToUse = isRefresh && loadedParams ? loadedParams.environment : (queryEnv.trim() || env);
    const typeToUse = isRefresh && loadedParams ? loadedParams.type : queryType;

    if (!keysToUse) return;

    if (isDemoMode()) {
      if (!isRefresh) setLoadedParams({ keys: keysToUse, environment: envToUse, type: typeToUse });
      loadMockData(keysToUse, envToUse, typeToUse);
      return;
    }

    setLoading(true);
    setError('');
    
    const cred = getGlobalCredential(bg, env, chVersion);

    const activeHost = customHost.trim() || cpsBaseUrl;
    const activeParams = { 
      environment: envToUse, 
      keys: keysToUse
    };

    const activeHeaders = {
      client_id: customClientId.trim() || cred?.clientId,
      client_secret: customClientSecret.trim() || cred?.clientSecret,
      'Content-Type': 'application/json'
    };

    try {
      // Seed the credentials into the backend session for this specific host/BG combination
      const storageKey = `${activeHost}::${bg}`;
      await postCpsCredentialsRaw({
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

      if (!isRefresh) {
        setLoadedParams({ keys: keysToUse, environment: envToUse, type: typeToUse });
      }

      if (typeToUse === 'binary') {
        const keysArr = activeParams.keys.split(',').map(k => k.trim()).filter(Boolean);
        setBinaryKeys(keysArr);
        setActiveTab('binaries');
        setLoading(false);
        setLastOperation({
          label: 'Fetch Binary Properties',
          timestamp: new Date().toISOString(),
          requestDetails: { method: 'GET', url: `/api/cps/fetch?type=binary`, params: activeParams },
          responseDetails: { status: 200, body: keysArr },
          success: true
        });
        return;
      }

      if (typeToUse === 'secure') {
        try {
          const secData = await fetchCpsProperties({ baseUrl: activeHost, type: 'secure', environment: activeParams.environment, keys: activeParams.keys, bgOrgId: bg });
          const groups = Array.isArray(secData?.responses) ? secData.responses : [];
          setSecureGroups(groups);
          setLastOperation({
            label: 'Fetch Secure Properties',
            timestamp: new Date().toISOString(),
            requestDetails: secData?.requestDetails || { method: 'GET', params: { ...activeParams, type: 'secure' } },
            responseDetails: secData?.responseDetails || { status: 200, body: secData },
            success: true
          });
        } catch (err) {
          setLastOperation({
            label: 'Fetch Secure Properties',
            timestamp: new Date().toISOString(),
            requestDetails: err.response?.data?.requestDetails || { method: 'GET', params: { ...activeParams, type: 'secure' } },
            responseDetails: err.response?.data?.responseDetails || { status: err.response?.status, body: err.response?.data },
            success: false
          });
          throw err;
        }
        setActiveTab('secure');
        setLoading(false);
        return;
      }

      // Fetch via backend proxy for non-secure
      const nsData = await fetchCpsProperties({
        baseUrl: activeHost,
        type: 'non-secure',
        bgOrgId: bg,
        ...activeParams
      });
      
      const flat = flattenCpsResponse(nsData, activeParams.keys);
      setOriginalProps(flat);
      setPendingChanges({ added: {}, modified: {}, deleted: new Set() });

      setLastOperation({
        label: 'Fetch Non-Secure Properties',
        timestamp: new Date().toISOString(),
        requestDetails: nsData?.requestDetails || { method: 'GET', params: { ...activeParams, type: 'non-secure' } },
        responseDetails: nsData?.responseDetails || { status: 200, body: nsData },
        success: true
      });

      // Extract binary keys from non-secure
      const binStr = flat['cps.secure.binaries'] || '';
      if (binStr) setBinaryKeys(binStr.split(',').map(k => k.trim()).filter(Boolean));

      // Try to load secure
      const secStr = flat['cps.secure.properties'] || '';
      if (secStr) {
        try {
          const secData = await fetchCpsProperties({ baseUrl: activeHost, type: 'secure', environment: activeParams.environment, keys: secStr, bgOrgId: bg });
          const groups = Array.isArray(secData?.responses) ? secData.responses : [];
          setSecureGroups(groups);
        } catch {}
      }
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to load CPS properties'));
      setLastOperation({
        label: 'Fetch Properties Error',
        timestamp: new Date().toISOString(),
        requestDetails: err.response?.data?.requestDetails || { method: 'GET', params: { type: typeToUse } },
        responseDetails: err.response?.data?.responseDetails || { status: err.response?.status, body: err.response?.data },
        success: false
      });
    }
    setLoading(false);
  }, [bg, queryKeys, queryEnv, queryType, loadedParams, customHost, customClientId, customClientSecret, env, chVersion, cpsBaseUrl, getGlobalCredential]);

  const loadMockData = (keysToUse, envToUse, typeToUse) => {
    setHasSearched(true);
    
    const requestedKey = keysToUse || mockNonSecureResponse.responses[0].key;

    if (typeToUse === 'binary') {
      setBinaryKeys(['mock-keystore.jks', 'mock-truststore.p12']);
      setActiveTab('binaries');
      return;
    }
    if (typeToUse === 'secure') {
      const groups = [
        { key: requestedKey, environment: envToUse || 'uat', properties: { "secure.password": "mock123", "secure.token": "abc" } }
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
          environment: envToUse || mockNonSecureResponse.responses[0].environment
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
        { key: requestedKey, environment: envToUse || 'uat', properties: { "secure.password": "mock123" } }
    ];
    setSecureGroups(groups);
  };

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
      await postCpsCredentialsRaw({
        credentials: {
          [storageKey]: { 
            clientId: activeHeaders.client_id || cred?.clientId, 
            clientSecret: activeHeaders.client_secret || cred?.clientSecret 
          }
        }
      });

      // Write via backend proxy
      const reqDetails = {
        method: 'PUT',
        url: `/api/cps/write`,
        params: { baseUrl: activeHost, type: 'non-secure', bgOrgId: bg, ...activeParams, projectKey: activeParams.keys },
        body: mergedProps
      };
      
      const saveData = await writeCpsProperties({
        baseUrl: activeHost,
        type: 'non-secure',
        method: 'PUT',
        bgOrgId: bg,
        properties: mergedProps,
        ...activeParams,
        projectKey: activeParams.keys
      });
      
      setLastOperation({
        label: 'Save Properties',
        timestamp: new Date().toISOString(),
        requestDetails: saveData.data?.requestDetails || reqDetails,
        responseDetails: saveData.data?.responseDetails || { status: 200, body: saveData.data },
        success: true
      });
      
      setOriginalProps(mergedProps);
      setPendingChanges({ added: {}, modified: {}, deleted: new Set() });
    } catch (err) {
      setError(getErrorMessage(err, 'Save failed'));
      setLastOperation({
        label: 'Save Properties',
        timestamp: new Date().toISOString(),
        requestDetails: err.response?.data?.requestDetails || { method: 'PUT', params: { ...activeParams, type: 'non-secure' } },
        responseDetails: err.response?.data?.responseDetails || { status: err.response?.status, body: err.response?.data },
        success: false
      });
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

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Globe}
        gradient="from-sfpurple-500 to-sf-500"
        shadow="shadow-md shadow-sfpurple-500/30 dark:shadow-sfpurple-500/20"
        title="Global CPS Manager"
        subtitle="Manage Config Property Server values across business groups and environments, globally."
        actions={hasGlobalCredentials ? <GlobalCpsCsvUpload /> : undefined}
      />

      {!hasGlobalCredentials ? (
        <div className="relative overflow-hidden rounded-[2rem] p-12 lg:p-16 text-center flex flex-col items-center justify-center mx-auto max-w-3xl mt-6 mb-16 bg-white dark:bg-gradient-to-b dark:from-gray-800 dark:to-gray-800/90 border border-gray-200 dark:border-white/[0.07] shadow-sm dark:shadow-[0_8px_30px_-6px_rgba(0,0,0,0.5)]">
          <div className="absolute inset-0 bg-gradient-to-br from-sfpurple-50/70 via-transparent to-sf-50/50 dark:from-sfpurple-500/[0.06] dark:via-transparent dark:to-sf-500/[0.04]" />

          <div className="relative p-5 rounded-full mb-8 flex items-center justify-center bg-gradient-to-br from-sfpurple-100 to-sf-100 dark:from-sfpurple-500/15 dark:to-sf-500/10 shadow-[0_0_30px_rgba(142,78,198,0.15)] dark:shadow-[0_0_30px_rgba(142,78,198,0.1)]">
            <FileUp size={44} className="text-sfpurple-600 dark:text-sfpurple-400" />
          </div>

          <h2 className="relative text-3xl lg:text-4xl font-semibold text-gray-900 dark:text-gray-100 mb-4 tracking-tight">
            Global Configuration
          </h2>

          <p className="relative max-w-xl text-base mb-10 leading-relaxed text-gray-500 dark:text-gray-400">
            Upload your master configuration CSV to manage properties across all business groups, <strong className="text-gray-700 dark:text-gray-300 font-semibold">UAT/PROD</strong> environments, and <strong className="text-gray-700 dark:text-gray-300 font-semibold">CH1/CH2</strong> versions from a single interface.
          </p>

          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            onChange={handlePremiumUpload}
            style={{ display: 'none' }}
          />

          <div
            className="relative w-full max-w-lg rounded-2xl p-10 flex flex-col items-center justify-center transition-all border border-dashed border-gray-300 dark:border-gray-600 hover:bg-sfpurple-50/40 dark:hover:bg-sfpurple-500/[0.04] hover:border-sfpurple-300 dark:hover:border-sfpurple-400/40 cursor-pointer group"
            onClick={() => fileInputRef.current?.click()}
          >
            <button
              onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}
              className="flex items-center gap-2.5 px-6 py-3 text-sm font-semibold text-white rounded-xl transition-all active:scale-95 bg-gradient-to-r from-sfpurple-600 to-sf-600 group-hover:from-sfpurple-500 group-hover:to-sf-500 shadow-md shadow-sfpurple-500/30 mb-4"
            >
              <Upload size={16} />
              Browse Files
            </button>
            <span className="text-sm text-gray-600 dark:text-gray-400 font-medium">
              Drag & drop your CSV here, or browse
            </span>
            <span className="text-xs text-gray-400 dark:text-gray-500 mt-2">
              Supports .csv files up to 25MB · UTF-8 encoded
            </span>
          </div>
        </div>
      ) : (
        <>
          <div className="card-surface p-5 space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div>
                <label className="block text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-2">
                  Business Group
                </label>
                <Select
                  value={bg}
                  onChange={setBg}
                  options={bgOptions.length ? bgOptions : [{ value: '', label: 'No BGs found' }]}
                  className="[&>button]:h-[42px]"
                />
              </div>
              
              <div>
                <label className="block text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-2">
                  Environment
                </label>
                <Select
                  value={env}
                  onChange={setEnv}
                  options={[
                    { value: 'uat', label: 'UAT' },
                    { value: 'prod', label: 'PROD' }
                  ]}
                  className="[&>button]:h-[42px]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-2">
                  CloudHub Version
                </label>
                <Select
                  value={chVersion}
                  onChange={setChVersion}
                  options={[
                    { value: 'ch1', label: 'CloudHub 1.0 (CH1)' },
                    { value: 'ch2', label: 'CloudHub 2.0 (CH2)' }
                  ]}
                  className="[&>button]:h-[42px]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-2">
                  CPS Config URL (Auto)
                </label>
                <div className="bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2 text-sm text-gray-600 dark:text-gray-300 font-mono flex items-center gap-2 h-[42px]">
                  <Database size={14} className="text-sfpurple-600 dark:text-sfpurple-400 flex-shrink-0" />
                  <span className="truncate">{cpsBaseUrl}</span>
                </div>
              </div>
            </div>
            
            <div className="flex flex-wrap items-end gap-4 border-t border-gray-100 dark:border-white/[0.06] pt-5">
              <div className="flex-[1.5] min-w-[300px]">
                <label className="block text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <Key size={12} className="text-gray-400 dark:text-gray-500" />
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
                    className="flex-1 min-w-0 bg-white dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded-r-xl px-3 h-[42px] text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:border-sf-500 dark:focus:border-sf-400 focus:ring-2 focus:ring-sf-500/15 font-mono transition-all"
                  />
                </div>
              </div>

              <div className="flex-[1] min-w-[200px]">
                <label className="block text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-2">
                  Query: env
                </label>
                <input
                  type="text"
                  value={queryEnv}
                  onChange={e => setQueryEnv(e.target.value)}
                  placeholder={env}
                  className="w-full bg-white dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded-xl px-3 h-[42px] text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:border-sf-500 dark:focus:border-sf-400 focus:ring-2 focus:ring-sf-500/15 font-mono transition-all"
                />
              </div>
              <button
                onClick={() => setShowOverrides(!showOverrides)}
                title="Advanced request overrides"
                className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-xl transition-all h-[42px] border shadow-sm ${
                  showOverrides ? 'bg-sfpurple-50 dark:bg-sfpurple-500/10 border-sfpurple-300/60 dark:border-sfpurple-400/30 text-sfpurple-700 dark:text-sfpurple-300' : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200'
                }`}
              >
                <Settings size={16} />
              </button>
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    setHasSearched(false);
                    setLoadedParams(null);
                    setOriginalProps({});
                    setSecureGroups([]);
                    setBinaryKeys([]);
                    setLastOperation(null);
                  }}
                  disabled={!hasSearched}
                  className="flex items-center gap-2 px-4 py-2.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/60 disabled:opacity-50 text-gray-700 dark:text-gray-200 text-sm font-medium rounded-xl shadow-sm transition-all h-[42px]"
                >
                  <X size={16} /> Clear
                </button>
                <button
                  onClick={() => fetchProperties(false)}
                  disabled={loading || !queryKeys.trim()}
                  className="flex items-center gap-2 px-6 py-2.5 bg-gradient-to-r from-sfpurple-600 to-sf-600 hover:from-sfpurple-500 hover:to-sf-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-xl transition-all shadow-md shadow-sfpurple-500/25 h-[42px]"
                >
                  {loading && !loadedParams ? <RefreshCw size={16} className="animate-spin" /> : <Search size={16} />}
                  Load Properties
                </button>
                {hasSearched && (
                  <button
                    onClick={() => fetchProperties(true)}
                    disabled={loading}
                    className="flex items-center gap-2 px-4 py-2.5 bg-sfteal-600 hover:bg-sfteal-500 disabled:opacity-50 text-white text-sm font-semibold rounded-xl transition-all shadow-md shadow-sfteal-500/25 h-[42px]"
                  >
                    <RefreshCw size={16} className={loading && loadedParams ? "animate-spin" : ""} />
                    Refresh
                  </button>
                )}
              </div>
            </div>
            
            {showOverrides && (
              <div className="bg-sfpurple-50/40 dark:bg-sfpurple-500/[0.04] border border-sfpurple-200/50 dark:border-sfpurple-400/20 rounded-2xl p-5 space-y-5">
                <h3 className="text-sm font-semibold text-sfpurple-700 dark:text-sfpurple-300 flex items-center gap-2">
                  <Settings size={14} /> Advanced Request Overrides
                </h3>
                
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  {/* Host Override */}
                  <div className="space-y-4">
                    <h4 className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">Host</h4>
                    <div>
                      <label className="block text-xs text-gray-400 dark:text-gray-500 mb-1.5">Custom CPS Host</label>
                      <input
                        type="text"
                        value={customHost}
                        onChange={e => setCustomHost(e.target.value)}
                        placeholder={cpsBaseUrl}
                        className="w-full bg-white dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:border-sfpurple-400 focus:ring-2 focus:ring-sfpurple-500/15 font-mono transition-all"
                      />
                    </div>
                  </div>

                  {/* Query Params Overrides */}
                  <div className="space-y-4">
                    <h4 className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">Query Params</h4>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs text-gray-400 dark:text-gray-500 mb-1.5">env</label>
                        <input
                          type="text"
                          value={queryEnv}
                          onChange={e => setQueryEnv(e.target.value)}
                          placeholder={env}
                          className="w-full bg-white dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:border-sfpurple-400 focus:ring-2 focus:ring-sfpurple-500/15 font-mono transition-all"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-400 dark:text-gray-500 mb-1.5">keys</label>
                        <input
                          type="text"
                          value={queryKeys}
                          onChange={e => setQueryKeys(e.target.value)}
                          placeholder="e.g. my-app-v1"
                          className="w-full bg-white dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:border-sfpurple-400 focus:ring-2 focus:ring-sfpurple-500/15 font-mono transition-all"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Headers Overrides */}
                  <div className="space-y-4">
                    <h4 className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">Auth Headers</h4>
                    <div className="space-y-3">
                      <div>
                        <label className="block text-xs text-gray-400 dark:text-gray-500 mb-1.5">client_id</label>
                        <input
                          type="text"
                          value={customClientId}
                          onChange={e => setCustomClientId(e.target.value)}
                          placeholder="Default from CSV"
                          className="w-full bg-white dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:border-sfpurple-400 focus:ring-2 focus:ring-sfpurple-500/15 font-mono transition-all"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-400 dark:text-gray-500 mb-1.5">client_secret</label>
                        <input
                          type="text"
                          value={customClientSecret}
                          onChange={e => setCustomClientSecret(e.target.value)}
                          placeholder="Default from CSV"
                          className="w-full bg-white dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:border-sfpurple-400 focus:ring-2 focus:ring-sfpurple-500/15 font-mono transition-all"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {error && (
            <div className="flex items-center gap-2.5 bg-sfred-50 dark:bg-sfred-500/10 border border-sfred-200/80 dark:border-sfred-400/30 rounded-2xl px-4 py-3 shadow-sm">
              <AlertTriangle className="text-sfred-600 dark:text-sfred-400 flex-shrink-0" size={16} />
              <div className="text-sm text-sfred-700 dark:text-sfred-300">{error}</div>
            </div>
          )}

          {hasSearched && (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div className="flex items-center gap-1 p-1 bg-gray-100 dark:bg-gray-900/40 border border-gray-200 dark:border-gray-700 rounded-xl w-fit">
                  {PROP_TYPE_TABS.map(t => (
                    <button
                      key={t.id}
                      onClick={() => setActiveTab(t.id)}
                      className={`px-4 py-2 text-xs font-semibold rounded-lg transition-all ${
                        activeTab === t.id
                          ? 'bg-white dark:bg-sf-500/20 text-sf-700 dark:text-sf-300 shadow-sm'
                          : 'text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200'
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
                        className="flex items-center gap-1.5 text-xs font-medium text-sf-700 dark:text-sf-300 hover:text-sf-800 dark:hover:text-sf-200 bg-sf-50 dark:bg-sf-500/10 border border-sf-200/70 dark:border-sf-400/30 px-2.5 py-1.5 rounded-xl shadow-sm hover:shadow-md transition-all">
                        <Upload size={11} /> Import
                      </button>
                      <button onClick={exportJson}
                        className="flex items-center gap-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-300 hover:text-emerald-800 dark:hover:text-emerald-200 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200/70 dark:border-emerald-400/30 px-2.5 py-1.5 rounded-xl shadow-sm hover:shadow-md transition-all">
                        <Download size={11} /> Export JSON
                      </button>
                    </>
                  )}
                  {activeTab !== 'auth' && (
                    <button onClick={() => setShowDelete(true)}
                      className="flex items-center gap-1.5 text-xs font-medium text-sfred-700 dark:text-sfred-300 hover:text-sfred-800 dark:hover:text-sfred-200 bg-sfred-50 dark:bg-sfred-500/10 border border-sfred-200/70 dark:border-sfred-400/30 px-2.5 py-1.5 rounded-xl shadow-sm hover:shadow-md transition-all">
                      <Trash2 size={11} /> Delete Project
                    </button>
                  )}
                </div>
              </div>

              {activeTab === 'non-secure' && (
                <div className="card-surface p-5 space-y-4">
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
                  <div className="flex items-center justify-between card-surface p-4">
                    <div>
                      <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Secure Properties</h3>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                        Encrypted values that are securely stored in the CPS.
                      </p>
                    </div>
                    <button 
                      onClick={() => setShowSecureRawJson(true)}
                      className="flex items-center gap-1.5 text-xs font-medium text-sf-700 dark:text-sf-300 hover:text-sf-800 dark:hover:text-sf-200 bg-sf-50 dark:bg-sf-500/10 border border-sf-200/70 dark:border-sf-400/30 px-3 py-1.5 rounded-xl shadow-sm hover:shadow-md transition-all"
                    >
                      <Code size={12} /> Global Raw JSON
                    </button>
                  </div>

                  <div className="relative">
                    <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500 pointer-events-none" />
                    <input
                      value={secureGroupSearch}
                      onChange={e => setSecureGroupSearch(e.target.value)}
                      placeholder={`Search groups, keys, or values... (${secureGroups.length} group${secureGroups.length !== 1 ? 's' : ''})`}
                      className="w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl pl-9 pr-10 py-2.5 text-xs text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 shadow-sm focus:outline-none focus:border-sf-500 dark:focus:border-sf-400 focus:ring-2 focus:ring-sf-500/15 transition-all"
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
                <div className="card-surface p-5">
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

      {/* Request / Response debug panel */}
      {lastOperation && (
        <CpsRequestResponsePanel
          operation={lastOperation}
          onDismiss={() => setLastOperation(null)}
        />
      )}
    </div>
  );
}
