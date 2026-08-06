import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useLocation } from 'react-router-dom';
import { Search, Package, RefreshCw, ExternalLink, ChevronLeft, ChevronRight } from 'lucide-react';
import Select from '../components/Select';
import api from '../services/api';

const ASSET_TYPES = [
  { value: '', label: 'All Types' },
  { value: 'rest-api', label: 'REST API' },
  { value: 'soap-api', label: 'SOAP API' },
  { value: 'http-api', label: 'HTTP API' },
  { value: 'mule-application', label: 'Mule Application' },
  { value: 'mule-plugin', label: 'Connector / Plugin' },
  { value: 'template', label: 'Template' },
  { value: 'example', label: 'Example' }
];

const typeColor = (type) => {
  const map = {
    'rest-api': 'bg-blue-500/20 text-blue-400',
    'soap-api': 'bg-purple-500/20 text-purple-400',
    'http-api': 'bg-cyan-500/20 text-cyan-400',
    'mule-application': 'bg-green-500/20 text-green-400',
    'mule-plugin': 'bg-orange-500/20 text-orange-400',
    template: 'bg-yellow-500/20 text-yellow-400',
    example: 'bg-pink-500/20 text-pink-400'
  };
  return map[type] || 'bg-gray-500/20 text-gray-400';
};

const LIMIT = 100;

