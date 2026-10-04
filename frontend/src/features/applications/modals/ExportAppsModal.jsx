import React, { useState, useEffect, useMemo } from 'react';
import { Search, FileSpreadsheet, Check } from 'lucide-react';
import Modal from '../../../components/ui/Modal';
import { applyBgFilter } from '../../../components/shared/BgFilterModal';
import { applyEnvFilter } from '../../../components/shared/EnvFilterModal';
import { rowsToWorksheet, writeWorkbook, timestampedFilename } from '../../../utils/xlsxExport';

/**
 * ExportAppsModal — multi-select BGs + Envs (pre-seeded from the global
 * BG/Env filters), producing one xlsx sheet per selected environment.
 *
 * Extracted from features/applications/ApplicationsPage.jsx — see
 * FRONTEND_ARCHITECTURE_REVIEW.md §10 folder-structure recommendation.
 */
export default function ExportAppsModal({ apps, allBusinessGroups, environments, onClose }) {
  // Honour the same global filters the main page uses
  const globalBgs  = useMemo(() => applyBgFilter(allBusinessGroups),  [allBusinessGroups]);
  const globalEnvs = useMemo(() => applyEnvFilter(environments), [environments]);

  const [selBgIds,  setSelBgIds]  = useState(() => new Set(globalBgs.map(g => g.id)));
  const [selEnvIds, setSelEnvIds] = useState(() => new Set(globalEnvs.map(e => e.id)));
  const [bgSearch,  setBgSearch]  = useState('');
  const [envSearch, setEnvSearch] = useState('');

  // Environments that have at least one app in the selected BGs
  const availableEnvs = useMemo(() => {
    const bgEnvIds = new Set(
      apps.filter(a => selBgIds.has(a._bgId)).map(a => a.environment?.id).filter(Boolean)
    );
    return globalEnvs.filter(e => bgEnvIds.has(e.id));
  }, [selBgIds, globalEnvs, apps]);

  // When BG selection changes, drop env selections that have no apps there
  useEffect(() => {
    const availIds = new Set(availableEnvs.map(e => e.id));
    setSelEnvIds(prev => new Set([...prev].filter(id => availIds.has(id))));
  }, [availableEnvs]);

  // Apps matching selected BGs + selected Envs
  const exportApps = useMemo(() =>
    apps.filter(a => selBgIds.has(a._bgId) && selEnvIds.has(a.environment?.id)),
    [apps, selBgIds, selEnvIds]
  );

  // Per-env app counts (only for selected envs)
  const envCounts = useMemo(() => {
    const c = {};
    exportApps.forEach(a => { const id = a.environment?.id; if (id) c[id] = (c[id] || 0) + 1; });
    return c;
  }, [exportApps]);

  const toggleBg  = id => setSelBgIds(prev  => { const n = new Set(prev);  n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleEnv = id => setSelEnvIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const allBgsChecked  = globalBgs.length     > 0 && globalBgs.every(g     => selBgIds.has(g.id));
  const allEnvsChecked = availableEnvs.length > 0 && availableEnvs.every(e => selEnvIds.has(e.id));

  const selectedEnvCount = availableEnvs.filter(e => selEnvIds.has(e.id) && envCounts[e.id] > 0).length;

  const doExport = () => {
    if (exportApps.length === 0) return;

    // One sheet per env (in global env order, only envs with apps)
    const envsToExport = availableEnvs.filter(e => selEnvIds.has(e.id) && (envCounts[e.id] || 0) > 0);
    const sheets = envsToExport.map(env => {
      const envApps = exportApps.filter(a => a.environment?.id === env.id);
      const rows = envApps.map(app => ({
        'Integration Name': app.name            || '—',
        'Mule Version':     app.muleVersion     || '—',
        'Status':           (app.status || '—').toUpperCase(),
        'Deployment Type':  app.deploymentType  || '—',
      }));
      return { name: env.name, worksheet: rowsToWorksheet(rows) };
    });

    writeWorkbook(sheets, timestampedFilename('apps-export'));
    onClose();
  };

  const filteredBgs  = globalBgs.filter(g => g.name.toLowerCase().includes(bgSearch.toLowerCase()));
  const filteredEnvs = availableEnvs.filter(e => e.name.toLowerCase().includes(envSearch.toLowerCase()));

  return (
    <Modal
      onClose={onClose}
      size="base"
      icon={FileSpreadsheet}
      accent="purple"
      title="Export Applications"
      subtitle="Download as an Excel workbook"
      footer={
        <>
          <button onClick={onClose}
            className="px-4 py-2.5 text-sm font-medium text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 bg-white dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 border border-gray-200 dark:border-gray-700 rounded-xl transition-colors">
            Cancel
          </button>
          <button onClick={doExport} disabled={exportApps.length === 0}
            className="flex items-center gap-2 px-5 py-2.5 text-sm font-semibold bg-gradient-to-b from-purple-500 to-purple-600 hover:from-purple-400 hover:to-purple-500 disabled:opacity-40 text-white rounded-xl shadow-md shadow-purple-500/30 hover:shadow-lg hover:shadow-purple-500/40 ring-1 ring-inset ring-white/20 transition-all duration-200 hover:-translate-y-0.5 active:translate-y-0">
            <FileSpreadsheet size={14} />
            Export{exportApps.length > 0 ? ` (${exportApps.length} · ${selectedEnvCount} sheets)` : ''}
          </button>
        </>
      }
    >
      {/* ── Business Groups ── */}
      <div>
        <div className="flex items-center justify-between mb-2.5">
          <label className="text-[10px] text-gray-400 dark:text-gray-500 uppercase tracking-wider font-bold">
            Business Groups
            <span className="ml-1.5 text-gray-400 dark:text-gray-500 normal-case font-medium">({selBgIds.size}/{globalBgs.length} selected)</span>
          </label>
          <button
            onClick={() => setSelBgIds(allBgsChecked ? new Set() : new Set(globalBgs.map(g => g.id)))}
            className="text-[11px] font-semibold text-purple-600 dark:text-purple-400 hover:text-purple-700 dark:hover:text-purple-300 transition-colors">
            {allBgsChecked ? 'Deselect All' : 'Select All'}
          </button>
        </div>
        {globalBgs.length > 6 && (
          <div className="relative mb-2">
            <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500 pointer-events-none" />
            <input value={bgSearch} onChange={e => setBgSearch(e.target.value)} placeholder="Filter BGs…"
              className="w-full bg-gray-50 dark:bg-gray-900/60 border border-gray-200 dark:border-gray-700 rounded-xl pl-9 pr-3 py-2 text-xs text-gray-700 dark:text-gray-300 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:border-purple-500 focus:ring-2 focus:ring-purple-500/15 transition-all" />
          </div>
        )}
        <div className="space-y-0.5 max-h-40 overflow-y-auto pr-1 rounded-xl border border-gray-100 dark:border-gray-700/50 p-1">
          {filteredBgs.map(g => (
            <button key={g.id} onClick={() => toggleBg(g.id)}
              className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700/40 transition-colors text-left">
              <div className={`w-[18px] h-[18px] rounded-md border flex-shrink-0 flex items-center justify-center transition-all ${
                selBgIds.has(g.id) ? 'bg-purple-600 border-purple-500 shadow-sm shadow-purple-500/40' : 'border-gray-300 dark:border-gray-600 hover:border-purple-500'
              }`}>
                {selBgIds.has(g.id) && <Check size={11} className="text-white" />}
              </div>
              {g.parentId && <span className="w-3 flex-shrink-0" />}
              <span className={`text-sm truncate flex-1 ${selBgIds.has(g.id) ? 'text-gray-900 dark:text-gray-100 font-semibold' : 'text-gray-500 dark:text-gray-400 font-medium'}`}>{g.name}</span>
              {!g.parentId && (
                <span className="text-[9px] bg-blue-50 dark:bg-blue-500/15 text-blue-600 dark:text-blue-300 px-1.5 py-0.5 rounded-full flex-shrink-0 font-bold">Root</span>
              )}
            </button>
          ))}
          {filteredBgs.length === 0 && (
            <p className="text-xs text-gray-400 dark:text-gray-500 px-3 py-2">No BGs match</p>
          )}
        </div>
      </div>

      {/* ── Environments (each = one sheet tab) ── */}
      <div>
        <div className="flex items-center justify-between mb-2.5">
          <label className="text-[10px] text-gray-400 dark:text-gray-500 uppercase tracking-wider font-bold">
            Environments
            <span className="ml-1 text-gray-400 dark:text-gray-500 normal-case font-medium">— each = one sheet</span>
          </label>
          <button
            onClick={() => setSelEnvIds(allEnvsChecked ? new Set() : new Set(availableEnvs.map(e => e.id)))}
            className="text-[11px] font-semibold text-purple-600 dark:text-purple-400 hover:text-purple-700 dark:hover:text-purple-300 transition-colors">
            {allEnvsChecked ? 'Deselect All' : 'Select All'}
          </button>
        </div>
        {availableEnvs.length > 6 && (
          <div className="relative mb-2">
            <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500 pointer-events-none" />
            <input value={envSearch} onChange={e => setEnvSearch(e.target.value)} placeholder="Filter environments…"
              className="w-full bg-gray-50 dark:bg-gray-900/60 border border-gray-200 dark:border-gray-700 rounded-xl pl-9 pr-3 py-2 text-xs text-gray-700 dark:text-gray-300 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:border-purple-500 focus:ring-2 focus:ring-purple-500/15 transition-all" />
          </div>
        )}
        <div className="space-y-0.5 max-h-48 overflow-y-auto pr-1 rounded-xl border border-gray-100 dark:border-gray-700/50 p-1">
          {availableEnvs.length === 0 ? (
            <p className="text-xs text-gray-400 dark:text-gray-500 px-3 py-2">No environments found for selected BGs</p>
          ) : filteredEnvs.length === 0 ? (
            <p className="text-xs text-gray-400 dark:text-gray-500 px-3 py-2">No environments match</p>
          ) : (
            filteredEnvs.map(e => {
              const isProd = e.type === 'production';
              const count  = envCounts[e.id] || 0;
              return (
                <button key={e.id} onClick={() => toggleEnv(e.id)}
                  className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700/40 transition-colors text-left">
                  <div className={`w-[18px] h-[18px] rounded-md border flex-shrink-0 flex items-center justify-center transition-all ${
                    selEnvIds.has(e.id) ? 'bg-purple-600 border-purple-500 shadow-sm shadow-purple-500/40' : 'border-gray-300 dark:border-gray-600 hover:border-purple-500'
                  }`}>
                    {selEnvIds.has(e.id) && <Check size={11} className="text-white" />}
                  </div>
                  <span className={`w-2 h-2 rounded-full flex-shrink-0 ${isProd ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                  <span className={`text-sm flex-1 truncate ${selEnvIds.has(e.id) ? 'text-gray-900 dark:text-gray-100 font-semibold' : 'text-gray-500 dark:text-gray-400 font-medium'}`}>{e.name}</span>
                  <span className={`text-[9px] px-1.5 py-0.5 rounded-full flex-shrink-0 font-bold ${
                    isProd ? 'bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' : 'bg-amber-50 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300'
                  }`}>{e.type}</span>
                  {selEnvIds.has(e.id) && count > 0 && (
                    <span className="text-[9px] font-semibold text-gray-400 dark:text-gray-500 flex-shrink-0 tabular-nums">{count} apps</span>
                  )}
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* ── Preview ── */}
      <div className="bg-gradient-to-br from-purple-50 to-purple-50/40 dark:from-purple-500/10 dark:to-purple-500/5 border border-purple-200/60 dark:border-purple-400/20 rounded-2xl px-4 py-3.5">
        <p className="text-sm text-gray-700 dark:text-gray-300">
          <span className="text-purple-700 dark:text-purple-300 font-bold text-lg">{exportApps.length}</span>
          {' '}app{exportApps.length !== 1 ? 's' : ''} across{' '}
          <span className="text-purple-700 dark:text-purple-300 font-bold text-lg">{selectedEnvCount}</span>
          {' '}sheet{selectedEnvCount !== 1 ? 's' : ''}
        </p>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
          Columns per sheet: Integration Name · Mule Version · Status · Deployment Type
        </p>
      </div>
    </Modal>
  );
}
