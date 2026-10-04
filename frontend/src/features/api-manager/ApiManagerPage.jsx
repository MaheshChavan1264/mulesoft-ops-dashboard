import React, { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import { useAuth } from '../../context/AuthContext';
import { RefreshCw, ShieldCheck, Search, SlidersHorizontal, FileText, ChevronRight, Globe, X } from 'lucide-react';
import StatusBadge from '../../components/ui/StatusBadge';
import Select from '../../components/ui/Select';
import BgFilterModal, { applyBgFilter } from '../../components/shared/BgFilterModal';
import { applyEnvFilter, getVisibleEnvIds } from '../../components/shared/EnvFilterModal';
import { ENV_BADGE } from '../../utils/appUtils';
import { ENV_TAG_COLOR } from '../../utils/accentColors';
import { useBgEnvFilter } from '../../hooks/useBgEnvFilter';
import { useDebounce } from '../../hooks/useDebounce';
import PageHeader from '../../components/ui/PageHeader';
import { SkeletonListRows } from '../../components/ui/SkeletonTable';
import { getCachedSWR, setCached } from '../../services/apiCache';
import { getErrorMessage } from '../../services/http';
import {
  getApiInstances, getApiPolicies, getApiContracts,
  updateContractStatus as updateContractStatusApi, deleteContract as deleteContractApi,
} from '../../services/apiManagerService';
import { getBusinessGroups, getEnvironments } from '../../services/applicationsService';
import ContractCard from './ContractCard';
import PolicyCard from './PolicyCard';

// Cache TTL constants
const ENV_CACHE_MS  = 10 * 60 * 1000;  // 10 min — env lists are stable
const APIS_CACHE_MS =  5 * 60 * 1000;  //  5 min — API instances change more often

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function ApiManagerPage() {
  const { orgId: authOrgId } = useAuth();

  const [allBusinessGroups, setAllBusinessGroups] = useState([]);

  // Persist BG selection in localStorage; default to __all__
  const [selectedBg, setSelectedBg] = useState(
    () => localStorage.getItem('mule_apimgr_bg') || '__all__'
  );
  useEffect(() => {
    if (selectedBg) localStorage.setItem('mule_apimgr_bg', selectedBg);
  }, [selectedBg]);

  const [bgLoading, setBgLoading] = useState(true);
  const [showBgFilter, setShowBgFilter] = useState(false);
  const [environments, setEnvironments] = useState([]);

  // Persist Env selection in localStorage; '' means All Environments
  const [selectedEnv, setSelectedEnv] = useState(
    () => localStorage.getItem('mule_apimgr_env') || ''
  );
  useEffect(() => {
    localStorage.setItem('mule_apimgr_env', selectedEnv);
  }, [selectedEnv]);

  const [apis, setApis] = useState([]);
  const [selectedApi, setSelectedApi] = useState(null);
  const [policies, setPolicies] = useState([]);
  const [contracts, setContracts] = useState([]);
  const [contractsLoading, setContractsLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 200);
  const { bgFilterVersion, envFilterVersion } = useBgEnvFilter();

  // Prevent the selectedEnv effect from double-firing on initial mount;
  // loadEnvs already calls loadApisInternal directly with fresh data.
  const skipEnvEffectRef = useRef(true);

  // Auto-select instance navigated from ApplicationDetailPage (stored in localStorage)
  const pendingInstanceIdRef = useRef(
    localStorage.getItem('mule_apimgr_instance') || ''
  );
  // Fallback hint when ApplicationDetailPage didn't know the exact API
  // instance ID yet (its Contracts tab hadn't been loaded) — it stores the
  // app name instead so we can pre-filter/auto-select by name once the
  // instance list loads. Previously written by ApplicationDetailPage but
  // never read here, so the "API Manager" shortcut silently did nothing
  // whenever contracts hadn't been fetched first.
  const pendingSearchRef = useRef(
    localStorage.getItem('mule_apimgr_search') || ''
  );

  // Clear the pending instance/search keys from localStorage as soon as the
  // page mounts (we've already captured them in the refs above), and seed
  // the search box with the name hint so the list is pre-filtered even if
  // auto-select below can't resolve it unambiguously.
  useEffect(() => {
    if (pendingInstanceIdRef.current) {
      localStorage.removeItem('mule_apimgr_instance');
    }
    if (pendingSearchRef.current) {
      localStorage.removeItem('mule_apimgr_search');
      setSearch(pendingSearchRef.current);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // On auth ready, load business groups
  useEffect(() => {
    if (authOrgId) loadBusinessGroups();
  }, [authOrgId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-select pending API instance once the list finishes loading.
  // Prefers the exact instance ID (set when ApplicationDetailPage's
  // Contracts tab had already resolved it); falls back to an unambiguous
  // name match (assetId/name/label) when only the app-name hint is
  // available. If the name hint matches more than one instance, we leave
  // it unresolved — the search box is already pre-filled above so the
  // user can pick the right one from the filtered list.
  useEffect(() => {
    if (apis.length === 0 || selectedApi) return;

    const targetId = pendingInstanceIdRef.current;
    if (targetId) {
      const match = apis.find(a => String(a.id) === String(targetId));
      if (match) {
        pendingInstanceIdRef.current = ''; // consume — only fire once
        selectApi(match);
        return;
      }
    }

    const targetName = pendingSearchRef.current;
    if (targetName) {
      const q = targetName.toLowerCase().trim();
      const nameMatches = apis.filter(a =>
        (a.assetId || '').toLowerCase() === q ||
        (a.name || '').toLowerCase() === q ||
        (a.label || '').toLowerCase() === q
      );
      if (nameMatches.length === 1) {
        pendingSearchRef.current = ''; // consume — only fire once
        selectApi(nameMatches[0]);
      }
    }
  }, [apis]); // eslint-disable-line react-hooks/exhaustive-deps

  // When BG selection changes, groups first load, OR global env filter changes →
  // reload envs + APIs.  envFilterVersion bump triggers this without a new API
  // call if the env list is already cached (cache hit → re-apply filter only).
  useEffect(() => {
    if (selectedBg && allBusinessGroups.length > 0) loadEnvs(selectedBg);
  }, [selectedBg, allBusinessGroups.length, envFilterVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-load APIs when user explicitly changes the env dropdown
  useEffect(() => {
    if (skipEnvEffectRef.current) return;
    if (selectedBg) loadApisInternal(selectedBg, selectedEnv, environments);
  }, [selectedEnv]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Business Groups ─────────────────────────────────────────────────────────
  const loadBusinessGroups = async () => {
    setBgLoading(true);
    try {
      const res = await getBusinessGroups();
      const groups = res.data.data || [];
      setAllBusinessGroups(groups);
      const savedBg = localStorage.getItem('mule_apimgr_bg');
      const isValidSaved = savedBg && (savedBg === '__all__' || groups.some(g => g.id === savedBg));
      setSelectedBg(isValidSaved ? savedBg : '__all__');
    } catch {
      setSelectedBg(authOrgId || '__all__');
    }
    setBgLoading(false);
  };

  // ── Environments ────────────────────────────────────────────────────────────
  // Fetches raw envs (with SWR caching), then applies the global env filter
  // from the Header's Env Filter button before updating state.
  const loadEnvs = async (bgId) => {
    skipEnvEffectRef.current = true;
    setApis([]); setSelectedApi(null);
    try {
      const visible = applyBgFilter(allBusinessGroups);
      const bgIds = bgId === '__all__'
        ? (visible.length > 0 ? visible.map(g => g.id) : [authOrgId])
        : [bgId];

      // ── Cache: raw (unfiltered) env list keyed by BG set ──────────────────
      // We cache the raw list so that global env filter changes can be applied
      // instantly without a new API call (envFilterVersion increments →
      // loadEnvs → cache hit → re-apply applyEnvFilter → done).
      const envCacheKey = `apimgr:envs:${[...bgIds].sort().join(',')}`;
      let rawEnvs;

      const swr = getCachedSWR(envCacheKey);
      if (swr && !swr.stale) {
        // Fresh cache hit — no network call needed
        rawEnvs = swr.data;
      } else {
        // Cache miss or stale — fetch from API
        const results = await Promise.allSettled(bgIds.map(id => getEnvironments(id)));
        const seenEnvs = new Set();
        const fetched = [];
        results.forEach(r => {
          if (r.status === 'fulfilled') {
            (r.value.data.data || []).forEach(e => {
              if (!seenEnvs.has(e.id)) { seenEnvs.add(e.id); fetched.push(e); }
            });
          }
        });
        setCached(envCacheKey, fetched, ENV_CACHE_MS);
        // SWR: if a stale entry existed, use it for this render cycle;
        // the fresh data is stored in cache for the next navigation.
        rawEnvs = swr?.stale ? swr.data : fetched;
      }

      // ── Apply global Env Filter (from Header's "Env Filter" button) ────────
      // applyEnvFilter returns ALL envs when no global filter is active,
      // or only the selected subset when the user has configured one.
      const mergedEnvs = applyEnvFilter(rawEnvs);
      setEnvironments(mergedEnvs);

      // Validate saved env is still in the filtered list; fall back to '' (All)
      const savedEnv = localStorage.getItem('mule_apimgr_env') || '';
      const validSavedEnv = savedEnv && mergedEnvs.some(e => e.id === savedEnv) ? savedEnv : '';
      setSelectedEnv(validSavedEnv);

      // Load APIs immediately with fresh data (don't wait for state to propagate)
      skipEnvEffectRef.current = false;
      await loadApisInternal(bgId, validSavedEnv, mergedEnvs);
    } catch {
      setEnvironments([]);
      skipEnvEffectRef.current = false;
    }
  };

  // ── API Instances ───────────────────────────────────────────────────────────
  // Core loader — accepts explicit args so it works both from loadEnvs
  // (before React state updates) and from the env-change effect.
  // Uses SWR caching: fresh → instant return; stale → instant render + bg refetch;
  // miss → fetch with spinner.
  const loadApisInternal = async (bgId, envId, envList) => {
    setError('');

    const visible = applyBgFilter(allBusinessGroups);
    const bgIds = bgId === '__all__'
      ? (visible.length > 0 ? visible.map(g => g.id) : [authOrgId])
      : [bgId];

    // Always apply the global env filter defensively so that stale-closure
    // callers (e.g. the selectedEnv useEffect) never accidentally fetch for
    // environments the user has excluded via the Header's Env Filter button.
    const filteredEnvList = applyEnvFilter(envList || []);

    const envIds = envId
      ? [envId]
      : filteredEnvList.map(e => e.id);

    if (envIds.length === 0) {
      setError('No environments available. Select a Business Group with environments.');
      setApis([]);
      setSelectedApi(null);
      setLoading(false);
      return;
    }

    // ── SWR cache check ───────────────────────────────────────────────────────
    const apisCacheKey = `apimgr:apis:${bgId}:${[...envIds].sort().join(',')}`;
    const swr = getCachedSWR(apisCacheKey);

    if (swr) {
      // Render instantly from cache (stale or fresh)
      setApis(swr.data);
      setSelectedApi(null);
      setLoading(false);
      if (swr.data.length === 0) setError('No API instances found.');
      if (!swr.stale) return; // Fresh — no network call needed
      // Stale — fall through for silent background refresh (no spinner)
    } else {
      // Cache miss — show loading spinner and clear list
      setLoading(true);
      setApis([]);
      setSelectedApi(null);
    }

    // ── Network fetch ─────────────────────────────────────────────────────────
    try {
      // Build correct (org, env) pairs — NO cross-product.
      // Each environment belongs to exactly one org (its organizationId).
      // Querying a different org for an env that does not belong to it returns 401.
      // • Specific BG selected → all envs in filteredEnvList belong to it by construction.
      // • "All BGs" selected   → use env.organizationId to route each env to its owning org.
      const combos = envIds.map(ev => {
        if (bgId !== '__all__') {
          return { bg: bgId, ev };
        }
        const envObj = filteredEnvList.find(e => e.id === ev);
        const bg = envObj?.organizationId || bgIds[0];
        return { bg, ev };
      });

      const results = await Promise.allSettled(
        combos.map(({ bg, ev }) => getApiInstances(bg, ev))
      );

      const seenApis = new Set();
      const list = [];
      results.forEach(r => {
        if (r.status === 'fulfilled') {
          const data = r.value.data;
          const rawItems = data.assets || data.data || (Array.isArray(data) ? data : []);
          const items = rawItems.flatMap(item =>
            Array.isArray(item.apis) && item.apis.length > 0
              ? item.apis.map(inst => ({
                  ...inst,
                  assetId: inst.assetId || item.assetId,
                  assetVersion: inst.assetVersion || item.assetVersion,
                  groupId: inst.groupId || item.groupId,
                }))
              : [item]
          );
          items.forEach(item => {
            const key = String(item.id);
            if (!seenApis.has(key)) { seenApis.add(key); list.push(item); }
          });
        }
      });

      setCached(apisCacheKey, list, APIS_CACHE_MS);
      setApis(list);
      if (list.length === 0) setError('No API instances found.');
    } catch (e) {
      // Only show error if we had no cached data to fall back on
      if (!swr) {
        setError(getErrorMessage(e, 'Failed to load API instances.'));
        setApis([]);
      }
    }
    setLoading(false);
  };

  // Public refresh — invalidates the API instances cache then reloads
  const loadApis = () => {
    const envIds = selectedEnv
      ? [selectedEnv]
      : environments.map(e => e.id);
    const apisCacheKey = `apimgr:apis:${selectedBg}:${[...envIds].sort().join(',')}`;
    // Force a fresh fetch by writing a 0-TTL entry (expired immediately)
    setCached(apisCacheKey, [], 0);
    loadApisInternal(selectedBg, selectedEnv, environments);
  };

  // ── API Detail ──────────────────────────────────────────────────────────────
  const selectApi = async (apiInstance) => {
    setSelectedApi(apiInstance);
    setPolicies([]);
    setContracts([]);
    setContractsLoading(true);

    // For "All BGs" mode, prefer the instance's own organizationId if available
    const bgId = selectedBg === '__all__'
      ? (apiInstance.organizationId || authOrgId)
      : selectedBg;
    const envId = apiInstance.environmentId || selectedEnv;

    const [pRes, cRes] = await Promise.allSettled([
      getApiPolicies(bgId, envId, apiInstance.id),
      getApiContracts(bgId, envId, apiInstance.id),
    ]);

    if (pRes.status === 'fulfilled') {
      const d = pRes.value.data;
      setPolicies(d.policies || (Array.isArray(d) ? d : []));
    }

    let contractList = [];
    if (cRes.status === 'fulfilled') {
      const d = cRes.value.data;
      contractList = d.contracts || (Array.isArray(d) ? d : []);
    }

    setContracts(contractList);
    setContractsLoading(false);
  };

  // useCallback — ContractCard is React.memo'd (see FRONTEND_ARCHITECTURE_REVIEW.md
  // §8 Performance Review, finding #4/#7); without stabilizing these handler
  // props every ContractCard would still re-render on every unrelated
  // ApiManagerPage re-render, defeating the memo.
  const updateContractStatus = useCallback(async (contractId, newStatus) => {
    const bgId = selectedBg === '__all__'
      ? (selectedApi?.organizationId || authOrgId)
      : selectedBg;
    const envId = selectedApi?.environmentId || selectedEnv;
    try {
      await updateContractStatusApi(bgId, envId, selectedApi.id, contractId, newStatus);
      const cRes = await getApiContracts(bgId, envId, selectedApi.id);
      const d = cRes.data;
      setContracts(d.contracts || (Array.isArray(d) ? d : []));
    } catch (e) {
      alert(`Failed to update contract: ${getErrorMessage(e)}`);
    }
  }, [selectedBg, selectedApi, authOrgId, selectedEnv]);

  const deleteContract = useCallback(async (contractId) => {
    const bgId = selectedBg === '__all__'
      ? (selectedApi?.organizationId || authOrgId)
      : selectedBg;
    const envId = selectedApi?.environmentId || selectedEnv;
    try {
      await deleteContractApi(bgId, envId, selectedApi.id, contractId);
      // Remove deleted contract from local state immediately — no re-fetch needed
      setContracts(prev => prev.filter(c => c.id !== contractId));
    } catch (e) {
      alert(`Failed to delete contract: ${getErrorMessage(e)}`);
    }
  }, [selectedBg, selectedApi, authOrgId, selectedEnv]);

  // ── Derived values ──────────────────────────────────────────────────────────
  const visibleGroups = applyBgFilter(allBusinessGroups);
  const filterActive = visibleGroups.length < allBusinessGroups.length;

  // Global env filter active when localStorage has a saved selection
  const envFilterActive = getVisibleEnvIds().size > 0;

  const selectedBgName = selectedBg === '__all__'
    ? 'All Business Groups'
    : visibleGroups.find(g => g.id === selectedBg)?.name || 'Organization';

  const selectedEnvName = environments.find(e => e.id === selectedEnv)?.name || '';

  const bgOptions = [
    {
      value: '__all__',
      label: 'All Business Groups',
      tag: `${visibleGroups.length}`,
      tagColor: 'bg-gray-200 text-gray-600',
    },
    ...visibleGroups.map(g => ({
      value: g.id,
      label: g.name,
      indent: !!g.parentId,
      tag: !g.parentId ? 'Root' : undefined,
      tagColor: 'bg-sf-100 text-sf-600',
    })),
  ];

  const envOptions = [
    {
      value: '',
      label: 'All Environments',
      tag: environments.length > 0 ? `${environments.length}` : undefined,
      tagColor: 'bg-gray-200 text-gray-600',
    },
    ...environments.map(e => ({
      value: e.id,
      label: e.name,
      badge: true,
      badgeColor: ENV_BADGE[e.type] || 'bg-gray-400',
      tag: e.type,
      tagColor: ENV_TAG_COLOR[e.type] || 'bg-gray-200 text-gray-500',
    })),
  ];

  // Search: match assetId, name, instanceLabel, OR numeric API instance ID
  const filtered = useMemo(() => apis.filter(a => {
    if (!debouncedSearch) return true;
    const q = debouncedSearch.toLowerCase().trim();
    return (
      (a.assetId  || '').toLowerCase().includes(q) ||
      (a.name     || '').toLowerCase().includes(q) ||
      (a.label    || '').toLowerCase().includes(q) ||
      (a.instanceLabel || '').toLowerCase().includes(q) ||
      String(a.id ?? '').includes(q)
    );
  }), [apis, debouncedSearch]);

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="h-full flex flex-col space-y-5">
      {showBgFilter && (
        <BgFilterModal
          businessGroups={allBusinessGroups}
          onClose={() => setShowBgFilter(false)}
          onSaved={() => {
            const visible = applyBgFilter(allBusinessGroups);
            if (selectedBg !== '__all__' && !visible.find(g => g.id === selectedBg)) {
              setSelectedBg('__all__');
            }
          }}
        />
      )}

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <PageHeader
        icon={ShieldCheck}
        title="API Manager"
        subtitle={
          <>
            Managed API instances in{' '}
            <span className="text-sf-600 dark:text-sf-400 font-semibold">{selectedBgName}</span>
            {selectedEnvName && (
              <> · <span className="text-sf-600 dark:text-sf-400 font-semibold">{selectedEnvName}</span></>
            )}
          </>
        }
        actions={
          <button
            onClick={loadApis}
            disabled={loading || !selectedBg}
            className="group/tool flex items-center gap-2 text-sm font-medium text-gray-600 dark:text-gray-300 bg-white dark:bg-gray-800 hover:text-sf-700 dark:hover:text-sf-300 border border-gray-200 dark:border-gray-700 hover:border-sf-200/70 dark:hover:border-sf-400/30 px-3.5 py-2.5 rounded-xl shadow-sm hover:shadow-md disabled:opacity-50 transition-all"
          >
            <span className="flex items-center justify-center w-5 h-5 rounded-lg bg-gray-100 dark:bg-gray-700 group-hover/tool:bg-sf-100 dark:group-hover/tool:bg-sf-500/20 text-gray-500 dark:text-gray-400 group-hover/tool:text-sf-600 dark:group-hover/tool:text-sf-400 flex-shrink-0 transition-colors">
              <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
            </span>
            Refresh
          </button>
        }
      />

      {/* ── Filters — BG · Env · Search inline row ─────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">

        {/* Business Group */}
        <div>
          <div className="flex items-center gap-2 h-[18px] mb-1.5">
            <p className="text-[10px] text-gray-400 dark:text-gray-500 uppercase tracking-wider font-bold flex-1">Business Group</p>
          </div>
          <Select
            value={selectedBg}
            onChange={v => { setSelectedBg(v); setSearch(''); }}
            options={bgOptions}
            placeholder="Select business group…"
            searchable={visibleGroups.length > 5}
            disabled={bgLoading}
          />
          {filterActive && (
            <p className="text-[9px] text-sf-600 dark:text-sf-400 font-medium mt-1 pl-1">
              {visibleGroups.length}/{allBusinessGroups.length} shown
            </p>
          )}
        </div>

        {/* Environment — respects global Env Filter from Header */}
        <div>
          <div className="flex items-center gap-2 h-[18px] mb-1.5">
            <p className="text-[10px] text-gray-400 dark:text-gray-500 uppercase tracking-wider font-bold flex-1">Environment</p>
            {envFilterActive && (
              <span className="flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded-md border bg-sfteal-50 dark:bg-sfteal-500/10 border-sfteal-200/60 dark:border-sfteal-400/30 text-sfteal-600 dark:text-sfteal-400 font-semibold">
                <Globe size={9} /> Global filter
              </span>
            )}
          </div>
          <Select
            value={selectedEnv}
            onChange={v => {
              skipEnvEffectRef.current = true;
              setSelectedEnv(v);
              loadApisInternal(selectedBg, v, environments);
            }}
            options={envOptions}
            placeholder="All Environments"
            searchable={environments.length > 5}
          />
          {envFilterActive && (
            <p className="text-[9px] text-sfteal-600 dark:text-sfteal-400 font-medium mt-1 pl-1">
              {environments.length} env{environments.length !== 1 ? 's' : ''} from global filter
            </p>
          )}
        </div>

        {/* Search — spans 2 columns on larger screens */}
        <div className="sm:col-span-2">
          <div className="flex items-center gap-2 h-[18px] mb-1.5">
            <p className="text-[10px] text-gray-400 dark:text-gray-500 uppercase tracking-wider font-bold">Search</p>
          </div>
          <div className="relative group">
            <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500 group-focus-within:text-sf-500 pointer-events-none transition-colors" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by API name, asset ID, or instance ID…"
              className="w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl pl-10 pr-9 py-2.5 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 shadow-sm focus:outline-none focus:border-sf-500 dark:focus:border-sf-400 focus:ring-2 focus:ring-sf-500/15 dark:focus:ring-sf-400/15 transition-all"
            />
            {search && (
              <button onClick={() => setSearch('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors">
                <X size={13} />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── Error banner ───────────────────────────────────────────────────── */}
      {error && (
        <div className="flex items-center gap-2.5 bg-amber-50 dark:bg-amber-500/10 border border-amber-200/80 dark:border-amber-400/30 rounded-2xl px-4 py-3 text-amber-700 dark:text-amber-300 text-sm shadow-sm">
          <AlertCircle size={15} className="flex-shrink-0" />
          {error}
        </div>
      )}

      {/* ── Main grid: list + detail — fills remaining viewport height so
          both panels scroll independently instead of being capped at an
          arbitrary max-height with empty space below ───────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 flex-1 min-h-0">

        {/* ── API Instance List ─────────────────────────────────────────────── */}
        <div className="card-surface overflow-hidden flex flex-col h-full">
          <div className="px-5 py-3.5 border-b border-gray-200 dark:border-white/[0.08] bg-gray-50/60 dark:bg-gray-900/40 flex items-center justify-between flex-shrink-0">
            <h3 className="flex items-center gap-2 text-gray-900 dark:text-gray-100 font-semibold text-sm">
              <span className="flex items-center justify-center w-6 h-6 rounded-lg bg-sf-100 dark:bg-sf-500/15 text-sf-600 dark:text-sf-400 flex-shrink-0">
                <ShieldCheck size={13} />
              </span>
              API Instances <span className="text-gray-400 dark:text-gray-500 font-normal">({filtered.length})</span>
            </h3>
            {apis.length > filtered.length && (
              <span className="text-[10px] text-gray-400 dark:text-gray-500 font-medium bg-gray-100 dark:bg-gray-700/60 px-2 py-1 rounded-lg">{apis.length} total</span>
            )}
          </div>

          {loading ? (
            <SkeletonListRows rows={6} showBadge />
          ) : (
            <div className="divide-y divide-gray-100 dark:divide-white/[0.06] flex-1 overflow-y-auto">
              {filtered.map(a => {
                const isSel = selectedApi?.id === a.id;
                return (
                  <button
                    key={`${a.id}-${a.assetId}`}
                    onClick={() => selectApi(a)}
                    className={`group w-full flex items-center justify-between gap-3 px-5 py-3.5 text-left transition-all border-l-2 ${
                      isSel
                        ? 'bg-sf-50/60 dark:bg-sf-500/[0.12] border-l-sf-500'
                        : 'border-l-transparent hover:bg-gray-50 dark:hover:bg-white/[0.03] hover:border-l-sf-300 dark:hover:border-l-sf-400/40'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className={`flex items-center justify-center w-8 h-8 rounded-xl flex-shrink-0 transition-colors ${
                        isSel
                          ? 'bg-sf-600 text-white shadow-sm shadow-sf-500/30'
                          : 'bg-gray-100 dark:bg-gray-700 text-sf-600 dark:text-sf-400 group-hover:bg-sf-100 dark:group-hover:bg-sf-500/20'
                      }`}>
                        <ShieldCheck size={14} />
                      </span>
                      <div className="min-w-0">
                        <p className="text-gray-900 dark:text-gray-100 text-sm font-semibold truncate">
                          {a.assetId || a.name || a.label}
                        </p>
                        <p className="text-gray-500 dark:text-gray-400 text-xs mt-0.5">
                          v{a.assetVersion || a.productVersion || '—'} <span className="text-gray-300 dark:text-gray-600">·</span> ID {a.id}
                          {/* Show env name when viewing across multiple envs */}
                          {!selectedEnv && a.environmentId && environments.length > 1 && (
                            <> <span className="text-gray-300 dark:text-gray-600">·</span> {environments.find(e => e.id === a.environmentId)?.name || a.environmentId}</>
                          )}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <StatusBadge status={a.status || 'active'} />
                      <ChevronRight size={14} className="text-gray-300 dark:text-gray-600 group-hover:text-sf-500 dark:group-hover:text-sf-400 group-hover:translate-x-0.5 transition-all" />
                    </div>
                  </button>
                );
              })}

              {filtered.length === 0 && !loading && (
                <div className="flex flex-col items-center justify-center py-14 px-6 text-center">
                  <div className="w-12 h-12 rounded-2xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center mb-3">
                    <ShieldCheck size={20} className="text-gray-400 dark:text-gray-500" />
                  </div>
                  <p className="text-gray-500 dark:text-gray-400 text-sm">
                    {search
                      ? 'No APIs match your search.'
                      : !selectedBg
                      ? 'Select a business group.'
                      : 'No API instances found.'}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── API Detail Panel ──────────────────────────────────────────────── */}
        <div className="card-surface overflow-hidden overflow-y-auto h-full">
          {selectedApi ? (
            <>
              {/* Detail header */}
              <div className="px-5 py-3.5 border-b border-gray-200 dark:border-white/[0.08] sticky top-0 bg-white/95 dark:bg-gray-800/95 backdrop-blur-sm z-10">
                <div className="flex items-center gap-2.5">
                  <span className="flex items-center justify-center w-7 h-7 rounded-xl bg-sf-100 dark:bg-sf-500/15 text-sf-600 dark:text-sf-400 flex-shrink-0">
                    <ShieldCheck size={13} />
                  </span>
                  <div className="min-w-0">
                    <h3 className="text-gray-900 dark:text-gray-100 font-semibold text-sm truncate">
                      {selectedApi.assetId || selectedApi.name}
                    </h3>
                    <p className="text-gray-500 dark:text-gray-400 text-xs mt-0.5">
                      Version {selectedApi.assetVersion || selectedApi.productVersion || '—'}
                      {selectedApi.instanceLabel && (
                        <span className="ml-1.5 text-sf-600 dark:text-sf-400 font-medium">· {selectedApi.instanceLabel}</span>
                      )}
                    </p>
                  </div>
                </div>
              </div>

              {/* Key-value metadata */}
              <div className="p-5 space-y-2 text-sm border-b border-gray-200 dark:border-white/[0.08]">
                {[
                  ['API ID', selectedApi.id],
                  ['Group ID', selectedApi.groupId || '—'],
                  ['Environment', (() => {
                    const envName = environments.find(e => e.id === (selectedApi.environmentId || selectedEnv))?.name;
                    return envName || selectedApi.environmentId || selectedEnv || '—';
                  })()],
                  ['Endpoint URI', selectedApi.endpoint?.uri || selectedApi.endpointUri || '—'],
                  ['Proxy URI', selectedApi.endpoint?.proxyUri || '—'],
                  ['Technology', selectedApi.technology || selectedApi.type || '—'],
                  ['Status', selectedApi.status || 'active'],
                ].map(([label, val]) => (
                  <div key={label} className="flex items-start justify-between gap-4">
                    <span className="text-gray-400 dark:text-gray-500 text-xs font-semibold uppercase tracking-wide flex-shrink-0 w-28 pt-1">{label}</span>
                    <span className="text-gray-700 dark:text-gray-300 text-right font-mono text-xs break-all bg-gray-50 dark:bg-gray-900/50 px-2 py-1 rounded-lg">{String(val)}</span>
                  </div>
                ))}
              </div>

              {/* Policies */}
              <div className="border-b border-gray-200 dark:border-white/[0.08]">
                <div className="px-5 py-2.5 flex items-center justify-between bg-gray-50/60 dark:bg-gray-900/30">
                  <h4 className="flex items-center gap-2 text-gray-900 dark:text-gray-100 text-sm font-semibold">
                    <span className="flex items-center justify-center w-5 h-5 rounded-lg bg-sfpurple-100 dark:bg-sfpurple-500/15 text-sfpurple-600 dark:text-sfpurple-400 flex-shrink-0">
                      <SlidersHorizontal size={11} />
                    </span>
                    Policies <span className="text-gray-400 dark:text-gray-500 font-normal">({policies.length})</span>
                  </h4>
                </div>
                {policies.length === 0 ? (
                  <p className="px-5 py-6 text-center text-gray-400 dark:text-gray-500 text-xs">No policies applied.</p>
                ) : (
                  <div className="divide-y divide-gray-100 dark:divide-white/[0.06]">
                    {policies.map((p, i) => (
                      <PolicyCard key={p.id || i} p={p} i={i} />
                    ))}
                  </div>
                )}
              </div>

              {/* Contracts */}
              <div>
                <div className="px-5 py-2.5 flex items-center justify-between bg-gray-50/60 dark:bg-gray-900/30">
                  <h4 className="flex items-center gap-2 text-gray-900 dark:text-gray-100 text-sm font-semibold">
                    <span className="flex items-center justify-center w-5 h-5 rounded-lg bg-sfteal-100 dark:bg-sfteal-500/15 text-sfteal-600 dark:text-sfteal-400 flex-shrink-0">
                      <FileText size={11} />
                    </span>
                    Contracts <span className="text-gray-400 dark:text-gray-500 font-normal">({contracts.length})</span>
                  </h4>
                  {contractsLoading && (
                    <RefreshCw size={12} className="animate-spin text-gray-400 dark:text-gray-500" />
                  )}
                </div>
                {contractsLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-sf-500" />
                  </div>
                ) : contracts.length === 0 ? (
                  <p className="px-5 py-6 text-center text-gray-400 dark:text-gray-500 text-xs">No contracts found.</p>
                ) : (
                  <div className="divide-y divide-gray-100 dark:divide-white/[0.06]">
                    {contracts.map((c, i) => (
                      <ContractCard
                        key={c.id || i}
                        c={c}
                        i={i}
                        onUpdateContract={updateContractStatus}
                        onDeleteContract={deleteContract}
                      />
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : (
            /* Empty state — no API selected */
            <div className="flex flex-col items-center justify-center h-full py-24 text-center px-6">
              <div className="w-14 h-14 rounded-3xl bg-gradient-to-br from-sf-50 to-sf-100 dark:from-sf-500/10 dark:to-sf-500/5 flex items-center justify-center mb-4 shadow-sm">
                <ShieldCheck size={24} className="text-sf-400 dark:text-sf-500" />
              </div>
              <p className="text-gray-500 dark:text-gray-400 text-sm font-medium">Select an API instance</p>
              <p className="text-gray-400 dark:text-gray-500 text-xs mt-1">View policies, contracts, and endpoint details.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
