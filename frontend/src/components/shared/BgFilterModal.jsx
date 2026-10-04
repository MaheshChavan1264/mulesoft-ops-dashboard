import React, { useState, useEffect } from 'react';
import { Building2, Check, Search, SlidersHorizontal, RefreshCw } from 'lucide-react';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import CheckboxTile from '../ui/CheckboxTile';

// Import for internal use within this component
import { getVisibleBgIds, saveVisibleBgIds } from '../../utils/filterUtils';

// Re-export so existing callers can still import from this file
export { BG_FILTER_KEY, getVisibleBgIds, saveVisibleBgIds, applyBgFilter } from '../../utils/filterUtils';

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
    <Modal
      onClose={onClose}
      size="sm"
      icon={SlidersHorizontal}
      accent="blue"
      title="Business Group Filter"
      subtitle="Choose which groups to show in dropdowns"
      bodyClassName="!px-0 !py-0 !space-y-0"
      footer={
        <>
          <button
            onClick={handleReset}
            className="flex items-center gap-1.5 text-xs font-medium text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 transition-colors"
            title="Show all business groups (clear filter)"
          >
            <RefreshCw size={11} /> Reset
          </button>
          <div className="flex gap-2.5">
            <Button variant="secondary" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button
              accent="blue"
              size="sm"
              icon={saved ? Check : SlidersHorizontal}
              onClick={handleSave}
              disabled={selected.size === 0}
            >
              {saved ? 'Saved' : 'Apply Filter'}
            </Button>
          </div>
        </>
      }
    >
      {/* Search + Select All */}
      <div className="px-6 pt-4 pb-3 border-b border-gray-100 dark:border-gray-700/60 space-y-3">
        <div className="relative">
          <Search size={13} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500 pointer-events-none" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search business groups…"
            className="w-full bg-gray-50 dark:bg-gray-900/60 border border-gray-200 dark:border-gray-700 rounded-xl pl-10 pr-4 py-2.5 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:border-blue-500 dark:focus:border-blue-400 focus:ring-2 focus:ring-blue-500/15 transition-all"
          />
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
            <span className="text-gray-900 dark:text-gray-100 font-bold">{selected.size}</span> of {businessGroups.length} selected
          </span>
          <div className="flex items-center gap-1 bg-gray-100 dark:bg-gray-900/60 rounded-lg p-0.5">
            <button onClick={selectAll} className="text-[11px] font-semibold px-2 py-1 rounded-md text-blue-600 dark:text-blue-400 hover:bg-white dark:hover:bg-gray-800 transition-colors">All</button>
            <button onClick={deselectAll} className="text-[11px] font-semibold px-2 py-1 rounded-md text-gray-500 dark:text-gray-400 hover:bg-white dark:hover:bg-gray-800 transition-colors">None</button>
          </div>
        </div>
      </div>

      {/* List */}
      <div className="max-h-[50vh] overflow-y-auto py-2 px-3">
        {filteredOrdered.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-10">
            <div className="w-10 h-10 rounded-2xl bg-gray-100 dark:bg-gray-700/50 flex items-center justify-center">
              <Search size={16} className="text-gray-400 dark:text-gray-500" />
            </div>
            <p className="text-center text-gray-500 dark:text-gray-400 text-xs">No groups found</p>
          </div>
        ) : filteredOrdered.map((g) => {
          const isChecked = selected.has(g.id);
          const isRoot = !g.parentId;
          return (
            <label
              key={g.id}
              role="checkbox"
              aria-checked={isChecked}
              tabIndex={0}
              onClick={() => toggle(g.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  toggle(g.id);
                }
              }}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 ${g.parentId ? 'ml-4' : ''}`}
            >
              {/* Custom checkbox (decorative — the label above carries the checkbox semantics) */}
              <CheckboxTile checked={isChecked} accent="blue" />
              <Building2 size={14} className={isChecked ? 'text-blue-600 dark:text-blue-400' : 'text-gray-400 dark:text-gray-500'} />
              <span className={`text-sm flex-1 truncate ${isChecked ? 'text-gray-900 dark:text-gray-100 font-semibold' : 'text-gray-500 dark:text-gray-400 font-medium'}`}>
                {g.name}
              </span>
              {isRoot && (
                <span className="text-[9px] bg-blue-50 dark:bg-blue-500/15 text-blue-600 dark:text-blue-300 border border-blue-200/60 dark:border-blue-400/30 px-1.5 py-0.5 rounded-full font-bold">ROOT</span>
              )}
            </label>
          );
        })}
      </div>
    </Modal>
  );
}
