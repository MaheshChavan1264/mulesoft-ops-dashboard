import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { Search, RefreshCw, ChevronRight, AlertTriangle, X, SlidersHorizontal, FileSpreadsheet, Activity, CheckCircle2, XCircle, Clock, ShieldCheck, UploadCloud, ExternalLink, Database, Check } from 'lucide-react';
import CredentialImportButton from '../../components/shared/CredentialImportButton';
import StatusBadge from '../../components/ui/StatusBadge';
import Select from '../../components/ui/Select';
import { applyBgFilter } from '../../components/shared/BgFilterModal';
import { applyEnvFilter } from '../../components/shared/EnvFilterModal';
import CpsExportModal from '../cps/CpsExportModal';
import PingResultCard from '../ping-test/PingResultCard';
import CopyBtn from '../../components/shared/CopyBtn';
import { getBusinessGroups, getEnvironments, getApplicationsSummary, runCloudhub1Action, runCloudhub2Action } from '../../services/applicationsService';
import { getCachedSWR, setCached, bustCache, keepFresh, stopKeepingFresh } from '../../services/apiCache';
import { CK } from '../../services/cacheKeys';
import { availableActions, ACTION_CONFIG, ENV_BADGE } from '../../utils/appUtils';
import { ENV_TAG_COLOR } from '../../utils/accentColors';
import Modal from '../../components/ui/Modal';
import Button from '../../components/ui/Button';
import ConfirmActionModal from '../../components/ui/ConfirmActionModal';
import TableHeader from '../../components/ui/TableHeader';
import { exportRowsToXlsx, timestampedFilename } from '../../utils/xlsxExport';
import { getErrorMessage } from '../../services/http';
import { useBgEnvFilter } from '../../hooks/useBgEnvFilter';
import { useDebounce } from '../../hooks/useDebounce';
import { parseCsvAppNames, matchAppsByCsvNames } from '../../hooks/useCsvAppMatcher';
import ConfirmModal from './modals/ConfirmModal';
import BulkConfirmModal from './modals/BulkConfirmModal';
import BulkPingModal from './modals/BulkPingModal';
import ExportAppsModal from './modals/ExportAppsModal';

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


// ── Cache TTL constants ───────────────────────────────────────────────────────
//
// APP_STALE_MS is the EVICTION window — how long before the entry is deleted.
// The freshness threshold (FRESH_MS = 3 min) is fixed inside apiCache.js.
//
// ┌─────────────────────────────────────────────────────────────────────────┐
// │  0 – 3 min   : FRESH  — instant render, no network call                │
// │  3 – 20 min  : STALE  — instant render from cache + silent BG refresh  │
// │  > 20 min    : EXPIRED — full reload with loading spinner               │
// └─────────────────────────────────────────────────────────────────────────┘
//
// Bug (before fix): APP_STALE_MS was set to 3 min — same as FRESH_MS.
// This collapsed the SWR window to 0 seconds: entries went from fresh
// directly to deleted, so ANY navigation longer than 3 minutes triggered a
// full cold reload with spinner.  Setting it to 20 min gives a 17-minute
// stale-but-usable window where the page renders instantly every time.
const APP_STALE_MS = 20 * 60 * 1000; // 20 min eviction (FRESH_MS = 3 min in apiCache.js)

/**
 * Standalone fetch helper used by the ApplicationsPage background-refresh path in loadApps.
 * Fetches apps + envs for the given BG IDs, merges them, stores in cache,
 * and returns { mergedApps, mergedEnvs }.
 * Does NOT touch any React state — callers apply the result themselves.
 */