export default function ExchangePage() {
  const { orgId: rootOrgId } = useAuth();
  const location = useLocation();

  const [businessGroups, setBusinessGroups] = useState([]);
  const [selectedOrgId, setSelectedOrgId] = useState('');
  const [bgLoading, setBgLoading] = useState(true);

  const [assets, setAssets] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [assetType, setAssetType] = useState('');
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState(null);
  const [pendingAssetId, setPendingAssetId] = useState(null);
  const [pendingGroupId, setPendingGroupId] = useState(null);

  // Load business groups on mount
  useEffect(() => {
    loadBusinessGroups();
  }, [rootOrgId]);

  // Handle navigation state from ApplicationDetailPage
  useEffect(() => {
    const state = location.state;
    if (state?.assetId) {
      setPendingAssetId(state.assetId);
      setPendingGroupId(state.groupId || null);
      setSearch(state.assetId);
      // Pre-select the BG that matches the groupId
      if (state.groupId) setSelectedOrgId(state.groupId);
    }
  }, []);

  useEffect(() => {
    if (selectedOrgId !== undefined && !bgLoading) {
      setOffset(0);
      loadAssets(0);
    }
  }, [search, assetType, selectedOrgId, bgLoading]);

  const loadBusinessGroups = async () => {
    setBgLoading(true);
    try {
      const res = await api.get('/organizations/business-groups');
      const groups = res.data.data || [];
      setBusinessGroups(groups);
      // Default to root org
      const root = groups.find(g => !g.parentId) || groups[0];
      if (root && !location.state?.groupId) setSelectedOrgId(root.id);
    } catch {
      setSelectedOrgId(rootOrgId);
    }
    setBgLoading(false);
  };

  const loadAssets = async (off) => {
    setLoading(true);
    try {
      const res = await api.get('/exchange/search', {
        params: {
          search: search || undefined,
          type: assetType || undefined,
          organizationId: selectedOrgId || undefined,
          offset: off,
          limit: LIMIT
        }
      });
      const data = res.data;
      const list = Array.isArray(data) ? data : (data.assets || data.data || []);
      setAssets(list);
      setTotal(data.total || list.length);

      // Auto-select matching asset if navigated from app detail
      if (pendingAssetId && off === 0) {
        const match = list.find(a =>
          a.assetId === pendingAssetId && (!pendingGroupId || a.groupId === pendingGroupId)
        ) || list.find(a => a.assetId === pendingAssetId)
          || (list.length === 1 ? list[0] : null);
        if (match) {
          setSelected(match);
          setPendingAssetId(null);
        }
      }
    } catch {
      setAssets([]);
      setTotal(0);
    }
    setLoading(false);
  };

  const prevPage = () => {
    const newOffset = Math.max(0, offset - LIMIT);
    setOffset(newOffset);
    loadAssets(newOffset);
  };

  const nextPage = () => {
    const newOffset = offset + LIMIT;
    setOffset(newOffset);
    loadAssets(newOffset);
  };

  const currentPage = Math.floor(offset / LIMIT) + 1;
  const totalPages = Math.ceil(total / LIMIT);

  const bgOptions = [
    { value: '', label: 'All Organizations', tag: 'ALL', tagColor: 'bg-gray-700 text-gray-400' },
    ...businessGroups.map(g => ({
      value: g.id, label: g.name, indent: !!g.parentId,
      tag: !g.parentId ? 'Root' : undefined, tagColor: 'bg-blue-500/20 text-blue-400'
    }))
  ];

  const selectedBgName = businessGroups.find(g => g.id === selectedOrgId)?.name
    || (selectedOrgId ? selectedOrgId : 'All Organizations');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-white">Exchange Assets</h1>
        <p className="text-gray-400 text-sm mt-1">
          Browse assets in <span className="text-blue-400">{selectedBgName}</span>
          {total > 0 && <span className="text-gray-600"> — {total} total</span>}
        </p>
      </div>

      {/* BG selector + Search + Type filter */}
      <div className="flex flex-wrap gap-3">
        {/* Business Group selector */}
        <div className="w-56">
          <Select
            value={selectedOrgId}
            onChange={(v) => { setSelectedOrgId(v); setOffset(0); setSelected(null); }}
            options={bgOptions}
            placeholder="Select organization..."
            searchable={businessGroups.length > 5}
            disabled={bgLoading}
          />
        </div>
        <div className="relative flex-1 min-w-48">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search assets..."
            className="w-full bg-gray-900 border border-gray-700 rounded-lg pl-9 pr-4 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
          />
        </div>
        <select
          value={assetType}
          onChange={(e) => setAssetType(e.target.value)}
          className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
        >
          {ASSET_TYPES.map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
        <button
          onClick={() => { setOffset(0); loadAssets(0); }}
          className="flex items-center gap-2 text-sm text-gray-400 hover:text-white bg-gray-800 px-3 py-2 rounded-lg"
        >
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Asset list */}
        <div className="lg:col-span-2 bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-800 flex items-center justify-between">
            <h3 className="text-white font-semibold">
              Assets {total > 0 && (
                <span className="text-gray-400 font-normal text-sm">
                  ({assets.length}{total > assets.length ? ` of ${total}` : ''})
                </span>
              )}
            </h3>
            {totalPages > 1 && (
              <div className="flex items-center gap-2 text-sm text-gray-400">
                <button onClick={prevPage} disabled={offset === 0} className="p-1 hover:text-white disabled:opacity-30">
                  <ChevronLeft size={16} />
                </button>
                <span>{currentPage} / {totalPages}</span>
                <button onClick={nextPage} disabled={currentPage >= totalPages} className="p-1 hover:text-white disabled:opacity-30">
                  <ChevronRight size={16} />
                </button>
              </div>
            )}
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-20">
              <div className="animate-spin rounded-full h-7 w-7 border-b-2 border-blue-500"></div>
            </div>
          ) : (
            <div className="divide-y divide-gray-800 max-h-[600px] overflow-y-auto">
              {assets.map((asset, i) => (
                <button
                  key={`${asset.groupId}-${asset.assetId}-${i}`}
                  onClick={() => setSelected(asset)}
                  className={`w-full flex items-start gap-3 px-5 py-4 hover:bg-gray-800/50 text-left transition-colors ${
                    selected?.assetId === asset.assetId ? 'bg-blue-600/10 border-l-2 border-blue-500' : ''
                  }`}
                >
                  <div className="w-8 h-8 rounded-lg bg-gray-800 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <Package size={14} className="text-blue-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-white text-sm font-medium truncate">{asset.name || asset.assetId}</p>
                      <span className={`text-xs px-2 py-0.5 rounded font-medium ${typeColor(asset.type)}`}>
                        {asset.type}
                      </span>
                    </div>
                    <p className="text-gray-500 text-xs mt-0.5 truncate">{asset.groupId}/{asset.assetId}</p>
                    {asset.description && (
                      <p className="text-gray-400 text-xs mt-1 line-clamp-2">{asset.description}</p>
                    )}
                  </div>
                  <span className="text-xs text-gray-500 flex-shrink-0">v{asset.version}</span>
                </button>
              ))}
              {assets.length === 0 && (
                <div className="px-5 py-16 text-center text-gray-500 text-sm">
                  No assets found. Try a different search term, type, or organization.
                </div>
              )}
            </div>
          )}
        </div>

        {/* Asset Detail panel */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          {selected ? (
            <div className="h-full flex flex-col">
              {/* Detail header */}
              <div className="px-5 py-4 border-b border-gray-800">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="text-white font-semibold">{selected.name || selected.assetId}</h3>
                    <span className={`text-xs px-2 py-0.5 rounded font-medium mt-1 inline-block ${typeColor(selected.type)}`}>
                      {selected.type}
                    </span>
                  </div>
                  <a
                    href={`https://anypoint.mulesoft.com/exchange/${selected.groupId}/${selected.assetId}/`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-blue-400 hover:text-blue-300 flex-shrink-0"
                    title="Open in Anypoint Exchange"
                  >
                    <ExternalLink size={16} />
                  </a>
                </div>
              </div>

              {/* Detail body */}
              <div className="p-5 space-y-2.5 text-sm overflow-y-auto flex-1">
                {selected.description && (
                  <div className="mb-3">
                    <p className="text-gray-400 text-xs mb-1">Description</p>
                    <p className="text-gray-200 text-sm">{selected.description}</p>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-gray-400">Asset ID</span>
                  <span className="text-white font-mono text-xs">{selected.assetId}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Group ID</span>
                  <span className="text-gray-400 font-mono text-xs truncate max-w-36">{selected.groupId}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Version</span>
                  <span className="text-white">{selected.version}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Status</span>
                  <span className={`capitalize ${selected.status === 'published' ? 'text-green-400' : 'text-yellow-400'}`}>
                    {selected.status || '—'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Created By</span>
                  <span className="text-white">{selected.createdBy?.username || '—'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Created</span>
                  <span className="text-white text-xs">
                    {selected.createdAt ? new Date(selected.createdAt).toLocaleDateString() : '—'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Updated</span>
                  <span className="text-white text-xs">
                    {selected.updatedAt ? new Date(selected.updatedAt).toLocaleDateString() : '—'}
                  </span>
                </div>
                {selected.labels && selected.labels.length > 0 && (
                  <div>
                    <p className="text-gray-400 text-xs mb-1.5">Labels</p>
                    <div className="flex flex-wrap gap-1">
                      {selected.labels.map((l, i) => (
                        <span key={i} className="bg-gray-800 text-gray-300 text-xs px-2 py-0.5 rounded">{l}</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center h-full py-24 text-gray-500 text-sm">
              Select an asset to view details
            </div>
          )}
        </div>
      </div>
    </div>
  );
}