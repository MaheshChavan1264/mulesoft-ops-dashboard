import React, { useEffect, useState, useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { Search, RefreshCw, ChevronRight, Play, Square, RotateCcw, AlertTriangle, X, SlidersHorizontal, FileSpreadsheet } from 'lucide-react';
import StatusBadge from '../components/StatusBadge';
import Select from '../components/Select';
import BgFilterModal, { applyBgFilter } from '../components/BgFilterModal';
import CpsExportModal from '../components/CpsExportModal';
import api from '../services/api';

const ENV_BADGE = { production: 'bg-green-400', sandbox: 'bg-yellow-400', design: 'bg-blue-400' };
const ENV_TAG_COLOR = {
  production: 'bg-green-500/20 text-green-400',
  sandbox: 'bg-yellow-500/20 text-yellow-400'
};

const availableActions = (status) => {
  const s = (status || '').toUpperCase();
  if (['RUNNING', 'STARTED', 'PARTIALLY_STARTED', 'PARTIALLY_RUNNING'].includes(s)) return ['stop', 'restart'];
  if (['STOPPED', 'FAILED', 'DEPLOY_FAILED', 'UNDEPLOYED', 'NOT_RUNNING'].includes(s)) return ['start'];
  return [];
};

const ACTION_CONFIG = {
  start:   { label: 'Start',   Icon: Play,      btnCls: 'text-emerald-400 hover:bg-emerald-950/60 hover:text-emerald-300 border-emerald-800/40', bulkCls: 'bg-emerald-600 hover:bg-emerald-500 text-white' },
  stop:    { label: 'Stop',    Icon: Square,    btnCls: 'text-red-400 hover:bg-red-950/60 hover:text-red-300 border-red-800/40',                 bulkCls: 'bg-red-600 hover:bg-red-500 text-white' },
  restart: { label: 'Restart', Icon: RotateCcw, btnCls: 'text-blue-400 hover:bg-blue-950/60 hover:text-blue-300 border-blue-800/40',             bulkCls: 'bg-blue-600 hover:bg-blue-500 text-white' }
};

/* ── Single-app Confirm Modal ──────────────────────────────── */
function ConfirmModal({ state, onConfirm, onCancel, loading }) {
  if (!state) return null;
  const { action, app } = state;
  const { Icon, label, bulkCls } = ACTION_CONFIG[action];
  const dangerous = action === 'stop';
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6 w-full max-w-md shadow-2xl mx-4">
        <div className="flex items-start gap-4">
          <div className={`p-2.5 rounded-xl flex-shrink-0 border ${dangerous ? 'bg-red-950/60 border-red-800/40' : 'bg-blue-950/60 border-blue-800/40'}`}>
            <AlertTriangle size={18} className={dangerous ? 'text-red-400' : 'text-blue-400'} />
          </div>
          <div className="flex-1">
            <h3 className="text-white font-semibold text-base mb-1">{label} Application?</h3>
            <p className="text-gray-400 text-sm">
              Are you sure you want to <span className="font-medium text-white">{label.toLowerCase()}</span>{' '}
              <span className="font-mono text-blue-300 text-xs bg-blue-950/40 px-1.5 py-0.5 rounded">{app.name}</span>?
            </p>
            {dangerous && <p className="text-red-400/80 text-xs mt-2">⚠ This will stop all running flows and connections.</p>}
          </div>
          <button onClick={onCancel} className="text-gray-600 hover:text-gray-300 flex-shrink-0"><X size={16} /></button>
        </div>
        <div className="flex justify-end gap-3 mt-6">
          <button onClick={onCancel} disabled={loading}
            className="px-4 py-2 text-sm text-gray-400 hover:text-white bg-gray-800 hover:bg-gray-700 rounded-lg disabled:opacity-50 transition-colors">
            Cancel
          </button>
          <button onClick={onConfirm} disabled={loading}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg disabled:opacity-50 transition-colors ${bulkCls}`}>
            {loading
              ? <><span className="animate-spin rounded-full h-3.5 w-3.5 border-b-2 border-white" /> Working…</>
              : <><Icon size={13} /> Confirm {label}</>}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Bulk Confirm Modal ─────────────────────────────────────── */
function BulkConfirmModal({ state, onConfirm, onCancel, loading, results }) {
  if (!state) return null;
  const { action, apps } = state;
  const { Icon, label, bulkCls } = ACTION_CONFIG[action];
  const dangerous = action === 'stop';
  const isDone = !!results;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6 w-full max-w-lg shadow-2xl mx-4">
        <div className="flex items-start gap-4 mb-4">
          <div className={`p-2.5 rounded-xl flex-shrink-0 border ${dangerous ? 'bg-red-950/60 border-red-800/40' : 'bg-blue-950/60 border-blue-800/40'}`}>
            <AlertTriangle size={18} className={dangerous ? 'text-red-400' : 'text-blue-400'} />
          </div>
          <div className="flex-1">
            <h3 className="text-white font-semibold text-base mb-1">
              {isDone ? 'Results' : `${label} ${apps.length} Application${apps.length !== 1 ? 's' : ''}?`}
            </h3>
            {!isDone && (
              <p className="text-gray-400 text-sm">
                This will <span className="text-white font-medium">{label.toLowerCase()}</span> the following applications:
              </p>
            )}
            {dangerous && !isDone && (
              <p className="text-red-400/80 text-xs mt-1">⚠ This will stop all running flows and connections for each app.</p>
            )}
          </div>
          <button onClick={onCancel} disabled={loading} className="text-gray-600 hover:text-gray-300 flex-shrink-0">
            <X size={16} />
          </button>
        </div>

        {/* App list with per-app result indicators */}
        <div className="max-h-52 overflow-y-auto space-y-1.5 mb-5 pr-1">
          {apps.map((app) => {
            const r = results?.[app.id];
            return (
              <div key={app.id} className="flex items-center justify-between bg-gray-800/60 border border-gray-700/40 rounded-lg px-3 py-2 gap-2">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <span className={`w-2 h-2 rounded-full flex-shrink-0 ${ENV_BADGE[app.environment?.type] || 'bg-gray-400'}`} />
                  <span className="text-gray-200 text-xs font-medium truncate">{app.name}</span>
                  <span className="text-gray-600 text-xs flex-shrink-0 hidden sm:inline">({app.environment?.name})</span>
                </div>
                <div className="flex-shrink-0">
                  {r ? (
                    r.success
                      ? <span className="text-emerald-400 text-xs font-medium">✓ Done</span>
                      : <span className="text-red-400 text-xs font-medium" title={r.error}>✗ Failed</span>
                  ) : loading ? (
                    <span className="animate-spin rounded-full h-3 w-3 border-b-2 border-blue-400 block" />
                  ) : (
                    <span className="text-gray-600 text-xs">Pending</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Summary when done */}
        {isDone && (
          <div className="flex gap-3 mb-4 text-xs">
            <span className="text-emerald-400 font-medium">
              ✓ {Object.values(results).filter((r) => r.success).length} succeeded
            </span>
            {Object.values(results).filter((r) => !r.success).length > 0 && (
              <span className="text-red-400 font-medium">
                ✗ {Object.values(results).filter((r) => !r.success).length} failed
              </span>
            )}
          </div>
        )}

        <div className="flex justify-end gap-3">
          <button onClick={onCancel} disabled={loading}
            className="px-4 py-2 text-sm text-gray-400 hover:text-white bg-gray-800 hover:bg-gray-700 rounded-lg disabled:opacity-50 transition-colors">
            {isDone ? 'Close' : 'Cancel'}
          </button>
          {!isDone && (
            <button onClick={onConfirm} disabled={loading}
              className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg disabled:opacity-50 transition-colors ${bulkCls}`}>
              {loading
                ? <><span className="animate-spin rounded-full h-3.5 w-3.5 border-b-2 border-white" /> Working…</>
                : <><Icon size={13} /> {label} All {apps.length}</>}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ApplicationsPage() {
  const { orgId } = useAuth();
  const navigate = useNavigate();

  const [allBusinessGroups, setAllBusinessGroups] = useState([]);
  const [selectedBg, setSelectedBg] = useState('');
  const [showBgFilter, setShowBgFilter] = useState(false);
  const [environments, setEnvironments] = useState([]);
  const [apps, setApps] = useState([]);
  const [loading, setLoading] = useState(false);
  const [bgLoading, setBgLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterEnv, setFilterEnv] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterType, setFilterType] = useState('');
  const [error, setError] = useState('');
  const [showExport, setShowExport] = useState(false);

  // Single-app action states
  const [actionLoading, setActionLoading] = useState({});
  const [confirmState, setConfirmState] = useState(null);
  const [actionResult, setActionResult] = useState(null);

  // Multi-select states
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [bulkConfirm, setBulkConfirm] = useState(null);
  const [bulkLoading, setBulkLoading] = useState(false);
  const [bulkResults, setBulkResults] = useState(null);

  useEffect(() => { if (orgId) loadBusinessGroups(); }, [orgId]);
  useEffect(() => { if (selectedBg) loadApps(selectedBg); }, [selectedBg]);
  useEffect(() => { setSelectedIds(new Set()); }, [selectedBg]);

  const loadBusinessGroups = async () => {
    setBgLoading(true);
    try {
      const res = await api.get('/organizations/business-groups');
      const groups = res.data.data || [];
      setAllBusinessGroups(groups);
      const visible = applyBgFilter(groups);
      const root = visible.find((g) => !g.parentId) || visible[0];
      setSelectedBg(root?.id || orgId);
    } catch { setSelectedBg(orgId); }
    setBgLoading(false);
  };

  const loadApps = async (bgId) => {
    setLoading(true);
    setError('');
    setFilterEnv('');
    setSelectedIds(new Set());
    try {
      const [appsRes, envsRes] = await Promise.all([
        api.get(`/applications/summary/${bgId}`),
        api.get(`/environments/${bgId}`)
      ]);
      setApps(appsRes.data.data || []);
      setEnvironments(envsRes.data.data || []);
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to load applications.');
      setApps([]);
    }
    setLoading(false);
  };

  /* ── Single-app action ─────────────────────────────── */
  const requestAction = (e, app, action) => {
    e.stopPropagation();
    setActionResult(null);
    setConfirmState({ app, action });
  };

  const executeAction = async () => {
    if (!confirmState) return;
    const { app, action } = confirmState;
    setActionLoading((prev) => ({ ...prev, [app.id]: action }));
    try {
      const isCH2 = app.deploymentType === 'CloudHub 2.0';
      const envId = app.environment?.id;
      if (isCH2) {
        await api.post(`/applications/cloudhub2/${selectedBg}/${envId}/${app.id}/action`, { action });
      } else {
        await api.post(`/applications/cloudhub1/${envId}/${app.id}/action?orgId=${selectedBg}`, { action });
      }
      const nextStatus = action === 'start' ? 'RUNNING' : action === 'stop' ? 'STOPPED' : 'DEPLOYING';
      setApps((prev) => prev.map((a) => a.id === app.id ? { ...a, status: nextStatus } : a));
      setActionResult({ success: true, message: `✓ ${app.name}: ${action} initiated` });
    } catch (e) {
      setActionResult({ success: false, message: `✗ Failed to ${action} ${app.name}: ${e.response?.data?.error || e.message}` });
    } finally {
      setActionLoading((prev) => ({ ...prev, [app.id]: null }));
      setConfirmState(null);
      setTimeout(() => setActionResult(null), 6000);
    }
  };

  /* ── Multi-select ──────────────────────────────────── */
  const filtered = useMemo(() => apps.filter((a) => {
    const matchSearch = !search || a.name?.toLowerCase().includes(search.toLowerCase());
    const matchEnv = !filterEnv || a.environment?.id === filterEnv;
    const matchStatus = !filterStatus || (a.status || '').toUpperCase() === filterStatus.toUpperCase();
    const matchType = !filterType || a.deploymentType === filterType;
    return matchSearch && matchEnv && matchStatus && matchType;
  }), [apps, search, filterEnv, filterStatus, filterType]);

  const allSelected = filtered.length > 0 && filtered.every((a) => selectedIds.has(a.id));
  const someSelected = !allSelected && filtered.some((a) => selectedIds.has(a.id));
  const selectedApps = filtered.filter((a) => selectedIds.has(a.id));

  const toggleRow = (e, appId) => {
    e.stopPropagation();
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(appId) ? next.delete(appId) : next.add(appId);
      return next;
    });
  };

  const toggleAll = (e) => {
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
  };

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
        if (isCH2) {
          return api.post(`/applications/cloudhub2/${selectedBg}/${envId}/${app.id}/action`, { action });
        } else {
          return api.post(`/applications/cloudhub1/${envId}/${app.id}/action?orgId=${selectedBg}`, { action });
        }
      })
    );

    const resultMap = {};
    const nextStatus = action === 'start' ? 'RUNNING' : action === 'stop' ? 'STOPPED' : 'DEPLOYING';

    targets.forEach((app, i) => {
      const r = settled[i];
      resultMap[app.id] = r.status === 'fulfilled'
        ? { success: true }
        : { success: false, error: r.reason?.response?.data?.error || r.reason?.message || 'Failed' };
    });

    // Optimistic update for successful ones
    setApps((prev) => prev.map((a) => resultMap[a.id]?.success ? { ...a, status: nextStatus } : a));
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

  /* ── Select options ────────────────────────────────── */
  // Apply BG filter to the visible list
  const visibleGroups = applyBgFilter(allBusinessGroups);
  const filterActive = visibleGroups.length < allBusinessGroups.length;

  const bgOptions = visibleGroups.map((g) => ({
    value: g.id, label: g.name, indent: !!g.parentId,
    tag: !g.parentId ? 'Root' : undefined, tagColor: 'bg-blue-500/20 text-blue-400'
  }));

  const envOptions = [
    { value: '', label: 'All Environments' },
    ...environments.map((e) => ({
      value: e.id, label: e.name, badge: true,
      badgeColor: ENV_BADGE[e.type] || 'bg-gray-400',
      tag: e.type, tagColor: ENV_TAG_COLOR[e.type] || 'bg-gray-700 text-gray-400'
    }))
  ];

  const statusOptions = [
    { value: '', label: 'All Statuses' },
    { value: 'RUNNING',   label: 'Running',   badge: true, badgeColor: 'bg-green-400' },
    { value: 'APPLIED',   label: 'Applied',   badge: true, badgeColor: 'bg-cyan-400' },
    { value: 'FAILED',    label: 'Failed',    badge: true, badgeColor: 'bg-red-400' },
    { value: 'STOPPED',   label: 'Stopped',   badge: true, badgeColor: 'bg-gray-400' },
    { value: 'DEPLOYING', label: 'Deploying', badge: true, badgeColor: 'bg-blue-400' },
    { value: 'UPDATING',  label: 'Updating',  badge: true, badgeColor: 'bg-purple-400' },
    { value: 'STARTING',  label: 'Starting',  badge: true, badgeColor: 'bg-blue-300' },
    { value: 'STOPPING',  label: 'Stopping',  badge: true, badgeColor: 'bg-orange-400' },
    { value: 'PARTIALLY_STARTED', label: 'Partial', badge: true, badgeColor: 'bg-yellow-400' }
  ];

  const typeOptions = [
    { value: '', label: 'All Deployment Types' },
    { value: 'CloudHub 2.0', label: 'CloudHub 2.0', tag: 'CH2', tagColor: 'bg-blue-500/20 text-blue-400' },
    { value: 'CloudHub 1.0', label: 'CloudHub 1.0', tag: 'CH1', tagColor: 'bg-purple-500/20 text-purple-400' }
  ];

  const selectedBgName = visibleGroups.find((g) => g.id === selectedBg)?.name || 'Organization';

  return (
    <div className="space-y-5">
      {/* Modals */}
      {/* BG Filter Modal */}
      {showBgFilter && (
        <BgFilterModal
          businessGroups={allBusinessGroups}
          onClose={() => setShowBgFilter(false)}
          onSaved={() => {
            const visible = applyBgFilter(allBusinessGroups);
            if (!visible.find((g) => g.id === selectedBg)) {
              const root = visible.find((g) => !g.parentId) || visible[0];
              if (root) setSelectedBg(root.id);
            }
          }}
        />
      )}

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

      {/* CPS Export Modal */}
      {showExport && (
        <CpsExportModal
          apps={apps}
          bgOrgId={selectedBg}
          bgName={selectedBgName}
          onClose={() => setShowExport(false)}
        />
      )}

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-white">Applications</h1>
          <p className="text-gray-400 text-sm mt-1">
            {loading ? 'Loading...' : `${apps.length} integrations in ${selectedBgName}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowExport(true)} disabled={loading || apps.length === 0}
            title="Export CPS Properties to Excel"
            className="flex items-center gap-2 text-sm text-emerald-400 hover:text-emerald-300 bg-emerald-950/40 hover:bg-emerald-950/60 border border-emerald-800/50 px-3 py-2 rounded-lg disabled:opacity-40 transition-colors">
            <FileSpreadsheet size={14} /> Export CPS
          </button>
          <button onClick={() => loadApps(selectedBg)} disabled={loading || bgLoading}
            className="flex items-center gap-2 text-sm text-gray-400 hover:text-white bg-gray-800 px-3 py-2 rounded-lg disabled:opacity-50">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>
      </div>

      {/* Single-app toast */}
      {actionResult && (
        <div className={`flex items-center justify-between px-4 py-3 rounded-xl border text-sm ${
          actionResult.success ? 'bg-emerald-950/40 border-emerald-800/50 text-emerald-300' : 'bg-red-950/40 border-red-800/50 text-red-300'
        }`}>
          <span>{actionResult.message}</span>
          <button onClick={() => setActionResult(null)} className="ml-4 opacity-60 hover:opacity-100"><X size={14} /></button>
        </div>
      )}

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 text-red-400 text-sm">{error}</div>
      )}

      {/* Business Group selector */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl px-5 py-4">
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs text-gray-500 uppercase tracking-wider font-medium">Business Group</p>
          <button
            onClick={() => setShowBgFilter(true)}
            title="Configure visible business groups"
            className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded-lg border transition-all ${
              filterActive
                ? 'bg-blue-600/20 border-blue-600/50 text-blue-400 hover:bg-blue-600/30'
                : 'bg-gray-800 border-gray-700 text-gray-500 hover:text-gray-300 hover:border-gray-600'
            }`}
          >
            <SlidersHorizontal size={11} />
            {filterActive ? `${visibleGroups.length}/${allBusinessGroups.length} shown` : 'Filter BGs'}
          </button>
        </div>
        <Select
          value={selectedBg}
          onChange={(v) => { setSelectedBg(v); setSearch(''); setFilterStatus(''); setFilterType(''); }}
          options={bgOptions}
          placeholder="Select business group..."
          searchable={visibleGroups.length > 5}
          disabled={bgLoading}
        />
      </div>

      {/* Filters */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="relative sm:col-span-2 lg:col-span-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
          <input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search applications..."
            className="w-full bg-gray-900 border border-gray-700 rounded-lg pl-9 pr-4 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500" />
        </div>
        <div><Select value={filterEnv} onChange={setFilterEnv} options={envOptions} placeholder="Environment" searchable /></div>
        <div><Select value={filterStatus} onChange={setFilterStatus} options={statusOptions} placeholder="Status" /></div>
        <div><Select value={filterType} onChange={setFilterType} options={typeOptions} placeholder="Type" /></div>
      </div>

      {/* Bulk action toolbar — appears when rows are selected */}
      {selectedApps.length > 0 && (
        <div className="flex items-center justify-between flex-wrap gap-3 px-4 py-3 bg-blue-950/40 border border-blue-800/50 rounded-xl">
          <div className="flex items-center gap-3">
            <span className="text-blue-300 text-sm font-medium">
              {selectedApps.length} application{selectedApps.length !== 1 ? 's' : ''} selected
            </span>
            <button
              onClick={() => setSelectedIds(new Set())}
              className="text-blue-500 hover:text-blue-300 text-xs underline underline-offset-2">
              Clear
            </button>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-blue-500 text-xs hidden sm:inline">Bulk action:</span>
            {bulkActions.map((action) => {
              const { Icon, label, bulkCls } = ACTION_CONFIG[action];
              return (
                <button key={action} onClick={() => requestBulkAction(action)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${bulkCls}`}>
                  <Icon size={12} /> {label} All
                </button>
              );
            })}
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center h-48">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
        </div>
      ) : (
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-800/50 text-gray-400 text-xs uppercase tracking-wider">
                {/* Select-all checkbox */}
                <th className="px-4 py-3 w-10" onClick={toggleAll}>
                  <div className={`w-4 h-4 rounded border flex items-center justify-center cursor-pointer transition-colors ${
                    allSelected ? 'bg-blue-600 border-blue-500' : someSelected ? 'bg-blue-900/60 border-blue-600' : 'border-gray-600 hover:border-blue-500'
                  }`}>
                    {allSelected && <span className="text-white text-[10px] font-bold leading-none">✓</span>}
                    {someSelected && <span className="text-blue-400 text-[10px] font-bold leading-none">–</span>}
                  </div>
                </th>
                <th className="text-left px-4 py-3 font-medium">Application</th>
                <th className="text-left px-4 py-3 font-medium">Status</th>
                <th className="text-left px-4 py-3 font-medium">Environment</th>
                <th className="text-left px-4 py-3 font-medium">Type</th>
                <th className="text-left px-4 py-3 font-medium">Mule Version</th>
                <th className="text-left px-4 py-3 font-medium">Last Modified</th>
                <th className="px-4 py-3 font-medium text-center">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((app, idx) => {
                const actions = availableActions(app.status);
                const isActing = !!actionLoading[app.id];
                const isChecked = selectedIds.has(app.id);

                return (
                  <tr key={`${app.id}-${idx}`}
                    className={`border-t border-gray-800 hover:bg-gray-800/30 cursor-pointer transition-colors ${isChecked ? 'bg-blue-950/20' : ''}`}
                    onClick={() => navigate(`/applications/${selectedBg}/${app.environment?.id}/${app.id}`)}>
                    {/* Checkbox */}
                    <td className="px-4 py-3" onClick={(e) => toggleRow(e, app.id)}>
                      <div className={`w-4 h-4 rounded border flex items-center justify-center cursor-pointer transition-colors ${
                        isChecked ? 'bg-blue-600 border-blue-500' : 'border-gray-600 hover:border-blue-500'
                      }`}>
                        {isChecked && <span className="text-white text-[10px] font-bold leading-none">✓</span>}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-white font-medium">{app.name}</td>
                    <td className="px-4 py-3"><StatusBadge status={app.status} /></td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${ENV_BADGE[app.environment?.type] || 'bg-gray-400'}`} />
                        <span className="text-gray-300">{app.environment?.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded font-medium ${
                        app.deploymentType === 'CloudHub 2.0' ? 'bg-blue-500/20 text-blue-400' : 'bg-purple-500/20 text-purple-400'
                      }`}>{app.deploymentType}</span>
                    </td>
                    <td className="px-4 py-3 text-gray-400 font-mono text-xs">{app.muleVersion || '—'}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs">
                      {app.lastModifiedDate ? new Date(app.lastModifiedDate).toLocaleDateString() : '—'}
                    </td>
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-center gap-1">
                        {isActing ? (
                          <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-400" />
                        ) : actions.length > 0 ? (
                          actions.map((action) => {
                            const { Icon, label, btnCls } = ACTION_CONFIG[action];
                            return (
                              <button key={action} title={label}
                                onClick={(e) => requestAction(e, app, action)}
                                className={`p-1.5 rounded-lg border transition-all ${btnCls}`}>
                                <Icon size={13} />
                              </button>
                            );
                          })
                        ) : (
                          <ChevronRight size={14} className="text-gray-600" />
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-5 py-12 text-center text-gray-500">
                    {apps.length === 0
                      ? `No applications found in ${selectedBgName}.`
                      : 'No applications match your filters.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {filtered.length > 0 && (
        <p className="text-xs text-gray-600 text-right">
          {selectedApps.length > 0 && <span className="text-blue-500 mr-2">{selectedApps.length} selected ·</span>}
          Showing {filtered.length} of {apps.length}
        </p>
      )}
    </div>
  );
}
