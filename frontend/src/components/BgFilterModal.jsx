import React, { useState, useEffect } from 'react';
import { X, Building2, Check, Search, SlidersHorizontal, RefreshCw } from 'lucide-react';

// Re-export filter utilities from the canonical location.
// BgFilterModal is a UI component — the utility functions live in filterUtils.js.
export {
  BG_FILTER_KEY,
  getVisibleBgIds,
  saveVisibleBgIds,
  applyBgFilter,
} from '../utils/filterUtils';

export default function BgFilterModal({ businessGroups = [], onClose, onSaved }) {
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(new Set());
  const [saved, setSaved] = useState(false);

  // Initialise from localStorage
  useEffect(() => {
    const current = getVisibleBgIds();
    if (current.size > 0) {
      setSelected(current);
    } else {
      // "all selected" by default if no filter is saved
      setSelected(new Set(businessGroups.map((g) => g.id)));
    }
  }, [businessGroups]);

  const filtered = businessGroups.filter((g) =>
    !search || g.name.toLowerCase().includes(search.toLowerCase())
  );

  const toggle = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const selectAll = () => setSelected(new Set(businessGroups.map((g) => g.id)));
  const deselectAll = () => setSelected(new Set());

  const handleSave = () => {
    // If all are selected → clear filter (show all)
    const allSelected = selected.size === businessGroups.length;
    saveVisibleBgIds(allSelected ? new Set() : selected);
    setSaved(true);
    setTimeout(() => {
      onSaved?.();
      onClose();
    }, 600);
  };

  const handleReset = () => {
    saveVisibleBgIds(new Set());
    setSelected(new Set(businessGroups.map((g) => g.id)));
    onSaved?.();
    onClose();
  };

  const root = businessGroups.find((g) => !g.parentId);
  const children = businessGroups.filter((g) => g.parentId);
  const orderedGroups = root ? [root, ...children] : businessGroups;
  const filteredOrdered = orderedGroups.filter((g) =>
    !search || g.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-md shadow-2xl mx-4 flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-blue-950/50 border border-blue-800/40">
              <SlidersHorizontal size={14} className="text-blue-400" />
            </div>
            <div>
              <h2 className="text-white font-semibold text-sm">Business Group Filter</h2>
              <p className="text-gray-500 text-xs mt-0.5">Choose which groups to show in dropdowns</p>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-600 hover:text-gray-300 p-1">
            <X size={16} />
          </button>
        </div>

        {/* Search + Select All */}
        <div className="px-5 pt-4 pb-3 border-b border-gray-800 space-y-2.5">
          <div className="relative">
            <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search business groups…"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg pl-8 pr-4 py-2 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
            />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-500">
              {selected.size} of {businessGroups.length} selected
            </span>
            <div className="flex gap-2">
              <button onClick={selectAll} className="text-xs text-blue-400 hover:text-blue-300">Select all</button>
              <span className="text-gray-700">·</span>
              <button onClick={deselectAll} className="text-xs text-gray-500 hover:text-gray-300">Clear all</button>
            </div>
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto py-2 px-2">
          {filteredOrdered.length === 0 ? (
            <p className="text-center text-gray-600 text-xs py-6">No groups found</p>
          ) : filteredOrdered.map((g) => {
            const isChecked = selected.has(g.id);
            const isRoot = !g.parentId;
            return (
              <label
                key={g.id}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer transition-colors ${
                  isChecked ? 'bg-blue-950/20' : 'hover:bg-gray-800/60'
                } ${g.parentId ? 'ml-4' : ''}`}
              >
                {/* Custom checkbox */}
                <div
                  onClick={() => toggle(g.id)}
                  className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 transition-colors ${
                    isChecked ? 'bg-blue-600 border-blue-500' : 'border-gray-600 hover:border-blue-500'
                  }`}
                >
                  {isChecked && <Check size={10} className="text-white" />}
                </div>
                <Building2 size={13} className={isChecked ? 'text-blue-400' : 'text-gray-600'} />
                <span className={`text-xs font-medium flex-1 ${isChecked ? 'text-white' : 'text-gray-400'}`}>
                  {g.name}
                </span>
                {isRoot && (
                  <span className="text-[9px] bg-blue-500/20 text-blue-400 border border-blue-500/30 px-1.5 py-0.5 rounded-full font-semibold">ROOT</span>
                )}
              </label>
            );
          })}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-4 border-t border-gray-800 gap-3">
          <button
            onClick={handleReset}
            className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-300 transition-colors"
            title="Show all business groups (clear filter)"
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
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white rounded-lg disabled:opacity-50 transition-colors"
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