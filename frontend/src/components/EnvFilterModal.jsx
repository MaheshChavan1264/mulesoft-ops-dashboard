import React, { useState, useEffect } from 'react';
import { X, Check, Search, SlidersHorizontal, RefreshCw } from 'lucide-react';

// Import for internal use within this component
import { getVisibleEnvIds, saveVisibleEnvIds } from '../utils/filterUtils';

// Re-export so existing callers can still import from this file
export { ENV_FILTER_KEY, getVisibleEnvIds, saveVisibleEnvIds, applyEnvFilter } from '../utils/filterUtils';

const ENV_TYPE_COLOR = {
  production: 'bg-green-400',
  sandbox: 'bg-yellow-400',
  design: 'bg-blue-400',
};

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

  // Group by type for display
  const prodEnvs = filteredEnvs.filter((e) => e.type === 'production');
  const otherEnvs = filteredEnvs.filter((e) => e.type !== 'production');

  // All prod / all sandbox from the full list (not just filtered)
  const allProdIds = environments.filter(e => e.type === 'production').map(e => e.id);
  const allOtherIds = environments.filter(e => e.type !== 'production').map(e => e.id);

  const selectByType = (ids) =>
    setSelected(prev => { const n = new Set(prev); ids.forEach(id => n.add(id)); return n; });

  const toggleTypeGroup = (ids) => {
    const allSel = ids.every(id => selected.has(id));
    setSelected(prev => {
      const n = new Set(prev);
      if (allSel) ids.forEach(id => n.delete(id));
      else ids.forEach(id => n.add(id));
      return n;
    });
  };

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
      <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-md shadow-2xl mx-4 flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-green-950/50 border border-green-800/40">
              <SlidersHorizontal size={14} className="text-green-400" />
            </div>
            <div>
              <h2 className="text-white font-semibold text-sm">Environment Filter</h2>
              <p className="text-gray-500 text-xs mt-0.5">Choose which environments appear in dropdowns</p>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-600 hover:text-gray-300 p-1">
            <X size={16} />
          </button>
        </div>

        {/* Quick-select shortcuts */}
        <div className="flex items-center gap-2 flex-wrap px-5 py-2.5 border-b border-gray-800 bg-gray-800/20">
          <span className="text-[9px] text-gray-600 uppercase tracking-wider font-bold flex-shrink-0">Quick select:</span>
          {allProdIds.length > 0 && (
            <button onClick={() => selectByType(allProdIds)}
              className="flex items-center gap-1 text-[10px] px-2.5 py-0.5 rounded-full border bg-green-950/40 text-green-400 border-green-800/50 hover:bg-green-950/70 transition-colors font-medium">
              ● All Production ({allProdIds.length})
            </button>
          )}
          {allOtherIds.length > 0 && (
            <button onClick={() => selectByType(allOtherIds)}
              className="flex items-center gap-1 text-[10px] px-2.5 py-0.5 rounded-full border bg-yellow-950/40 text-yellow-400 border-yellow-800/50 hover:bg-yellow-950/70 transition-colors font-medium">
              ● All Sandbox ({allOtherIds.length})
            </button>
          )}
          <div className="ml-auto flex items-center gap-2">
            <span className="text-[10px] text-gray-500">{selected.size}/{environments.length}</span>
            {selected.size > 0 && <button onClick={deselectAll} className="text-[10px] text-red-500/70 hover:text-red-400 transition-colors">Clear</button>}
          </div>
        </div>

        {/* Search */}
        <div className="px-5 pt-3 pb-3 border-b border-gray-800 space-y-2.5">
          <div className="relative">
            <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search environments…"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg pl-8 pr-4 py-2 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-green-500"
            />
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto py-2 px-2">
          {filteredEnvs.length === 0 ? (
            <p className="text-center text-gray-600 text-xs py-6">No environments found</p>
          ) : (
            <>
              {/* Production environments */}
              {prodEnvs.length > 0 && (
                <>
                  {/* Clickable group header — toggles all prod envs */}
                  <div
                    onClick={() => toggleTypeGroup(prodEnvs.map(e => e.id))}
                    className="flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-gray-800/50 rounded-lg mx-1 transition-colors group"
                  >
                    <div className={`w-3.5 h-3.5 rounded border flex items-center justify-center flex-shrink-0 transition-colors ${
                      prodEnvs.every(e => selected.has(e.id)) ? 'bg-green-600 border-green-500' :
                      prodEnvs.some(e => selected.has(e.id)) ? 'bg-green-900/60 border-green-600' :
                      'border-gray-600 group-hover:border-green-500'
                    }`}>
                      {prodEnvs.every(e => selected.has(e.id)) && <Check size={8} className="text-white" />}
                      {!prodEnvs.every(e => selected.has(e.id)) && prodEnvs.some(e => selected.has(e.id)) && <span className="text-green-400 text-[8px] font-bold leading-none">–</span>}
                    </div>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-green-500/70 flex-1">
                      Production
                    </p>
                    <span className="text-[9px] text-gray-600">{prodEnvs.length}</span>
                  </div>
                  {prodEnvs.map((e) => {
                    const isChecked = selected.has(e.id);
                    return (
                      <label
                        key={e.id}
                        className={`flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer transition-colors ${
                          isChecked ? 'bg-green-950/20' : 'hover:bg-gray-800/60'
                        }`}
                      >
                        <div
                          onClick={() => toggle(e.id)}
                          className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 transition-colors ${
                            isChecked ? 'bg-green-600 border-green-500' : 'border-gray-600 hover:border-green-500'
                          }`}
                        >
                          {isChecked && <Check size={10} className="text-white" />}
                        </div>
                        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${ENV_TYPE_COLOR[e.type] || 'bg-gray-400'}`} />
                        <span className={`text-xs font-medium flex-1 ${isChecked ? 'text-white' : 'text-gray-400'}`}>
                          {e.name}
                        </span>
                        <span className="text-[9px] bg-green-500/20 text-green-400 border border-green-500/30 px-1.5 py-0.5 rounded-full font-semibold">
                          PROD
                        </span>
                      </label>
                    );
                  })}
                </>
              )}

              {/* Non-production environments */}
              {otherEnvs.length > 0 && (
                <>
                  {prodEnvs.length > 0 && <div className="mx-3 my-1 border-t border-gray-800/60" />}
                  {/* Clickable group header — toggles all sandbox envs */}
                  <div
                    onClick={() => toggleTypeGroup(otherEnvs.map(e => e.id))}
                    className="flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-gray-800/50 rounded-lg mx-1 transition-colors group"
                  >
                    <div className={`w-3.5 h-3.5 rounded border flex items-center justify-center flex-shrink-0 transition-colors ${
                      otherEnvs.every(e => selected.has(e.id)) ? 'bg-yellow-600 border-yellow-500' :
                      otherEnvs.some(e => selected.has(e.id)) ? 'bg-yellow-900/60 border-yellow-600' :
                      'border-gray-600 group-hover:border-yellow-500'
                    }`}>
                      {otherEnvs.every(e => selected.has(e.id)) && <Check size={8} className="text-white" />}
                      {!otherEnvs.every(e => selected.has(e.id)) && otherEnvs.some(e => selected.has(e.id)) && <span className="text-yellow-400 text-[8px] font-bold leading-none">–</span>}
                    </div>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-yellow-500/70 flex-1">
                      Sandbox / Other
                    </p>
                    <span className="text-[9px] text-gray-600">{otherEnvs.length}</span>
                  </div>
                  {otherEnvs.map((e) => {
                    const isChecked = selected.has(e.id);
                    return (
                      <label
                        key={e.id}
                        className={`flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer transition-colors ${
                          isChecked ? 'bg-yellow-950/10' : 'hover:bg-gray-800/60'
                        }`}
                      >
                        <div
                          onClick={() => toggle(e.id)}
                          className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 transition-colors ${
                            isChecked ? 'bg-yellow-600 border-yellow-500' : 'border-gray-600 hover:border-yellow-500'
                          }`}
                        >
                          {isChecked && <Check size={10} className="text-white" />}
                        </div>
                        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${ENV_TYPE_COLOR[e.type] || 'bg-gray-400'}`} />
                        <span className={`text-xs font-medium flex-1 ${isChecked ? 'text-white' : 'text-gray-400'}`}>
                          {e.name}
                        </span>
                        <span className="text-[9px] bg-yellow-500/20 text-yellow-400 border border-yellow-500/30 px-1.5 py-0.5 rounded-full font-semibold capitalize">
                          {e.type || 'sandbox'}
                        </span>
                      </label>
                    );
                  })}
                </>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-4 border-t border-gray-800 gap-3">
          <button
            onClick={handleReset}
            className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-300 transition-colors"
            title="Show all environments (clear filter)"
          >
            <RefreshCw size={11} /> Reset (show all)
          </button>
          <div className="flex gap-3">
            <button onClick={onClose}
              className="px-4 py-2 text-sm text-gray-400 hover:text-white bg-gray-800 hover:bg-gray-700 rounded-lg transition-colors">
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