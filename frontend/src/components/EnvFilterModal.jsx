import React, { useState, useEffect, useMemo } from 'react';
import { X, Check, Search, SlidersHorizontal, RefreshCw, Building2, ChevronDown } from 'lucide-react';

// Import for internal use within this component
import { getVisibleEnvIds, saveVisibleEnvIds } from '../utils/filterUtils';

// Re-export so existing callers can still import from this file
export { ENV_FILTER_KEY, getVisibleEnvIds, saveVisibleEnvIds, applyEnvFilter } from '../utils/filterUtils';

const ENV_TYPE_COLOR = {
  production: 'bg-green-400',
  sandbox: 'bg-yellow-400',
  design: 'bg-blue-400',
};

// ── Env row sub-item ──────────────────────────────────────────────────────────
function EnvRow({ e, isChecked, toggle, indent = 'pl-10' }) {
  const isProd = e.type === 'production';
  return (
    <label
      className={`flex items-center gap-3 ${indent} pr-3 py-2 cursor-pointer transition-colors hover:bg-gray-100/40 dark:hover:bg-gray-800/40`}
    >
      <div
        onClick={() => toggle(e.id)}
        className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 transition-colors ${
          isChecked
            ? (isProd ? 'bg-green-500 border-green-400' : 'bg-yellow-600 border-yellow-500')
            : 'border-gray-300 dark:border-gray-600 hover:border-green-500'
        }`}
      >
        {isChecked && <Check size={10} className="text-white" />}
      </div>
      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${ENV_TYPE_COLOR[e.type] || 'bg-gray-400'}`} />
      <span className={`text-xs flex-1 ${isChecked ? 'text-gray-900 dark:text-gray-100 font-medium' : 'text-gray-500 dark:text-gray-400'}`}>{e.name}</span>
    </label>
  );
}

