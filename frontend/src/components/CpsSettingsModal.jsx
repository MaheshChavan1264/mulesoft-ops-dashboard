import React, { useEffect, useState } from 'react';
import { X, Key, Check, RefreshCw, Eye, EyeOff, AlertTriangle, Shield } from 'lucide-react';
import api from '../services/api';

const CRED_LABELS = {
  ch1_prod: { label: 'CloudHub 1.0 — Production', color: 'text-emerald-400', bg: 'bg-emerald-950/30 border-emerald-800/40' },
  ch2_prod: { label: 'CloudHub 2.0 — Production', color: 'text-blue-400',    bg: 'bg-blue-950/30 border-blue-800/40' },
  ch1_uat:  { label: 'CloudHub 1.0 — UAT / Staging', color: 'text-yellow-400', bg: 'bg-yellow-950/30 border-yellow-800/40' },
  ch2_uat:  { label: 'CloudHub 2.0 — UAT / Staging', color: 'text-purple-400', bg: 'bg-purple-950/30 border-purple-800/40' }
};

function CredRow({ credKey, status, form, onChange, showSecrets, onToggleShow }) {
  const meta = CRED_LABELS[credKey];
  const configured = status?.configured;
  const source = status?.source;

  return (
    <div className={`rounded-xl border p-4 space-y-3 ${meta.bg}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Shield size={13} className={meta.color} />
          <span className={`text-xs font-semibold ${meta.color}`}>{meta.label}</span>
        </div>
        <div className="flex items-center gap-2">
          {configured ? (
            <span className="flex items-center gap-1 text-[10px] text-emerald-400 bg-emerald-950/40 border border-emerald-800/40 px-2 py-0.5 rounded-full">
              <Check size={9} /> {source === 'env' ? 'ENV' : 'Session'}
            </span>
          ) : (
            <span className="text-[10px] text-slate-500 bg-slate-800/60 border border-slate-700/40 px-2 py-0.5 rounded-full">
              Not configured
            </span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-2">
        <div>
          <label className="block text-[10px] text-slate-500 uppercase tracking-wider mb-1">Client ID</label>
          <input
            value={form.clientId}
            onChange={(e) => onChange(credKey, 'clientId', e.target.value)}
            placeholder={configured && source === 'env' ? '(loaded from .env)' : 'Enter client_id…'}
            className="w-full bg-slate-900/80 border border-slate-700/60 rounded-lg px-3 py-2 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-blue-600/50 font-mono"
          />
        </div>
        <div>
          <label className="block text-[10px] text-slate-500 uppercase tracking-wider mb-1">Client Secret</label>
          <div className="relative">
            <input
              type={showSecrets ? 'text' : 'password'}
              value={form.clientSecret}
              onChange={(e) => onChange(credKey, 'clientSecret', e.target.value)}
              placeholder={configured && source === 'env' ? '(loaded from .env)' : 'Enter client_secret…'}
              className="w-full bg-slate-900/80 border border-slate-700/60 rounded-lg px-3 py-2 pr-9 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-blue-600/50 font-mono"
            />
            <button
              type="button"
              onClick={() => onToggleShow(credKey)}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-600 hover:text-slate-300">
              {showSecrets ? <EyeOff size={12} /> : <Eye size={12} />}
            </button>
          </div>
        </div>
      </div>

      {source === 'env' && !form.clientId && (
        <p className="text-[10px] text-slate-600">
          ⚙ Credentials loaded from <code className="text-slate-500">.env</code>. Enter values above to override for this session.
        </p>
      )}
    </div>
  );
}

export default function CpsSettingsModal({ onClose }) {
  const [status, setStatus] = useState({});
  const [forms, setForms] = useState({
    ch1_prod: { clientId: '', clientSecret: '' },
    ch2_prod: { clientId: '', clientSecret: '' },
    ch1_uat:  { clientId: '', clientSecret: '' },
    ch2_uat:  { clientId: '', clientSecret: '' }
  });
  const [showSecrets, setShowSecrets] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    loadStatus();
  }, []);

  const loadStatus = async () => {
    setLoading(true);
    try {
      const res = await api.get('/cps/credentials');
      setStatus(res.data.credentials || {});
    } catch (e) {
      setError('Failed to load credential status.');
    }
    setLoading(false);
  };

  const handleChange = (key, field, value) => {
    setForms((prev) => ({ ...prev, [key]: { ...prev[key], [field]: value } }));
  };

  const handleToggleShow = (key) => {
    setShowSecrets((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      // Only save entries where at least clientId is provided
      const toSave = {};
      for (const [key, form] of Object.entries(forms)) {
        if (form.clientId || form.clientSecret) {
          toSave[key] = form;
        }
      }

      if (Object.keys(toSave).length === 0) {
        setError('Enter at least one client ID to save.');
        setSaving(false);
        return;
      }

      await api.post('/cps/credentials', { credentials: toSave });
      setSaved(true);
      await loadStatus();
      setTimeout(() => setSaved(false), 2500);

      // Clear form fields that were saved
      setForms((prev) => {
        const next = { ...prev };
        for (const key of Object.keys(toSave)) {
          next[key] = { clientId: '', clientSecret: '' };
        }
        return next;
      });
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to save credentials.');
    }
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-2xl shadow-2xl mx-4 max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800/60">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-blue-950/50 border border-blue-800/40">
              <Key size={16} className="text-blue-400" />
            </div>
            <div>
              <h2 className="text-white font-semibold text-base">CPS Credentials</h2>
              <p className="text-slate-500 text-xs mt-0.5">Configure Config Property Server credentials per environment</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-600 hover:text-slate-300 p-1">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 px-6 py-5 space-y-4">
          <div className="bg-blue-950/20 border border-blue-800/30 rounded-xl px-4 py-3 text-xs text-blue-300/80">
            <strong className="text-blue-300">How credentials work:</strong> Values in <code className="bg-slate-800 px-1 py-0.5 rounded">.env</code> are loaded automatically.
            Entering values here overrides them for your current session only (cleared on logout).
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-12">
              <RefreshCw size={20} className="animate-spin text-slate-500" />
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {Object.keys(CRED_LABELS).map((key) => (
                <CredRow
                  key={key}
                  credKey={key}
                  status={status[key]}
                  form={forms[key]}
                  onChange={handleChange}
                  showSecrets={showSecrets[key]}
                  onToggleShow={handleToggleShow}
                />
              ))}
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2 bg-red-950/40 border border-red-800/50 text-red-300 text-xs px-4 py-3 rounded-xl">
              <AlertTriangle size={13} /> {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-slate-800/60 gap-3">
          <p className="text-slate-600 text-xs">
            Credentials are stored in your session and not persisted to disk.
          </p>
          <div className="flex gap-3">
            <button onClick={onClose}
              className="px-4 py-2 text-sm text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors">
              Cancel
            </button>
            <button onClick={handleSave} disabled={saving || loading}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white rounded-lg disabled:opacity-50 transition-colors">
              {saving
                ? <><RefreshCw size={13} className="animate-spin" /> Saving…</>
                : saved
                  ? <><Check size={13} className="text-emerald-300" /> Saved</>
                  : <><Key size={13} /> Save Credentials</>}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}