import React, { useState, useEffect } from 'react';
import { ShieldCheck, Plus, X, RefreshCw, AlertTriangle } from 'lucide-react';
import api from '../services/api';

/**
 * CpsAuthPanel
 *
 * Displays and manages the access control list (allowedClientIds / readOnlyClientIds)
 * for a CPS project key.
 *
 * Uses:
 *   GET  /api/cps/auth  — fetch current ACL
 *   POST /api/cps/auth  — update ACL (replace or add)
 *
 * Props:
 *   baseUrl     {string}  CPS server base URL
 *   type        {string}  'non-secure' | 'secure' | 'binaries'
 *   environment {string}  CPS environment prefix
 *   projectKey  {string}  CPS project key
 *   bgOrgId     {string}  Business Group org ID
 */
export default function CpsAuthPanel({ baseUrl, type = 'non-secure', environment, projectKey, bgOrgId }) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [allowedClientIds, setAllowedClientIds] = useState([]);
  const [readOnlyClientIds, setReadOnlyClientIds] = useState([]);
  const [replaceMode, setReplaceMode] = useState(false);
  const [newAllowed, setNewAllowed] = useState('');
  const [newReadOnly, setNewReadOnly] = useState('');

  const canLoad = !!(baseUrl && environment && projectKey);

  const loadAuth = async () => {
    if (!canLoad) return;
    setLoading(true);
    setError('');
    try {
      const res = await api.get('/cps/auth', {
        params: { baseUrl, type, environment, projectKey, bgOrgId },
      });
      const data = res.data;
      const props = Array.isArray(data?.properties) ? data.properties[0]
        : Array.isArray(data?.responses) ? data.responses[0]
        : data;
      setAllowedClientIds(props?.allowedClientIds || []);
      setReadOnlyClientIds(props?.readOnlyClientIds || []);
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to load access control list');
    }
    setLoading(false);
  };

  useEffect(() => {
    if (canLoad) loadAuth();
  }, [baseUrl, type, environment, projectKey, bgOrgId]); // eslint-disable-line react-hooks/exhaustive-deps

  const addId = (list, setList, value, setInput) => {
    const v = value.trim();
    if (!v || list.includes(v)) return;
    setList(prev => [...prev, v]);
    setInput('');
  };

  const removeId = (setList, value) => setList(prev => prev.filter(id => id !== value));

  const handleSave = async () => {
    if (allowedClientIds.length === 0) { setError('allowedClientIds must have at least one entry'); return; }
    setError('');
    setSaving(true);
    try {
      await api.post('/cps/auth', {
        baseUrl, type, environment, projectKey,
        allowedClientIds, readOnlyClientIds,
        replace: replaceMode, bgOrgId,
      });
      setSuccessMsg(`Access control ${replaceMode ? 'replaced' : 'updated'} successfully`);
      setTimeout(() => setSuccessMsg(''), 4000);
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to update access control');
    }
    setSaving(false);
  };

  if (!canLoad) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-3 text-gray-600">
        <ShieldCheck size={32} className="text-gray-700" />
        <p className="text-sm">Select an app to view access control</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h3 className="text-white font-semibold text-sm flex items-center gap-2">
            <ShieldCheck size={14} className="text-cyan-400" />
            Access Control
          </h3>
          <p className="text-gray-500 text-xs mt-0.5">
            Manage which client IDs can access{' '}
            <code className="text-gray-400 bg-gray-800 px-1 rounded">{projectKey}</code>
          </p>
        </div>
        <button
          onClick={loadAuth}
          disabled={loading}
          className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-white bg-gray-800 border border-gray-700 px-3 py-1.5 rounded-lg transition-colors"
        >
          <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {/* Mode toggle */}
      <div className="flex items-center gap-3 bg-gray-800/40 border border-gray-700/50 rounded-xl px-4 py-3">
        <ShieldCheck size={13} className="text-gray-500 flex-shrink-0" />
        <div className="flex-1">
          <p className="text-xs text-gray-300 font-medium">Update Mode</p>
          <p className="text-[10px] text-gray-500 mt-0.5">
            {replaceMode
              ? 'Replace all: existing clientIds NOT in your list will be removed'
              : 'Add to existing: non-destructive — only new IDs are added'}
          </p>
        </div>
        <div className="flex gap-1 bg-gray-700/60 rounded-lg p-0.5 flex-shrink-0">
          {[{ label: 'Add', value: false }, { label: 'Replace', value: true }].map(opt => (
            <button
              key={String(opt.value)}
              onClick={() => setReplaceMode(opt.value)}
              className={`text-[10px] px-2.5 py-1 rounded-md font-medium transition-all ${
                replaceMode === opt.value
                  ? opt.value ? 'bg-red-700 text-white' : 'bg-cyan-700 text-white'
                  : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {replaceMode && (
        <div className="flex items-start gap-2 bg-red-950/20 border border-red-800/40 rounded-lg px-3 py-2">
          <AlertTriangle size={11} className="text-red-400 flex-shrink-0 mt-0.5" />
          <p className="text-[10px] text-red-400/90">
            <strong>Replace mode:</strong> Any clientId currently configured but not in your list below will be removed when you save.
          </p>
        </div>
      )}

      {/* Allowed ClientIds */}
      <div className="space-y-2">
        <p className="text-[10px] text-blue-400 font-bold uppercase tracking-wider flex items-center gap-1.5">
          Allowed ClientIds (read + write)
          <span className="px-1.5 py-0.5 rounded-full text-[9px] bg-blue-500/20">{allowedClientIds.length}</span>
        </p>
        <div className="max-h-40 overflow-y-auto space-y-1 pr-0.5">
          {allowedClientIds.length === 0 ? (
            <p className="text-[10px] text-gray-600 italic px-1">No client IDs configured</p>
          ) : (
            allowedClientIds.map((id) => (
              <div key={id} className="flex items-center justify-between bg-blue-950/20 border border-blue-800/30 rounded-lg px-2.5 py-1.5">
                <span className="font-mono text-[10px] text-gray-200 truncate flex-1">{id}</span>
                <button onClick={() => removeId(setAllowedClientIds, id)} className="text-gray-600 hover:text-red-400 transition-colors flex-shrink-0 ml-2">
                  <X size={11} />
                </button>
              </div>
            ))
          )}
        </div>
        <div className="flex gap-1.5">
          <input
            value={newAllowed}
            onChange={e => setNewAllowed(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addId(allowedClientIds, setAllowedClientIds, newAllowed, setNewAllowed)}
            placeholder="Add client ID…"
            className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-2.5 py-1 text-[10px] text-gray-200 font-mono placeholder-gray-600 focus:outline-none focus:border-blue-600/50"
          />
          <button
            onClick={() => addId(allowedClientIds, setAllowedClientIds, newAllowed, setNewAllowed)}
            disabled={!newAllowed.trim()}
            className="flex items-center gap-0.5 px-2 py-1 text-[10px] rounded-lg border font-medium transition-colors disabled:opacity-40 bg-blue-600/20 border-blue-600/40 text-blue-300 hover:bg-blue-600/30"
          >
            <Plus size={9} /> Add
          </button>
        </div>
      </div>

      {/* Read-Only ClientIds */}
      <div className="space-y-2">
        <p className="text-[10px] text-purple-400 font-bold uppercase tracking-wider flex items-center gap-1.5">
          Read-Only ClientIds
          <span className="px-1.5 py-0.5 rounded-full text-[9px] bg-purple-500/20">{readOnlyClientIds.length}</span>
          <span className="text-gray-600 font-normal normal-case">(optional)</span>
        </p>
        <div className="max-h-32 overflow-y-auto space-y-1 pr-0.5">
          {readOnlyClientIds.length === 0 ? (
            <p className="text-[10px] text-gray-600 italic px-1">No read-only client IDs configured</p>
          ) : (
            readOnlyClientIds.map((id) => (
              <div key={id} className="flex items-center justify-between bg-purple-950/20 border border-purple-800/30 rounded-lg px-2.5 py-1.5">
                <span className="font-mono text-[10px] text-gray-200 truncate flex-1">{id}</span>
                <button onClick={() => removeId(setReadOnlyClientIds, id)} className="text-gray-600 hover:text-red-400 transition-colors flex-shrink-0 ml-2">
                  <X size={11} />
                </button>
              </div>
            ))
          )}
        </div>
        <div className="flex gap-1.5">
          <input
            value={newReadOnly}
            onChange={e => setNewReadOnly(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addId(readOnlyClientIds, setReadOnlyClientIds, newReadOnly, setNewReadOnly)}
            placeholder="Add read-only client ID…"
            className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-2.5 py-1 text-[10px] text-gray-200 font-mono placeholder-gray-600 focus:outline-none focus:border-purple-600/50"
          />
          <button
            onClick={() => addId(readOnlyClientIds, setReadOnlyClientIds, newReadOnly, setNewReadOnly)}
            disabled={!newReadOnly.trim()}
            className="flex items-center gap-0.5 px-2 py-1 text-[10px] rounded-lg border font-medium transition-colors disabled:opacity-40 bg-purple-600/20 border-purple-600/40 text-purple-300 hover:bg-purple-600/30"
          >
            <Plus size={9} /> Add
          </button>
        </div>
      </div>

      {/* Error / Success */}
      {error && (
        <div className="flex items-center gap-2 bg-red-950/30 border border-red-800/50 rounded-lg px-3 py-2 text-red-400 text-xs">
          <AlertTriangle size={11} className="flex-shrink-0" /> {error}
        </div>
      )}
      {successMsg && (
        <div className="flex items-center gap-2 bg-emerald-950/30 border border-emerald-800/50 rounded-lg px-3 py-2 text-emerald-400 text-xs">
          <ShieldCheck size={11} className="flex-shrink-0" /> {successMsg}
        </div>
      )}

      {/* Save / Discard */}
      <div className="flex justify-end gap-3 pt-2 border-t border-gray-800/60">
        <button
          onClick={loadAuth}
          disabled={loading || saving}
          className="px-4 py-2 text-sm text-gray-400 hover:text-white bg-gray-800 hover:bg-gray-700 rounded-lg transition-colors disabled:opacity-50"
        >
          Discard
        </button>
        <button
          onClick={handleSave}
          disabled={saving || allowedClientIds.length === 0}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-cyan-700 hover:bg-cyan-600 text-white rounded-lg disabled:opacity-50 transition-colors"
        >
          {saving
            ? <><RefreshCw size={13} className="animate-spin" /> Saving…</>
            : <><ShieldCheck size={13} /> Save Auth Changes</>}
        </button>
      </div>
    </div>
  );
}