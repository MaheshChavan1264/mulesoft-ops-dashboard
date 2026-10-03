
import React, { useEffect, useState, useCallback } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useLocation } from 'react-router-dom';
import {
  Search, Package, RefreshCw, ExternalLink, ChevronLeft, ChevronRight,
  Globe, FileText, Tag, User, Link2, SlidersHorizontal,
  Code2, AlertTriangle, X,
} from 'lucide-react';
import Select from '../../components/ui/Select';
import CopyBtn from '../../components/shared/CopyBtn';
import BgFilterModal, { applyBgFilter } from '../../components/shared/BgFilterModal';
import api from '../../services/api';
import { getBusinessGroups } from '../../services/applicationsService';
import { useBgEnvFilter } from '../../hooks/useBgEnvFilter';
import PageHeader from '../../components/ui/PageHeader';
import { SkeletonListRows } from '../../components/ui/SkeletonTable';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const ASSET_TYPES = [
  { value: '', label: 'All Types' },
  { value: 'rest-api', label: 'REST API' },
  { value: 'soap-api', label: 'SOAP API' },
  { value: 'http-api', label: 'HTTP API' },
  { value: 'mule-application', label: 'Mule Application' },
  { value: 'mule-plugin', label: 'Connector / Plugin' },
  { value: 'template', label: 'Template' },
  { value: 'example', label: 'Example' },
];

const typeColor = (type) => ({
  'rest-api':          'bg-sf-100 dark:bg-sf-500/15 text-sf-600 dark:text-sf-400',
  'soap-api':          'bg-sfpurple-100 dark:bg-sfpurple-500/15 text-sfpurple-600 dark:text-sfpurple-400',
  'http-api':          'bg-sfteal-100 dark:bg-sfteal-500/15 text-sfteal-600 dark:text-sfteal-400',
  'mule-application':  'bg-sfgreen-100 dark:bg-sfgreen-500/15 text-sfgreen-600 dark:text-sfgreen-400',
  'mule-plugin':       'bg-sforange-100 dark:bg-sforange-500/15 text-sforange-600 dark:text-sforange-400',
  template:            'bg-amber-100 dark:bg-amber-500/15 text-amber-600 dark:text-amber-400',
  example:             'bg-pink-100 dark:bg-pink-500/15 text-pink-600 dark:text-pink-400',
}[type] || 'bg-gray-100 dark:bg-gray-700/50 text-gray-500 dark:text-gray-400');

const METHOD_COLOR = {
  GET:    'bg-sf-50 dark:bg-sf-500/10 text-sf-700 dark:text-sf-300 border-sf-200/70 dark:border-sf-400/30',
  POST:   'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-200/70 dark:border-emerald-400/30',
  PUT:    'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-200/70 dark:border-amber-400/30',
  DELETE: 'bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-300 border-red-200/70 dark:border-red-400/30',
  PATCH:  'bg-orange-50 dark:bg-orange-500/10 text-orange-700 dark:text-orange-300 border-orange-200/70 dark:border-orange-400/30',
};

const LIMIT = 100;

// ─── ExchangePage ─────────────────────────────────────────────────────────────