async function _fetchAndCacheApps(bgId, bgIds, cacheKey) {
  const [appsResults, envsResults] = await Promise.all([
    Promise.allSettled(bgIds.map((id) => getApplicationsSummary(id))),
    Promise.allSettled(bgIds.map((id) => getEnvironments(id))),
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

  // Use APP_STALE_MS (20 min) so entries stay stale-but-usable for 17 min
  // after the 3-min freshness window expires — no cold reload needed.
  setCached(cacheKey, { apps: mergedApps, envs: mergedEnvs }, APP_STALE_MS);
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
  const debouncedSearch = useDebounce(search, 200);
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
  const { bgFilterVersion, envFilterVersion } = useBgEnvFilter();

  const [error, setError] = useState('');
  const [showExport, setShowExport] = useState(false);
  const [showExportApps, setShowExportApps] = useState(false);
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
  // 'exact' = app.name must exactly equal a CSV name | 'fuzzy' = substring match
  const [csvMatchMode, setCsvMatchMode] = useState('exact');
  // Set of env IDs to scope CSV matching — empty Set = match all loaded apps
  const [csvEnvFilter, setCsvEnvFilter] = useState(new Set());
  const [csvEnvDropOpen, setCsvEnvDropOpen] = useState(false);
  const csvEnvDropRef = useRef(null);
  const csvInputRef = useRef(null);
  // Tracks the cache key currently registered for proactive background refresh
  // so we can unregister it when the BG selection changes or the page unmounts.
  // Close env dropdown on outside click
  useEffect(() => {
    if (!csvEnvDropOpen) return;
    const handler = (e) => {
      if (csvEnvDropRef.current && !csvEnvDropRef.current.contains(e.target)) {
        setCsvEnvDropOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [csvEnvDropOpen]);

  const keepFreshKeyRef = useRef(null);
  // Feature 1: column sort state
  const [sortColumn, setSortColumn] = useState('');
  const [sortDir, setSortDir]       = useState('asc');

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const sortColumnRef = useRef(sortColumn); sortColumnRef.current = sortColumn;
  const sortDirRef = useRef(sortDir); sortDirRef.current = sortDir;
  // Stable (deps-free) handler — reads current sort state via refs instead
  // of closing over sortColumn/sortDir, so it isn't recreated on every
  // render — see FRONTEND_ARCHITECTURE_REVIEW.md §8 Performance Review,
  // finding #7.
  const handleSort = useCallback((col) => {
    if (sortColumnRef.current === col) setSortDir(sortDirRef.current === 'asc' ? 'desc' : 'asc');
    else { setSortColumn(col); setSortDir('asc'); }
  }, []);

  const SortIcon = ({ col }) => {
    if (sortColumn !== col) return <span className="text-gray-300 dark:text-gray-600 ml-0.5">⇅</span>;
    return <span className="text-sf-600 dark:text-sf-400 ml-0.5">{sortDir === 'asc' ? '↑' : '↓'}</span>;
  };

  /**
   * Match CSV names against the app pool, respecting mode and env scope.
   * Extracted as a plain function (not useCallback) so it can be called
   * both from handleCsvUpload and from the re-apply useEffect.
   */
  const runCsvMatch = useCallback((appPool, csvNames, mode, envFilterSet) =>
    matchAppsByCsvNames(appPool, csvNames, { mode, envFilterSet }), []);

  // Re-apply CSV matching whenever mode or env filter set changes
  useEffect(() => {
    if (!csvMatchedNames?.length) return;
    const matched = runCsvMatch(apps, csvMatchedNames, csvMatchMode, csvEnvFilter);
    setSelectedIds(new Set(matched.map(a => a.id)));
  }, [csvMatchMode, csvEnvFilter, csvMatchedNames, apps]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleCsvUpload = useCallback((e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCsvFileName(file.name);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const normalised = parseCsvAppNames(ev.target.result || '');
      setCsvMatchedNames(normalised);
      // Initial selection — useEffect will also fire after state settles
      setApps(current => {
        const matched = runCsvMatch(current, normalised, csvMatchMode, csvEnvFilter);
        setSelectedIds(new Set(matched.map(a => a.id)));
        return current;
      });
    };
    reader.readAsText(file);
    e.target.value = '';
  }, [csvMatchMode, csvEnvFilter, runCsvMatch]);

  useEffect(() => { if (orgId) loadBusinessGroups(); }, [orgId]);
  // Only re-load when selectedBg changes AND BGs are already loaded.
  // On initial mount, loadBusinessGroups calls loadApps directly with fresh BGs,
  // so this effect should only fire for subsequent user-driven BG changes.
  // bgFilterVersion (bumped when the global BG-visibility filter saves) must
  // ALSO trigger a re-fetch while on "All Organizations" — otherwise hiding
  // a BG there only updated the dropdown/labels (computed at render time)
  // while the already-fetched app rows for that now-hidden BG kept showing
  // until the next manual refresh or BG re-selection.
  useEffect(() => {
    if (selectedBg && allBusinessGroups.length > 0) loadApps(selectedBg);
  }, [selectedBg, bgFilterVersion]); // eslint-disable-line react-hooks/exhaustive-deps
  // Track mount state so background refresh doesn't set state on unmounted component
  // We intentionally do NOT stop keepFresh on unmount so the cache stays warm globally.
  const isMounted = useRef(true);
  useEffect(() => {
    return () => { isMounted.current = false; };
  }, []);

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
          getBusinessGroups()
            .then(r => {
              const fresh = r.data.data || [];
              setCached(cacheKey, fresh, 30 * 60 * 1000);
              setAllBusinessGroups(fresh);
            })
            .catch(() => {});
        }
        return;
      }
      const groups = await getBusinessGroups().then(res => res.data.data || []);
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
    const cacheKey = CK.apps(bgId, bgIds);

    // Registers (or re-registers) the proactive keep-fresh job for this exact
    // cache scope. Previously only called from the cold-fetch branch below —
    // both cache-HIT branches (fresh or stale) `return`ed before ever
    // reaching it, so revisiting this page while the cache was still warm
    // silently left no recurring background refresh running, defeating the
    // "navigation to this page will always be instant" guarantee the comment
    // below describes.
    const registerKeepFresh = () => {
      if (keepFreshKeyRef.current && keepFreshKeyRef.current !== cacheKey) {
        stopKeepingFresh(keepFreshKeyRef.current); // unregister previous BG key
      }
      keepFreshKeyRef.current = cacheKey;
      keepFresh(cacheKey, () =>
        _fetchAndCacheApps(bgId, bgIds, cacheKey).then(({ mergedApps: ma, mergedEnvs: me }) => {
          if (isMounted.current) {
            setApps(ma);
            setEnvironments(me);
          }
          return { apps: ma, envs: me }; // returned value is stored by the sweep
        })
      );
    };

    // ── Frontend cache — SWR (stale-while-revalidate) ────────────────────────
    // Render instantly from any usable cached value, then silently re-fetch
    // in the background when the entry is older than FRESH_MS (3 min).
    if (!forceRefresh) {
      const swr = getCachedSWR(cacheKey);
      if (swr) {
        setApps(swr.data.apps);
        setEnvironments(swr.data.envs);
        setError(swr.data.apps.length === 0 ? 'No applications found.' : '');
        setSelectedIds(new Set());
        registerKeepFresh();
        if (swr.stale) {
          // Background refresh — no loading spinner, UI stays responsive
          _fetchAndCacheApps(bgId, bgIds, cacheKey).then(({ mergedApps, mergedEnvs }) => {
            if (!isMounted.current) return;
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
      const [appsResults, envsResults] = await Promise.all([
        Promise.allSettled(bgIds.map(id => getApplicationsSummary(id, forceRefresh))),
        Promise.allSettled(bgIds.map(id => getEnvironments(id))),
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

      if (!isMounted.current) return;
      setApps(mergedApps);
      setEnvironments(mergedEnvs);
      if (mergedApps.length === 0) setError('No applications found.');

      // Store in frontend cache — APP_STALE_MS eviction window (20 min)
      // FRESH_MS (3 min) is fixed inside apiCache.js, giving a 17-min SWR window.
      setCached(cacheKey, { apps: mergedApps, envs: mergedEnvs }, APP_STALE_MS);

      // Proactive background refresh — the idle sweep will re-fetch this entry
      // when it goes stale (after 3 min), so the cache is NEVER cold while the
      // page is open. Navigation to this page will always be instant.
      registerKeepFresh();
    } catch (e) {
      if (isMounted.current) {
        setError(getErrorMessage(e, 'Failed to load applications.'));
        setApps([]);
      }
    }
    if (isMounted.current) setLoading(false);
  };

  /* ── Single-app action ─────────────────────────────── */
  const requestAction = useCallback((e, app, action) => {
    e.stopPropagation();
    setActionResult(null);
    setConfirmState({ app, action });
  }, []);

  const executeAction = async () => {
    if (!confirmState) return;
    const { app, action } = confirmState;
    setActionLoading((prev) => ({ ...prev, [app.id]: action }));
    try {
      const isCH2 = app.deploymentType === 'CloudHub 2.0';
      const envId = app.environment?.id;
      const appBgId = app._bgId || (selectedBg !== '__all__' ? selectedBg : orgId);
      if (isCH2) {
        await runCloudhub2Action(appBgId, envId, app.id, action);
      } else {
        await runCloudhub1Action(envId, app.id, appBgId, action);
      }
      const nextStatus = action === 'start' ? 'RUNNING' : action === 'stop' ? 'STOPPED' : 'DEPLOYING';
      setApps((prev) => prev.map((a) => a.id === app.id ? { ...a, status: nextStatus } : a));
      bustCache(CK.PREFIX.apps); // invalidate cached lists so Refresh picks up real status
      setActionResult({ success: true, message: `✓ ${app.name}: ${action} initiated` });
    } catch (e) {
      setActionResult({ success: false, message: `✗ Failed to ${action} ${app.name}: ${getErrorMessage(e)}` });
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
      const matchSearch = !debouncedSearch || a.name?.toLowerCase().includes(debouncedSearch.toLowerCase());
      const matchEnv = !filterEnv || a.environment?.id === filterEnv;
      const matchStatus = !filterStatus || (a.status || '').toUpperCase() === filterStatus.toUpperCase();
      const matchType = !filterType || a.deploymentType === filterType;
      return matchSearch && matchEnv && matchStatus && matchType;
    });
  }, [apps, environments, debouncedSearch, filterEnv, filterStatus, filterType, envFilterVersion]);

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

  // Reset to page 1 whenever filters, search, sort, or BG selection change
  useEffect(() => {
    setCurrentPage(1);
  }, [search, filterEnv, filterStatus, filterType, selectedBg, sortColumn, sortDir, filtered.length]);

  // Paginated slice of the display list
  const totalPages = Math.max(1, Math.ceil(displayFiltered.length / pageSize));
  const paginatedItems = displayFiltered.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const toggleRow = useCallback((e, appId) => {
    e.stopPropagation();
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(appId) ? next.delete(appId) : next.add(appId);
      return next;
    });
  }, []);

  const toggleAll = useCallback((e) => {
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
  }, [allSelected, someSelected, filtered]);

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
          return runCloudhub2Action(appBgId, envId, app.id, action);
        } else {
          return runCloudhub1Action(envId, app.id, appBgId, action);
        }
      })
    );

    const resultMap = {};
    const nextStatus = action === 'start' ? 'RUNNING' : action === 'stop' ? 'STOPPED' : 'DEPLOYING';

    targets.forEach((app, i) => {
      const r = settled[i];
      resultMap[app.id] = r.status === 'fulfilled'
        ? { success: true }
        : { success: false, error: getErrorMessage(r.reason, 'Failed') };
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

  /* ── Export Apps to XLSX ───────────────────────────── */
  const exportAppsToXlsx = useCallback(() => {
    const source = selectedApps.length > 0 ? selectedApps : filtered;
    if (source.length === 0) return;

    const rows = source.map(app => ({
      'Environment': app.environment?.name || '—',
      'Integration Name': app.name || '—',
      'Mule Version': app.muleVersion || '—',
      'Status': (app.status || '—').toUpperCase(),
    }));

    exportRowsToXlsx(rows, { sheetName: 'Applications', filename: timestampedFilename('apps-export') });
  }, [selectedApps, filtered]);

  /* ── Select options ────────────────────────────────── */
  // Apply BG filter to the visible list
  const visibleGroups = applyBgFilter(allBusinessGroups);
  const filterActive = visibleGroups.length < allBusinessGroups.length;

  // Apply Env filter to the loaded environments
  const visibleEnvs = applyEnvFilter(environments);
  const envFilterActive = visibleEnvs.length < environments.length;

  const bgOptions = [
    { value: '__all__', label: 'All Organizations', tag: `${visibleGroups.length}`, tagColor: 'bg-gray-200 text-gray-600' },
    ...visibleGroups.map((g) => ({
      value: g.id, label: g.name, indent: !!g.parentId,
      tag: !g.parentId ? 'Root' : undefined, tagColor: 'bg-sf-100 text-sf-600'
    })),
  ];

  const envOptions = [
    { value: '', label: 'All Environments' },
    ...visibleEnvs.map((e) => ({
      value: e.id, label: e.name, badge: true,
      badgeColor: ENV_BADGE[e.type] || 'bg-gray-400',
      tag: e.type, tagColor: ENV_TAG_COLOR[e.type] || 'bg-gray-200 text-gray-500'
    }))
  ];

  // Feature 7: status options with live counts from all loaded apps
  const statusOptions = [
    { value: '', label: 'All Statuses' },
    ...[
      { value: 'RUNNING',           label: 'Running',   badgeColor: 'bg-sfgreen-400' },
      { value: 'APPLIED',           label: 'Applied',   badgeColor: 'bg-sfteal-400' },
      { value: 'FAILED',            label: 'Failed',    badgeColor: 'bg-sfred-400' },
      { value: 'STOPPED',           label: 'Stopped',   badgeColor: 'bg-gray-400' },
      { value: 'DEPLOYING',         label: 'Deploying', badgeColor: 'bg-sf-400' },
      { value: 'UPDATING',          label: 'Updating',  badgeColor: 'bg-sfpurple-400' },
      { value: 'STARTING',          label: 'Starting',  badgeColor: 'bg-sf-300' },
      { value: 'STOPPING',          label: 'Stopping',  badgeColor: 'bg-sforange-400' },
      { value: 'PARTIALLY_STARTED', label: 'Partial',   badgeColor: 'bg-sforange-400' },
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
    { value: 'CloudHub 2.0', label: 'CloudHub 2.0', tag: 'CH2', tagColor: 'bg-sf-100 text-sf-600' },
    { value: 'CloudHub 1.0', label: 'CloudHub 1.0', tag: 'CH1', tagColor: 'bg-sfpurple-100 text-sfpurple-600' }
  ];

  const selectedBgName = selectedBg === '__all__'
    ? 'All Organizations'
    : visibleGroups.find((g) => g.id === selectedBg)?.name || 'Organization';

  return (
    <div className="h-full flex flex-col gap-5">
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

      {/* Export Apps Modal */}
      {showExportApps && (
        <ExportAppsModal
          apps={apps}
          allBusinessGroups={allBusinessGroups}
          environments={environments}
          onClose={() => setShowExportApps(false)}
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

      {/* Header — title + inline CSV banner + action buttons all on one row */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3 flex-wrap min-w-0 flex-1">
          {/* Inline CSV banner — only when a CSV is uploaded */}
          {csvMatchedNames !== null && (
            <div className={`group relative flex items-center gap-2.5 flex-wrap pl-1 pr-3 py-1.5 rounded-2xl border transition-all ${
              selectedIds.size > 0
                ? 'bg-gradient-to-r from-sf-50 via-sf-50/60 to-transparent dark:from-sf-500/10 dark:via-sf-500/5 border-sf-200/70 dark:border-sf-400/30 shadow-sm'
                : 'bg-gray-50 dark:bg-gray-800/40 border-gray-200 dark:border-gray-700'
            }`}>
              <span className={`flex items-center justify-center w-7 h-7 rounded-xl flex-shrink-0 ${
                selectedIds.size > 0 ? 'bg-sf-600 text-white shadow-sm shadow-sf-500/30' : 'bg-gray-200/70 dark:bg-gray-700/70 text-gray-500 dark:text-gray-400'
              }`}>
                <UploadCloud size={13} />
              </span>
              <div className="flex flex-col leading-tight">
                <span className="font-mono text-[10px] text-gray-500 dark:text-gray-400 max-w-[120px] truncate">{csvFileName}</span>
                {selectedIds.size > 0
                  ? <span className="text-sf-700 dark:text-sf-300 font-bold text-[11px]">{selectedIds.size} matched</span>
                  : <span className="text-gray-400 dark:text-gray-500 text-[10px]">no match</span>}
              </div>
              {csvMatchedNames.length > 0 && (
                <span className="text-[10px] text-gray-400 dark:text-gray-500">({csvMatchedNames.length} in CSV)</span>
              )}
              <div className="w-px h-6 bg-gray-200 dark:bg-gray-700 flex-shrink-0" />
              {/* Match mode */}
              <div className="flex items-center gap-0.5 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-0.5 shadow-sm">
                {[['exact', 'Exact'], ['fuzzy', '~']].map(([mode, label]) => (
                  <button key={mode} onClick={() => setCsvMatchMode(mode)}
                    className={`text-[9px] px-1.5 py-0.5 rounded-md font-semibold transition-all ${
                      csvMatchMode === mode ? 'bg-sf-600 text-white shadow-sm' : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100'
                    }`}>
                    {label}
                  </button>
                ))}
              </div>
              {/* Env dropdown */}
              {environments.length > 0 && (() => {
                const envList = applyEnvFilter(environments);
                const selNames = [...csvEnvFilter].map(id => envList.find(e => e.id === id)?.name).filter(Boolean);
                const dropLabel = csvEnvFilter.size === 0 ? 'All envs' : `${csvEnvFilter.size} envs`;
                return (
                  <>
                    <div className="relative" ref={csvEnvDropRef}>
                      <button onClick={() => setCsvEnvDropOpen(o => !o)}
                        className={`flex items-center gap-1 text-[9px] font-semibold rounded-lg px-2 py-1 border transition-colors ${
                          csvEnvFilter.size > 0
                            ? 'bg-sf-50 dark:bg-sf-500/10 border-sf-200/70 dark:border-sf-400/30 text-sf-700 dark:text-sf-300'
                            : 'bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:border-sf-300/60 dark:hover:border-sf-400/40 hover:text-sf-700 dark:hover:text-sf-300'
                        }`}>
                        {dropLabel}
                        <span className={`transition-transform inline-block ${csvEnvDropOpen ? 'rotate-180' : ''}`}>▾</span>
                      </button>
                      {csvEnvDropOpen && (
                        <div className="absolute top-full left-0 mt-1.5 z-30 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-2xl min-w-[11rem] overflow-hidden">
                          <div className="px-2 pt-2 pb-1 border-b border-gray-100 dark:border-gray-700">
                            <div className="relative">
                              <Search size={9} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500 pointer-events-none" />
                              <input autoFocus placeholder="Search…"
                                onChange={e => {
                                  const q = e.target.value.toLowerCase();
                                  csvEnvDropRef.current?.querySelectorAll('[data-env-name]').forEach(el => {
                                    el.style.display = el.dataset.envName.includes(q) ? '' : 'none';
                                  });
                                }}
                                className="w-full bg-gray-100 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg pl-5 pr-2 py-1 text-[9px] text-gray-700 dark:text-gray-300 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:border-sf-500/50"
                              />
                            </div>
                          </div>
                          <div className="max-h-44 overflow-y-auto py-1">
                            {envList.map(env => {
                              const isSel = csvEnvFilter.has(env.id);
                              const isProd = env.type === 'production';
                              return (
                                <button key={env.id} data-env-name={env.name.toLowerCase()}
                                  onClick={() => setCsvEnvFilter(prev => { const n = new Set(prev); n.has(env.id) ? n.delete(env.id) : n.add(env.id); return n; })}
                                  className="w-full flex items-center gap-2 px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors text-left">
                                  <div className={`w-3.5 h-3.5 rounded-md border flex-shrink-0 flex items-center justify-center transition-colors ${isSel ? 'bg-sf-500 border-sf-400' : 'border-gray-300 dark:border-gray-600'}`}>
                                    {isSel && <span className="text-white text-[7px] font-bold leading-none">✓</span>}
                                  </div>
                                  <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${isProd ? 'bg-sfgreen-400' : 'bg-sforange-400'}`} />
                                  <span className="text-[9px] text-gray-600 dark:text-gray-300">{env.name}</span>
                                </button>
                              );
                            })}
                          </div>
                          {csvEnvFilter.size > 0 && (
                            <div className="px-3 py-1.5 border-t border-gray-100 dark:border-gray-700">
                              <button onClick={() => { setCsvEnvFilter(new Set()); setCsvEnvDropOpen(false); }}
                                className="text-[9px] text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">Clear</button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                    {selNames.length > 0 && (
                      <span className="text-[9px] text-sf-700/80 dark:text-sf-300/80 font-medium truncate max-w-[140px]">{selNames.join(', ')}</span>
                    )}
                  </>
                );
              })()}
              {/* Close CSV */}
              <button onClick={() => { setCsvMatchedNames(null); setCsvFileName(''); setSelectedIds(new Set()); setCsvEnvFilter(new Set()); }}
                className="flex items-center justify-center w-5 h-5 rounded-lg text-gray-400 dark:text-gray-500 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 flex-shrink-0 transition-colors">
                <X size={12} />
              </button>
            </div>
          )}

        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Bulk actions — shown before Upload CSV when apps are selected */}
          {selectedApps.length > 0 && (
            <>
              <span className="text-[11px] text-sf-700 dark:text-sf-300 font-bold px-2 py-1 rounded-lg bg-sf-50 dark:bg-sf-500/10">{selectedApps.length} sel</span>
              <button onClick={() => setSelectedIds(new Set())}
                className="text-[10px] text-gray-500 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400 underline underline-offset-2 transition-colors">Clear</button>
              {bulkActions.map(action => {
                const { Icon, label, bulkCls } = ACTION_CONFIG[action];
                return (
                  <button key={action} onClick={() => requestBulkAction(action)}
                    className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-sm font-semibold transition-all duration-200 hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98] ${bulkCls}`}>
                    <Icon size={13} /> {label}
                  </button>
                );
              })}
              <span className="w-px h-6 bg-gradient-to-b from-transparent via-gray-200 dark:via-gray-700 to-transparent mx-1 flex-shrink-0" />
            </>
          )}
          {/* Hidden CSV file input */}
          <input ref={csvInputRef} type="file" accept=".csv,text/csv" onChange={handleCsvUpload} className="hidden" />
          {/* CSV upload button */}
          <button onClick={() => csvInputRef.current?.click()}
            title="Upload a CSV of app names to auto-select matching apps"
            className="group/tool flex items-center gap-2 text-sm font-medium text-gray-600 dark:text-gray-300 bg-white dark:bg-gray-800 hover:text-sf-700 dark:hover:text-sf-300 border border-gray-200 dark:border-gray-700 hover:border-sf-200/70 dark:hover:border-sf-400/30 px-3 py-2 rounded-xl shadow-sm hover:shadow-md transition-all">
            <span className="flex items-center justify-center w-5 h-5 rounded-lg bg-gray-100 dark:bg-gray-700 group-hover/tool:bg-sf-100 dark:group-hover/tool:bg-sf-500/20 text-gray-500 dark:text-gray-400 group-hover/tool:text-sf-600 dark:group-hover/tool:text-sf-400 flex-shrink-0 transition-colors">
              <UploadCloud size={12} />
            </span>
            Upload CSV
          </button>
          <button onClick={() => setShowBulkPing(true)} disabled={loading || filtered.length === 0}
            title={selectedApps.length > 0 ? `Ping ${selectedApps.length} selected apps` : 'Ping all visible apps'}
            className="group/tool flex items-center gap-2 text-sm font-medium text-gray-600 dark:text-gray-300 bg-white dark:bg-gray-800 hover:text-sfteal-700 dark:hover:text-sfteal-300 border border-gray-200 dark:border-gray-700 hover:border-sfteal-200/70 dark:hover:border-sfteal-400/30 px-3 py-2 rounded-xl shadow-sm hover:shadow-md disabled:opacity-40 disabled:shadow-none disabled:hover:shadow-none transition-all">
            <span className="flex items-center justify-center w-5 h-5 rounded-lg bg-gray-100 dark:bg-gray-700 group-hover/tool:bg-sfteal-100 dark:group-hover/tool:bg-sfteal-500/20 text-gray-500 dark:text-gray-400 group-hover/tool:text-sfteal-600 dark:group-hover/tool:text-sfteal-400 flex-shrink-0 transition-colors">
              <Activity size={12} />
            </span>
            {selectedApps.length > 0 ? `Ping (${selectedApps.length})` : 'Ping Test'}
          </button>
          <button
            onClick={() => setShowExportApps(true)}
            disabled={loading || apps.length === 0}
            title="Export apps to Excel — choose Business Group and Environment"
            className="group/tool flex items-center gap-2 text-sm font-medium text-gray-600 dark:text-gray-300 bg-white dark:bg-gray-800 hover:text-sfpurple-700 dark:hover:text-sfpurple-300 border border-gray-200 dark:border-gray-700 hover:border-sfpurple-200/70 dark:hover:border-sfpurple-400/30 px-3 py-2 rounded-xl shadow-sm hover:shadow-md disabled:opacity-40 disabled:shadow-none disabled:hover:shadow-none transition-all">
            <span className="flex items-center justify-center w-5 h-5 rounded-lg bg-gray-100 dark:bg-gray-700 group-hover/tool:bg-sfpurple-100 dark:group-hover/tool:bg-sfpurple-500/20 text-gray-500 dark:text-gray-400 group-hover/tool:text-sfpurple-600 dark:group-hover/tool:text-sfpurple-400 flex-shrink-0 transition-colors">
              <FileSpreadsheet size={12} />
            </span>
            Export Apps
          </button>
          <button onClick={() => setShowExport(true)} disabled={loading || apps.length === 0}
            title={selectedApps.length > 0 ? `Export CPS for ${selectedApps.length} selected apps` : 'Export CPS Properties to Excel'}
            className="group/tool flex items-center gap-2 text-sm font-medium text-gray-600 dark:text-gray-300 bg-white dark:bg-gray-800 hover:text-sfgreen-700 dark:hover:text-sfgreen-300 border border-gray-200 dark:border-gray-700 hover:border-sfgreen-200/70 dark:hover:border-sfgreen-400/30 px-3 py-2 rounded-xl shadow-sm hover:shadow-md disabled:opacity-40 disabled:shadow-none disabled:hover:shadow-none transition-all">
            <span className="flex items-center justify-center w-5 h-5 rounded-lg bg-gray-100 dark:bg-gray-700 group-hover/tool:bg-sfgreen-100 dark:group-hover/tool:bg-sfgreen-500/20 text-gray-500 dark:text-gray-400 group-hover/tool:text-sfgreen-600 dark:group-hover/tool:text-sfgreen-400 flex-shrink-0 transition-colors">
              <FileSpreadsheet size={12} />
            </span>
            {selectedApps.length > 0 ? `Export CPS (${selectedApps.length})` : 'Export CPS'}
          </button>
          <button onClick={() => loadApps(selectedBg, true)} disabled={loading || bgLoading}
            title="Refresh application list"
            className="flex items-center justify-center w-9 h-9 rounded-xl text-gray-500 dark:text-gray-400 bg-white dark:bg-gray-800 hover:text-gray-900 dark:hover:text-gray-100 border border-gray-200 dark:border-gray-700 shadow-sm hover:shadow-md disabled:opacity-50 transition-all">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Single-app toast */}
      {actionResult && (
        <div className={`flex items-center justify-between px-4 py-3 rounded-xl border text-sm ${
          actionResult.success ? 'bg-sfgreen-50/40 border-sfgreen-200/50 text-sfgreen-700' : 'bg-sfred-50/40 border-sfred-200/50 text-sfred-700'
        }`}>
          <span>{actionResult.message}</span>
          <button onClick={() => setActionResult(null)} className="ml-4 opacity-60 hover:opacity-100"><X size={14} /></button>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2.5 bg-red-50 dark:bg-red-500/10 border border-red-200/80 dark:border-red-400/30 rounded-2xl px-4 py-3 text-red-700 dark:text-red-300 text-sm shadow-sm">
          <AlertTriangle size={15} className="flex-shrink-0" />
          {error}
        </div>
      )}

      {/* Filters row — Search, BG, Env, Status, Type (no labels) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        {/* Search */}
        <div className="sm:col-span-2 lg:col-span-1">
          <div className="relative group">
            <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500 group-focus-within:text-sf-500 pointer-events-none transition-colors" />
            <input value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Search applications…"
              className="w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl pl-10 pr-4 py-2.5 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 shadow-sm focus:outline-none focus:border-sf-500 dark:focus:border-sf-400 focus:ring-2 focus:ring-sf-500/15 dark:focus:ring-sf-400/15 transition-all" />
            {search && (
              <button onClick={() => setSearch('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors">
                <X size={13} />
              </button>
            )}
          </div>
        </div>
        {/* BG selector */}
        <div className="lg:col-span-1">
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
            placeholder="All Organizations…"
            searchable={visibleGroups.length > 5}
            disabled={bgLoading}
          />
          {filterActive && (
            <p className="text-[10px] text-sf-600 dark:text-sf-400 font-medium mt-1 pl-1">
              {visibleGroups.length}/{allBusinessGroups.length} shown
            </p>
          )}
        </div>
        <div><Select value={filterEnv} onChange={setFilterEnv} options={envOptions} placeholder="All Environments" searchable /></div>
        <div><Select value={filterStatus} onChange={setFilterStatus} options={statusOptions} placeholder="All Statuses" /></div>
        <div><Select value={filterType} onChange={setFilterType} options={typeOptions} placeholder="All Types" /></div>
      </div>


      {loading ? (
        /* Feature 1.1: skeleton table rows matching the real table structure */
        <div className="card-surface overflow-hidden flex-1 flex flex-col min-h-0">
          <table className="w-full text-sm">
            <TableHeader>
              <tr className="text-gray-500 dark:text-gray-400 text-xs uppercase tracking-wider">
                <th className="px-4 py-3 w-10" />
                <th className="text-left px-4 py-3">Application</th>
                <th className="text-left px-4 py-3">Status</th>
                <th className="text-left px-4 py-3">Environment</th>
                <th className="text-left px-4 py-3">Type</th>
                <th className="text-left px-4 py-3">Mule Version</th>
                <th className="text-left px-4 py-3">Last Modified</th>
                <th className="px-4 py-3 text-center">Actions</th>
              </tr>
            </TableHeader>
            <tbody>
              {[...Array(8)].map((_, i) => (
                <tr key={i} className="border-t border-gray-100 dark:border-gray-700/60 animate-pulse">
                  <td className="px-4 py-3.5"><div className="w-4 h-4 rounded bg-gray-100 dark:bg-gray-700" /></td>
                  <td className="px-4 py-3.5">
                    <div className="flex items-center gap-2">
                      <div className="h-3 rounded bg-gray-100 dark:bg-gray-700" style={{ width: `${100 + (i % 5) * 30}px` }} />
                    </div>
                  </td>
                  <td className="px-4 py-3.5"><div className="h-5 w-20 rounded-full bg-gray-100 dark:bg-gray-700" /></td>
                  <td className="px-4 py-3.5">
                    <div className="flex items-center gap-1.5">
                      <div className="w-2 h-2 rounded-full bg-gray-200 dark:bg-gray-600" />
                      <div className="h-3 w-24 rounded bg-gray-100 dark:bg-gray-700" />
                    </div>
                  </td>
                  <td className="px-4 py-3.5"><div className="h-5 w-24 rounded bg-gray-100 dark:bg-gray-700" /></td>
                  <td className="px-4 py-3.5"><div className="h-3 w-16 rounded bg-gray-100 dark:bg-gray-700" /></td>
                  <td className="px-4 py-3.5"><div className="h-3 w-20 rounded bg-gray-100 dark:bg-gray-700" /></td>
                  <td className="px-4 py-3.5"><div className="h-6 w-14 rounded-lg bg-gray-100 dark:bg-gray-700 mx-auto" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="relative card-surface overflow-hidden flex-1 flex flex-col min-h-0">
          {/* Feature 6: overflow-y-auto on this inner div makes sticky thead work.
              The outer div keeps overflow-hidden for border-radius clipping. */}
          <div className="overflow-y-auto flex-1">
          <table className="w-full text-sm">
            <TableHeader sticky>
              <tr className="text-gray-500 dark:text-gray-400 text-[11px] uppercase tracking-wider border-b border-gray-200 dark:border-white/[0.08]">
                {/* Select-all checkbox */}
                <th className="px-4 py-3.5 w-10" onClick={toggleAll}>
                  <div className={`w-4 h-4 rounded-md border flex items-center justify-center cursor-pointer transition-all ${
                    allSelected ? 'bg-sf-600 border-sf-500 shadow-sm shadow-sf-500/30' : someSelected ? 'bg-sf-100 dark:bg-sf-500/20 border-sf-300 dark:border-sf-400/40' : 'border-gray-300 dark:border-gray-600 hover:border-sf-500'
                  }`}>
                    {allSelected && <span className="text-white text-[10px] font-bold leading-none">✓</span>}
                    {someSelected && <span className="text-sf-600 dark:text-sf-400 text-[10px] font-bold leading-none">–</span>}
                  </div>
                </th>
                {/* Feature 1: sortable column headers */}
                <th className="text-left px-4 py-3.5 font-semibold cursor-pointer hover:text-gray-800 dark:hover:text-gray-200 select-none transition-colors" onClick={() => handleSort('name')}>
                  Application <SortIcon col="name" />
                </th>
                <th className="text-left px-4 py-3.5 font-semibold cursor-pointer hover:text-gray-800 dark:hover:text-gray-200 select-none transition-colors" onClick={() => handleSort('status')}>
                  Status <SortIcon col="status" />
                </th>
                <th className="text-left px-4 py-3.5 font-semibold cursor-pointer hover:text-gray-800 dark:hover:text-gray-200 select-none transition-colors" onClick={() => handleSort('environment')}>
                  Environment <SortIcon col="environment" />
                </th>
                <th className="text-left px-4 py-3.5 font-semibold cursor-pointer hover:text-gray-800 dark:hover:text-gray-200 select-none transition-colors" onClick={() => handleSort('type')}>
                  Type <SortIcon col="type" />
                </th>
                <th className="text-left px-4 py-3.5 font-semibold cursor-pointer hover:text-gray-800 dark:hover:text-gray-200 select-none transition-colors" onClick={() => handleSort('muleVersion')}>
                  Mule Version <SortIcon col="muleVersion" />
                </th>
                <th className="text-left px-4 py-3.5 font-semibold cursor-pointer hover:text-gray-800 dark:hover:text-gray-200 select-none transition-colors" onClick={() => handleSort('lastModified')}>
                  Last Modified <SortIcon col="lastModified" />
                </th>
                <th className="px-4 py-3.5 font-semibold text-center">Actions</th>
              </tr>
            </TableHeader>
            <tbody className="divide-y divide-gray-100 dark:divide-white/[0.06]">
              {paginatedItems.map((app, idx) => {
                const actions = availableActions(app.status);
                const isActing = !!actionLoading[app.id];
                const isChecked = selectedIds.has(app.id);

                return (
                  <tr key={`${app.id}-${idx}`}
                    className={`group hover:bg-sf-50/40 dark:hover:bg-sf-500/[0.08] cursor-pointer transition-colors ${isChecked ? 'bg-sf-50/60 dark:bg-sf-500/[0.12]' : (() => {
                      const st = (app.status || '').toUpperCase();
                      if (st === 'FAILED')    return 'border-l-2 border-l-red-500 bg-red-50/30 dark:bg-red-500/[0.08]';
                      if (st === 'DEPLOYING') return 'border-l-2 border-l-blue-400 bg-blue-50/20 dark:bg-blue-500/[0.07]';
                      if (st === 'UPDATING')  return 'border-l-2 border-l-purple-400 bg-purple-50/20 dark:bg-purple-500/[0.07]';
                      if (st === 'STARTING')  return 'border-l-2 border-l-blue-300';
                      if (st === 'STOPPING')  return 'border-l-2 border-l-orange-400';
                      if (st === 'STOPPED')   return 'border-l-2 border-l-gray-200 dark:border-l-gray-700';
                      return 'border-l-2 border-l-transparent';
                    })()}`}
                    onClick={() => navigate(`/applications/${app._bgId || (selectedBg !== '__all__' ? selectedBg : orgId)}/${app.environment?.id}/${app.id}`)}>
                    {/* Checkbox */}
                    <td className="px-4 py-3.5" onClick={(e) => toggleRow(e, app.id)}>
                      <div className={`w-4 h-4 rounded-md border flex items-center justify-center cursor-pointer transition-all ${
                        isChecked ? 'bg-sf-600 border-sf-500 shadow-sm shadow-sf-500/30' : 'border-gray-300 dark:border-gray-600 hover:border-sf-500 group-hover:border-sf-400'
                      }`}>
                        {isChecked && <span className="text-white text-[10px] font-bold leading-none">✓</span>}
                      </div>
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-1.5">
                        <span className="text-gray-900 dark:text-gray-100 font-semibold">{app.name}</span>
                        <CopyBtn text={app.name} fade={false} />
                        <button
                          type="button"
                          title={`Open in Anypoint Platform${app.environment?.name ? ` — ${app.environment.name}` : ''} (app name copied to clipboard)`}
                          onClick={(e) => openInAnypoint(e, app, selectedBg !== '__all__' ? selectedBg : orgId)}
                          className="ml-0.5 text-gray-400 dark:text-gray-500 hover:text-sf-600 dark:hover:text-sf-400 transition-colors flex-shrink-0"
                        >
                          <ExternalLink size={11} />
                        </button>
                      </div>
                    </td>
                    <td className="px-4 py-3.5"><StatusBadge status={app.status} /></td>
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-1.5">
                        <span className={`w-2 h-2 rounded-full flex-shrink-0 ring-2 ring-white dark:ring-gray-800 ${ENV_BADGE[app.environment?.type] || 'bg-gray-400'}`} />
                        <span className="text-gray-600 dark:text-gray-400">{app.environment?.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3.5">
                      <span className={`text-[11px] px-2 py-0.5 rounded-md font-semibold ${
                        app.deploymentType === 'CloudHub 2.0' ? 'bg-sf-50 text-sf-700 dark:bg-sf-500/15 dark:text-sf-300' : 'bg-sfpurple-50 text-sfpurple-700 dark:bg-sfpurple-500/15 dark:text-sfpurple-300'
                      }`}>{app.deploymentType}</span>
                    </td>
                    <td className="px-4 py-3.5 text-gray-500 dark:text-gray-400 font-mono text-xs">{app.muleVersion || '—'}</td>
                    <td className="px-4 py-3.5 text-xs">
                      {app.lastModifiedDate
                        ? <span className="text-gray-500 dark:text-gray-400 tabular-nums whitespace-nowrap">
                            {new Date(app.lastModifiedDate).toLocaleString(undefined, {
                              year: 'numeric', month: 'short', day: '2-digit',
                              hour: '2-digit', minute: '2-digit', hour12: false,
                            })}
                          </span>
                        : <span className="text-gray-400 dark:text-gray-500">—</span>}
                    </td>
                    <td className="px-4 py-3.5" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-center gap-1">
                        {isActing ? (
                          <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-sf-400" />
                        ) : actions.length > 0 ? (
                          actions.map((action) => {
                            const { Icon, label, btnCls } = ACTION_CONFIG[action];
                            return (
                              <button key={action} title={label}
                                onClick={(e) => requestAction(e, app, action)}
                                className={`p-1.5 rounded-xl border transition-all duration-200 hover:scale-105 active:scale-95 ${btnCls}`}>
                                <Icon size={13} />
                              </button>
                            );
                          })
                        ) : (
                          <ChevronRight size={14} className="text-gray-400 dark:text-gray-500" />
                        )}
                        {/* CPS Manager shortcut */}
                        <button
                          title="Open in CPS Manager"
                          onClick={(e) => {
                            e.stopPropagation();
                            navigate('/cps-manager', {
                              state: {
                                cpsAutoSelect: {
                                  bgId: app._bgId || (selectedBg !== '__all__' ? selectedBg : orgId),
                                  envId: app.environment?.id || '',
                                  compositeId: `${app.id}|${app.environment?.id || ''}|${app._bgId || ''}`,
                                  appName: app.name,
                                },
                              },
                            });
                          }}
                          className="p-1.5 rounded-lg border text-gray-400 dark:text-gray-500 hover:text-sfteal-600 dark:hover:text-sfteal-400 border-gray-200 dark:border-gray-700 hover:border-sfteal-300/60 dark:hover:border-sfteal-400/30 hover:bg-sfteal-50 dark:hover:bg-sfteal-500/10 hover:shadow-sm transition-all">
                          <Database size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {displayFiltered.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-5 py-16 text-center">
                    <div className="flex flex-col items-center gap-2">
                      <div className="w-12 h-12 rounded-2xl bg-gray-100 dark:bg-gray-700/50 flex items-center justify-center mb-1">
                        <Search size={20} className="text-gray-400 dark:text-gray-500" />
                      </div>
                      <p className="text-gray-500 dark:text-gray-400 text-sm">
                        {apps.length === 0
                          ? `No applications found in ${selectedBgName}.`
                          : 'No applications match your filters.'}
                      </p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          </div>
        </div>
      )}

      {/* Pagination controls */}
      {!loading && filtered.length > 0 && (
        <div className="flex items-center justify-between flex-wrap gap-3 px-1 flex-shrink-0">
          {/* Left: selected + total info */}
          <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
            {selectedApps.length > 0 && (
              <span className="text-sf-700 dark:text-sf-300 font-bold px-2 py-0.5 rounded-lg bg-sf-50 dark:bg-sf-500/10">{selectedApps.length} selected</span>
            )}
            <span>
              {displayFiltered.length === apps.length
                ? `${apps.length} application${apps.length !== 1 ? 's' : ''}`
                : `${displayFiltered.length} of ${apps.length} applications`}
            </span>
          </div>

          {/* Right: page-size picker + prev/next */}
          <div className="flex items-center gap-3">
            {/* Page size selector */}
            <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
              <span>Rows</span>
              <div className="flex items-center gap-0.5 bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-0.5">
                {[25, 50, 100, 200].map(size => (
                  <button
                    key={size}
                    onClick={() => { setPageSize(size); setCurrentPage(1); }}
                    className={`px-2.5 py-1 rounded-lg text-[10px] font-semibold transition-all ${
                      pageSize === size
                        ? 'bg-white dark:bg-gray-900 text-sf-700 dark:text-sf-300 shadow-sm'
                        : 'text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200'
                    }`}
                  >
                    {size}
                  </button>
                ))}
              </div>
            </div>

            {/* Page navigation */}
            {totalPages > 1 && (
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setCurrentPage(1)}
                  disabled={currentPage === 1}
                  className="px-2 py-1.5 text-[10px] text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 border border-gray-200 dark:border-gray-700 rounded-lg disabled:opacity-30 disabled:cursor-not-allowed shadow-sm transition-all"
                  title="First page"
                >
                  «
                </button>
                <button
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="px-2.5 py-1.5 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 border border-gray-200 dark:border-gray-700 rounded-lg disabled:opacity-30 disabled:cursor-not-allowed shadow-sm transition-all"
                >
                  ‹
                </button>

                {/* Page number pills */}
                <div className="flex items-center gap-0.5">
                  {(() => {
                    const pages = [];
                    const delta = 2;
                    const left = Math.max(1, currentPage - delta);
                    const right = Math.min(totalPages, currentPage + delta);
                    if (left > 1) {
                      pages.push(1);
                      if (left > 2) pages.push('...');
                    }
                    for (let i = left; i <= right; i++) pages.push(i);
                    if (right < totalPages) {
                      if (right < totalPages - 1) pages.push('...');
                      pages.push(totalPages);
                    }
                    return pages.map((p, i) =>
                      p === '...' ? (
                        <span key={`ellipsis-${i}`} className="px-1.5 text-[10px] text-gray-400 dark:text-gray-500">…</span>
                      ) : (
                        <button
                          key={p}
                          onClick={() => setCurrentPage(p)}
                          className={`min-w-[28px] h-[28px] text-[10px] font-semibold rounded-lg transition-all ${
                            currentPage === p
                              ? 'bg-sf-600 text-white shadow-sm shadow-sf-500/30'
                              : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 border border-gray-200 dark:border-gray-700 shadow-sm'
                          }`}
                        >
                          {p}
                        </button>
                      )
                    );
                  })()}
                </div>

                <button
                  onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                  className="px-2.5 py-1.5 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 border border-gray-200 dark:border-gray-700 rounded-lg disabled:opacity-30 disabled:cursor-not-allowed shadow-sm transition-all"
                >
                  ›
                </button>
                <button
                  onClick={() => setCurrentPage(totalPages)}
                  disabled={currentPage === totalPages}
                  className="px-2 py-1.5 text-[10px] text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 border border-gray-200 dark:border-gray-700 rounded-lg disabled:opacity-30 disabled:cursor-not-allowed shadow-sm transition-all"
                  title="Last page"
                >
                  »
                </button>

                {/* Compact page range label */}
                <span className="text-[10px] text-gray-400 dark:text-gray-500 ml-1 tabular-nums whitespace-nowrap">
                  {(currentPage - 1) * pageSize + 1}–{Math.min(currentPage * pageSize, displayFiltered.length)} of {displayFiltered.length}
                </span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
