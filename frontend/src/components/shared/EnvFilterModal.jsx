import React, { useState, useEffect, useMemo } from 'react';
import { Check, Search, SlidersHorizontal, RefreshCw, Building2, ChevronDown } from 'lucide-react';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import CheckboxTile from '../ui/CheckboxTile';

// Import for internal use within this component
import { getVisibleEnvIds, saveVisibleEnvIds } from '../../utils/filterUtils';

// Re-export so existing callers can still import from this file
export { ENV_FILTER_KEY, getVisibleEnvIds, saveVisibleEnvIds, applyEnvFilter } from '../../utils/filterUtils';

const ENV_TYPE_COLOR = {
  production: 'bg-emerald-400',
  sandbox: 'bg-amber-400',
  design: 'bg-blue-400',
};

// ── Env row sub-item ──────────────────────────────────────────────────────────
function EnvRow({ e, isChecked, toggle, indent = 'pl-10' }) {
  const isProd = e.type === 'production';
  return (
    <label
      role="checkbox"
      aria-checked={isChecked}
      tabIndex={0}
      onClick={() => toggle(e.id)}
      onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); toggle(e.id); } }}
      className={`flex items-center gap-3 ${indent} pr-3 py-2.5 cursor-pointer transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/40 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50`}
    >
      <CheckboxTile checked={isChecked} accent={isProd ? 'emerald' : 'amber'} />
      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${ENV_TYPE_COLOR[e.type] || 'bg-gray-400'}`} />
      <span className={`text-sm flex-1 truncate ${isChecked ? 'text-gray-900 dark:text-gray-100 font-semibold' : 'text-gray-500 dark:text-gray-400 font-medium'}`}>{e.name}</span>
    </label>
  );
}

// ── Type sub-group header (Production / Sandbox) inside a BG ─────────────────
function TypeGroupHeader({ label, ids, selected, toggleGroup, accent }) {
  const allSel = ids.every(id => selected.has(id));
  const someSel = !allSel && ids.some(id => selected.has(id));
  const cls = accent === 'green'
    ? { dot: 'bg-emerald-400', text: 'text-emerald-600 dark:text-emerald-400' }
    : { dot: 'bg-amber-400', text: 'text-amber-600 dark:text-amber-400' };
  return (
    <div
      role="checkbox"
      aria-checked={allSel ? true : someSel ? 'mixed' : false}
      tabIndex={0}
      onClick={() => toggleGroup(ids)}
      onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); toggleGroup(ids); } }}
      className="flex items-center gap-2 pl-8 pr-3 py-2 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors group focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-400/50">
      <CheckboxTile checked={allSel} indeterminate={someSel} accent={accent === 'green' ? 'emerald' : 'amber'} size="sm" />
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${cls.dot}`} />
      <span className={`text-[10px] font-bold uppercase tracking-wider ${cls.text} flex-1`}>{label}</span>
      <span className="text-[9px] font-semibold text-gray-400 dark:text-gray-500 bg-gray-100 dark:bg-gray-700/60 px-1.5 py-0.5 rounded-full">{ids.length}</span>
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
    <div className="space-y-2 py-1">
      {byBg.map(({ bgId, bgName, envs }) => {
        const bgIds = envs.map(e => e.id);
        const allSel = bgIds.every(id => selected.has(id));
        const someSel = !allSel && bgIds.some(id => selected.has(id));
        const isCollapsed = collapsed.has(bgId);
        const selCount = bgIds.filter(id => selected.has(id)).length;

        const prodEnvs  = envs.filter(e => e.type === 'production');
        const otherEnvs = envs.filter(e => e.type !== 'production');

        return (
          <div key={bgId} className="rounded-2xl border border-gray-200/80 dark:border-gray-700/60 overflow-hidden mx-1 shadow-sm">
            {/* BG Header — bold, prominent */}
            <div className="flex items-center gap-2.5 px-3.5 py-3 bg-gray-50 dark:bg-gray-900/40 cursor-pointer hover:bg-gray-100/80 dark:hover:bg-gray-900/60 transition-colors group select-none">
              {/* Tri-state checkbox */}
              <CheckboxTile checked={allSel} indeterminate={someSel} accent="blue" onClick={() => toggleGroup(bgIds)} />
              {/* BG name (click = toggle collapse) */}
              <div className="flex items-center gap-2 flex-1 min-w-0" onClick={e => toggleCollapse(bgId, e)}>
                <Building2 size={13} className="text-blue-500 dark:text-blue-400 flex-shrink-0" />
                <span className="text-sm font-bold text-gray-900 dark:text-gray-100 truncate">{bgName}</span>
              </div>
              {/* count + chevron (click = toggle collapse) */}
              <div className="flex items-center gap-2 flex-shrink-0" onClick={e => toggleCollapse(bgId, e)}>
                {selCount > 0
                  ? <span className="text-[10px] font-bold text-blue-700 dark:text-blue-300 bg-blue-100 dark:bg-blue-500/20 border border-blue-300/40 dark:border-blue-400/30 px-1.5 py-0.5 rounded-full">{selCount}/{envs.length}</span>
                  : <span className="text-[10px] font-semibold text-gray-400 dark:text-gray-500">{envs.length}</span>}
                <ChevronDown size={14} className={`text-gray-400 dark:text-gray-500 transition-transform duration-200 ${isCollapsed ? '-rotate-90' : ''}`} />
              </div>
            </div>

            {/* Env rows grouped by type — hidden when BG is collapsed */}
            {!isCollapsed && (
              <div className="border-t border-gray-100 dark:border-gray-700/50 bg-white dark:bg-gray-800/40">
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
                    <div className="divide-y divide-gray-100/60 dark:divide-gray-700/30">
                      {prodEnvs.map(e => (
                        <EnvRow key={e.id} e={e} isChecked={selected.has(e.id)} toggle={toggle} indent="pl-14" />
                      ))}
                    </div>
                  </>
                )}
                {/* Sandbox/UAT/Dev sub-group */}
                {otherEnvs.length > 0 && (
                  <>
                    {prodEnvs.length > 0 && <div className="mx-4 border-t border-gray-100 dark:border-gray-700/40" />}
                    <TypeGroupHeader
                      label="Sandbox / UAT / Dev"
                      ids={otherEnvs.map(e => e.id)}
                      selected={selected}
                      toggleGroup={toggleGroup}
                      accent="yellow"
                    />
                    <div className="divide-y divide-gray-100/60 dark:divide-gray-700/30">
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
    <Modal
      onClose={onClose}
      size="sm"
      icon={SlidersHorizontal}
      accent="emerald"
      title={
        <span className="flex items-center gap-2">
          Environment Filter
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border border-emerald-200/60 dark:border-emerald-400/30">
            {selected.size} selected
          </span>
        </span>
      }
      subtitle="Choose which environments appear in dropdowns"
      bodyClassName="!px-0 !py-0 !space-y-0"
      footer={
        <>
          <button
            onClick={handleReset}
            className="flex items-center gap-1.5 text-xs font-medium text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 transition-colors"
            title="Show all environments (clear filter)"
          >
            <RefreshCw size={11} /> Reset
          </button>
          <div className="flex gap-2.5">
            <Button variant="secondary" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button
              accent="emerald"
              size="sm"
              icon={saved ? Check : SlidersHorizontal}
              onClick={handleSave}
              disabled={selected.size === 0}
            >
              {saved ? 'Saved' : `Apply Filter (${selected.size})`}
            </Button>
          </div>
        </>
      }
    >
      {/* Quick-select shortcuts */}
      <div className="flex items-center gap-2 flex-wrap px-6 py-3 border-b border-gray-100 dark:border-gray-700/60 bg-gray-50/60 dark:bg-gray-900/20">
        <span className="text-[10px] text-gray-400 dark:text-gray-500 uppercase tracking-wider font-bold flex-shrink-0">Quick:</span>
        {allProdIds.length > 0 && (
          <button onClick={() => selectByType(allProdIds)}
            className="flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-full border font-semibold bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-200/70 dark:border-emerald-400/30 hover:bg-emerald-100 dark:hover:bg-emerald-500/20 transition-colors">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> All Production ({allProdIds.length})
          </button>
        )}
        {allOtherIds.length > 0 && (
          <button onClick={() => selectByType(allOtherIds)}
            className="flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-full border font-semibold bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-200/70 dark:border-amber-400/30 hover:bg-amber-100 dark:hover:bg-amber-500/20 transition-colors">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500" /> All Sandbox ({allOtherIds.length})
          </button>
        )}
        <div className="ml-auto flex items-center gap-2.5">
          <span className="text-[11px] font-semibold text-gray-500 dark:text-gray-400">{selected.size}/{environments.length}</span>
          {selected.size > 0 && <button onClick={deselectAll} className="text-[11px] font-semibold text-red-500 dark:text-red-400 hover:text-red-600 dark:hover:text-red-300 transition-colors">Clear</button>}
        </div>
      </div>

      {/* Search */}
      <div className="px-6 pt-3 pb-3 border-b border-gray-100 dark:border-gray-700/60">
        <div className="relative">
          <Search size={13} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500 pointer-events-none" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search environments…"
            className="w-full bg-gray-50 dark:bg-gray-900/60 border border-gray-200 dark:border-gray-700 rounded-xl pl-10 pr-4 py-2.5 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:border-emerald-500 dark:focus:border-emerald-400 focus:ring-2 focus:ring-emerald-500/15 transition-all"
          />
        </div>
      </div>

      {/* List */}
      <div className="py-2 px-3">
        {filteredEnvs.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-10">
              <div className="w-10 h-10 rounded-2xl bg-gray-100 dark:bg-gray-700/50 flex items-center justify-center">
                <Search size={16} className="text-gray-400 dark:text-gray-500" />
              </div>
              <p className="text-center text-gray-500 dark:text-gray-400 text-xs">No environments found</p>
            </div>
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
                  <div
                    role="checkbox"
                    aria-checked={prodEnvs.every(e => selected.has(e.id)) ? true : prodEnvs.some(e => selected.has(e.id)) ? 'mixed' : false}
                    tabIndex={0}
                    onClick={() => toggleTypeGroup(prodEnvs.map(e => e.id))}
                    onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); toggleTypeGroup(prodEnvs.map(e => e.id)); } }}
                    className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/40 rounded-xl mx-1 transition-colors group focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50">
                    <CheckboxTile checked={prodEnvs.every(e => selected.has(e.id))} indeterminate={prodEnvs.some(e => selected.has(e.id))} accent="emerald" size="sm" />
                    <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400 flex-1">Production</p>
                    <span className="text-[9px] font-semibold text-gray-400 dark:text-gray-500 bg-gray-100 dark:bg-gray-700/60 px-1.5 py-0.5 rounded-full">{prodEnvs.length}</span>
                  </div>
                  {prodEnvs.map((e) => {
                    const isChecked = selected.has(e.id);
                    return (
                      <label
                        key={e.id}
                        role="checkbox"
                        aria-checked={isChecked}
                        tabIndex={0}
                        onClick={() => toggle(e.id)}
                        onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); toggle(e.id); } }}
                        className="flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50">
                        <CheckboxTile checked={isChecked} accent="emerald" />
                        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${ENV_TYPE_COLOR[e.type] || 'bg-gray-400'}`} />
                        <span className={`text-sm flex-1 truncate ${isChecked ? 'text-gray-900 dark:text-gray-100 font-semibold' : 'text-gray-500 dark:text-gray-400 font-medium'}`}>{e.name}</span>
                        <span className="text-[9px] bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-200/60 dark:border-emerald-400/30 px-1.5 py-0.5 rounded-full font-bold">PROD</span>
                      </label>
                    );
                  })}
                </>
              )}
              {otherEnvs.length > 0 && (
                <>
                  {prodEnvs.length > 0 && <div className="mx-3 my-1.5 border-t border-gray-100 dark:border-gray-700/50" />}
                  <div
                    role="checkbox"
                    aria-checked={otherEnvs.every(e => selected.has(e.id)) ? true : otherEnvs.some(e => selected.has(e.id)) ? 'mixed' : false}
                    tabIndex={0}
                    onClick={() => toggleTypeGroup(otherEnvs.map(e => e.id))}
                    onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); toggleTypeGroup(otherEnvs.map(e => e.id)); } }}
                    className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/40 rounded-xl mx-1 transition-colors group focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50">
                    <CheckboxTile checked={otherEnvs.every(e => selected.has(e.id))} indeterminate={otherEnvs.some(e => selected.has(e.id))} accent="amber" size="sm" />
                    <p className="text-[10px] font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400 flex-1">Sandbox / Other</p>
                    <span className="text-[9px] font-semibold text-gray-400 dark:text-gray-500 bg-gray-100 dark:bg-gray-700/60 px-1.5 py-0.5 rounded-full">{otherEnvs.length}</span>
                  </div>
                  {otherEnvs.map((e) => {
                    const isChecked = selected.has(e.id);
                    return (
                      <label
                        key={e.id}
                        role="checkbox"
                        aria-checked={isChecked}
                        tabIndex={0}
                        onClick={() => toggle(e.id)}
                        onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); toggle(e.id); } }}
                        className="flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50">
                        <CheckboxTile checked={isChecked} accent="amber" />
                        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${ENV_TYPE_COLOR[e.type] || 'bg-gray-400'}`} />
                        <span className={`text-sm flex-1 truncate ${isChecked ? 'text-gray-900 dark:text-gray-100 font-semibold' : 'text-gray-500 dark:text-gray-400 font-medium'}`}>{e.name}</span>
                        <span className="text-[9px] bg-amber-50 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-200/60 dark:border-amber-400/30 px-1.5 py-0.5 rounded-full font-bold capitalize">{e.type || 'sandbox'}</span>
                      </label>
                    );
                  })}
                </>
              )}
            </>
          )}
      </div>
    </Modal>
  );
}
