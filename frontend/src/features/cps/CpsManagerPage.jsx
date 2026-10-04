import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useNavigate, useLocation } from 'react-router-dom';
import { useCpsCredentialStore } from '../../context/CpsCredentialStoreContext';
import { usePendingPropertyChanges } from '../../hooks/usePendingPropertyChanges';
import { useBgEnvFilter } from '../../hooks/useBgEnvFilter';
import { useDebounce } from '../../hooks/useDebounce';
import PageHeader from '../../components/ui/PageHeader';
import { getErrorMessage } from '../../services/http';
import { postScopedCpsCredential, postAllCpsCredentials, fetchCpsProperties, writeCpsProperties } from '../../services/cpsService';
import { getBusinessGroups, getEnvironments, getApplicationsSummary, getCloudhub2AppDetail, getCloudhub1AppDetail } from '../../services/applicationsService';
import {
  Database, RefreshCw, Search, Plus, Trash2, Save,
  X, AlertTriangle, Download, Upload, Key,
  Eye, EyeOff, ExternalLink, Code,
} from 'lucide-react';
import Select from '../../components/ui/Select';
import CpsCredentialImportButton from './CpsCredentialImportButton';
import CpsCreateModal from './CpsCreateModal';
import CpsDeleteProjectModal from './CpsDeleteProjectModal';
import CpsBinaryUploadPanel from './CpsBinaryUploadPanel';
import CpsImportModal from './CpsImportModal';
import CpsSettingsModal from './CpsSettingsModal';
import CpsCredTestButton from './CpsCredTestButton';
import CpsRequestResponsePanel from './CpsRequestResponsePanel';
import CpsRawJsonModal from './CpsRawJsonModal';
import axios from 'axios';
import { extractCpsConfig, flattenCpsResponse } from '../../utils/cpsHelpers';
import { isDemoMode } from '../../utils/demoMode';
import { mockNonSecureResponse, mockSecureResponse } from '../../services/mocks/mockCpsProperties';
import { downloadCsv } from '../../utils/appUtils';
import { applyBgFilter } from '../../components/shared/BgFilterModal';
import { applyEnvFilter } from '../../components/shared/EnvFilterModal';
import { PropertyTable } from './PropertyTable';
import { SecureGroupEditor } from './SecureGroupEditor';
import { AuthTabWithSearch } from './AuthTabWithSearch';

// ── SecretValue ───────────────────────────────────────────────────────────────
function SecretValue({ value }) {
  const [show, setShow] = useState(false);
  const isSecret = /^\*+$/.test(String(value));
  return (
    <span className="flex items-center gap-1">
      <span className="font-mono text-xs text-gray-700 dark:text-gray-300 break-all">
        {show || !isSecret ? String(value) : '••••••••'}
      </span>
      {isSecret && (
        <button onClick={() => setShow(v => !v)} className="text-gray-400 dark:text-gray-500 hover:text-sf-600 dark:hover:text-sf-400 flex-shrink-0 transition-colors">
          {show ? <EyeOff size={11} /> : <Eye size={11} />}
        </button>
      )}
    </span>
  );
}

const PROP_TYPE_TABS = [
  { id: 'non-secure', label: 'Non-Secure' },
  { id: 'secure', label: 'Secure' },
  { id: 'binaries', label: 'Binaries' },
  { id: 'auth', label: '🔐 Access Control' },
];

