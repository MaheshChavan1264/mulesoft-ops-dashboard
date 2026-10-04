import React, { useState, useEffect, useCallback } from 'react';
import { ShieldCheck, RefreshCw, AlertTriangle, Code } from 'lucide-react';
import { getCpsAuth, postCpsAuth } from '../../services/cpsService';
import CpsRawJsonModal from './CpsRawJsonModal';
import ErrorBanner from '../../components/ui/ErrorBanner';
import ClientIdList from '../../components/ui/ClientIdList';
import { normaliseCpsUrl } from '../../utils/cpsHelpers';
import { getErrorMessage } from '../../services/http';

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
export default function CpsAuthPanel({ baseUrl, type = 'non-secure', environment, projectKey, bgOrgId, onResult }) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [allowedClientIds, setAllowedClientIds] = useState([]);
  const [readOnlyClientIds, setReadOnlyClientIds] = useState([]);
  const [replaceMode, setReplaceMode] = useState(false);
  const [searchAllowed, setSearchAllowed] = useState('');
  const [searchReadOnly, setSearchReadOnly] = useState('');
  const [showRawJson, setShowRawJson] = useState(false);

  const canLoad = !!(baseUrl && environment && projectKey);

  // useCallback (keyed on the exact fields it reads) instead of a plain
  // function + eslint-disabled effect deps — the effect below can now list
  // `loadAuth` as a real dependency instead of silently masking the
  // stale-closure risk — see FRONTEND_ARCHITECTURE_REVIEW.md §8 Performance
  // Review, finding #6.
  const loadAuth = useCallback(async () => {
    if (!canLoad) return;
    setLoading(true);
    setError('');
    try {
      const res = await getCpsAuth({ baseUrl, type, environment, projectKey, bgOrgId });
      const data = res.data;
      const props = Array.isArray(data?.properties) ? data.properties[0]
        : Array.isArray(data?.responses) ? data.responses[0]
        : data;
      setAllowedClientIds(props?.allowedClientIds || []);
      setReadOnlyClientIds(props?.readOnlyClientIds || []);
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to load access control list'));
    }
    setLoading(false);
  }, [canLoad, baseUrl, type, environment, projectKey, bgOrgId]);

  useEffect(() => {
    if (canLoad) loadAuth();
  }, [canLoad, loadAuth]);

  const addId = (setList, value) => setList(prev => prev.includes(value) ? prev : [...prev, value]);
  const removeId = (setList, value) => setList(prev => prev.filter(id => id !== value));

  const handleSave = async () => {
    if (allowedClientIds.length === 0) { setError('allowedClientIds must have at least one entry'); return; }
    setError('');
    setSaving(true);

    const authPath = { 'non-secure': '/api/v2/properties/non-secure/auth', secure: '/api/v2/properties/secure/auth', binaries: '/api/v2/binaries/secure/auth' };
    const cleanBase = normaliseCpsUrl(baseUrl);
    const suffix = replaceMode ? '' : '/add';
    const fallbackReqDetails = {
      method: 'PUT',
      url: `${cleanBase}${authPath[type] || authPath['non-secure']}${suffix}`,
      body: {
        properties: [{
          environment, key: projectKey, allowedClientIds,
          ...(readOnlyClientIds.length > 0 && { readOnlyClientIds }),
        }],
      },
    };

    try {
      const resp = await postCpsAuth({
        baseUrl, type, environment, projectKey,
        allowedClientIds, readOnlyClientIds,
        replace: replaceMode, bgOrgId,
      });
      const { requestDetails, responseDetails } = resp.data || {};
      onResult?.({
        label: `Update Auth (${replaceMode ? 'Replace' : 'Add'})`,
        timestamp: new Date().toISOString(),
        requestDetails: requestDetails || fallbackReqDetails,
        responseDetails: responseDetails || { status: 200, body: resp.data },
        success: true,
      });
      setSuccessMsg(`Access control ${replaceMode ? 'replaced' : 'updated'} successfully`);
      setTimeout(() => setSuccessMsg(''), 4000);
    } catch (err) {
      const { requestDetails, responseDetails } = err.response?.data || {};
      onResult?.({
        label: `Update Auth (${replaceMode ? 'Replace' : 'Add'})`,
        timestamp: new Date().toISOString(),
        requestDetails: requestDetails || fallbackReqDetails,
        responseDetails: responseDetails || { status: err.response?.status, body: err.response?.data },
        success: false,
      });
      setError(getErrorMessage(err, 'Failed to update access control'));
    }
    setSaving(false);
  };

  if (!canLoad) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-3 text-gray-500">
        <ShieldCheck size={32} className="text-gray-500" />
        <p className="text-sm">Select an app to view access control</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h3 className="text-gray-900 font-semibold text-sm flex items-center gap-2">
            <ShieldCheck size={14} className="text-cyan-600" />
            Access Control
          </h3>
          <p className="text-gray-500 text-xs mt-0.5">
            Manage which client IDs can access{' '}
            <code className="text-gray-500 bg-gray-100 px-1 rounded">{projectKey}</code>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowRawJson(true)}
            className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-cyan-700 bg-gray-100 border border-gray-300 hover:border-cyan-300/50 px-3 py-1.5 rounded-lg transition-colors"
          >
            <Code size={11} /> Raw JSON
          </button>
          <button
            onClick={loadAuth}
            disabled={loading}
            className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-900 bg-gray-100 border border-gray-300 px-3 py-1.5 rounded-lg transition-colors"
          >
            <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* Mode toggle */}
      <div className="flex items-center gap-3 bg-gray-100/40 border border-gray-300/50 rounded-xl px-4 py-3">
        <ShieldCheck size={13} className="text-gray-500 flex-shrink-0" />
        <div className="flex-1">
          <p className="text-xs text-gray-600 font-medium">Update Mode</p>
          <p className="text-[10px] text-gray-500 mt-0.5">
            {replaceMode
              ? 'Replace all: existing clientIds NOT in your list will be removed'
              : 'Add to existing: non-destructive — only new IDs are added'}
          </p>
        </div>
        <div className="flex gap-1 bg-gray-200/60 rounded-lg p-0.5 flex-shrink-0">
          {[{ label: 'Add', value: false }, { label: 'Replace', value: true }].map(opt => (
            <button
              key={String(opt.value)}
              onClick={() => setReplaceMode(opt.value)}
              className={`text-[10px] px-2.5 py-1 rounded-md font-medium transition-all ${
                replaceMode === opt.value
                  ? opt.value ? 'bg-red-700 text-white' : 'bg-cyan-700 text-white'
                  : 'text-gray-500 hover:text-gray-900'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {replaceMode && (
        <div className="flex items-start gap-2 bg-red-50/20 border border-red-200/40 rounded-lg px-3 py-2">
          <AlertTriangle size={11} className="text-red-600 flex-shrink-0 mt-0.5" />
          <p className="text-[10px] text-red-600/90">
            <strong>Replace mode:</strong> Any clientId currently configured but not in your list below will be removed when you save.
          </p>
        </div>
      )}

      {/* Allowed ClientIds */}
      <ClientIdList
        title="Allowed ClientIds (read + write)"
        accent="blue"
        ids={allowedClientIds}
        onAdd={(v) => addId(setAllowedClientIds, v)}
        onRemove={(v) => removeId(setAllowedClientIds, v)}
        search={searchAllowed}
        setSearch={setSearchAllowed}
        emptyLabel="No client IDs configured"
        searchPlaceholder="Search allowed IDs…"
        addPlaceholder="Add client ID…"
        maxHeightClass="max-h-40"
      />

      {/* Read-Only ClientIds */}
      <ClientIdList
        title="Read-Only ClientIds"
        accent="purple"
        ids={readOnlyClientIds}
        onAdd={(v) => addId(setReadOnlyClientIds, v)}
        onRemove={(v) => removeId(setReadOnlyClientIds, v)}
        search={searchReadOnly}
        setSearch={setSearchReadOnly}
        emptyLabel="No read-only client IDs configured"
        searchPlaceholder="Search read-only IDs…"
        addPlaceholder="Add read-only client ID…"
        note="(optional)"
        maxHeightClass="max-h-32"
      />

      {/* Error / Success */}
      <ErrorBanner error={error} variant="inline" size="sm" />
      {successMsg && (
        <div className="flex items-center gap-2 bg-emerald-50/30 border border-emerald-200/50 rounded-lg px-3 py-2 text-emerald-600 text-xs">
          <ShieldCheck size={11} className="flex-shrink-0" /> {successMsg}
        </div>
      )}

      {/* Save / Discard */}
      <div className="flex justify-end gap-3 pt-2 border-t border-gray-200/60">
        <button
          onClick={loadAuth}
          disabled={loading || saving}
          className="px-4 py-2 text-sm text-gray-500 hover:text-gray-900 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors disabled:opacity-50"
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

      {showRawJson && (
        <CpsRawJsonModal
          isOpen={showRawJson}
          onClose={() => setShowRawJson(false)}
          title="Edit Access Control as JSON"
          description="Paste a full Postman auth properties payload."
          initialJson={{
            properties: [
              {
                environment,
                key: projectKey,
                allowedClientIds,
                readOnlyClientIds
              }
            ]
          }}
          onSave={(parsed) => {
            let newAuth = parsed;
            if (parsed.properties && Array.isArray(parsed.properties) && parsed.properties[0]) {
              newAuth = parsed.properties[0];
            }
            if (newAuth.allowedClientIds && Array.isArray(newAuth.allowedClientIds)) {
              setAllowedClientIds(newAuth.allowedClientIds);
            }
            if (newAuth.readOnlyClientIds && Array.isArray(newAuth.readOnlyClientIds)) {
              setReadOnlyClientIds(newAuth.readOnlyClientIds);
            }
            // For auth, replacing everything is generally what they want when editing raw JSON, so force replace mode.
            setReplaceMode(true);
          }}
        />
      )}
    </div>
  );
}