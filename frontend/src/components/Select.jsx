import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check, Search } from 'lucide-react';

export default function Select({
  value,
  onChange,
  options = [],         // [{ value, label, badge, badgeColor, indent }]
  placeholder = 'Select...',
  searchable = false,
  disabled = false,
  className = ''
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef(null);

  const selected = options.find((o) => o.value === value);

  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const filtered = searchable && query
    ? options.filter((o) => o.label.toLowerCase().includes(query.toLowerCase()))
    : options;

  const handleSelect = (opt) => {
    if (opt.value !== value) onChange(opt.value);
    setOpen(false);
    setQuery('');
  };

  return (
    <div ref={ref} className={`relative ${className}`}>
      {/* Trigger */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(!open)}
        className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg border text-sm transition-colors
          ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:border-gray-400'}
          ${open ? 'border-sf-500 bg-white' : 'border-gray-300 bg-white'}
          text-gray-900`}
      >
        <span className="flex items-center gap-2 min-w-0">
          {selected?.badge && (
            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${selected.badgeColor || 'bg-gray-400'}`} />
          )}
          <span className="truncate">{selected?.label || placeholder}</span>
        </span>
        <ChevronDown size={14} className={`flex-shrink-0 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute z-50 mt-1 w-full min-w-48 bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden">
          {searchable && (
            <div className="px-3 py-2 border-b border-gray-200">
              <div className="flex items-center gap-2">
                <Search size={13} className="text-gray-400 flex-shrink-0" />
                <input
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search..."
                  className="flex-1 bg-transparent text-sm text-gray-900 placeholder-gray-400 focus:outline-none"
                />
              </div>
            </div>
          )}
          <ul className="max-h-64 overflow-y-auto py-1">
            {filtered.length === 0 && (
              <li className="px-4 py-3 text-sm text-gray-400 text-center">No results</li>
            )}
            {filtered.map((opt) => (
              <li key={opt.value}>
                <button
                  type="button"
                  onClick={() => handleSelect(opt)}
                  className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-left transition-colors
                    ${opt.value === value ? 'bg-sf-50 text-sf-700' : 'text-gray-700 hover:bg-gray-100'}
                    ${opt.indent ? 'pl-7' : ''}`}
                >
                  {opt.badge && (
                    <span className={`w-2 h-2 rounded-full flex-shrink-0 ${opt.badgeColor || 'bg-gray-400'}`} />
                  )}
                  <span className="flex-1 truncate">{opt.label}</span>
                  {opt.tag && (
                    <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${opt.tagColor || 'bg-gray-200 text-gray-600'}`}>
                      {opt.tag}
                    </span>
                  )}
                  {opt.value === value && <Check size={13} className="flex-shrink-0 text-sf-600" />}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}