// ── Feature 1: Save Diff Modal ────────────────────────────────────────────────
function SaveDiffModal({ pendingChanges, originalProps, mergedProps, isProd, onConfirm, onCancel, saving }) {
  const added    = Object.entries(pendingChanges.added);
  const modified = Object.entries(pendingChanges.modified);
  const deleted  = [...pendingChanges.deleted];
  const total    = added.length + modified.length + deleted.length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/60 dark:bg-black/75 backdrop-blur-sm p-4">
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-white/10 rounded-2xl w-full max-w-2xl shadow-2xl shadow-gray-900/20 dark:shadow-black/50 flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-white/10 flex-shrink-0">
          <div className="flex items-center gap-3">
            <span className={`flex items-center justify-center w-9 h-9 rounded-xl flex-shrink-0 ${isProd ? 'bg-sfred-100 dark:bg-sfred-500/15 text-sfred-600 dark:text-sfred-400' : 'bg-sf-100 dark:bg-sf-500/15 text-sf-600 dark:text-sf-400'}`}>
              <Save size={15} />
            </span>
            <div>
              <h3 className="text-gray-900 dark:text-gray-100 font-semibold text-sm">Review Changes Before Saving</h3>
              <p className="text-gray-500 dark:text-gray-400 text-xs mt-0.5">{total} change{total !== 1 ? 's' : ''} pending · {isProd ? <span className="text-sfred-600 dark:text-sfred-400 font-semibold">⚠ PRODUCTION</span> : 'Non-production'}</p>
            </div>
          </div>
          <button onClick={onCancel} className="text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-200 p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700/50 transition-colors flex-shrink-0"><X size={15} /></button>
        </div>

        {/* Diff table */}
        <div className="overflow-y-auto flex-1 p-3 space-y-1.5">
          {added.map(([key, val]) => (
            <div key={`add::${key}`} className="grid grid-cols-[1fr_1fr_1fr] gap-2 px-3 py-2 rounded-xl bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200/70 dark:border-emerald-400/30 text-xs">
              <span className="font-mono text-gray-600 dark:text-gray-300 truncate">{key}</span>
              <span className="text-gray-400 dark:text-gray-500 italic">— (new)</span>
              <span className="font-mono text-emerald-700 dark:text-emerald-300 break-all">{String(val)}</span>
            </div>
          ))}
          {modified.map(([key, newVal]) => (
            <div key={`mod::${key}`} className="grid grid-cols-[1fr_1fr_1fr] gap-2 px-3 py-2 rounded-xl bg-sf-50 dark:bg-sf-500/10 border border-sf-200/70 dark:border-sf-400/30 text-xs">
              <span className="font-mono text-gray-600 dark:text-gray-300 truncate">{key}</span>
              <span className="font-mono text-sfred-600 dark:text-sfred-400 break-all line-through">{String(originalProps[key] ?? '')}</span>
              <span className="font-mono text-sf-700 dark:text-sf-300 break-all">{String(newVal)}</span>
            </div>
          ))}
          {deleted.map(key => (
            <div key={`del::${key}`} className="grid grid-cols-[1fr_1fr_1fr] gap-2 px-3 py-2 rounded-xl bg-sfred-50 dark:bg-sfred-500/10 border border-sfred-200/70 dark:border-sfred-400/30 text-xs">
              <span className="font-mono text-gray-600 dark:text-gray-300 truncate">{key}</span>
              <span className="font-mono text-sfred-600 dark:text-sfred-400 break-all line-through">{String(originalProps[key] ?? '')}</span>
              <span className="text-gray-400 dark:text-gray-500 italic">— (deleted)</span>
            </div>
          ))}
        </div>

        {/* Column labels */}
        <div className="grid grid-cols-[1fr_1fr_1fr] gap-2 px-5 py-2 border-t border-gray-200 dark:border-white/10 text-[9px] text-gray-400 dark:text-gray-500 uppercase tracking-wider font-bold flex-shrink-0">
          <span>Key</span><span>Old Value</span><span>New Value</span>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-3 px-5 py-4 border-t border-gray-200 dark:border-white/10 flex-shrink-0">
          <button onClick={onCancel} disabled={saving}
            className="px-4 py-2 text-sm text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 bg-gray-100 dark:bg-gray-700/60 border border-gray-200 dark:border-gray-700 rounded-xl disabled:opacity-50 transition-colors">
            Cancel
          </button>
          <button onClick={onConfirm} disabled={saving}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-xl disabled:opacity-50 transition-all shadow-md ${
              isProd ? 'bg-sfred-600 hover:bg-sfred-500 text-white shadow-sfred-500/25' : 'bg-gradient-to-r from-sf-600 to-sfteal-600 hover:from-sf-500 hover:to-sfteal-500 text-white shadow-sf-500/25'
            }`}>
            {saving
              ? <><RefreshCw size={13} className="animate-spin" /> Saving…</>
              : <><Save size={13} /> Confirm Save ({total} change{total !== 1 ? 's' : ''})</>}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function CpsManagerPage() {
  const { orgId: authOrgId } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  // Stores the pending auto-select from navigation state (set by ApplicationsPage / ApplicationDetailPage)
  const pendingAutoSelectRef = useRef(null);
  // Survives the apps-effect reset: holds the compositeId to re-apply after filtered apps load
  const pendingSelectCompositeRef = useRef(null);
  // Version counters — incremented each time a new fetch starts so stale Promises are ignored
  const envsFetchIdRef = useRef(0);
  const appsFetchIdRef = useRef(0);
  const { getAllCredentials, hasCredentials: hasCpsCreds, getSecret } = useCpsCredentialStore();

  // ── BG / Env / App state ─────────────────────────────────────────────────
  const [allBgs, setAllBgs] = useState([]);
  const [selectedBgId, setSelectedBgId] = useState('');
  const [envs, setEnvs] = useState([]);
  const [selectedEnvId, setSelectedEnvId] = useState('');
  const [apps, setApps] = useState([]);
  const [selectedAppComposite, setSelectedAppComposite] = useState(''); // "appId|envId|bgId"
  const [bgLoading, setBgLoading] = useState(true);
  const [envLoading, setEnvLoading] = useState(false);
  const [appLoading, setAppLoading] = useState(false);

  // ── CPS connection details (auto-populated from ARM) ─────────────────────
  const [cpsBaseUrl, setCpsBaseUrl] = useState('');
  const [cpsEnv, setCpsEnv] = useState('');
  const [cpsKey, setCpsKey] = useState('');
  const [cpsClientId, setCpsClientId] = useState('');
  const [credsResolved, setCredsResolved] = useState(false);
  const [appDetailLoading, setAppDetailLoading] = useState(false);

  // ── Property data state ──────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState('non-secure');
  const [originalProps, setOriginalProps] = useState({});
  const [propsLoading, setPropsLoading] = useState(false);
  const [propsError, setPropsError] = useState('');
  const [secureGroups, setSecureGroups] = useState([]);
  const [binaryKeys, setBinaryKeys] = useState([]);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 200);
  const [secureGroupSearch, setSecureGroupSearch] = useState('');
  const debouncedSecureGroupSearch = useDebounce(secureGroupSearch, 200);

  // ── Save state ───────────────────────────────────────────────────────────
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saveSuccess, setSaveSuccess] = useState('');
  const [toast, setToast] = useState(null);
  const [lastOperation, setLastOperation] = useState(null);

  // ── Env filter version (re-renders envOptions when filter changes) ────────
  const { bgFilterVersion, envFilterVersion } = useBgEnvFilter(); // eslint-disable-line no-unused-vars

  // ── Modals ───────────────────────────────────────────────────────────────
  const [showCreate, setShowCreate] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showCpsSettings, setShowCpsSettings] = useState(false);
  const [showSecureRawJson, setShowSecureRawJson] = useState(false);
  // Feature 1: save diff modal
  const [showDiffModal, setShowDiffModal] = useState(false);
  // Feature 5: undo history
  const [undoHistory, setUndoHistory] = useState([]);
  const {
    pendingChanges, setPendingChanges, mergedProps, pendingCount, hasPendingChanges,
    updateProperty, addProperty, markDeleted, discardChanges: discardPendingChanges,
  } = usePendingPropertyChanges(originalProps, {
    onBeforeChange: (prev) => setUndoHistory(h => [...h.slice(-19), { added: { ...prev.added }, modified: { ...prev.modified }, deleted: new Set(prev.deleted) }]),
  });
  // Feature 3: localStorage draft banner
  const [pendingDraft, setPendingDraft] = useState(null);
  // Feature 13: session change log
  const [changeLog, setChangeLog] = useState([]);
  const [showChangeLog, setShowChangeLog] = useState(false);
  // Feature 15: app CPS status map (compositeId → true/false)
  const [appCpsStatus, setAppCpsStatus] = useState({});
  // Feature 16: URL presets (persisted in localStorage, max 5)
  const [cpsUrlPresets, setCpsUrlPresets] = useState(() => {
    try { return JSON.parse(localStorage.getItem('cps_url_presets') || '[]'); } catch { return []; }
  });

  // ── Derived ──────────────────────────────────────────────────────────────
  const resolvedBgId = useMemo(() => {
    if (!selectedAppComposite) return selectedBgId;
    const [, , bgId] = selectedAppComposite.split('|');
    return bgId || selectedBgId;
  }, [selectedAppComposite, selectedBgId]);

  const selectedApp = useMemo(() => {
    if (!selectedAppComposite) return null;
    const [appId, envId, bgId] = selectedAppComposite.split('|');
    return apps.find(a => String(a.id) === appId && (a.environment?.id === envId || !envId) && (a._bgId === bgId || !bgId)) || null;
  }, [selectedAppComposite, apps]);

  const isProd = useMemo(() => {
    if (!selectedApp) return false;
    const type = selectedApp.environment?.type || '';
    return type === 'production' || cpsEnv === 'prod' || cpsBaseUrl.includes('-pd.') || cpsBaseUrl.includes('-pd.');
  }, [selectedApp, cpsEnv, cpsBaseUrl]);

  // mergedProps / pendingCount / hasPendingChanges come from usePendingPropertyChanges above.

  // ── Load BGs ─────────────────────────────────────────────────────────────
  // Capture auto-select request from navigation state on mount
  useEffect(() => {
    const auto = location.state?.cpsAutoSelect;
    if (auto?.bgId) pendingAutoSelectRef.current = auto;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setBgLoading(true);
    getBusinessGroups()
      .then(r => {
        const bgs = r.data?.data || [];
        setAllBgs(bgs);
        // Default to 'All Business Groups' (selectedBgId stays '')
      })
      .catch(() => {})
      .finally(() => setBgLoading(false));
  }, []);

  // When BG list loads and there's a pending auto-select, set the BG
  useEffect(() => {
    const auto = pendingAutoSelectRef.current;
    if (!auto || !allBgs.length || bgLoading) return;
    if (selectedBgId !== auto.bgId) {
      setSelectedBgId(auto.bgId);
      // Don't set envId here — the envs loading effect resets it.
      // pendingAutoSelectRef keeps the envId so the envs effect can pick it up.
    }
  }, [allBgs, bgLoading]); // eslint-disable-line react-hooks/exhaustive-deps

  // When apps load and there's a pending auto-select, call selectApp.
  // IMPORTANT: only fire once selectedEnvId has settled to the target env —
  // if we fire on the intermediate "all envs" load the apps effect will reset
  // selectedAppComposite when the filtered load arrives.
  useEffect(() => {
    const auto = pendingAutoSelectRef.current;
    if (!auto) return;
    if (appLoading) return;
    if (!apps.length) return;
    if (selectedEnvId !== auto.envId) return;
    if (selectedBgId !== auto.bgId) return;
    const targetAppId = String(auto.compositeId.split('|')[0]);
    const found = apps.find(a => String(a.id) === targetAppId);
    if (found) {
      const actualCompositeId = `${found.id}|${found.environment?.id || ''}|${found._bgId || ''}`;
      pendingAutoSelectRef.current = null;
      // Store compositeId so the apps effect can re-apply it after the filtered list loads
      pendingSelectCompositeRef.current = actualCompositeId;
      selectApp(actualCompositeId);
    }
  }, [apps, appLoading, selectedEnvId, selectedBgId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Load Envs when BG selection or BG list changes ────────────────────────
  useEffect(() => {
    // Wait until BG list has loaded before fan-out
    if (!allBgs.length) return;
    setEnvLoading(true);
    setSelectedEnvId('');
    setApps([]);
    setSelectedAppComposite('');

    const bgsToFetch = selectedBgId === ''
      ? applyBgFilter(allBgs)                          // All BGs: fan out to every visible BG
      : allBgs.filter(g => g.id === selectedBgId);    // Specific BG

    if (bgsToFetch.length === 0) { setEnvLoading(false); return; }

    const fetchId = ++envsFetchIdRef.current; // capture version for this fetch

    Promise.all(
      bgsToFetch.map(bg =>
        getEnvironments(bg.id)
          .then(r => r.data?.data || [])
          .catch(() => [])
      )
    ).then(results => {
      // Discard stale fetches (e.g. the all-BGs fan-out that started before BG was set)
      if (fetchId !== envsFetchIdRef.current) return;
      // Merge + deduplicate by environment ID
      const seen = new Set();
      const merged = results.flat().filter(e => {
        if (seen.has(e.id)) return false;
        seen.add(e.id);
        return true;
      });
      setEnvs(merged);
      // Use the pending auto-select envId if it exists in the loaded list;
      // otherwise fall back to the first environment.
      const auto = pendingAutoSelectRef.current;
      const targetEnv = auto?.envId && merged.some(e => e.id === auto.envId)
        ? auto.envId
        : merged[0]?.id || '';
      setSelectedEnvId(targetEnv);
    }).catch(() => {}).finally(() => {
      if (fetchId === envsFetchIdRef.current) setEnvLoading(false);
    });
  }, [selectedBgId, allBgs]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Load Apps when Env or BG changes ─────────────────────────────────────
  useEffect(() => {
    if (!allBgs.length) return;
    setAppLoading(true);
    setSelectedAppComposite('');

    const bgsToFetch = selectedBgId === ''
      ? applyBgFilter(allBgs)
      : allBgs.filter(g => g.id === selectedBgId);

    if (bgsToFetch.length === 0) { setAppLoading(false); return; }

    const fetchId = ++appsFetchIdRef.current; // capture version for this fetch

    Promise.all(
      bgsToFetch.map(bg =>
        getApplicationsSummary(bg.id)
          .then(r => {
            const all = r.data?.data || [];
            const filtered = selectedEnvId
              ? all.filter(a => a.environment?.id === selectedEnvId)
              : all;
            return filtered.map(a => ({ ...a, _bgId: bg.id }));
          })
          .catch(() => [])
      )
    ).then(results => {
      // Discard stale fetches
      if (fetchId !== appsFetchIdRef.current) return;
      const flatApps = results.flat();
      setApps(flatApps);
      // Re-apply auto-select if a compositeId was queued (the apps-effect reset above clears
      // selectedAppComposite, so we must re-set it after the filtered list arrives)
      const pendingCid = pendingSelectCompositeRef.current;
      if (pendingCid) {
        const targetId = String(pendingCid.split('|')[0]);
        const found = flatApps.find(a => String(a.id) === targetId);
        if (found) {
          pendingSelectCompositeRef.current = null;
          const actualCid = `${found.id}|${found.environment?.id || ''}|${found._bgId || ''}`;
          // Defer one tick so setApps state is applied before selectApp reads it
          setTimeout(() => selectApp(actualCid), 0);
        }
      }
    }).catch(() => {}).finally(() => {
      if (fetchId === appsFetchIdRef.current) setAppLoading(false);
    });
  }, [selectedBgId, selectedEnvId, allBgs]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Select App → fetch ARM detail → extract CPS config ───────────────────
  const selectApp = useCallback(async (compositeId) => {
    setSelectedAppComposite(compositeId);
    setCpsBaseUrl(''); setCpsEnv(''); setCpsKey(''); setCpsClientId('');
    setCredsResolved(false);
    setOriginalProps({}); setPendingChanges({ added: {}, modified: {}, deleted: new Set() });
    setSecureGroups([]); setBinaryKeys([]);
    setPropsError('');
    if (!compositeId) return;

    const [appId, envId, bgId] = compositeId.split('|');
    const app = apps.find(a => String(a.id) === appId);
    if (!app) return;

    setAppDetailLoading(true);
    try {
      let detail;
      if (app.deploymentType === 'CloudHub 2.0') {
        const r = await getCloudhub2AppDetail(bgId || selectedBgId, envId, appId);
        detail = r.data;
      } else {
        const r = await getCloudhub1AppDetail(envId, appId, bgId || selectedBgId);
        detail = { name: app.name, properties: r.data?.properties || {} };
      }
      const extracted = extractCpsConfig(detail);
      setCpsBaseUrl(extracted.cpsBaseUrl || '');
      setCpsEnv(extracted.cpsEnv || '');
      setCpsKey(extracted.cpsKey || '');
      setCpsClientId(extracted.cpsClientId || '');

      // Auto-resolve credentials from imported CSV
      if (extracted.cpsBaseUrl && hasCpsCreds) {
        const isMasked = v => !v || /^\*+$/.test(v.trim());
        const bgOrgId = bgId || selectedBgId;

        if (extracted.cpsClientId && !isMasked(extracted.cpsClientId)) {
          const secret = getSecret(extracted.cpsClientId);
          if (secret) {
            const ok = await postScopedCpsCredential(extracted.cpsBaseUrl, bgOrgId, extracted.cpsClientId, secret);
            if (ok) setCredsResolved(true);
          }
        }
        if (!credsResolved) {
          const allCreds = getAllCredentials();
          if (allCreds.length > 0) {
            await postAllCpsCredentials(extracted.cpsBaseUrl, allCreds);
            setCredsResolved(true);
          }
        }
      }
    } catch {}
    // Feature 15: record CPS status for this app so the selector can show an indicator
    setAppCpsStatus(prev => ({ ...prev, [compositeId]: !!(extractCpsConfig ? true : false) }));
    setAppDetailLoading(false);
  }, [apps, selectedBgId, hasCpsCreds, getSecret, getAllCredentials]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Load Properties ───────────────────────────────────────────────────────
  const loadProperties = useCallback(async () => {
    if (!cpsBaseUrl || !cpsKey || !cpsEnv) return;
    setPropsLoading(true);
    setPropsError('');
    setOriginalProps({});
    setPendingChanges({ added: {}, modified: {}, deleted: new Set() });
    setSecureGroups([]);
    setBinaryKeys([]);

    if (isDemoMode()) {
      const nonSecureKey = mockNonSecureResponse.responses[0].key;
      const flat = flattenCpsResponse(mockNonSecureResponse, nonSecureKey);
      setOriginalProps(flat);
      setUndoHistory([]);
      
      const binStr = flat['cps.secure.binaries'] || '';
      if (binStr) setBinaryKeys(binStr.split(',').map(k => k.trim()).filter(Boolean));
      
      const groups = Array.isArray(mockSecureResponse.responses) ? mockSecureResponse.responses : [];
      setSecureGroups(groups);
      
      setPropsLoading(false);
      return;
    }

    const bgOrgId = resolvedBgId;
    try {
      // Load non-secure (always)
      const nsData = await fetchCpsProperties({ baseUrl: cpsBaseUrl, type: 'non-secure', environment: cpsEnv, keys: cpsKey, bgOrgId });
      const flat = flattenCpsResponse(nsData, cpsKey);
      setOriginalProps(flat);
      setUndoHistory([]);

      // Feature 3: check for a saved draft
      try {
        const dKey = `cps_draft_${cpsBaseUrl}_${cpsKey}_${cpsEnv}`;
        const raw = localStorage.getItem(dKey);
        if (raw) {
          const draft = JSON.parse(raw);
          const n = Object.keys(draft.added || {}).length + Object.keys(draft.modified || {}).length + (draft.deleted || []).length;
          if (n > 0) setPendingDraft({ ...draft, draftKey: dKey, totalChanges: n });
        }
      } catch { /* ignore corrupt draft */ }

      // Extract binary keys from non-secure
      const binStr = flat['cps.secure.binaries'] || '';
      if (binStr) setBinaryKeys(binStr.split(',').map(k => k.trim()).filter(Boolean));

      // Try to load secure (optional — requires credentials)
      const secStr = flat['cps.secure.properties'] || '';
      if (secStr) {
        try {
          const secData = await fetchCpsProperties({ baseUrl: cpsBaseUrl, type: 'secure', environment: cpsEnv, keys: secStr, bgOrgId });
          const groups = Array.isArray(secData?.responses) ? secData.responses : [];
          setSecureGroups(groups);
        } catch {}
      }
    } catch (err) {
      setPropsError(getErrorMessage(err, 'Failed to load CPS properties'));
    }
    setPropsLoading(false);
  }, [cpsBaseUrl, cpsKey, cpsEnv, resolvedBgId]);

  // ── Feature 5: undo stack helpers ────────────────────────────────────────
  const undoLastChange = useCallback(() => {
    setUndoHistory(h => {
      if (h.length === 0) return h;
      const prev = h[h.length - 1];
      setPendingChanges({ added: { ...prev.added }, modified: { ...prev.modified }, deleted: new Set(prev.deleted) });
      return h.slice(0, -1);
    });
  }, []);

  useEffect(() => {
    const handler = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        const tag = document.activeElement?.tagName;
        if (tag !== 'INPUT' && tag !== 'TEXTAREA') { e.preventDefault(); undoLastChange(); }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [undoLastChange]);

  // Feature 3: auto-save draft to localStorage whenever pendingChanges changes
  useEffect(() => {
    if (!cpsBaseUrl || !cpsKey || !cpsEnv) return;
    const draftKey = `cps_draft_${cpsBaseUrl}_${cpsKey}_${cpsEnv}`;
    const hasChanges = Object.keys(pendingChanges.added).length > 0
      || Object.keys(pendingChanges.modified).length > 0
      || pendingChanges.deleted.size > 0;
    if (hasChanges) {
      try {
        localStorage.setItem(draftKey, JSON.stringify({
          added: pendingChanges.added, modified: pendingChanges.modified,
          deleted: [...pendingChanges.deleted], savedAt: new Date().toISOString(),
        }));
      } catch { /* ignore */ }
    } else {
      localStorage.removeItem(draftKey);
    }
  }, [pendingChanges, cpsBaseUrl, cpsKey, cpsEnv]);

  // ── Property change helpers ───────────────────────────────────────────────
  // updateProperty / addProperty / markDeleted come from usePendingPropertyChanges
  // above (its onBeforeChange option already pushes undo history on every
  // mutation). discardChanges additionally clears undo history and the
  // localStorage draft, so it keeps its own wrapper here.
  const discardChanges = () => {
    setUndoHistory([]);
    discardPendingChanges();
    if (cpsBaseUrl && cpsKey && cpsEnv) localStorage.removeItem(`cps_draft_${cpsBaseUrl}_${cpsKey}_${cpsEnv}`);
    setPendingDraft(null);
  };

  // ── Save (PUT) — Feature 1: show diff modal before actual save ───────────
  const requestSave = () => {
    if (!hasPendingChanges || !cpsBaseUrl || !cpsKey) return;
    setShowDiffModal(true);
  };

  const saveChanges = async () => {
    setShowDiffModal(false);
    if (!hasPendingChanges || !cpsBaseUrl || !cpsKey) return;
    setSaving(true);
    setSaveError('');

    const propType = activeTab === 'secure' ? 'secure' : 'non-secure';
    const pathSuffix = propType === 'secure' ? '/api/v2/properties/secure' : '/api/v2/properties/non-secure';
    const cleanBase = cpsBaseUrl.replace(/\/+$/, '').replace(/\/api\/v2\/?$/, '');
    const fallbackReqDetails = {
      method: 'PUT',
      url: `${cleanBase}${pathSuffix}`,
      body: { properties: [{ environment: cpsEnv, key: cpsKey, properties: mergedProps }] },
    };

    try {
      const resp = await writeCpsProperties({
        baseUrl: cpsBaseUrl,
        type: propType,
        method: 'PUT',
        environment: cpsEnv,
        projectKey: cpsKey,
        properties: mergedProps,
        bgOrgId: resolvedBgId,
      });
      const { requestDetails, responseDetails } = resp.data || {};
      setLastOperation({
        label: 'Save Properties',
        timestamp: new Date().toISOString(),
        requestDetails: requestDetails || fallbackReqDetails,
        responseDetails: responseDetails || { status: 200, body: resp.data },
        success: true,
      });
      setOriginalProps(mergedProps);
      setPendingChanges({ added: {}, modified: {}, deleted: new Set() });
      setUndoHistory([]);
      try { localStorage.removeItem(`cps_draft_${cpsBaseUrl}_${cpsKey}_${cpsEnv}`); } catch {}
      setPendingDraft(null);
      // Feature 13: append to session change log
      setChangeLog(log => [...log, {
        ts: new Date().toISOString(), label: 'Save Non-Secure',
        key: cpsKey, env: cpsEnv, changes: pendingCount, success: true,
      }]);
      showToast('Properties saved successfully', 'success');
      await loadProperties();
    } catch (err) {
      const { requestDetails, responseDetails } = err.response?.data || {};
      setLastOperation({
        label: 'Save Properties',
        timestamp: new Date().toISOString(),
        requestDetails: requestDetails || fallbackReqDetails,
        responseDetails: responseDetails || { status: err.response?.status, body: err.response?.data },
        success: false,
      });
      setSaveError(getErrorMessage(err, 'Save failed'));
    }
    setSaving(false);
  };

  // ── Toast helper ──────────────────────────────────────────────────────────
  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  };

  // ── Feature 16: URL preset helpers ───────────────────────────────────────
  const saveUrlPreset = () => {
    const u = cpsBaseUrl.trim().replace(/\/+$/, '').replace(/\/api\/v2\/?$/, '');
    if (!u || cpsUrlPresets.includes(u)) return;
    const next = [...cpsUrlPresets, u].slice(-5);
    setCpsUrlPresets(next);
    try { localStorage.setItem('cps_url_presets', JSON.stringify(next)); } catch {}
  };
  const removeUrlPreset = (url) => {
    const next = cpsUrlPresets.filter(p => p !== url);
    setCpsUrlPresets(next);
    try { localStorage.setItem('cps_url_presets', JSON.stringify(next)); } catch {}
  };

  // ── Export CSV ────────────────────────────────────────────────────────────
  const exportCsv = () => {
    const rows = [['Property Key', 'Value']];
    Object.entries(mergedProps).sort(([a], [b]) => a.localeCompare(b))
      .forEach(([k, v]) => rows.push([k, String(v ?? '')]));
    downloadCsv(rows, `cps-${cpsKey}-${cpsEnv}-${new Date().toISOString().slice(0, 10)}.csv`);
  };

  // ── Filtered secure groups ────────────────────────────────────────────────
  const filteredSecureGroups = useMemo(() => {
    if (!debouncedSecureGroupSearch.trim()) return secureGroups;
    const q = debouncedSecureGroupSearch.toLowerCase();
    return secureGroups.filter(g => {
      if ((g.key || '').toLowerCase().includes(q)) return true;
      if (g.properties && typeof g.properties === 'object') {
        return Object.entries(g.properties).some(([k, v]) => 
          k.toLowerCase().includes(q) || String(v).toLowerCase().includes(q)
        );
      }
      return false;
    });
  }, [secureGroups, debouncedSecureGroupSearch]);

  // ── Filtered visible properties ───────────────────────────────────────────
  const visibleProps = useMemo(() => {
    const entries = Object.entries(mergedProps).sort(([a], [b]) => a.localeCompare(b));
    if (!debouncedSearch.trim()) return entries;
    const q = debouncedSearch.toLowerCase();
    return entries.filter(([k, v]) => k.toLowerCase().includes(q) || String(v).toLowerCase().includes(q));
  }, [mergedProps, debouncedSearch]);

  // ── Dropdown options ──────────────────────────────────────────────────────
  const bgOptions = [
    { value: '', label: 'All Business Groups' },
    ...applyBgFilter(allBgs).map(g => ({
      value: g.id, label: g.name, indent: !!g.parentId,
      tag: !g.parentId ? 'Root' : undefined, tagColor: 'bg-blue-100 text-blue-600',
    })),
  ];
  const visibleEnvs = applyEnvFilter(envs);
  const envFilterActive = visibleEnvs.length < envs.length;
  const envOptions = [
    { value: '', label: `All Environments${envFilterActive ? ` (${visibleEnvs.length} visible)` : ''}` },
    ...visibleEnvs.map(e => ({ value: e.id, label: e.name })),
  ];
  const appOptions = apps.map(a => {
    const cid = `${a.id}|${a.environment?.id || ''}|${a._bgId || ''}`;
    const hasCps = appCpsStatus[cid];
    return {
      value: cid, label: a.name,
      tag: a.deploymentType === 'CloudHub 2.0' ? 'CH2' : 'CH1',
      tagColor: a.deploymentType === 'CloudHub 2.0' ? 'bg-blue-100 text-blue-600' : 'bg-purple-100 text-purple-600',
      ...(hasCps !== undefined ? {
        tag2: hasCps ? '✓CPS' : 'noCPS',
        tag2Color: hasCps ? 'bg-emerald-500/15 text-emerald-500' : 'bg-gray-200/40 text-gray-500',
      } : {}),
    };
  });

  const canLoad = !!(cpsBaseUrl && cpsKey && cpsEnv);

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5">
      {/* Modals */}
      {showCreate && (
        <CpsCreateModal
          baseUrl={cpsBaseUrl} environment={cpsEnv} bgOrgId={resolvedBgId} isProd={isProd}
          onClose={() => setShowCreate(false)}
          onCreated={k => { showToast(`Project "${k}" created`); loadProperties(); }}
          onResult={setLastOperation}
        />
      )}
      {showDelete && (
        <CpsDeleteProjectModal
          baseUrl={cpsBaseUrl} type={activeTab === 'secure' ? 'secure' : 'non-secure'}
          environment={cpsEnv} projectKey={cpsKey} bgOrgId={resolvedBgId} isProd={isProd}
          onClose={() => setShowDelete(false)}
          onDeleted={k => { showToast(`Project "${k}" deleted`); setOriginalProps({}); setPendingChanges({ added: {}, modified: {}, deleted: new Set() }); }}
          onResult={setLastOperation}
        />
      )}
      {showImport && (
        <CpsImportModal
          baseUrl={cpsBaseUrl} type={activeTab} environment={cpsEnv} projectKey={cpsKey}
          bgOrgId={resolvedBgId} isProd={isProd} existingProps={originalProps}
          onClose={() => setShowImport(false)}
          onImported={({ count, mergedProps }) => { 
            showToast(`Imported ${count} properties`); 
            if (isDemoMode && mergedProps) {
              setOriginalProps(mergedProps);
              setPendingChanges({ added: {}, modified: {}, deleted: new Set() });
            } else {
              loadProperties(); 
            }
          }}
        />
      )}
      {showCpsSettings && (
        <CpsSettingsModal
          prefilledUrl={cpsBaseUrl.replace(/\/+$/, '').replace(/\/api\/v2\/?$/, '')}
          prefilledBgId={resolvedBgId}
          onClose={() => setShowCpsSettings(false)}
        />
      )}

      {/* Feature 1: Save Diff Modal */}
      {showDiffModal && (
        <SaveDiffModal
          pendingChanges={pendingChanges}
          originalProps={originalProps}
          mergedProps={mergedProps}
          isProd={isProd}
          onConfirm={saveChanges}
          onCancel={() => setShowDiffModal(false)}
          saving={saving}
        />
      )}

      {/* Toast */}
      {toast && (
        <div className={`flex items-center justify-between px-4 py-3 rounded-2xl border text-sm shadow-sm ${
          toast.type === 'success'
            ? 'bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200/80 dark:border-emerald-400/30 text-emerald-700 dark:text-emerald-300'
            : 'bg-sfred-50 dark:bg-sfred-500/10 border-sfred-200/80 dark:border-sfred-400/30 text-sfred-700 dark:text-sfred-300'
        }`}>
          <span>{toast.msg}</span>
          <button onClick={() => setToast(null)} className="ml-4 opacity-60 hover:opacity-100 transition-opacity"><X size={14} /></button>
        </div>
      )}

      {/* Page Header */}
      <PageHeader
        icon={Database}
        title="CPS Property Manager"
        subtitle="Create, update, delete and manage auth for CPS properties"
        actions={
          <>
            <CpsCredentialImportButton compact />
            <button onClick={() => setShowCpsSettings(true)}
              className="flex items-center gap-1.5 text-xs font-medium text-sf-700 dark:text-sf-300 hover:text-sf-800 dark:hover:text-sf-200 bg-sf-50 dark:bg-sf-500/10 border border-sf-200/70 dark:border-sf-400/30 px-3 py-2 rounded-xl shadow-sm hover:shadow-md transition-all">
              <Key size={11} /> CPS Credentials
            </button>
          </>
        }
      />

      {/* Production banner */}
      {isProd && cpsBaseUrl && (
        <div className="flex items-center gap-3 bg-sfred-50 dark:bg-sfred-500/10 border border-sfred-200/80 dark:border-sfred-400/30 rounded-2xl px-4 py-3 shadow-sm">
          <AlertTriangle size={16} className="text-sfred-600 dark:text-sfred-400 flex-shrink-0" />
          <span className="text-sfred-700 dark:text-sfred-300 text-sm font-semibold">
            ⚠️ PRODUCTION — changes take effect immediately and cannot be undone
          </span>
        </div>
      )}

      {/* BG / Env / App selectors */}
      <div className="card-surface px-5 py-4 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <p className="text-[10px] text-gray-400 dark:text-gray-500 uppercase tracking-wider font-bold mb-1.5">Business Group</p>
            <Select value={selectedBgId} onChange={setSelectedBgId} options={bgOptions}
              placeholder="Select BG…" searchable disabled={bgLoading} />
          </div>
          <div>
            <p className="text-[10px] text-gray-400 dark:text-gray-500 uppercase tracking-wider font-bold mb-1.5">Environment</p>
            <Select value={selectedEnvId} onChange={setSelectedEnvId} options={envOptions}
              placeholder="All Environments" disabled={envLoading || !allBgs.length} />
          </div>
          <div>
            <p className="text-[10px] text-gray-400 dark:text-gray-500 uppercase tracking-wider font-bold mb-1.5 flex items-center gap-1">
              Application {appLoading && <RefreshCw size={9} className="animate-spin text-gray-400 dark:text-gray-500" />}
            </p>
            <Select value={selectedAppComposite} onChange={selectApp} options={appOptions}
              placeholder="Search application…" searchable disabled={appLoading || !allBgs.length} />
            {/* View Application link — appears immediately after selecting an app */}
            {selectedAppComposite && (() => {
              const [appId, envId, bgId] = selectedAppComposite.split('|');
              if (!appId || !envId || !bgId) return null;
              const appName = apps.find(a => String(a.id) === appId)?.name || '';
              return (
                <button
                  onClick={() => navigate(`/applications/${bgId}/${envId}/${appId}`)}
                  className="mt-1.5 flex items-center gap-1.5 text-[10px] text-sf-600 dark:text-sf-400 hover:text-sf-700 dark:hover:text-sf-300 transition-colors group/applink">
                  <ExternalLink size={10} className="flex-shrink-0" />
                  <span className="group-hover/applink:underline underline-offset-2 truncate">
                    {appName ? `Open ${appName} in Application Details` : 'View Application Details'}
                  </span>
                </button>
              );
            })()}
          </div>
        </div>

        {/* CPS config fields — always visible for manual entry or auto-fill from selected app */}
        <div className="pt-3 border-t border-gray-100 dark:border-white/[0.06] space-y-3">
          {appDetailLoading ? (
            <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400 text-xs">
              <RefreshCw size={11} className="animate-spin" /> Extracting CPS config from ARM properties…
            </div>
          ) : (
            <>
              {!selectedAppComposite && !cpsBaseUrl && (
                <div className="flex items-center gap-2 bg-sf-50 dark:bg-sf-500/10 border border-sf-200/60 dark:border-sf-400/30 rounded-xl px-3 py-2 text-[10px] text-sf-600 dark:text-sf-400">
                  <Database size={10} className="flex-shrink-0" />
                  Select an app above to auto-fill, or enter CPS details manually to create properties for a new app before deployment.
                </div>
              )}
              {!selectedAppComposite && cpsBaseUrl && (
                <span className="inline-flex items-center gap-1 text-[9px] font-semibold text-sf-600 dark:text-sf-400 bg-sf-50 dark:bg-sf-500/10 border border-sf-300/40 dark:border-sf-400/30 px-2 py-0.5 rounded-full">
                  <Database size={8} /> Manual entry
                </span>
              )}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="md:col-span-2">
                  <label className="block text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-2 flex items-center gap-2">
                    CPS Base URL
                    {cpsBaseUrl && !cpsUrlPresets.includes(cpsBaseUrl.trim().replace(/\/+$/, '').replace(/\/api\/v2\/?$/, '')) && (
                      <button onClick={saveUrlPreset} title="Save as preset"
                        className="text-[8px] text-gray-500 dark:text-gray-400 hover:text-sf-600 dark:hover:text-sf-400 border border-gray-200 dark:border-gray-700 hover:border-sf-300/60 dark:hover:border-sf-400/30 px-1.5 py-0.5 rounded transition-colors">
                        + save preset
                      </button>
                    )}
                  </label>
                  <input value={cpsBaseUrl} onChange={e => setCpsBaseUrl(e.target.value)}
                    placeholder="https://cps-server.internalapi.sfdcbt.net"
                    className="w-full h-[42px] bg-white dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded-xl px-3 text-sm text-gray-700 dark:text-gray-300 font-mono focus:outline-none focus:border-sf-500 dark:focus:border-sf-400 focus:ring-2 focus:ring-sf-500/15 placeholder-gray-400 dark:placeholder-gray-500 transition-all" />
                  {cpsUrlPresets.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {cpsUrlPresets.map(p => (
                        <span key={p} className="inline-flex items-center gap-1 text-[9px] font-mono bg-gray-100 dark:bg-gray-700/60 border border-gray-200 dark:border-gray-600 rounded-md px-2 py-0.5 group/preset">
                          <button onClick={() => setCpsBaseUrl(p)} title={p}
                            className={`hover:text-sf-700 dark:hover:text-sf-300 transition-colors truncate max-w-40 ${cpsBaseUrl.startsWith(p) || p === cpsBaseUrl ? 'text-sf-600 dark:text-sf-400' : 'text-gray-500 dark:text-gray-400'}`}>
                            {p.replace(/^https?:\/\//, '')}
                          </button>
                          <button onClick={() => removeUrlPreset(p)} className="opacity-0 group-hover/preset:opacity-100 text-gray-400 dark:text-gray-500 hover:text-sfred-600 dark:hover:text-sfred-400 flex-shrink-0 transition-all">×</button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-2">CPS Env</label>
                  <input value={cpsEnv} onChange={e => setCpsEnv(e.target.value)} placeholder="prod / uat"
                    className="w-full h-[42px] bg-white dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded-xl px-3 text-sm text-gray-700 dark:text-gray-300 font-mono focus:outline-none focus:border-sf-500 dark:focus:border-sf-400 focus:ring-2 focus:ring-sf-500/15 placeholder-gray-400 dark:placeholder-gray-500 transition-all" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-2">Project Key</label>
                  <input value={cpsKey} onChange={e => setCpsKey(e.target.value)} placeholder="my-api-name"
                    className="w-full h-[42px] bg-white dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded-xl px-3 text-sm text-gray-700 dark:text-gray-300 font-mono focus:outline-none focus:border-sf-500 dark:focus:border-sf-400 focus:ring-2 focus:ring-sf-500/15 placeholder-gray-400 dark:placeholder-gray-500 transition-all" />
                </div>
              </div>
              <div className="flex items-center gap-3 flex-wrap">
                {credsResolved && (
                  <span className="flex items-center gap-1 text-[9px] font-semibold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-300/40 dark:border-emerald-400/30 px-2 py-0.5 rounded-full">
                    <Key size={8} /> CPS creds auto-resolved
                  </span>
                )}
                <CpsCredTestButton baseUrl={cpsBaseUrl} clientId={cpsClientId}
                  clientSecret={cpsClientId ? undefined : undefined}
                  environment={cpsEnv} projectKey={cpsKey} compact />
                <div className="flex items-center gap-2 ml-auto">
                  <button onClick={loadProperties} disabled={!canLoad || propsLoading}
                    className="flex items-center gap-1.5 text-xs font-medium text-sf-700 dark:text-sf-300 hover:text-sf-800 dark:hover:text-sf-200 bg-sf-50 dark:bg-sf-500/10 border border-sf-200/70 dark:border-sf-400/30 px-3 py-2 rounded-xl disabled:opacity-50 shadow-sm hover:shadow-md transition-all">
                    <RefreshCw size={11} className={propsLoading ? 'animate-spin' : ''} />
                    {Object.keys(originalProps).length > 0 ? 'Refresh' : 'Load Properties'}
                  </button>
                  {canLoad && (
                    <button onClick={() => setShowCreate(true)}
                      className="flex items-center gap-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-300 hover:text-emerald-800 dark:hover:text-emerald-200 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200/70 dark:border-emerald-400/30 px-3 py-2 rounded-xl shadow-sm hover:shadow-md transition-all">
                      <Plus size={11} /> Create New
                    </button>
                  )}

                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Properties area */}
      {Object.keys(originalProps).length > 0 && (
        <div className="space-y-4">
          {/* Tabs + action toolbar */}
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="bg-gray-100 dark:bg-gray-900/40 p-1 rounded-xl border border-gray-200 dark:border-gray-700 flex gap-0.5">
              {PROP_TYPE_TABS.map(t => (
                <button key={t.id} onClick={() => setActiveTab(t.id)}
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-all ${
                    activeTab === t.id ? 'bg-white dark:bg-sf-500/20 text-sf-700 dark:text-sf-300 shadow-sm' : 'text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200'
                  }`}>
                  {t.label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {activeTab !== 'auth' && activeTab !== 'binaries' && (
                <>
                  <button onClick={() => setShowImport(true)}
                    className="flex items-center gap-1.5 text-xs font-medium text-sf-700 dark:text-sf-300 hover:text-sf-800 dark:hover:text-sf-200 bg-sf-50 dark:bg-sf-500/10 border border-sf-200/70 dark:border-sf-400/30 px-2.5 py-1.5 rounded-xl shadow-sm hover:shadow-md transition-all">
                    <Upload size={11} /> Import
                  </button>
                  <button onClick={exportCsv}
                    className="flex items-center gap-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-300 hover:text-emerald-800 dark:hover:text-emerald-200 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200/70 dark:border-emerald-400/30 px-2.5 py-1.5 rounded-xl shadow-sm hover:shadow-md transition-all">
                    <Download size={11} /> Export
                  </button>
                  <button onClick={() => setShowDelete(true)}
                    className="flex items-center gap-1.5 text-xs font-medium text-sfred-700 dark:text-sfred-300 hover:text-sfred-800 dark:hover:text-sfred-200 bg-sfred-50 dark:bg-sfred-500/10 border border-sfred-200/70 dark:border-sfred-400/30 px-2.5 py-1.5 rounded-xl shadow-sm hover:shadow-md transition-all">
                    <Trash2 size={11} /> Delete Project
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Save error */}
          {saveError && (
            <div className="flex items-center gap-2.5 bg-sfred-50 dark:bg-sfred-500/10 border border-sfred-200/80 dark:border-sfred-400/30 rounded-2xl px-4 py-3 text-sfred-700 dark:text-sfred-300 text-sm shadow-sm">
              <AlertTriangle size={14} className="flex-shrink-0" /> {saveError}
            </div>
          )}

          {/* Loading / Error state */}
          {propsLoading && (
            <div className="flex items-center justify-center py-12 gap-3 text-gray-500 dark:text-gray-400">
              <RefreshCw size={18} className="animate-spin" />
              <span className="text-sm">Loading CPS properties…</span>
            </div>
          )}
          {propsError && !propsLoading && (
            <div className="flex items-start gap-3 bg-sfred-50 dark:bg-sfred-500/10 border border-sfred-200/80 dark:border-sfred-400/30 rounded-2xl px-4 py-3 shadow-sm">
              <AlertTriangle size={14} className="text-sfred-600 dark:text-sfred-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sfred-700 dark:text-sfred-300 text-sm font-medium">Failed to load properties</p>
                <p className="text-sfred-600/80 dark:text-sfred-400/80 text-xs mt-1">{propsError}</p>
              </div>
            </div>
          )}

          {/* Feature 3: Draft restore banner */}
          {pendingDraft && !hasPendingChanges && (
            <div className="flex items-center justify-between gap-4 bg-amber-50 dark:bg-amber-500/10 border border-amber-200/80 dark:border-amber-400/30 rounded-2xl px-4 py-3 shadow-sm">
              <div>
                <p className="text-amber-700 dark:text-amber-300 text-xs font-semibold">📝 Unsaved draft found</p>
                <p className="text-amber-600/80 dark:text-amber-400/80 text-[10px] mt-0.5">
                  {pendingDraft.totalChanges} unsaved change{pendingDraft.totalChanges !== 1 ? 's' : ''} from {new Date(pendingDraft.savedAt).toLocaleTimeString()}
                </p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button onClick={() => {
                  setPendingChanges({ added: pendingDraft.added || {}, modified: pendingDraft.modified || {}, deleted: new Set(pendingDraft.deleted || []) });
                  setPendingDraft(null);
                }} className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white rounded-xl shadow-sm transition-colors">
                  Restore Draft
                </button>
                <button onClick={() => { try { localStorage.removeItem(pendingDraft.draftKey); } catch {} setPendingDraft(null); }}
                  className="text-amber-600 dark:text-amber-400 hover:text-amber-700 dark:hover:text-amber-300 text-xs font-medium transition-colors">Discard</button>
              </div>
            </div>
          )}

          {/* Non-Secure Tab */}
          {activeTab === 'non-secure' && !propsLoading && !propsError && (
            <PropertyTable
              props={mergedProps}
              originalProps={originalProps}
              pendingChanges={pendingChanges}
              search={search}
              setSearch={setSearch}
              onUpdate={updateProperty}
              onDelete={markDeleted}
              onAdd={addProperty}
              onReplaceAll={setPendingChanges}
              hasPendingChanges={hasPendingChanges}
              pendingCount={pendingCount}
              onSave={requestSave}
              onDiscard={discardChanges}
              saving={saving}
              isProd={isProd}
              allProps={mergedProps}
              onUndo={undoLastChange}
              undoCount={undoHistory.length}
              envStr={cpsEnv}
              keyStr={cpsKey}
            />
          )}

          {/* Secure Tab */}
          {activeTab === 'secure' && !propsLoading && (
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
              {secureGroups.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 gap-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-white/[0.07] rounded-2xl shadow-sm">
                  <div className="w-12 h-12 rounded-2xl bg-sforange-50 dark:bg-sforange-500/10 flex items-center justify-center">
                    <Key size={20} className="text-sforange-400 dark:text-sforange-500" />
                  </div>
                  <p className="text-gray-500 dark:text-gray-400 text-sm">No secure properties configured (<code className="text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-700/60 px-1 rounded">cps.secure.properties</code> not set in non-secure)</p>
                </div>
              ) : (
                <>
                  {/* Search across secure group keys */}
                  <div className="relative">
                    <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500 pointer-events-none" />
                    <input
                      value={secureGroupSearch}
                      onChange={e => setSecureGroupSearch(e.target.value)}
                      placeholder={`Search groups, keys, or values… (${secureGroups.length} group${secureGroups.length !== 1 ? 's' : ''})`}
                      className="w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl pl-9 pr-10 py-2.5 text-xs text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 shadow-sm focus:outline-none focus:border-sf-500 dark:focus:border-sf-400 focus:ring-2 focus:ring-sf-500/15 transition-all"
                    />
                    {secureGroupSearch && (
                      <button onClick={() => setSecureGroupSearch('')}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-200 transition-colors">
                        <X size={12} />
                      </button>
                    )}
                  </div>
                  {secureGroupSearch.trim() && (
                    <p className="text-[10px] text-gray-400 dark:text-gray-500 -mt-2">
                      {filteredSecureGroups.length} of {secureGroups.length} group{secureGroups.length !== 1 ? 's' : ''} shown
                    </p>
                  )}
                  {filteredSecureGroups.map(group => (
                    <SecureGroupEditor
                      key={group.key}
                      group={group}
                      baseUrl={cpsBaseUrl}
                      environment={cpsEnv}
                      bgOrgId={resolvedBgId}
                      isProd={isProd}
                      onResult={setLastOperation}
                      globalSearch={secureGroupSearch}
                      onGroupDeleted={deletedKey => {
                        setSecureGroups(prev => prev.filter(g => g.key !== deletedKey));
                        showToast(`Secure group "${deletedKey}" deleted`);
                      }}
                    />
                  ))}
                  {filteredSecureGroups.length === 0 && secureGroupSearch.trim() && (
                    <div className="flex flex-col items-center justify-center py-8 gap-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-white/[0.07] rounded-2xl shadow-sm">
                      <Search size={20} className="text-gray-400 dark:text-gray-500" />
                      <p className="text-gray-500 dark:text-gray-400 text-sm">No secure groups match "<span className="font-mono">{secureGroupSearch}</span>"</p>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* Binaries Tab */}
          {activeTab === 'binaries' && !propsLoading && (
            <div className="card-surface p-5">
              <CpsBinaryUploadPanel
                baseUrl={cpsBaseUrl}
                environment={cpsEnv}
                bgOrgId={resolvedBgId}
                existingKeys={binaryKeys}
                isProd={isProd}
                onUploaded={key => { showToast(`Binary "${key}" uploaded`); loadProperties(); }}
                onResult={setLastOperation}
              />
            </div>
          )}

          {/* Access Control Tab */}
          {activeTab === 'auth' && !propsLoading && (
            <AuthTabWithSearch
              cpsBaseUrl={cpsBaseUrl}
              cpsEnv={cpsEnv}
              cpsKey={cpsKey}
              secureGroups={secureGroups}
              resolvedBgId={resolvedBgId}
              setLastOperation={setLastOperation}
            />
          )}
        </div>
      )}

      {/* Empty state: CPS config entered but no properties loaded yet */}
      {!propsLoading && Object.keys(originalProps).length === 0 && !propsError && canLoad && (
        <div className="flex flex-col items-center justify-center py-16 gap-4 bg-white dark:bg-gray-800 border border-gray-200 dark:border-white/[0.07] rounded-2xl shadow-sm">
          <div className="w-14 h-14 rounded-3xl bg-gradient-to-br from-sf-50 to-sfteal-50 dark:from-sf-500/10 dark:to-sfteal-500/5 flex items-center justify-center shadow-sm">
            <Database size={24} className="text-sf-400 dark:text-sf-500" />
          </div>
          <p className="text-gray-500 dark:text-gray-400 text-sm">
            CPS config detected — click <strong className="text-gray-800 dark:text-gray-200">Load Properties</strong> to fetch
          </p>
          <p className="text-gray-400 dark:text-gray-500 text-xs font-mono">
            {cpsKey} · {cpsEnv} · {cpsBaseUrl.split('/')[2]}
          </p>
          <button onClick={loadProperties} disabled={!canLoad}
            className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-sf-600 to-sfteal-600 hover:from-sf-500 hover:to-sfteal-500 text-white text-sm font-semibold rounded-xl shadow-md shadow-sf-500/25 transition-all disabled:opacity-50">
            <RefreshCw size={13} /> Load Properties
          </button>
        </div>
      )}

      {/* Request / Response debug panel */}
      {lastOperation && (
        <CpsRequestResponsePanel
          operation={lastOperation}
          onDismiss={() => setLastOperation(null)}
        />
      )}

      {/* Feature 13: Session Change Log */}
      {changeLog.length > 0 && (
        <div className="card-surface overflow-hidden">
          <button onClick={() => setShowChangeLog(s => !s)}
            className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 dark:hover:bg-white/[0.02] transition-colors">
            <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 flex items-center gap-2">
              📋 Session Change Log
              <span className="text-[9px] font-bold bg-gray-100 dark:bg-gray-700/60 border border-gray-200 dark:border-gray-600 px-1.5 py-0.5 rounded-full">{changeLog.length}</span>
            </span>
            <span className="text-gray-400 dark:text-gray-500 text-xs">{showChangeLog ? '▲ hide' : '▼ show'}</span>
          </button>
          {showChangeLog && (
            <div className="border-t border-gray-200 dark:border-white/10 divide-y divide-gray-100 dark:divide-white/[0.06] max-h-48 overflow-y-auto">
              {[...changeLog].reverse().map((entry, i) => (
                <div key={i} className="flex items-center gap-3 px-4 py-2.5 text-[10px]">
                  <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${entry.success ? 'bg-emerald-400' : 'bg-sfred-400'}`} />
                  <span className="text-gray-400 dark:text-gray-500 font-mono flex-shrink-0">{new Date(entry.ts).toLocaleTimeString()}</span>
                  <span className="text-gray-600 dark:text-gray-300 font-medium flex-shrink-0">{entry.label}</span>
                  <span className="text-gray-400 dark:text-gray-500 font-mono truncate">{entry.key} · {entry.env}</span>
                  {entry.changes != null && <span className="text-sf-600 dark:text-sf-400 ml-auto flex-shrink-0 font-medium">{entry.changes} change{entry.changes !== 1 ? 's' : ''}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* No CPS config state */}
      {selectedAppComposite && !appDetailLoading && !cpsBaseUrl && (
        <div className="flex flex-col items-center justify-center py-12 gap-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-white/[0.07] rounded-2xl shadow-sm">
          <div className="w-12 h-12 rounded-2xl bg-amber-50 dark:bg-amber-500/10 flex items-center justify-center">
            <AlertTriangle size={20} className="text-amber-500 dark:text-amber-400" />
          </div>
          <p className="text-gray-500 dark:text-gray-400 text-sm">No CPS configuration found for this application</p>
          <p className="text-gray-400 dark:text-gray-500 text-xs">
            The app must have <code className="text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-700/60 px-1 rounded">cps.configServerBaseUrl</code> in its deployment properties
          </p>
          <p className="text-gray-400 dark:text-gray-500 text-xs">You can still enter the CPS URL, env, and project key manually above</p>
        </div>
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
