import React, { useMemo } from 'react';
import { Plus, Search, X } from 'lucide-react';

const ACCENT = {
  blue: {
    label: 'text-blue-600',
    badge: 'bg-blue-100',
    row: 'bg-blue-50/20 border-blue-200/30',
    searchFocus: 'focus:border-blue-300/40',
    addBtn: 'bg-blue-100 border-blue-300/40 text-blue-700 hover:bg-blue-600/30',
    addFocus: 'focus:border-blue-300/50',
  },
  purple: {
    label: 'text-purple-600',
    badge: 'bg-purple-100',
    row: 'bg-purple-50/20 border-purple-200/30',
    searchFocus: 'focus:border-purple-300/40',
    addBtn: 'bg-purple-100 border-purple-300/40 text-purple-700 hover:bg-purple-600/30',
    addFocus: 'focus:border-purple-300/50',
  },
};

/**
 * ClientIdList
 *
 * Searchable, editable list of client IDs (add / remove / filter) — extracted
 * from the ~95%-identical "Allowed ClientIds" / "Read-Only ClientIds" blocks
 * in CpsAuthPanel, which only differed by accent color and copy — see
 * FRONTEND_ARCHITECTURE_REVIEW.md finding "<ClientIdList>".
 *
 * Props:
 *   title           {string}  label shown above the list, e.g. "Allowed ClientIds (read + write)"
 *   accent          {string}  'blue' | 'purple'
 *   ids             {string[]} current client IDs
 *   onAdd           {(id: string) => void}
 *   onRemove        {(id: string) => void}
 *   search          {string}
 *   setSearch       {(v: string) => void}
 *   emptyLabel      {string}  shown when `ids` is empty
 *   searchPlaceholder {string}
 *   addPlaceholder  {string}
 *   note            {ReactNode} optional small suffix next to the title, e.g. "(optional)"
 *   maxHeightClass  {string}  Tailwind max-height class for the scroll area (default 'max-h-40')
 */
export default function ClientIdList({
  title,
  accent = 'blue',
  ids = [],
  onAdd,
  onRemove,
  search,
  setSearch,
  emptyLabel = 'No client IDs configured',
  searchPlaceholder = 'Search IDs…',
  addPlaceholder = 'Add client ID…',
  note,
  maxHeightClass = 'max-h-40',
}) {
  const a = ACCENT[accent] || ACCENT.blue;
  const [newValue, setNewValue] = React.useState('');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? ids.filter(id => id.toLowerCase().includes(q)) : ids;
  }, [ids, search]);

  const handleAdd = () => {
    const v = newValue.trim();
    if (!v || ids.includes(v)) return;
    onAdd(v);
    setNewValue('');
  };

  return (
    <div className="space-y-2">
      <p className={`text-[10px] ${a.label} font-bold uppercase tracking-wider flex items-center gap-1.5`}>
        {title}
        <span className={`px-1.5 py-0.5 rounded-full text-[9px] ${a.badge}`}>{ids.length}</span>
        {note && <span className="text-gray-500 font-normal normal-case">{note}</span>}
        {search && filtered.length !== ids.length && (
          <span className="text-[9px] text-gray-500 font-normal normal-case">
            {filtered.length} shown
          </span>
        )}
      </p>
      {ids.length > 3 && (
        <div className="relative">
          <Search size={10} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={searchPlaceholder}
            className={`w-full bg-gray-100/60 border border-gray-300/60 rounded-lg pl-7 pr-3 py-1 text-[10px] text-gray-700 font-mono placeholder-gray-400 focus:outline-none ${a.searchFocus}`}
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-500">
              <X size={9} />
            </button>
          )}
        </div>
      )}
      <div className={`${maxHeightClass} overflow-y-auto space-y-1 pr-0.5`}>
        {ids.length === 0 ? (
          <p className="text-[10px] text-gray-500 italic px-1">{emptyLabel}</p>
        ) : filtered.length === 0 ? (
          <p className="text-[10px] text-gray-500 italic px-1">No matches for "{search}"</p>
        ) : (
          filtered.map((id) => (
            <div key={id} className={`flex items-center justify-between ${a.row} border rounded-lg px-2.5 py-1.5`}>
              <span className="font-mono text-[10px] text-gray-700 truncate flex-1">{id}</span>
              <button onClick={() => onRemove(id)} aria-label={`Remove ${id}`} className="text-gray-500 hover:text-red-600 transition-colors flex-shrink-0 ml-2">
                <X size={11} />
              </button>
            </div>
          ))
        )}
      </div>
      <div className="flex gap-1.5">
        <input
          value={newValue}
          onChange={e => setNewValue(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleAdd()}
          placeholder={addPlaceholder}
          className={`flex-1 bg-gray-100 border border-gray-300 rounded-lg px-2.5 py-1 text-[10px] text-gray-700 font-mono placeholder-gray-400 focus:outline-none ${a.addFocus}`}
        />
        <button
          onClick={handleAdd}
          disabled={!newValue.trim()}
          className={`flex items-center gap-0.5 px-2 py-1 text-[10px] rounded-lg border font-medium transition-colors disabled:opacity-40 ${a.addBtn}`}
        >
          <Plus size={9} /> Add
        </button>
      </div>
    </div>
  );
}