export default function ExchangePage() {
  const { orgId: rootOrgId } = useAuth();
  const location = useLocation();

  // ── BG state ─────────────────────────────────────────────────────────────
  const [allBgs, setAllBgs] = useState([]);
  const [selectedOrgId, setSelectedOrgId] = useState('');
  const [bgLoading, setBgLoading] = useState(true);
  const [showBgFilter, setShowBgFilter] = useState(false);

  // ── Asset list state ──────────────────────────────────────────────────────
  const [assets, setAssets] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [assetType, setAssetType] = useState('');
  const { bgFilterVersion } = useBgEnvFilter(); // eslint-disable-line no-unused-vars
  const [offset, setOffset] = useState(0);

  // ── Asset detail state ────────────────────────────────────────────────────
  const [selected, setSelected] = useState(null);
  const [detailTab, setDetailTab] = useState('overview');
  const [assetDetail, setAssetDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [pingSpec, setPingSpec] = useState(null);
  const [pingSpecLoading, setPingSpecLoading] = useState(false);

  // For navigation from AppDetailPage
  const [pendingAssetId, setPendingAssetId] = useState(null);
  const [pendingGroupId, setPendingGroupId] = useState(null);

  // ── Load BGs ──────────────────────────────────────────────────────────────
  useEffect(() => {
    getBusinessGroups().then(r => {
      const groups = r.data?.data || [];
      setAllBgs(groups);
      const root = groups.find(g => !g.parentId) || groups[0];
      if (root && !location.state?.groupId) setSelectedOrgId(root.id);
    }).catch(() => { setSelectedOrgId(rootOrgId); }).finally(() => setBgLoading(false));
  }, [rootOrgId]);

  // ── Handle navigation state from AppDetailPage ────────────────────────────
  useEffect(() => {
    const state = location.state;
    if (state?.assetId) {
      setPendingAssetId(state.assetId);
      setPendingGroupId(state.groupId || null);
      setSearch(state.assetId);
      if (state.groupId) setSelectedOrgId(state.groupId);
    }
  }, []);

  useEffect(() => {
    if (!bgLoading) { setOffset(0); loadAssets(0); }
  }, [search, assetType, selectedOrgId, bgLoading]);

  // ── Load assets ───────────────────────────────────────────────────────────
  const loadAssets = useCallback(async (off) => {
    setLoading(true);
    try {
      const res = await api.get('/exchange/search', {
        params: { search: search || undefined, type: assetType || undefined,
          organizationId: selectedOrgId || undefined, offset: off, limit: LIMIT }
      });
      const data = res.data;
      const list = Array.isArray(data) ? data : (data.assets || data.data || []);
      setAssets(list);
      setTotal(data.total || list.length);

      if (pendingAssetId && off === 0) {
        const match = list.find(a => a.assetId === pendingAssetId && (!pendingGroupId || a.groupId === pendingGroupId))
          || list.find(a => a.assetId === pendingAssetId)
          || (list.length === 1 ? list[0] : null);
        if (match) { selectAsset(match); setPendingAssetId(null); }
      }
    } catch { setAssets([]); setTotal(0); }
    setLoading(false);
  }, [search, assetType, selectedOrgId, pendingAssetId, pendingGroupId]);

  // ── Select asset + fetch detail & spec ────────────────────────────────────
  const selectAsset = useCallback(async (asset) => {
    setSelected(asset);
    setDetailTab('overview');
    setAssetDetail(null);
    setPingSpec(null);

    // Fetch full asset details
    setDetailLoading(true);
    try {
      const r = await api.get(`/exchange/${asset.groupId}/${asset.assetId}/${asset.version}`);
      setAssetDetail(r.data);
    } catch {}
    setDetailLoading(false);

    // Fetch API spec for REST/HTTP APIs
    if (['rest-api', 'http-api', 'soap-api'].includes(asset.type)) {
      setPingSpecLoading(true);
      try {
        const r = await api.get('/exchange/ping-spec', {
          params: { groupId: asset.groupId, assetId: asset.assetId,
            version: asset.version, orgId: asset.groupId, appName: asset.name || asset.assetId }
        });
        setPingSpec(r.data);
      } catch {}
      setPingSpecLoading(false);
    }
  }, []);

  // ─────────────────────────────────────────────────────────────────────────
  // Filtered BGs (respects BgFilterModal)
  const filteredBgs = applyBgFilter(allBgs);
  const filterActive = filteredBgs.length < allBgs.length;

  const bgOptions = [
    { value: '', label: 'All Organizations', tag: `${filteredBgs.length}`, tagColor: 'bg-gray-200 text-gray-600' },
    ...filteredBgs.map(g => ({
      value: g.id, label: g.name, indent: !!g.parentId,
      tag: !g.parentId ? 'Root' : undefined, tagColor: 'bg-sf-100 text-sf-600'
    }))
  ];

  const selectedBgName = allBgs.find(g => g.id === selectedOrgId)?.name
    || (selectedOrgId ? selectedOrgId : 'All Organizations');

  const currentPage = Math.floor(offset / LIMIT) + 1;
  const totalPages = Math.ceil(total / LIMIT);

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5">
      {showBgFilter && (
        <BgFilterModal businessGroups={allBgs} onClose={() => setShowBgFilter(false)} onSaved={() => {}} />
      )}

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <PageHeader
        icon={Package}
        gradient="from-sfpurple-500 to-sf-500"
        shadow="shadow-md shadow-sfpurple-500/30 dark:shadow-sfpurple-500/20"
        title="Exchange Assets"
        subtitle={
          <>
            Browse in <span className="text-sf-600 dark:text-sf-400 font-semibold">{selectedBgName}</span>
            {total > 0 && <span className="text-gray-400 dark:text-gray-500 ml-1">— {total} total</span>}
          </>
        }
      />

      {/* ── Filters row ────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-3 items-center">
        {/* BG selector */}
        <div className="w-56">
          <Select value={selectedOrgId}
            onChange={v => { setSelectedOrgId(v); setOffset(0); setSelected(null); }}
            options={bgOptions} placeholder="Select organization…"
            searchable={filteredBgs.length > 5} disabled={bgLoading} />
        </div>
        {/* BG Filter button */}
        <button onClick={() => setShowBgFilter(true)}
          className={`flex items-center gap-1.5 text-xs font-medium px-3 py-2.5 rounded-xl border shadow-sm hover:shadow-md transition-all ${
            filterActive
              ? 'bg-sf-50 dark:bg-sf-500/10 border-sf-200/70 dark:border-sf-400/30 text-sf-700 dark:text-sf-300'
              : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100'
          }`}>
          <SlidersHorizontal size={12} />
          {filterActive ? `${filteredBgs.length}/${allBgs.length} BGs` : 'Filter BGs'}
        </button>
        {/* Search */}
        <div className="relative flex-1 min-w-48 group">
          <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500 group-focus-within:text-sf-500 pointer-events-none transition-colors" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search assets…"
            className="w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl pl-10 pr-9 py-2.5 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 shadow-sm focus:outline-none focus:border-sf-500 dark:focus:border-sf-400 focus:ring-2 focus:ring-sf-500/15 dark:focus:ring-sf-400/15 transition-all" />
          {search && (
            <button onClick={() => setSearch('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors">
              <X size={13} />
            </button>
          )}
        </div>
        {/* Type filter */}
        <Select value={assetType} onChange={setAssetType} options={ASSET_TYPES} placeholder="All Types" className="w-48" />
        <button onClick={() => { setOffset(0); loadAssets(0); }}
          className="group/tool flex items-center gap-2 text-sm font-medium text-gray-600 dark:text-gray-300 bg-white dark:bg-gray-800 hover:text-sf-700 dark:hover:text-sf-300 border border-gray-200 dark:border-gray-700 hover:border-sf-200/70 dark:hover:border-sf-400/30 px-3.5 py-2.5 rounded-xl shadow-sm hover:shadow-md transition-all">
          <span className="flex items-center justify-center w-5 h-5 rounded-lg bg-gray-100 dark:bg-gray-700 group-hover/tool:bg-sf-100 dark:group-hover/tool:bg-sf-500/20 text-gray-500 dark:text-gray-400 group-hover/tool:text-sf-600 dark:group-hover/tool:text-sf-400 flex-shrink-0 transition-colors">
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          </span>
          Refresh
        </button>
      </div>

      {/* ── Main layout ────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">

        {/* ── Asset list (2/5) ─────────────────────────────── */}
        <div className="lg:col-span-2 card-surface overflow-hidden flex flex-col">
          <div className="px-5 py-3.5 border-b border-gray-200 dark:border-white/[0.08] bg-gray-50/60 dark:bg-gray-900/40 flex items-center justify-between flex-shrink-0">
            <h3 className="flex items-center gap-2 text-gray-900 dark:text-gray-100 font-semibold text-sm">
              <span className="flex items-center justify-center w-6 h-6 rounded-lg bg-sfpurple-100 dark:bg-sfpurple-500/15 text-sfpurple-600 dark:text-sfpurple-400 flex-shrink-0">
                <Package size={13} />
              </span>
              Assets {total > 0 && (
                <span className="text-gray-400 dark:text-gray-500 font-normal">
                  ({assets.length}{total > assets.length ? ` of ${total}` : ''})
                </span>
              )}
            </h3>
            {totalPages > 1 && (
              <div className="flex items-center gap-1 text-sm text-gray-500 dark:text-gray-400">
                <button onClick={() => { const n = Math.max(0, offset - LIMIT); setOffset(n); loadAssets(n); }}
                  disabled={offset === 0}
                  className="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gray-900 dark:hover:text-gray-100 disabled:opacity-30 transition-colors">
                  <ChevronLeft size={15} />
                </button>
                <span className="text-xs font-medium bg-gray-100 dark:bg-gray-700/60 px-2 py-0.5 rounded-lg">{currentPage}/{totalPages}</span>
                <button onClick={() => { const n = offset + LIMIT; setOffset(n); loadAssets(n); }}
                  disabled={currentPage >= totalPages}
                  className="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gray-900 dark:hover:text-gray-100 disabled:opacity-30 transition-colors">
                  <ChevronRight size={15} />
                </button>
              </div>
            )}
          </div>

          {loading ? (
            <SkeletonListRows rows={6} />
          ) : (
            <div className="divide-y divide-gray-100 dark:divide-white/[0.06] overflow-y-auto flex-1 max-h-[640px]">
              {assets.map((asset, i) => {
                const isSel = selected?.assetId === asset.assetId && selected?.groupId === asset.groupId;
                return (
                  <button key={`${asset.groupId}-${asset.assetId}-${i}`}
                    onClick={() => selectAsset(asset)}
                    className={`group w-full flex items-start gap-3 px-5 py-3.5 text-left transition-all border-l-2 ${
                      isSel
                        ? 'bg-sf-50/60 dark:bg-sf-500/[0.12] border-l-sf-500'
                        : 'border-l-transparent hover:bg-gray-50 dark:hover:bg-white/[0.03] hover:border-l-sf-300 dark:hover:border-l-sf-400/40'
                    }`}>
                    <span className={`flex items-center justify-center w-8 h-8 rounded-xl flex-shrink-0 mt-0.5 transition-colors ${
                      isSel
                        ? 'bg-sf-600 text-white shadow-sm shadow-sf-500/30'
                        : 'bg-gray-100 dark:bg-gray-700 text-sf-600 dark:text-sf-400 group-hover:bg-sf-100 dark:group-hover:bg-sf-500/20'
                    }`}>
                      <Package size={14} />
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-gray-900 dark:text-gray-100 text-sm font-semibold truncate">{asset.name || asset.assetId}</p>
                        <span className={`text-[9px] px-1.5 py-0.5 rounded-md font-semibold ${typeColor(asset.type)}`}>
                          {asset.type}
                        </span>
                      </div>
                      <p className="text-gray-400 dark:text-gray-500 text-[10px] mt-0.5 truncate font-mono">{asset.assetId}</p>
                      {asset.description && (
                        <p className="text-gray-500 dark:text-gray-400 text-xs mt-0.5 line-clamp-1">{asset.description}</p>
                      )}
                    </div>
                    <span className="text-[10px] text-gray-400 dark:text-gray-500 font-medium flex-shrink-0 mt-1 bg-gray-100 dark:bg-gray-700/60 px-1.5 py-0.5 rounded-md">v{asset.version}</span>
                  </button>
                );
              })}
              {assets.length === 0 && (
                <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
                  <div className="w-12 h-12 rounded-2xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center mb-3">
                    <Package size={20} className="text-gray-400 dark:text-gray-500" />
                  </div>
                  <p className="text-gray-500 dark:text-gray-400 text-sm">No assets found.</p>
                  <p className="text-gray-400 dark:text-gray-500 text-xs mt-1">Try a different search, type, or organization.</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Asset Detail panel (3/5) ─────────────────────── */}
        <div className="lg:col-span-3 card-surface overflow-hidden flex flex-col min-h-[500px]">
          {!selected ? (
            <div className="flex flex-col items-center justify-center flex-1 py-24 text-center px-6">
              <div className="w-14 h-14 rounded-3xl bg-gradient-to-br from-sfpurple-50 to-sf-50 dark:from-sfpurple-500/10 dark:to-sf-500/5 flex items-center justify-center mb-4 shadow-sm">
                <Package size={24} className="text-sfpurple-400 dark:text-sfpurple-500" />
              </div>
              <p className="text-gray-500 dark:text-gray-400 text-sm font-medium">Select an asset</p>
              <p className="text-gray-400 dark:text-gray-500 text-xs mt-1">View overview, API spec, and files.</p>
            </div>
          ) : (
            <>
              {/* Detail header */}
              <div className="px-5 py-4 border-b border-gray-200 dark:border-white/[0.08] flex-shrink-0 sticky top-0 bg-white/95 dark:bg-gray-800/95 backdrop-blur-sm z-10">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-2.5 flex-1 min-w-0">
                    <span className="flex items-center justify-center w-9 h-9 rounded-xl bg-sfpurple-100 dark:bg-sfpurple-500/15 text-sfpurple-600 dark:text-sfpurple-400 flex-shrink-0 mt-0.5">
                      <Package size={16} />
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="text-gray-900 dark:text-gray-100 font-bold text-base truncate">{selected.name || selected.assetId}</h3>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${typeColor(selected.type)}`}>
                          {selected.type}
                        </span>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full border font-semibold ${
                          selected.status === 'published'
                            ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-200/80 dark:border-emerald-400/30'
                            : 'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-200/80 dark:border-amber-400/30'
                        }`}>{selected.status || 'published'}</span>
                      </div>
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        <span className="font-mono text-xs text-gray-500 dark:text-gray-400">{selected.assetId}</span>
                        <span className="text-gray-300 dark:text-gray-600 text-xs">·</span>
                        <span className="text-xs text-gray-500 dark:text-gray-400">v{selected.version}</span>
                        {selected.minMuleVersion && (
                          <>
                            <span className="text-gray-300 dark:text-gray-600 text-xs">·</span>
                            <span className="text-xs text-gray-500 dark:text-gray-400">Min Mule: {selected.minMuleVersion}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                  <a href={`https://anypoint.mulesoft.com/exchange/${selected.groupId}/${selected.assetId}/`}
                    target="_blank" rel="noreferrer"
                    className="flex items-center gap-1.5 text-xs font-medium text-sf-700 dark:text-sf-300 hover:text-sf-800 dark:hover:text-sf-200 flex-shrink-0 border border-sf-200/70 dark:border-sf-400/30 px-2.5 py-1.5 rounded-xl bg-sf-50 dark:bg-sf-500/10 hover:shadow-sm transition-all">
                    <ExternalLink size={12} /> Open in Exchange
                  </a>
                </div>

                {/* Tab bar */}
                <div className="flex gap-1 mt-3.5 bg-gray-100 dark:bg-gray-900/50 rounded-xl p-1 w-fit">
                  {[
                    { id: 'overview', label: 'Overview', icon: Globe },
                    ...(['rest-api', 'http-api'].includes(selected.type) ? [{ id: 'api', label: 'API Spec', icon: Code2 }] : []),
                    { id: 'files', label: 'Files', icon: FileText },
                  ].map(t => (
                    <button key={t.id} onClick={() => setDetailTab(t.id)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                        detailTab === t.id
                          ? 'bg-white dark:bg-gray-700 text-sf-700 dark:text-sf-300 shadow-sm'
                          : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100'
                      }`}>
                      <t.icon size={12} /> {t.label}
                      {t.id === 'api' && pingSpec?.allEndpoints?.length > 0 && (
                        <span className="bg-sf-100 dark:bg-sf-500/20 text-sf-700 dark:text-sf-300 text-[9px] px-1.5 py-0.5 rounded-full font-bold">{pingSpec.allEndpoints.length}</span>
                      )}
                    </button>
                  ))}
                </div>
              </div>

              {/* ── OVERVIEW tab ────────────────────────────── */}
              {detailTab === 'overview' && (
                <div className="overflow-y-auto flex-1 p-5 space-y-5">
                  {detailLoading && (
                    <div className="flex items-center justify-center py-10 text-gray-400 dark:text-gray-500">
                      <RefreshCw size={16} className="animate-spin mr-2" /> Loading details…
                    </div>
                  )}

                  {/* Description */}
                  {(selected.description || assetDetail?.description) && (
                    <div>
                      <p className="text-[10px] text-gray-400 dark:text-gray-500 uppercase tracking-wider font-bold mb-1.5">Description</p>
                      <p className="text-gray-600 dark:text-gray-300 text-sm leading-relaxed">
                        {assetDetail?.description || selected.description}
                      </p>
                    </div>
                  )}

                  {/* Key metadata grid */}
                  <div className="grid grid-cols-2 gap-3">
                    {[
                      { label: 'Asset ID', value: selected.assetId, mono: true, copy: true },
                      { label: 'Group ID', value: selected.groupId, mono: true, copy: true },
                      { label: 'Version', value: selected.version },
                      { label: 'Type', value: selected.type },
                      { label: 'Status', value: selected.status || 'published' },
                      { label: 'Min Mule Version', value: selected.minMuleVersion },
                      { label: 'Created By', value: selected.createdBy?.username || assetDetail?.createdBy?.username },
                      { label: 'Created', value: selected.createdAt ? new Date(selected.createdAt).toLocaleDateString() : null },
                      { label: 'Updated', value: selected.updatedAt ? new Date(selected.updatedAt).toLocaleDateString() : null },
                    ].filter(r => r.value).map(({ label, value, mono, copy }) => (
                      <div key={label} className="group bg-gray-50 dark:bg-gray-900/40 border border-gray-200/70 dark:border-white/[0.06] rounded-xl px-3.5 py-2.5">
                        <p className="text-[9px] text-gray-400 dark:text-gray-500 uppercase tracking-wider font-bold mb-0.5">{label}</p>
                        <div className="flex items-center gap-1">
                          <p className={`text-xs break-all ${mono ? 'font-mono text-gray-600 dark:text-gray-300' : 'text-gray-900 dark:text-gray-100 font-medium'}`}>{value}</p>
                          {copy && <CopyBtn text={String(value)} fade={false} />}
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Tags / Labels */}
                  {(selected.labels?.length > 0 || assetDetail?.labels?.length > 0) && (
                    <div>
                      <p className="text-[10px] text-gray-400 dark:text-gray-500 uppercase tracking-wider font-bold mb-1.5 flex items-center gap-1">
                        <Tag size={10} /> Tags
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {(assetDetail?.labels || selected.labels || []).map((l, i) => (
                          <span key={i} className="bg-gray-100 dark:bg-gray-700/60 text-gray-600 dark:text-gray-300 text-xs font-medium px-2 py-0.5 rounded-lg border border-gray-200/70 dark:border-gray-600/40">{l}</span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Categories */}
                  {assetDetail?.categories?.length > 0 && (
                    <div>
                      <p className="text-[10px] text-gray-400 dark:text-gray-500 uppercase tracking-wider font-bold mb-1.5">Categories</p>
                      <div className="flex flex-wrap gap-1.5">
                        {assetDetail.categories.map((c, i) => (
                          <span key={i} className="bg-sf-50 dark:bg-sf-500/10 text-sf-700 dark:text-sf-300 text-xs font-medium px-2 py-0.5 rounded-lg border border-sf-200/60 dark:border-sf-400/30">
                            {c.key}: {c.value}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Contact info */}
                  {(assetDetail?.contactName || assetDetail?.contactEmail) && (
                    <div>
                      <p className="text-[10px] text-gray-400 dark:text-gray-500 uppercase tracking-wider font-bold mb-1.5 flex items-center gap-1">
                        <User size={10} /> Contact
                      </p>
                      <div className="bg-gray-50 dark:bg-gray-900/40 border border-gray-200/70 dark:border-white/[0.06] rounded-xl px-3.5 py-2.5">
                        {assetDetail.contactName && <p className="text-gray-900 dark:text-gray-100 text-sm font-medium">{assetDetail.contactName}</p>}
                        {assetDetail.contactEmail && <p className="text-sf-600 dark:text-sf-400 text-xs mt-0.5">{assetDetail.contactEmail}</p>}
                      </div>
                    </div>
                  )}

                  {/* Portal link */}
                  <div className="pt-2 border-t border-gray-100 dark:border-white/[0.06]">
                    <a href={`https://anypoint.mulesoft.com/exchange/${selected.groupId}/${selected.assetId}/${selected.version}/`}
                      target="_blank" rel="noreferrer"
                      className="flex items-center gap-2 text-xs font-medium text-sf-600 dark:text-sf-400 hover:text-sf-700 dark:hover:text-sf-300 transition-colors">
                      <Link2 size={11} /> View full documentation on Exchange
                    </a>
                  </div>
                </div>
              )}

              {/* ── API SPEC tab ─────────────────────────────── */}
              {detailTab === 'api' && (
                <div className="overflow-y-auto flex-1 p-5 space-y-4">
                  {pingSpecLoading && (
                    <div className="flex items-center justify-center py-10 text-gray-400 dark:text-gray-500">
                      <RefreshCw size={16} className="animate-spin mr-2" /> Fetching API spec…
                    </div>
                  )}

                  {!pingSpecLoading && pingSpec && (
                    <>
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-gray-900 dark:text-gray-100 text-sm font-semibold">{pingSpec.assetName}</p>
                          <p className="text-gray-500 dark:text-gray-400 text-xs mt-0.5">
                            {pingSpec.specType?.toUpperCase()} · {pingSpec.allEndpoints?.length ?? 0} endpoints
                            {pingSpec.pingEndpoints?.length > 0 && (
                              <span className="ml-2 text-emerald-600 dark:text-emerald-400 font-semibold">· {pingSpec.pingEndpoints.length} ping/health endpoints</span>
                            )}
                          </p>
                        </div>
                      </div>

                      {pingSpec.allEndpoints?.length > 0 ? (
                        <div className="space-y-1.5">
                          {pingSpec.allEndpoints.map((ep, i) => {
                            const isPing = pingSpec.pingEndpoints?.some(p => p.path === ep.path && p.method === ep.method);
                            return (
                              <div key={i} className={`rounded-xl border px-3.5 py-2.5 ${isPing ? 'bg-emerald-50/60 dark:bg-emerald-500/5 border-emerald-200/60 dark:border-emerald-400/20' : 'bg-gray-50 dark:bg-gray-900/40 border-gray-200/70 dark:border-white/[0.06]'}`}>
                                <div className="flex items-center gap-2.5 flex-wrap">
                                  <span className={`text-[10px] px-2 py-0.5 rounded-md font-bold border ${METHOD_COLOR[ep.method] || 'bg-gray-100 dark:bg-gray-700/60 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-600/40'}`}>
                                    {ep.method}
                                  </span>
                                  <span className={`font-mono text-xs ${isPing ? 'text-emerald-700 dark:text-emerald-300' : 'text-gray-700 dark:text-gray-300'}`}>{ep.path}</span>
                                  {isPing && <span className="text-[9px] text-emerald-500 dark:text-emerald-400 font-semibold">● health</span>}
                                  {ep.description && <span className="text-gray-400 dark:text-gray-500 text-[10px] ml-auto truncate max-w-xs">{ep.description}</span>}
                                </div>
                                {ep.queryParams?.length > 0 && (
                                  <div className="flex items-center gap-1 mt-1.5 flex-wrap">
                                    <span className="text-[9px] text-gray-400 dark:text-gray-500 uppercase font-bold">Query:</span>
                                    {ep.queryParams.map(p => (
                                      <span key={p.name} title={p.description}
                                        className={`text-[9px] px-1.5 py-0.5 rounded-md border font-mono ${
                                          p.required ? 'bg-orange-50 dark:bg-orange-500/10 text-orange-700 dark:text-orange-300 border-orange-200/70 dark:border-orange-400/30'
                                                     : 'bg-gray-100 dark:bg-gray-700/60 text-gray-500 dark:text-gray-400 border-gray-200 dark:border-gray-600/40'
                                        }`}>
                                        {p.name}{p.required ? '*' : ''}
                                      </span>
                                    ))}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      ) : !pingSpecLoading && (
                        <div className="flex items-start gap-3 bg-amber-50 dark:bg-amber-500/10 border border-amber-200/80 dark:border-amber-400/30 rounded-xl px-4 py-3">
                          <AlertTriangle size={14} className="text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
                          <p className="text-amber-700 dark:text-amber-300 text-xs">
                            No endpoints found in spec. The backend server may need to be restarted to apply the latest spec parsing fixes.
                          </p>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              {/* ── FILES tab ────────────────────────────────── */}
              {detailTab === 'files' && (
                <div className="overflow-y-auto flex-1 p-5 space-y-3">
                  {detailLoading ? (
                    <div className="flex items-center justify-center py-10 text-gray-400 dark:text-gray-500">
                      <RefreshCw size={16} className="animate-spin mr-2" /> Loading…
                    </div>
                  ) : (assetDetail?.files?.length > 0) ? (
                    <div className="space-y-2">
                      <p className="text-[10px] text-gray-400 dark:text-gray-500 uppercase tracking-wider font-bold">Available Files</p>
                      {assetDetail.files.map((f, i) => (
                        <div key={i} className="flex items-center justify-between bg-gray-50 dark:bg-gray-900/40 border border-gray-200/70 dark:border-white/[0.06] rounded-xl px-3.5 py-2.5">
                          <div>
                            <p className="text-gray-900 dark:text-gray-100 text-xs font-semibold">{f.classifier || f.packaging || '—'}</p>
                            <p className="text-gray-400 dark:text-gray-500 text-[10px] font-mono mt-0.5">{f.packaging}</p>
                          </div>
                          {f.externalLink && (
                            <a href={f.externalLink} target="_blank" rel="noreferrer"
                              className="text-sf-700 dark:text-sf-300 hover:text-sf-800 dark:hover:text-sf-200 text-[10px] font-medium flex items-center gap-1 border border-sf-200/70 dark:border-sf-400/30 px-2.5 py-1.5 rounded-lg bg-sf-50 dark:bg-sf-500/10 hover:shadow-sm transition-all">
                              <ExternalLink size={10} /> Download
                            </a>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center py-14 text-center">
                      <div className="w-12 h-12 rounded-2xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center mb-3">
                        <FileText size={20} className="text-gray-400 dark:text-gray-500" />
                      </div>
                      <p className="text-gray-500 dark:text-gray-400 text-sm">No file information available</p>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
