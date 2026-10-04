import React, { useState } from 'react';
import {
  Search, Plus, Trash2, Save, X, Copy, Check, Code, RefreshCw,
} from 'lucide-react';
import TableHeader from '../../components/ui/TableHeader';
import CopyBtn from '../../components/shared/CopyBtn';
import { useCopyToClipboard } from '../../hooks/useCopyToClipboard';
import CpsRawJsonModal from './CpsRawJsonModal';

// ── Feature 9: Property type detection ───────────────────────────────────────
function getValueTypeIcon(val) {
  const v = String(val ?? '').trim();
  if (!v) return null;
  if (/^\$\{.+\}$/.test(v)) return { emoji: '⚡', label: 'Placeholder reference', color: 'text-yellow-500' };
  if (/^https?:\/\//i.test(v)) return { emoji: '🌐', label: 'URL', color: 'text-blue-600' };
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)) return { emoji: '🔑', label: 'UUID', color: 'text-purple-600' };
  if (/^(true|false)$/i.test(v)) return { emoji: v.toLowerCase() === 'true' ? '✅' : '❌', label: 'Boolean', color: 'text-emerald-600' };
  if (/^\d+(\.\d+)?$/.test(v) && v.length < 20) return { emoji: '🔢', label: 'Number', color: 'text-cyan-600' };
  if (/^\s*[\[{]/.test(v)) return { emoji: '📋', label: 'JSON object/array', color: 'text-orange-600' };
  return null;
}

// ── Feature 14: Validation warnings ──────────────────────────────────────────
function getValidationWarning(key, val, allProps) {
  const v = String(val ?? '').trim();
  if (!v && /(\.url|\.host|\.username|\.user|\.endpoint|\.server|\.address)$/i.test(key)) {
    return { msg: 'Empty value for a required-looking property' };
  }
  if (/^\$\{.+\}$/.test(v)) {
    const inner = v.slice(2, -1);
    if (allProps && !(inner in allProps)) {
      return { msg: `Placeholder key "${inner}" not found in this property set` };
    }
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// PropertyTable — inline-editable property table with pending change tracking
//
// Extracted from pages/CpsManagerPage.jsx (where it was exported alongside
// the page component so GlobalCpsManagerPage.jsx could reuse it) — see
// FRONTEND_ARCHITECTURE_REVIEW.md §4 "god component" finding. Used by both
// CpsManagerPage and GlobalCpsManagerPage (via SecureGroupEditor below and
// directly for the non-secure tab).
// ─────────────────────────────────────────────────────────────────────────────
export function PropertyTable({
  props, originalProps, pendingChanges, search, setSearch,
  onUpdate, onDelete, onAdd, onReplaceAll, hasPendingChanges, pendingCount,
  onSave, onDiscard, saving, isProd,
  allProps, // for placeholder resolution + validation (features 9/14/17)
  onUndo, undoCount = 0, // Feature 5: undo stack
  envStr, keyStr, // Passed from parent for Raw JSON full payload structure
  hideSearchInput,
}) {
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');
  const [editingKey, setEditingKey] = useState(null);
  const [editValue, setEditValue] = useState('');
  const [showBulkAdd, setShowBulkAdd] = useState(false);
  const [showRawJson, setShowRawJson] = useState(false);
  const [bulkText, setBulkText] = useState('');
  // Feature 6: copy as formats
  const [showCopyMenu, setShowCopyMenu] = useState(false);
  const [copyDone, copyToClipboard] = useCopyToClipboard(2000);
  // Feature 7: find & replace
  const [showFindReplace, setShowFindReplace] = useState(false);
  const [findText, setFindText] = useState('');
  const [replaceText, setReplaceText] = useState('');

  // Parse bulk text → array of { key, value }
  const parseBulk = (text) => {
    if (!text.trim()) return [];
    // Try JSON first
    try {
      const obj = JSON.parse(text.trim());
      if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
        return Object.entries(obj).map(([k, v]) => ({ key: String(k), value: String(v ?? '') }));
      }
    } catch { /* not JSON, fall through */ }
    // Parse key=value or key: value lines
    return text.split('\n')
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#') && !line.startsWith('//'))
      .map(line => {
        const eqIdx = line.indexOf('=');
        const colIdx = line.indexOf(':');
        let sep = -1;
        if (eqIdx >= 0 && colIdx >= 0) sep = Math.min(eqIdx, colIdx);
        else if (eqIdx >= 0) sep = eqIdx;
        else if (colIdx >= 0) sep = colIdx;
        if (sep <= 0) return null;
        return { key: line.slice(0, sep).trim(), value: line.slice(sep + 1).trim() };
      })
      .filter(Boolean)
      .filter(({ key }) => key.length > 0);
  };

  const bulkParsed = parseBulk(bulkText);

  const applyBulk = () => {
    bulkParsed.forEach(({ key, value }) => onAdd(key, value));
    setBulkText('');
    setShowBulkAdd(false);
  };

  const allEntries = Object.entries(props).sort(([a], [b]) => a.localeCompare(b));
  const filtered = search.trim()
    ? allEntries.filter(([k, v]) => k.toLowerCase().includes(search.toLowerCase()) || String(v).toLowerCase().includes(search.toLowerCase()))
    : allEntries;

  const rowStatus = (key) => {
    if (pendingChanges.deleted.has(key)) return 'deleted';
    if (key in pendingChanges.added) return 'added';
    if (key in pendingChanges.modified) return 'modified';
    return 'unchanged';
  };

  const startEdit = (key, currentValue) => {
    setEditingKey(key);
    setEditValue(String(currentValue));
  };

  const commitEdit = (key) => {
    if (editValue !== String(props[key])) onUpdate(key, editValue);
    setEditingKey(null);
  };

  // ── Feature 6: copy all properties as various formats ─────────────────────
  const copyAs = (format) => {
    const entries = Object.entries(props).sort(([a], [b]) => a.localeCompare(b));
    let text = '';
    if (format === 'json') {
      text = JSON.stringify(Object.fromEntries(entries), null, 2);
    } else if (format === 'properties') {
      text = entries.map(([k, v]) => `${k}=${v}`).join('\n');
    } else if (format === 'yaml') {
      text = entries.map(([k, v]) => {
        const safe = String(v).includes(':') || String(v).includes('#') || String(v).startsWith(' ')
          ? `"${String(v).replace(/"/g, '\\"')}"` : String(v);
        return `${k}: ${safe}`;
      }).join('\n');
    } else if (format === 'env') {
      text = entries.map(([k, v]) => `export ${k.toUpperCase().replace(/\./g, '_')}="${String(v).replace(/"/g, '\\"')}"`).join('\n');
    }
    copyToClipboard(text);
    setShowCopyMenu(false);
  };

  // ── Feature 7: find & replace ─────────────────────────────────────────────
  const findMatches = findText.trim()
    ? Object.keys(props).filter(k => {
        const v = String(props[k] ?? '');
        return v.includes(findText);
      })
    : [];

  const applyFindReplace = () => {
    if (!findText.trim()) return;
    findMatches.forEach(key => {
      const newVal = String(props[key] ?? '').split(findText).join(replaceText);
      onUpdate(key, newVal);
    });
  };

  return (
    <div className="space-y-3">
      {/* Feature 7: Find & Replace panel */}
      {showFindReplace && (
        <div className="bg-white dark:bg-gray-800 border border-sfpurple-200/60 dark:border-sfpurple-400/30 rounded-2xl shadow-sm p-3 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-sfpurple-700 dark:text-sfpurple-300 flex items-center gap-1.5">
              <Search size={11} /> Find & Replace in Values
            </p>
            <button onClick={() => { setShowFindReplace(false); setFindText(''); setReplaceText(''); }}
              className="text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"><X size={13} /></button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div>
              <label className="block text-[9px] text-gray-400 dark:text-gray-500 uppercase tracking-wider font-bold mb-1">Find (in values)</label>
              <input value={findText} onChange={e => setFindText(e.target.value)} placeholder="search string…"
                className="w-full bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded-lg px-2.5 py-1.5 text-xs text-gray-900 dark:text-gray-100 font-mono placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:border-sfpurple-400 focus:ring-2 focus:ring-sfpurple-500/15 transition-all" />
            </div>
            <div>
              <label className="block text-[9px] text-gray-400 dark:text-gray-500 uppercase tracking-wider font-bold mb-1">Replace with</label>
              <input value={replaceText} onChange={e => setReplaceText(e.target.value)} placeholder="replacement…"
                className="w-full bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded-lg px-2.5 py-1.5 text-xs text-gray-900 dark:text-gray-100 font-mono placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:border-sfpurple-400 focus:ring-2 focus:ring-sfpurple-500/15 transition-all" />
            </div>
          </div>
          <div className="flex items-center justify-between">
            <span className={`text-[10px] font-medium ${findMatches.length > 0 ? 'text-sfpurple-700 dark:text-sfpurple-300' : 'text-gray-400 dark:text-gray-500'}`}>
              {findText.trim()
                ? findMatches.length > 0
                  ? `${findMatches.length} value${findMatches.length !== 1 ? 's' : ''} match`
                  : 'No matches'
                : 'Enter search text above'}
            </span>
            <button onClick={applyFindReplace} disabled={findMatches.length === 0 || !findText.trim()}
              className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 bg-sfpurple-600 hover:bg-sfpurple-500 text-white rounded-xl shadow-sm disabled:opacity-40 transition-colors">
              Replace All ({findMatches.length})
            </button>
          </div>
        </div>
      )}

      {/* Search + toolbar row */}
      <div className="flex items-center gap-2 flex-wrap">
        {!hideSearchInput && (
          <div className="relative flex-1 min-w-48">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500 pointer-events-none" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search properties…"
              className="w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl pl-9 pr-9 py-2 text-xs text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 shadow-sm focus:outline-none focus:border-sf-500 dark:focus:border-sf-400 focus:ring-2 focus:ring-sf-500/15 transition-all" />
            {search && (
              <button onClick={() => setSearch('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-200 transition-colors">
                <X size={12} />
              </button>
            )}
          </div>
        )}
        {/* Feature 7: Find & Replace toggle */}
        <button onClick={() => setShowFindReplace(s => !s)}
          className={`flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-xl border transition-all shadow-sm ${
            showFindReplace
              ? 'bg-sfpurple-50 dark:bg-sfpurple-500/10 border-sfpurple-300/60 dark:border-sfpurple-400/30 text-sfpurple-700 dark:text-sfpurple-300'
              : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:text-sfpurple-700 dark:hover:text-sfpurple-300 hover:border-sfpurple-200/70 dark:hover:border-sfpurple-400/30'
          }`}>
          <Search size={11} /> Find & Replace
        </button>
        {/* Feature 6: Copy as formats */}
        <div className="relative">
          <button onClick={() => setShowCopyMenu(s => !s)}
            className={`flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-xl border transition-all shadow-sm ${
              copyDone ? 'bg-emerald-50 dark:bg-emerald-500/10 border-emerald-300/60 dark:border-emerald-400/30 text-emerald-700 dark:text-emerald-300'
              : showCopyMenu ? 'bg-gray-100 dark:bg-gray-700/60 border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200'
              : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200'
            }`}>
            {copyDone ? <><Check size={11} className="text-emerald-600 dark:text-emerald-400" /> Copied!</>
              : <><Copy size={11} /> Copy as…</>}
          </button>
          {showCopyMenu && (
            <div className="absolute right-0 top-full mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-white/10 rounded-2xl shadow-xl shadow-gray-900/10 dark:shadow-black/40 z-30 min-w-40 overflow-hidden">
              {[
                { id: 'json', label: 'JSON', sub: '{ "key": "val" }' },
                { id: 'properties', label: '.properties', sub: 'key=value' },
                { id: 'yaml', label: 'YAML', sub: 'key: value' },
                { id: 'env', label: 'Env Vars', sub: 'export KEY=value' },
              ].map(fmt => (
                <button key={fmt.id} onClick={() => copyAs(fmt.id)}
                  className="w-full text-left px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-white/[0.03] transition-colors group">
                  <p className="text-xs text-gray-700 dark:text-gray-200 font-medium">{fmt.label}</p>
                  <p className="text-[9px] text-gray-400 dark:text-gray-500 font-mono">{fmt.sub}</p>
                </button>
              ))}
            </div>
          )}
        </div>
        {/* Raw JSON Edit toggle */}
        <button
          onClick={() => setShowRawJson(true)}
          className="flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-xl border bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:text-sf-700 dark:hover:text-sf-300 hover:border-sf-200/70 dark:hover:border-sf-400/30 shadow-sm transition-all"
        >
          <Code size={11} /> Raw JSON
        </button>
        {/* Bulk Add toggle */}
        <button
          onClick={() => setShowBulkAdd(s => !s)}
          className={`flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-xl border transition-all shadow-sm ${
            showBulkAdd
              ? 'bg-sfpurple-50 dark:bg-sfpurple-500/10 border-sfpurple-300/60 dark:border-sfpurple-400/30 text-sfpurple-700 dark:text-sfpurple-300'
              : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:text-sfpurple-700 dark:hover:text-sfpurple-300 hover:border-sfpurple-200/70 dark:hover:border-sfpurple-400/30'
          }`}
        >
          <Plus size={11} /> Bulk Add
        </button>
        {hasPendingChanges && (
          <>
            {undoCount > 0 && onUndo && (
              <button onClick={onUndo} disabled={saving} title={`Undo (${undoCount} steps) — Ctrl+Z`}
                className="flex items-center gap-1.5 text-xs font-medium text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 px-3 py-2 rounded-xl shadow-sm disabled:opacity-50 transition-all">
                ↩ Undo ({undoCount})
              </button>
            )}
            <button onClick={onDiscard} disabled={saving}
              className="flex items-center gap-1.5 text-xs font-medium text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 px-3 py-2 rounded-xl shadow-sm disabled:opacity-50 transition-all">
              <X size={11} /> Discard
            </button>
            <button onClick={onSave} disabled={saving}
              className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-xl disabled:opacity-50 shadow-md transition-all ${
                isProd ? 'bg-sfred-600 hover:bg-sfred-500 text-white shadow-sfred-500/25' : 'bg-gradient-to-r from-sf-600 to-sfteal-600 hover:from-sf-500 hover:to-sfteal-500 text-white shadow-sf-500/25'
              }`}>
              {saving
                ? <><RefreshCw size={11} className="animate-spin" /> Saving…</>
                : <><Save size={11} /> Save ({pendingCount} change{pendingCount !== 1 ? 's' : ''})</>}
            </button>
          </>
        )}
      </div>

      {/* Bulk Add panel */}
      {showBulkAdd && (
        <div className="bg-white dark:bg-gray-800 border border-sfpurple-200/60 dark:border-sfpurple-400/30 rounded-2xl shadow-sm p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-sfpurple-700 dark:text-sfpurple-300">Bulk Add Properties</p>
            <button onClick={() => { setShowBulkAdd(false); setBulkText(''); }}
              className="text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-200 transition-colors">
              <X size={13} />
            </button>
          </div>
          <p className="text-[10px] text-gray-400 dark:text-gray-500 leading-relaxed">
            Paste <code className="text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-700/60 px-1 rounded">key=value</code> lines (one per line),
            or a <code className="text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-700/60 px-1 rounded">{'{"key":"value"}'}</code> JSON object.
            Lines starting with <code className="text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-700/60 px-1 rounded">#</code> are ignored.
          </p>
          <textarea
            value={bulkText}
            onChange={e => setBulkText(e.target.value)}
            placeholder={`# Paste key=value pairs or JSON\ndb.host=localhost\ndb.port=5432\ndb.name=myapp\n\n# Or paste JSON:\n# { "db.host": "localhost", "db.port": "5432" }`}
            rows={8}
            className="w-full bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2 text-xs text-gray-700 dark:text-gray-300 font-mono placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:border-sfpurple-400 focus:ring-2 focus:ring-sfpurple-500/15 resize-y min-h-[120px] transition-all"
          />
          <div className="flex items-center justify-between">
            <span className={`text-[10px] font-medium ${bulkParsed.length > 0 ? 'text-sfpurple-700 dark:text-sfpurple-300' : 'text-gray-400 dark:text-gray-500'}`}>
              {bulkText.trim()
                ? bulkParsed.length > 0
                  ? `✓ ${bulkParsed.length} propert${bulkParsed.length === 1 ? 'y' : 'ies'} parsed`
                  : '⚠ Could not parse — check format'
                : 'Paste content above to preview'}
            </span>
            <div className="flex items-center gap-2">
              {/* Preview parsed entries */}
              {bulkParsed.length > 0 && bulkParsed.length <= 5 && (
                <span className="text-[9px] text-gray-400 dark:text-gray-500 font-mono truncate max-w-48">
                  {bulkParsed.slice(0, 3).map(e => e.key).join(', ')}{bulkParsed.length > 3 ? ', …' : ''}
                </span>
              )}
              <button
                onClick={applyBulk}
                disabled={bulkParsed.length === 0}
                className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 bg-sfpurple-600 hover:bg-sfpurple-500 text-white rounded-xl shadow-sm disabled:opacity-40 transition-colors"
              >
                <Plus size={11} /> Add {bulkParsed.length > 0 ? `${bulkParsed.length} ` : ''}Properties
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Property table */}
      <div className="card-surface overflow-hidden">
        <table className="w-full text-sm border-collapse">
          <TableHeader>
            <tr className="text-gray-400 dark:text-gray-500 text-[10px] uppercase tracking-wider font-bold">
              <th className="text-left px-4 py-2.5 w-[45%]">Property Key</th>
              <th className="text-left px-4 py-2.5">Value</th>
              <th className="px-3 py-2.5 w-16 text-center">Actions</th>
            </tr>
          </TableHeader>
          <tbody>
            {filtered.map(([key, value]) => {
              const status = rowStatus(key);
              const isDeleted = status === 'deleted';
              const isAdded = status === 'added';
              const isModified = status === 'modified';
              const isEditing = editingKey === key;
              return (
                <tr key={key}
                  className={`group border-t border-gray-100 dark:border-white/[0.06] transition-colors ${
                    isDeleted ? 'opacity-40 bg-sfred-50/40 dark:bg-sfred-500/[0.04]' :
                    isAdded ? 'bg-emerald-50/40 dark:bg-emerald-500/[0.04] border-l-2 border-l-emerald-600' :
                    isModified ? 'bg-sf-50/40 dark:bg-sf-500/[0.04] border-l-2 border-l-sf-600' :
                    'hover:bg-gray-50 dark:hover:bg-white/[0.02]'
                  }`}>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-1.5">
                      {isAdded && <span className="text-[8px] text-emerald-700 dark:text-emerald-300 bg-emerald-100 dark:bg-emerald-500/15 px-1 py-0.5 rounded font-bold">NEW</span>}
                      {isModified && <span className="text-[8px] text-sf-700 dark:text-sf-300 bg-sf-100 dark:bg-sf-500/15 px-1 py-0.5 rounded font-bold">MOD</span>}
                      {isDeleted && <span className="text-[8px] text-sfred-700 dark:text-sfred-300 bg-sfred-100 dark:bg-sfred-500/15 px-1 py-0.5 rounded font-bold">DEL</span>}
                      <span className={`font-mono text-xs ${isDeleted ? 'line-through text-gray-400 dark:text-gray-500' : 'text-gray-600 dark:text-gray-300'}`}>{key}</span>
                      <CopyBtn text={key} size={10} hoverColor="sf" padding="p-0.5" />
                    </div>
                  </td>
                  <td className="px-4 py-2.5">
                    {isEditing ? (
                      <input
                        autoFocus
                        value={editValue}
                        onChange={e => setEditValue(e.target.value)}
                        onBlur={() => commitEdit(key)}
                        onKeyDown={e => { if (e.key === 'Enter') commitEdit(key); if (e.key === 'Escape') setEditingKey(null); }}
                        className="w-full bg-white dark:bg-gray-900/60 border border-sf-300/60 dark:border-sf-400/40 rounded-lg px-2 py-1 text-xs text-gray-900 dark:text-gray-100 font-mono focus:outline-none focus:ring-2 focus:ring-sf-500/15"
                      />
                    ) : (
                      <div className="space-y-0.5">
                        {/* Feature 9+14: type icon + validation warning + value + copy */}
                        <div className="flex items-center gap-1.5 group/val cursor-text" onClick={() => !isDeleted && startEdit(key, value)}>
                          {!isDeleted && (() => {
                            const typeInfo = getValueTypeIcon(value);
                            return typeInfo ? (
                              <span title={typeInfo.label} className={`text-[10px] flex-shrink-0 leading-none ${typeInfo.color}`}>{typeInfo.emoji}</span>
                            ) : null;
                          })()}
                          {!isDeleted && (() => {
                            const warn = getValidationWarning(key, value, allProps || props);
                            return warn ? (
                              <span title={warn.msg} className="text-amber-500 dark:text-amber-400 flex-shrink-0 cursor-help text-[10px] leading-none" aria-label={warn.msg}>⚠</span>
                            ) : null;
                          })()}
                          <span className={`font-mono text-xs break-all leading-relaxed ${isDeleted ? 'line-through text-gray-400 dark:text-gray-500' : 'text-gray-700 dark:text-gray-300'}`}>
                            {String(value) || <span className="text-gray-400 dark:text-gray-500 italic">empty</span>}
                          </span>
                          <CopyBtn text={String(value)} />
                        </div>
                        {/* Feature 17: placeholder resolution preview */}
                        {!isEditing && !isDeleted && /^\$\{.+\}$/.test(String(value)) && (() => {
                          const inner = String(value).slice(2, -1);
                          const resolved = (allProps || props)?.[inner];
                          return resolved ? (
                            <p className="text-[9px] text-gray-400 dark:text-gray-500 font-mono pl-0.5">
                              <span className="text-gray-400 dark:text-gray-500">→ </span>
                              {String(resolved).substring(0, 80)}{String(resolved).length > 80 ? '…' : ''}
                            </p>
                          ) : null;
                        })()}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    {!isDeleted ? (
                      <button onClick={() => onDelete(key)}
                        className="opacity-0 group-hover:opacity-100 p-1.5 rounded text-gray-400 dark:text-gray-500 hover:text-sfred-600 dark:hover:text-sfred-400 hover:bg-sfred-50 dark:hover:bg-sfred-500/10 transition-all">
                        <Trash2 size={12} />
                      </button>
                    ) : (
                      <button onClick={() => onUpdate(key, originalProps[key] ?? props[key])}
                        className="text-[9px] font-medium text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 px-1.5 py-0.5 border border-gray-200 dark:border-gray-700 rounded transition-colors">
                        Undo
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}

            {/* Add new property row */}
            <tr className="border-t border-gray-100 dark:border-white/[0.06] bg-emerald-50/20 dark:bg-emerald-500/[0.03]">
              <td className="px-4 py-2.5">
                <input
                  value={newKey}
                  onChange={e => setNewKey(e.target.value)}
                  placeholder="new.property.key"
                  className="w-full bg-white dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded-lg px-2.5 py-1 text-xs text-gray-700 dark:text-gray-300 font-mono placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-500/15 transition-all"
                />
              </td>
              <td className="px-4 py-2.5">
                <input
                  value={newValue}
                  onChange={e => setNewValue(e.target.value)}
                  placeholder="value"
                  onKeyDown={e => { if (e.key === 'Enter' && newKey.trim()) { onAdd(newKey, newValue); setNewKey(''); setNewValue(''); } }}
                  className="w-full bg-white dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded-lg px-2.5 py-1 text-xs text-gray-700 dark:text-gray-300 font-mono placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-500/15 transition-all"
                />
              </td>
              <td className="px-3 py-2.5 text-center">
                <button
                  onClick={() => { if (newKey.trim()) { onAdd(newKey, newValue); setNewKey(''); setNewValue(''); } }}
                  disabled={!newKey.trim()}
                  className="flex items-center gap-0.5 text-[10px] font-semibold px-2 py-1 bg-emerald-100 dark:bg-emerald-500/15 border border-emerald-300/40 dark:border-emerald-400/30 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-200 dark:hover:bg-emerald-500/25 rounded-lg transition-colors disabled:opacity-40 mx-auto"
                >
                  <Plus size={10} /> Add
                </button>
              </td>
            </tr>
          </tbody>
        </table>
        {filtered.length === 0 && (
          <div className="px-4 py-8 text-center text-gray-400 dark:text-gray-500 text-xs">
            {search ? `No properties match "${search}"` : 'No properties loaded'}
          </div>
        )}
      </div>
      <p className="text-[10px] text-gray-400 dark:text-gray-500 text-right">
        {filtered.length} of {allEntries.length} properties shown
        {hasPendingChanges && <span className="ml-2 text-sf-600 dark:text-sf-400 font-medium">{pendingCount} unsaved change{pendingCount !== 1 ? 's' : ''}</span>}
      </p>

      {/* Raw JSON Modal */}
      {showRawJson && (
        <CpsRawJsonModal
          isOpen={showRawJson}
          onClose={() => setShowRawJson(false)}
          title="Edit Properties as JSON"
          description="Paste a full Postman properties payload. Your changes will be diffed and added to pending changes."
          initialJson={{
            properties: [
              {
                environment: envStr || '',
                key: keyStr || '',
                properties: props
              }
            ]
          }}
          onSave={(parsed) => {
            let newProps = parsed;
            if (parsed.properties && Array.isArray(parsed.properties) && parsed.properties[0]?.properties) {
              newProps = parsed.properties[0].properties;
            }
            const newPending = { added: {}, modified: {}, deleted: new Set() };
            for (const k of Object.keys(originalProps)) {
              if (!(k in newProps)) {
                newPending.deleted.add(k);
              } else if (String(newProps[k]) !== String(originalProps[k])) {
                newPending.modified[k] = String(newProps[k]);
              }
            }
            for (const k of Object.keys(newProps)) {
              if (!(k in originalProps)) {
                newPending.added[k] = String(newProps[k]);
              }
            }

            if (onReplaceAll) {
              onReplaceAll(newPending);
            } else {
              newPending.deleted.forEach(k => onDelete(k));
              Object.entries(newPending.modified).forEach(([k, v]) => onUpdate(k, v));
              Object.entries(newPending.added).forEach(([k, v]) => onAdd(k, v));
            }
          }}
        />
      )}
    </div>
  );
}

export default PropertyTable;
