import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Database, Search, ShieldCheck, RefreshCw, AlertTriangle, Key, Upload } from 'lucide-react';
import Select from '../components/Select';
import GlobalCpsCsvUpload from '../components/GlobalCpsCsvUpload';
import { useCpsCredentialStore } from '../context/CpsCredentialStoreContext';
import { PropertyTable } from './CpsManagerPage';
import api from '../services/api';
import { flattenCpsResponse } from '../utils/cpsHelpers';

const CPS_URLS = {
  ch1: {
    uat: 'https://cps-server-uat.internalapi.sfdcbt.net',
    prod: 'https://cps-server.internalapi.sfdcbt.net'
  },
  ch2: {
    uat: 'https://ch2-uat-cps.example.com',
    prod: 'https://ch2-prod-cps.example.com'
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
  const [projectKey, setProjectKey] = useState('');
  const [globalSearch, setGlobalSearch] = useState('');

  const [originalProps, setOriginalProps] = useState({});
  const [pendingChanges, setPendingChanges] = useState({ added: {}, modified: {}, deleted: new Set() });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

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
    if (!bg || !projectKey.trim()) return;
    setLoading(true);
    setError('');
    
    // We get the credentials for the backend proxy to use if needed
    // However, our backend proxy (/api/cps/fetch) natively checks the session store
    // The credentials should be passed or we need an endpoint to seed them? 
    // Usually, CPS routes just use the baseUrl and bgOrgId in the current implementation.
    // Let's pass the specific credential in headers or body if required, or we can assume
    // the user wants us to use the global credentials to get the client id/secret.
    
    const cred = getGlobalCredential(bg, env, chVersion);
    if (!cred || !cred.clientId || !cred.clientSecret) {
       setError(`No credentials found for BG: ${bg}, Env: ${env}, CH: ${chVersion}. Please verify your CSV.`);
       setLoading(false);
       return;
    }

    try {
      // Load non-secure properties
      const nsRes = await api.get('/cps/fetch', {
        params: { 
          baseUrl: cpsBaseUrl, 
          type: 'non-secure', 
          environment: env, 
          keys: projectKey, 
          bgOrgId: bg,
          clientId: cred.clientId,
          clientSecret: cred.clientSecret 
        }
      });
      const flat = flattenCpsResponse(nsRes.data, projectKey);
      setOriginalProps(flat);
      setPendingChanges({ added: {}, modified: {}, deleted: new Set() });
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to load CPS properties');
    }
    setLoading(false);
  }, [bg, projectKey, env, chVersion, cpsBaseUrl, getGlobalCredential]);

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

    try {
      await api.post('/cps/write', {
        baseUrl: cpsBaseUrl, 
        type: 'non-secure', 
        method: 'PUT',
        environment: env, 
        projectKey: projectKey, 
        properties: mergedProps, 
        bgOrgId: bg,
        clientId: cred?.clientId,
        clientSecret: cred?.clientSecret
      });
      
      setOriginalProps(mergedProps);
      setPendingChanges({ added: {}, modified: {}, deleted: new Set() });
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Save failed');
    }
    setSaving(false);
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
        <div className="flex items-center gap-3">
          <GlobalCpsCsvUpload />
        </div>
      </div>

      {!hasGlobalCredentials ? (
        <div className="bg-gray-900 border border-gray-800 rounded-3xl p-16 text-center flex flex-col items-center justify-center shadow-2xl mx-auto max-w-4xl mt-10">
          <div className="bg-gray-950 p-6 rounded-full border border-gray-800 shadow-inner mb-6 flex items-center justify-center">
            <ShieldCheck size={48} className="text-blue-500" />
          </div>
          
          <h2 className="text-3xl font-bold text-white mb-4">
            Global CPS Configuration
          </h2>
          
          <p className="text-gray-400 max-w-lg text-base mb-10 leading-relaxed">
            Upload your master configuration CSV to manage properties across all business groups, <strong className="text-gray-200">UAT/PROD</strong> environments, and <strong className="text-gray-200">CH1/CH2</strong> versions from a single interface.
          </p>
          
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            onChange={handlePremiumUpload}
            style={{ display: 'none' }}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-3 px-8 py-3.5 text-sm font-semibold text-white bg-blue-600 rounded-xl hover:bg-blue-500 shadow-lg shadow-blue-900/20 border-0 transition-colors"
          >
            <Upload size={18} />
            Import Master CSV
          </button>
        </div>
      ) : (
        <>
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5 space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <Select
                label="Business Group"
                value={bg}
                onChange={setBg}
                options={bgOptions.length ? bgOptions : [{ value: '', label: 'No BGs found' }]}
              />
              <Select
                label="Environment"
                value={env}
                onChange={setEnv}
                options={[
                  { value: 'uat', label: 'UAT' },
                  { value: 'prod', label: 'PROD' }
                ]}
              />
              <Select
                label="CH Version"
                value={chVersion}
                onChange={setChVersion}
                options={[
                  { value: 'ch1', label: 'CloudHub 1.0 (CH1)' },
                  { value: 'ch2', label: 'CloudHub 2.0 (CH2)' }
                ]}
              />
              <div>
                <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                  CPS Config URL (Auto)
                </label>
                <div className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-300 font-mono flex items-center gap-2">
                  <Database size={14} className="text-indigo-400 flex-shrink-0" />
                  <span className="truncate">{cpsBaseUrl}</span>
                </div>
              </div>
            </div>
            
            <div className="flex items-end gap-4 border-t border-gray-800 pt-5">
              <div className="flex-1">
                <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                  Project / App Key
                </label>
                <div className="relative">
                  <Key size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                  <input
                    value={projectKey}
                    onChange={e => setProjectKey(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && fetchProperties()}
                    placeholder="e.g. my-mule-app-v1"
                    className="w-full bg-gray-950 border border-gray-800 rounded-xl pl-10 pr-4 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500 transition-colors"
                  />
                </div>
              </div>
              <button
                onClick={fetchProperties}
                disabled={!bg || !projectKey.trim() || loading}
                className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white px-6 py-2.5 rounded-xl font-medium disabled:opacity-50 transition-colors"
              >
                {loading ? <RefreshCw className="animate-spin" size={16} /> : <Search size={16} />}
                Load Properties
              </button>
            </div>
          </div>

          {error && (
            <div className="bg-red-950/30 border border-red-900/50 rounded-xl p-4 flex items-start gap-3">
              <AlertTriangle className="text-red-500 flex-shrink-0 mt-0.5" size={18} />
              <div className="text-sm text-red-400">{error}</div>
            </div>
          )}

          {Object.keys(originalProps).length > 0 && (
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
                  keyStr={projectKey}
                />
             </div>
          )}
        </>
      )}
    </div>
  );
}
