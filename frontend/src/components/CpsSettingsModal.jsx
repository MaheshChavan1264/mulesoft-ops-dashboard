import React, { useEffect, useState } from 'react';
import { X, Key, Check, RefreshCw, Eye, EyeOff, AlertTriangle, Shield, Plus, Trash2, Globe } from 'lucide-react';
import api from '../services/api';

/* ── URL-keyed credential row ──────────────────────────────────── */
function UrlCredRow({ url, maskedId, onDelete }) {
  return (
    <div className="flex items-center gap-3 bg-emerald-950/20 border border-emerald-800/30 rounded-xl px-4 py-3">
      <Check size={13} className="text-emerald-400 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-emerald-300 text-xs font-mono truncate">{url}</p>
        <p className="text-emerald-600 text-[10px] mt-0.5">ID: {maskedId}</p>
      </div>
      <button onClick={() => onDelete(url)}
        className="flex-shrink-0 p-1.5 text-slate-600 hover:text-red-400 hover:bg-red-950/40 rounded-lg transition-colors">
        <Trash2 size={13} />
      </button>
    </div>
  );
}

/* ── Add new server form ───────────────────────────────────────── */
function AddServerForm({ prefilledUrl = '', onSaved, onCancel }) {
  const [url, setUrl] = useState(prefilledUrl);
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  const handleSave = async () => {
    if (!url.trim() || !clientId.trim() || !clientSecret.trim()) {
      setError('All three fields are required.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await api.post('/cps/credentials', { credentials: { [url.trim()]: { clientId: clientId.trim(), clientSecret: clientSecret.trim() } } });
      setSaved(true);
      setTimeout(() => { onSaved(); }, 600);
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to save credentials.');
    }
    setSaving(false);
  };

  return (
    <div className="space-y-3 bg-slate-800/40 border border-slate-700/50 rounded-xl p-4">
      <p className="text-slate-300 text-xs font-semibold">Add / Update CPS Server</p>

      <div>
        <label className="block text-[10px] text-slate-500 uppercase tracking-wider mb-1">CPS Base URL</label>
        <input value={url} onChange={(e) => setUrl(e.target.value)}
          placeholder="https://sapi-config-property-pd.bt-integration.api.sfdcbt.net"
          className="w-full bg-slate-900/80 border border-slate-700/60 rounded-lg px-3 py-2 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-blue-600/50 font-mono"
        />
        <p className="text-[10px] text-slate-600 mt-1">Same value as <code className="text-slate-500">cps.configServerBaseUrl</code> in runtime properties</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-[10px] text-slate-500 uppercase tracking-wider mb-1">Client ID</label>
          <input value={clientId} onChange={(e) => setClientId(e.target.value)}
            placeholder="Enter client_id…"
            className="w-full bg-slate-900/80 border border-slate-700/60 rounded-lg px-3 py-2 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-blue-600/50 font-mono"
          />
        </div>
        <div>
          <label className="block text-[10px] text-slate-500 uppercase tracking-wider mb-1">Client Secret</label>
          <div className="relative">
            <input type={showSecret ? 'text' : 'password'} value={clientSecret} onChange={(e) => setClientSecret(e.target.value)}
              placeholder="Enter client_secret…"
              className="w-full bg-slate-900/80 border border-slate-700/60 rounded-lg px-3 py-2 pr-8 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-blue-600/50 font-mono"
            />
            <button type="button" onClick={() => setShowSecret(!showSecret)}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-600 hover:text-slate-300">
              {showSecret ? <EyeOff size={12} /> : <Eye size={12} />}
            </button>
          </div>
        </div>
      </div>

      {error && <p className="text-red-400 text-xs flex items-center gap-1.5"><AlertTriangle size={11} />{error}</p>}

      <div className="flex justify-end gap-2">
        {onCancel && <button onClick={onCancel} className="px-3 py-1.5 text-xs text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors">Cancel</button>}
        <button onClick={handleSave} disabled={saving}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white rounded-lg disabled:opacity-50 transition-colors">
          {saving ? <><RefreshCw size={11} className="animate-spin" /> Saving…</>
            : saved ? <><Check size={11} className="text-emerald-300" /> Saved</>
            : <><Key size={11} /> Save Credentials</>}
        </button>
      </div>
    </div>
  );
}

/* ── Main Modal ────────────────────────────────────────────────── */
export default function CpsSettingsModal({ onClose, prefilledUrl = '' }) {
  const [status, setStatus] = useState({ credentials: {}, byUrl: {} });
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(!!prefilledUrl);
  const [deleting, setDeleting] = useState(null);

  useEffect(() => { loadStatus(); }, []);

  const loadStatus = async () => {
    setLoading(true);
    try {
      const res = await api.get('/cps/credentials');
      setStatus(res.data || { credentials: {}, byUrl: {} });
    } catch { /* ignore */ }
    setLoading(false);
  };

  const handleDelete = async (urlKey) => {
    setDeleting(urlKey);
    try {
      await api.delete(`/cps/credentials/${encodeURIComponent(urlKey)}`);
      await loadStatus();
    } catch { /* ignore */ }
    setDeleting(null);
  };

  const urlEntries = Object.entries(status.byUrl || {});
  const legacyEntries = Object.entries(status.credentials || {});
  const anyLegacyConfigured = legacyEntries.some(([, v]) => v.configured);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-2xl shadow-2xl mx-4 max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800/60">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-blue-950/50 border border-blue-800/40">
              <Globe size={15} className="text-blue-400" />
            </div>
            <div>
              <h2 className="text-white font-semibold text-base">CPS Server Credentials</h2>
              <p className="text-slate-500 text-xs mt-0.5">One credential set per CPS server URL — works across all BGs and environments</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-600 hover:text-slate-300 p-1"><X size={18} /></button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 px-6 py-5 space-y-5">
          {/* Info banner */}
          <div className="bg-blue-950/20 border border-blue-800/30 rounded-xl px-4 py-3 text-xs text-blue-300/80">
            <strong className="text-blue-300">How it works:</strong> Credentials are keyed by the CPS server URL
            (matching <code className="bg-slate-800 px-1 py-0.5 rounded">cps.configServerBaseUrl</code> in runtime properties).
            Different BGs and environments pointing to the same CPS URL share one credential set.
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-8"><RefreshCw size={20} className="animate-spin text-slate-500" /></div>
          ) : (
            <>
              {/* URL-keyed credentials */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <p className="text-slate-300 text-sm font-semibold">Configured CPS Servers</p>
                  <button onClick={() => setShowAddForm(!showAddForm)}
                    className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-blue-600/20 hover:bg-blue-600/30 border border-blue-600/40 text-blue-400 rounded-lg transition-colors">
                    <Plus size={11} /> Add Server
                  </button>
                </div>

                {showAddForm && (
                  <div className="mb-3">
                    <AddServerForm
                      prefilledUrl={prefilledUrl}
                      onSaved={() => { setShowAddForm(false); loadStatus(); }}
                      onCancel={() => setShowAddForm(false)}
                    />
                  </div>
                )}

                {urlEntries.length === 0 && !showAddForm ? (
                  <div className="flex flex-col items-center justify-center py-8 border border-dashed border-slate-700/60 rounded-xl gap-3">
                    <Globe size={28} className="text-slate-700" />
                    <p className="text-slate-500 text-sm">No URL-keyed credentials yet</p>
                    <button onClick={() => setShowAddForm(true)}
                      className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors">
                      <Plus size={11} /> Add CPS Server
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {urlEntries.map(([url, info]) => (
                      <div key={url} className="relative">
                        <UrlCredRow
                          url={url}
                          maskedId={info.maskedId}
                          onDelete={handleDelete}
                        />
                        {deleting === url && (
                          <div className="absolute inset-0 bg-slate-900/80 rounded-xl flex items-center justify-center">
                            <RefreshCw size={14} className="animate-spin text-slate-400" />
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Legacy / env-var credentials (collapsed by default if URL creds exist) */}
              {anyLegacyConfigured && (
                <div className="border-t border-slate-800/60 pt-4">
                  <p className="text-slate-500 text-xs font-semibold uppercase tracking-wider mb-3 flex items-center gap-1.5">
                    <Shield size={11} /> Legacy Credentials (from .env)
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    {legacyEntries.map(([key, info]) => (
                      <div key={key} className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs ${
                        info.configured ? 'bg-emerald-950/20 border-emerald-800/30 text-emerald-400' : 'bg-slate-800/40 border-slate-700/30 text-slate-600'
                      }`}>
                        {info.configured ? <Check size={11} /> : <X size={11} />}
                        <span className="font-mono">{key}</span>
                        {info.configured && <span className="ml-auto text-[9px] opacity-60">{info.source}</span>}
                      </div>
                    ))}
                  </div>
                  <p className="text-slate-600 text-[10px] mt-2">
                    Legacy credentials are used as fallback when no URL-specific credential is found.
                  </p>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-slate-800/60 gap-3">
          <p className="text-slate-600 text-xs">Credentials stored in session only — cleared on logout.</p>
          <button onClick={onClose}
            className="px-4 py-2 text-sm text-white bg-slate-700 hover:bg-slate-600 rounded-lg transition-colors">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}