// ── Type sub-group header (Production / Sandbox) inside a BG ─────────────────
function TypeGroupHeader({ label, ids, selected, toggleGroup, accent }) {
  const allSel = ids.every(id => selected.has(id));
  const someSel = !allSel && ids.some(id => selected.has(id));
  const cls = accent === 'green'
    ? { dot: 'bg-green-400', text: 'text-green-500/80 dark:text-green-400/90', check: 'bg-green-500 border-green-400', ind: 'bg-green-100/60 dark:bg-green-500/20 border-green-300 dark:border-green-400/40', hover: 'hover:border-green-500' }
    : { dot: 'bg-yellow-400', text: 'text-yellow-500/80 dark:text-yellow-400/90', check: 'bg-yellow-600 border-yellow-500', ind: 'bg-yellow-100/60 dark:bg-yellow-500/20 border-yellow-300 dark:border-yellow-400/40', hover: 'hover:border-yellow-500' };
  return (
    <div onClick={() => toggleGroup(ids)}
      className="flex items-center gap-2 pl-8 pr-3 py-1.5 cursor-pointer hover:bg-gray-100/30 dark:hover:bg-gray-800/40 transition-colors group">
      <div className={`w-3.5 h-3.5 rounded border flex items-center justify-center flex-shrink-0 transition-colors ${
        allSel ? cls.check : someSel ? cls.ind : `border-gray-300 dark:border-gray-600 ${cls.hover}`
      }`}>
        {allSel  && <Check size={8} className="text-white" />}
        {someSel && <span className="text-[8px] font-bold leading-none" style={{ color: accent === 'green' ? '#4ade80' : '#facc15' }}>–</span>}
      </div>
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${cls.dot}`} />
      <span className={`text-[10px] font-bold uppercase tracking-wider ${cls.text} flex-1`}>{label}</span>
      <span className="text-[9px] text-gray-500 dark:text-gray-400">{ids.length}</span>
    </div>
  );
}

// ── BG-grouped collapsible list ───────────────────────────────────────────────
function BgGroupedList({ byBg, selected, toggle, toggleGroup }) {
  const [collapsed, setCollapsed] = useState(new Set());

  const toggleCollapse = (bgId, e) => {
    e.stopPropagation();
    setCollapsed(prev => {
      const n = new Set(prev);
      n.has(bgId) ? n.delete(bgId) : n.add(bgId);
      return n;
    });
  };

  return (
    <div className="space-y-1.5 py-1">
      {byBg.map(({ bgId, bgName, envs }) => {
        const bgIds = envs.map(e => e.id);
        const allSel = bgIds.every(id => selected.has(id));
        const someSel = !allSel && bgIds.some(id => selected.has(id));
        const isCollapsed = collapsed.has(bgId);
        const selCount = bgIds.filter(id => selected.has(id)).length;

        const prodEnvs  = envs.filter(e => e.type === 'production');
        const otherEnvs = envs.filter(e => e.type !== 'production');

        return (
          <div key={bgId} className="rounded-xl border border-gray-200/60 dark:border-gray-700/60 overflow-hidden mx-1">
            {/* BG Header — bold, prominent */}
            <div className="flex items-center gap-2.5 px-3 py-2.5 bg-gray-100/50 dark:bg-gray-800/50 cursor-pointer hover:bg-gray-100/80 dark:hover:bg-gray-800/80 transition-colors group select-none">
              {/* Tri-state checkbox */}
              <div onClick={() => toggleGroup(bgIds)}
                className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 transition-colors ${
                  allSel  ? 'bg-blue-500 border-blue-400' :
                  someSel ? 'bg-blue-100/60 dark:bg-blue-500/20 border-blue-300 dark:border-blue-400/40' :
                  'border-gray-300 dark:border-gray-600 group-hover:border-blue-500'
                }`}>
                {allSel  && <Check size={9} className="text-white" />}
                {someSel && <span className="text-blue-600 dark:text-blue-400 text-[8px] font-bold leading-none">–</span>}
              </div>
              {/* BG name (click = toggle collapse) */}
              <div className="flex items-center gap-1.5 flex-1 min-w-0" onClick={e => toggleCollapse(bgId, e)}>
                <Building2 size={12} className="text-blue-600/70 dark:text-blue-400/80 flex-shrink-0" />
                <span className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">{bgName}</span>
              </div>
              {/* count + chevron (click = toggle collapse) */}
              <div className="flex items-center gap-2 flex-shrink-0" onClick={e => toggleCollapse(bgId, e)}>
                {selCount > 0
                  ? <span className="text-[10px] font-bold text-blue-700 dark:text-blue-300 bg-blue-100 dark:bg-blue-500/20 border border-blue-300/40 dark:border-blue-400/30 px-1.5 py-0.5 rounded-full">{selCount}/{envs.length}</span>
                  : <span className="text-[10px] text-gray-500 dark:text-gray-400">{envs.length}</span>}
                <ChevronDown size={13} className={`text-gray-500 dark:text-gray-400 transition-transform duration-200 ${isCollapsed ? '-rotate-90' : ''}`} />
              </div>
            </div>

            {/* Env rows grouped by type — hidden when BG is collapsed */}
            {!isCollapsed && (
              <div className="border-t border-gray-200/40 dark:border-gray-700/40">
                {/* Production sub-group */}
                {prodEnvs.length > 0 && (
                  <>
                    <TypeGroupHeader
                      label="Production"
                      ids={prodEnvs.map(e => e.id)}
                      selected={selected}
                      toggleGroup={toggleGroup}
                      accent="green"
                    />
                    <div className="divide-y divide-gray-200/20 dark:divide-gray-700/40">
                      {prodEnvs.map(e => (
                        <EnvRow key={e.id} e={e} isChecked={selected.has(e.id)} toggle={toggle} indent="pl-14" />
                      ))}
                    </div>
                  </>
                )}
                {/* Sandbox/UAT/Dev sub-group */}
                {otherEnvs.length > 0 && (
                  <>
                    {prodEnvs.length > 0 && <div className="mx-4 border-t border-gray-200/40 dark:border-gray-700/40" />}
                    <TypeGroupHeader
                      label="Sandbox / UAT / Dev"
                      ids={otherEnvs.map(e => e.id)}
                      selected={selected}
                      toggleGroup={toggleGroup}
                      accent="yellow"
                    />
                    <div className="divide-y divide-gray-200/20 dark:divide-gray-700/40">
                      {otherEnvs.map(e => (
                        <EnvRow key={e.id} e={e} isChecked={selected.has(e.id)} toggle={toggle} indent="pl-14" />
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function EnvFilterModal({ environments = [], onClose, onSaved }) {
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(new Set());
  const [saved, setSaved] = useState(false);

  // Initialise from localStorage
  useEffect(() => {
    const current = getVisibleEnvIds();
    if (current.size > 0) {
      setSelected(current);
    } else {
      // "all selected" by default if no filter is saved
      setSelected(new Set(environments.map((e) => e.id)));
    }
  }, [environments]);

  const filteredEnvs = environments.filter((e) =>
    !search ||
    e.name.toLowerCase().includes(search.toLowerCase()) ||
    (e.type || '').toLowerCase().includes(search.toLowerCase())
  );

  const toggle = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const selectAll = () => setSelected(new Set(environments.map((e) => e.id)));
  const deselectAll = () => setSelected(new Set());

  // Detect if envs carry BG context (new format from Header)
  const hasBgContext = environments.some(e => e.bgId);

  // Group by BG when context is available, otherwise group by type
  const byBg = useMemo(() => {
    if (!hasBgContext) return null;
    const map = new Map();
    filteredEnvs.forEach(e => {
      if (!map.has(e.bgId)) map.set(e.bgId, { bgId: e.bgId, bgName: e.bgName || e.bgId, envs: [] });
      map.get(e.bgId).envs.push(e);
    });
    return [...map.values()];
  }, [filteredEnvs, hasBgContext]);

  // Flat type-based groups (legacy / no-BG-context path)
  const prodEnvs = filteredEnvs.filter((e) => e.type === 'production');
  const otherEnvs = filteredEnvs.filter((e) => e.type !== 'production');

  // All prod / all sandbox from the full list (not just filtered)
  const allProdIds = environments.filter(e => e.type === 'production').map(e => e.id);
  const allOtherIds = environments.filter(e => e.type !== 'production').map(e => e.id);

  const selectByType = (ids) =>
    setSelected(prev => { const n = new Set(prev); ids.forEach(id => n.add(id)); return n; });

  const toggleGroup = (ids) => {
    const allSel = ids.every(id => selected.has(id));
    setSelected(prev => {
      const n = new Set(prev);
      if (allSel) ids.forEach(id => n.delete(id));
      else ids.forEach(id => n.add(id));
      return n;
    });
  };

  // Keep old name as alias for the non-BG path
  const toggleTypeGroup = toggleGroup;

  const handleSave = () => {
    // If all are selected → clear filter (show all)
    const allSelected = selected.size === environments.length;
    saveVisibleEnvIds(allSelected ? new Set() : selected);
    setSaved(true);
    setTimeout(() => {
      onSaved?.();
      onClose();
    }, 600);
  };

  const handleReset = () => {
    saveVisibleEnvIds(new Set());
    setSelected(new Set(environments.map((e) => e.id)));
    onSaved?.();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-2xl w-full max-w-md shadow-2xl mx-4 flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-green-50/50 dark:bg-green-500/10 border border-green-200/40 dark:border-green-400/30">
              <SlidersHorizontal size={14} className="text-green-600 dark:text-green-400" />
            </div>
            <div>
              <h2 className="text-gray-900 dark:text-gray-100 font-semibold text-sm">Environment Filter</h2>
              <p className="text-gray-500 dark:text-gray-400 text-xs mt-0.5">Choose which environments appear in dropdowns</p>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 p-1">
            <X size={16} />
          </button>
        </div>

        {/* Quick-select shortcuts */}
        <div className="flex items-center gap-2 flex-wrap px-5 py-2.5 border-b border-gray-200 dark:border-gray-700 bg-gray-100/20 dark:bg-gray-800/20">
          <span className="text-[9px] text-gray-500 dark:text-gray-400 uppercase tracking-wider font-bold flex-shrink-0">Quick select:</span>
          {allProdIds.length > 0 && (
            <button onClick={() => selectByType(allProdIds)}
              className="flex items-center gap-1 text-[10px] px-2.5 py-0.5 rounded-full border bg-green-50/40 dark:bg-green-500/10 text-green-600 dark:text-green-400 border-green-200/50 dark:border-green-400/30 hover:bg-green-50/70 dark:hover:bg-green-500/20 transition-colors font-medium">
              ● All Production ({allProdIds.length})
            </button>
          )}
          {allOtherIds.length > 0 && (
            <button onClick={() => selectByType(allOtherIds)}
              className="flex items-center gap-1 text-[10px] px-2.5 py-0.5 rounded-full border bg-yellow-50/40 dark:bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border-yellow-200/50 dark:border-yellow-400/30 hover:bg-yellow-50/70 dark:hover:bg-yellow-500/20 transition-colors font-medium">
              ● All Sandbox ({allOtherIds.length})
            </button>
          )}
          <div className="ml-auto flex items-center gap-2">
            <span className="text-[10px] text-gray-500 dark:text-gray-400">{selected.size}/{environments.length}</span>
            {selected.size > 0 && <button onClick={deselectAll} className="text-[10px] text-red-500/70 dark:text-red-400/80 hover:text-red-600 dark:hover:text-red-400 transition-colors">Clear</button>}
          </div>
        </div>

        {/* Search */}
        <div className="px-5 pt-3 pb-3 border-b border-gray-200 dark:border-gray-700 space-y-2.5">
          <div className="relative">
            <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 dark:text-gray-400 pointer-events-none" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search environments…"
              className="w-full bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg pl-8 pr-4 py-2 text-xs text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:border-green-500"
            />
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto py-2 px-2">
          {filteredEnvs.length === 0 ? (
            <p className="text-center text-gray-500 dark:text-gray-400 text-xs py-6">No environments found</p>
          ) : hasBgContext && byBg ? (
            /* ── BG-grouped collapsible view ── */
            <BgGroupedList
              byBg={byBg}
              selected={selected}
              toggle={toggle}
              toggleGroup={toggleGroup}
            />
          ) : (
            /* ── Type-grouped view (fallback when no BG context) ── */
            <>
              {prodEnvs.length > 0 && (
                <>
                  <div onClick={() => toggleTypeGroup(prodEnvs.map(e => e.id))}
                    className="flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-gray-100/50 dark:hover:bg-gray-800/50 rounded-lg mx-1 transition-colors group">
                    <div className={`w-3.5 h-3.5 rounded border flex items-center justify-center flex-shrink-0 transition-colors ${
                      prodEnvs.every(e => selected.has(e.id)) ? 'bg-green-500 border-green-400' :
                      prodEnvs.some(e => selected.has(e.id)) ? 'bg-green-100/60 dark:bg-green-500/20 border-green-300 dark:border-green-400/40' :
                      'border-gray-300 dark:border-gray-600 group-hover:border-green-500'
                    }`}>
                      {prodEnvs.every(e => selected.has(e.id)) && <Check size={8} className="text-white" />}
                      {!prodEnvs.every(e => selected.has(e.id)) && prodEnvs.some(e => selected.has(e.id)) && <span className="text-green-600 dark:text-green-400 text-[8px] font-bold leading-none">–</span>}
                    </div>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-green-500/70 dark:text-green-400/80 flex-1">Production</p>
                    <span className="text-[9px] text-gray-500 dark:text-gray-400">{prodEnvs.length}</span>
                  </div>
                  {prodEnvs.map((e) => {
                    const isChecked = selected.has(e.id);
                    return (
                      <label key={e.id} className="flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer transition-colors hover:bg-gray-100/60 dark:hover:bg-gray-800/60">
                        <div onClick={() => toggle(e.id)} className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 transition-colors ${isChecked ? 'bg-green-500 border-green-400' : 'border-gray-300 dark:border-gray-600 hover:border-green-500'}`}>
                          {isChecked && <Check size={10} className="text-white" />}
                        </div>
                        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${ENV_TYPE_COLOR[e.type] || 'bg-gray-400'}`} />
                        <span className={`text-xs font-medium flex-1 ${isChecked ? 'text-gray-900 dark:text-gray-100' : 'text-gray-500 dark:text-gray-400'}`}>{e.name}</span>
                        <span className="text-[9px] bg-green-100 dark:bg-green-500/20 text-green-600 dark:text-green-300 border border-green-200 dark:border-green-400/30 px-1.5 py-0.5 rounded-full font-semibold">PROD</span>
                      </label>
                    );
                  })}
                </>
              )}
              {otherEnvs.length > 0 && (
                <>
                  {prodEnvs.length > 0 && <div className="mx-3 my-1 border-t border-gray-200/60 dark:border-gray-700/60" />}
                  <div onClick={() => toggleTypeGroup(otherEnvs.map(e => e.id))}
                    className="flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-gray-100/50 dark:hover:bg-gray-800/50 rounded-lg mx-1 transition-colors group">
                    <div className={`w-3.5 h-3.5 rounded border flex items-center justify-center flex-shrink-0 transition-colors ${
                      otherEnvs.every(e => selected.has(e.id)) ? 'bg-yellow-600 border-yellow-500' :
                      otherEnvs.some(e => selected.has(e.id)) ? 'bg-yellow-100/60 dark:bg-yellow-500/20 border-yellow-300 dark:border-yellow-400/40' :
                      'border-gray-300 dark:border-gray-600 group-hover:border-yellow-500'
                    }`}>
                      {otherEnvs.every(e => selected.has(e.id)) && <Check size={8} className="text-white" />}
                      {!otherEnvs.every(e => selected.has(e.id)) && otherEnvs.some(e => selected.has(e.id)) && <span className="text-yellow-600 dark:text-yellow-400 text-[8px] font-bold leading-none">–</span>}
                    </div>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-yellow-500/70 dark:text-yellow-400/80 flex-1">Sandbox / Other</p>
                    <span className="text-[9px] text-gray-500 dark:text-gray-400">{otherEnvs.length}</span>
                  </div>
                  {otherEnvs.map((e) => {
                    const isChecked = selected.has(e.id);
                    return (
                      <label key={e.id} className="flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer transition-colors hover:bg-gray-100/60 dark:hover:bg-gray-800/60">
                        <div onClick={() => toggle(e.id)} className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 transition-colors ${isChecked ? 'bg-yellow-600 border-yellow-500' : 'border-gray-300 dark:border-gray-600 hover:border-yellow-500'}`}>
                          {isChecked && <Check size={10} className="text-white" />}
                        </div>
                        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${ENV_TYPE_COLOR[e.type] || 'bg-gray-400'}`} />
                        <span className={`text-xs font-medium flex-1 ${isChecked ? 'text-gray-900 dark:text-gray-100' : 'text-gray-500 dark:text-gray-400'}`}>{e.name}</span>
                        <span className="text-[9px] bg-yellow-100 dark:bg-yellow-500/20 text-yellow-600 dark:text-yellow-300 border border-yellow-200 dark:border-yellow-400/30 px-1.5 py-0.5 rounded-full font-semibold capitalize">{e.type || 'sandbox'}</span>
                      </label>
                    );
                  })}
                </>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-4 border-t border-gray-200 dark:border-gray-700 gap-3">
          <button
            onClick={handleReset}
            className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 transition-colors"
            title="Show all environments (clear filter)"
          >
            <RefreshCw size={11} /> Reset (show all)
          </button>
          <div className="flex gap-3">
            <button onClick={onClose}
              className="px-4 py-2 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg transition-colors">
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={selected.size === 0}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-green-700 hover:bg-green-600 text-white rounded-lg disabled:opacity-50 transition-colors"
            >
              {saved
                ? <><Check size={13} /> Saved</>
                : <><SlidersHorizontal size={13} /> Apply Filter</>}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}