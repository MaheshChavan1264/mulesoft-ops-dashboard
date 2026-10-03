import React, { useState } from 'react';
import {
  Key, RefreshCw, Save, X, AlertTriangle, ShieldCheck, Trash2,
} from 'lucide-react';
import api from '../../services/api';
import { getErrorMessage } from '../../services/http';
import { usePendingPropertyChanges } from '../../hooks/usePendingPropertyChanges';
import CpsAuthPanel from './CpsAuthPanel';
import { PropertyTable } from './PropertyTable';

// ─────────────────────────────────────────────────────────────────────────────
// SecureGroupEditor — full CRUD + Auth panel for a single CPS secure group
//
// Extracted from pages/CpsManagerPage.jsx — see
// FRONTEND_ARCHITECTURE_REVIEW.md §4 "god component" finding. Used by both
// CpsManagerPage and GlobalCpsManagerPage.
// ─────────────────────────────────────────────────────────────────────────────
export function SecureGroupEditor({ group, baseUrl, environment, bgOrgId, isProd, onResult, onGroupDeleted, globalSearch }) {
  const isAccessDenied = typeof group.properties === 'string';
  const [originalProps, setOriginalProps] = useState(!isAccessDenied ? (group.properties || {}) : {});
  const {
    pendingChanges, setPendingChanges, mergedProps, pendingCount, hasPendingChanges,
    updateProperty, addProperty, markDeleted, discardChanges,
  } = usePendingPropertyChanges(originalProps);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [showAuth, setShowAuth] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  const saveGroup = async () => {
    if (!hasPendingChanges) return;
    setSaving(true);
    setSaveError('');
    const cleanBase = baseUrl.replace(/\/+$/, '').replace(/\/api\/v2\/?$/, '');
    const fallbackReqDetails = {
      method: 'PUT',
      url: `${cleanBase}/api/v2/properties/secure`,
      body: { properties: [{ environment, key: group.key, properties: mergedProps }] },
    };
    try {
      const resp = await api.post('/cps/write', {
        baseUrl, type: 'secure', method: 'PUT',
        environment, projectKey: group.key, properties: mergedProps, bgOrgId,
      });
      const { requestDetails, responseDetails } = resp.data || {};
      onResult?.({
        label: `Save Secure Group (${group.key})`,
        timestamp: new Date().toISOString(),
        requestDetails: requestDetails || fallbackReqDetails,
        responseDetails: responseDetails || { status: 200, body: resp.data },
        success: true,
      });
      setOriginalProps(mergedProps);
      setPendingChanges({ added: {}, modified: {}, deleted: new Set() });
    } catch (err) {
      const { requestDetails, responseDetails } = err.response?.data || {};
      onResult?.({
        label: `Save Secure Group (${group.key})`,
        timestamp: new Date().toISOString(),
        requestDetails: requestDetails || fallbackReqDetails,
        responseDetails: responseDetails || { status: err.response?.status, body: err.response?.data },
        success: false,
      });
      setSaveError(getErrorMessage(err, 'Save failed'));
    }
    setSaving(false);
  };

  const deleteGroup = async () => {
    if (isProd && deleteConfirmText.trim() !== group.key) return;
    setDeleting(true);
    const cleanBase = baseUrl.replace(/\/+$/, '').replace(/\/api\/v2\/?$/, '');
    const fallbackReqDetails = {
      method: 'DELETE',
      url: `${cleanBase}/api/v2/properties/secure`,
      params: { environment, keys: group.key },
    };
    try {
      const resp = await api.delete('/cps/project', {
        data: { baseUrl, type: 'secure', environment, projectKey: group.key, bgOrgId },
      });
      const { requestDetails, responseDetails } = resp.data || {};
      onResult?.({
        label: `Delete Secure Group (${group.key})`,
        timestamp: new Date().toISOString(),
        requestDetails: requestDetails || fallbackReqDetails,
        responseDetails: responseDetails || { status: 200, body: resp.data },
        success: true,
      });
      onGroupDeleted?.(group.key);
    } catch (err) {
      const { requestDetails, responseDetails } = err.response?.data || {};
      onResult?.({
        label: `Delete Secure Group (${group.key})`,
        timestamp: new Date().toISOString(),
        requestDetails: requestDetails || fallbackReqDetails,
        responseDetails: responseDetails || { status: err.response?.status, body: err.response?.data },
        success: false,
      });
    }
    setDeleting(false);
    setShowDeleteConfirm(false);
  };

  return (
    <div className="bg-white dark:bg-gradient-to-b dark:from-gray-800 dark:to-gray-800/90 border border-sforange-200/60 dark:border-sforange-400/20 rounded-2xl shadow-sm dark:shadow-[0_8px_30px_-6px_rgba(0,0,0,0.5)] overflow-hidden">
      {/* Group header */}
      <div className="px-4 py-3 bg-sforange-50/60 dark:bg-sforange-500/[0.06] border-b border-sforange-200/50 dark:border-sforange-400/20 flex items-center gap-2 flex-wrap">
        <button onClick={() => setCollapsed(c => !c)} className="flex items-center gap-2 flex-1 min-w-0">
          <span className="flex items-center justify-center w-6 h-6 rounded-lg bg-sforange-100 dark:bg-sforange-500/15 text-sforange-600 dark:text-sforange-400 flex-shrink-0">
            <Key size={12} />
          </span>
          <span className="text-sforange-700 dark:text-sforange-300 text-xs font-semibold font-mono truncate">{group.key}</span>
          {isAccessDenied && (
            <span className="text-[9px] font-semibold text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10 border border-amber-300/40 dark:border-amber-400/30 px-1.5 py-0.5 rounded-full flex-shrink-0">
              ⚠ Access Denied
            </span>
          )}
          {hasPendingChanges && !collapsed && (
            <span className="text-[9px] font-semibold text-sf-600 dark:text-sf-400 bg-sf-50 dark:bg-sf-500/10 border border-sf-300/40 dark:border-sf-400/30 px-1.5 py-0.5 rounded-full flex-shrink-0">
              {pendingCount} unsaved
            </span>
          )}
        </button>
        {/* Toolbar */}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {hasPendingChanges && (
            <>
              <button onClick={discardChanges} disabled={saving}
                className="flex items-center gap-1 text-[10px] font-medium text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 px-2 py-1 rounded-lg transition-colors disabled:opacity-50">
                <X size={9} /> Discard
              </button>
              <button onClick={saveGroup} disabled={saving}
                className={`flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-lg transition-colors disabled:opacity-50 shadow-sm ${
                  isProd ? 'bg-sfred-600 hover:bg-sfred-500 text-white' : 'bg-sforange-600 hover:bg-sforange-500 text-white'
                }`}>
                {saving ? <><RefreshCw size={9} className="animate-spin" /> Saving…</> : <><Save size={9} /> Save</>}
              </button>
            </>
          )}
          <button
            onClick={() => { setShowAuth(s => !s); setShowDeleteConfirm(false); }}
            className={`flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded-lg border transition-colors ${
              showAuth
                ? 'bg-sf-50 dark:bg-sf-500/10 border-sf-300/60 dark:border-sf-400/30 text-sf-700 dark:text-sf-300'
                : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:text-sf-700 dark:hover:text-sf-300'
            }`}
          >
            <ShieldCheck size={9} /> Auth
          </button>
          <button
            onClick={() => { setShowDeleteConfirm(s => !s); setShowAuth(false); }}
            className={`flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded-lg border transition-colors ${
              showDeleteConfirm
                ? 'bg-sfred-50 dark:bg-sfred-500/10 border-sfred-300/60 dark:border-sfred-400/30 text-sfred-700 dark:text-sfred-300'
                : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:text-sfred-600 dark:hover:text-sfred-400'
            }`}
          >
            <Trash2 size={9} /> Delete Group
          </button>
        </div>
      </div>

      {/* Save error */}
      {saveError && (
        <div className="flex items-center gap-2 bg-sfred-50 dark:bg-sfred-500/10 border-b border-sfred-200/60 dark:border-sfred-400/30 px-4 py-2 text-sfred-700 dark:text-sfred-300 text-xs">
          <AlertTriangle size={11} className="flex-shrink-0" /> {saveError}
        </div>
      )}

      {/* Delete confirmation */}
      {showDeleteConfirm && (
        <div className="px-4 py-3 bg-sfred-50/60 dark:bg-sfred-500/[0.06] border-b border-sfred-200/50 dark:border-sfred-400/20 space-y-2">
          <p className="text-xs text-sfred-700 dark:text-sfred-300 font-medium flex items-center gap-1.5">
            <AlertTriangle size={11} /> Delete entire secure group <code className="bg-sfred-100 dark:bg-sfred-500/15 px-1 rounded">{group.key}</code>?
          </p>
          {isProd ? (
            <div className="flex items-center gap-2">
              <input
                value={deleteConfirmText}
                onChange={e => setDeleteConfirmText(e.target.value)}
                placeholder={`Type "${group.key}" to confirm`}
                className="flex-1 bg-white dark:bg-gray-900/50 border border-sfred-300/60 dark:border-sfred-400/30 rounded-lg px-2.5 py-1 text-xs text-gray-900 dark:text-gray-100 font-mono placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-sfred-500/15"
              />
              <button
                onClick={deleteGroup}
                disabled={deleting || deleteConfirmText.trim() !== group.key}
                className="flex items-center gap-1 text-[10px] font-semibold px-2.5 py-1 bg-sfred-600 hover:bg-sfred-500 text-white rounded-lg disabled:opacity-50 shadow-sm transition-colors"
              >
                {deleting ? <><RefreshCw size={9} className="animate-spin" /> Deleting…</> : <><Trash2 size={9} /> Confirm Delete</>}
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <p className="text-[10px] text-sfred-600/80 dark:text-sfred-400/80 flex-1">This will remove all properties in this group permanently.</p>

              <button
                onClick={deleteGroup}
                disabled={deleting}
                className="flex items-center gap-1 text-[10px] font-semibold px-2.5 py-1 bg-sfred-600 hover:bg-sfred-500 text-white rounded-lg disabled:opacity-50 shadow-sm transition-colors"
              >
                {deleting ? <><RefreshCw size={9} className="animate-spin" /> Deleting…</> : <><Trash2 size={9} /> Delete</>}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Auth panel */}
      {showAuth && (
        <div className="px-4 pt-4 pb-2 border-b border-sforange-200/40 dark:border-sforange-400/20 bg-sforange-50/40 dark:bg-sforange-500/[0.04]">
          <CpsAuthPanel
            baseUrl={baseUrl}
            type="secure"
            environment={environment}
            projectKey={group.key}
            bgOrgId={bgOrgId}
            onResult={onResult}
          />
        </div>
      )}

      {/* Properties */}
      {!collapsed && (
        isAccessDenied ? (
          <div className="px-4 py-5 flex flex-col items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-50 dark:bg-amber-500/10 flex items-center justify-center">
              <AlertTriangle size={18} className="text-amber-500 dark:text-amber-400" />
            </div>
            <p className="text-amber-600/90 dark:text-amber-400/90 text-sm text-center">
              COULD NOT ACCESS — the credential in use does not have permission for this group.
            </p>
            <p className="text-gray-400 dark:text-gray-500 text-xs text-center">
              You can still create a new entry using the form below — existing values will be replaced.
            </p>
            {/* Allow write even when read fails */}
            <div className="w-full mt-2">
              <PropertyTable
                props={mergedProps}
                originalProps={originalProps}
                pendingChanges={pendingChanges}
                search={globalSearch || ''}
                setSearch={() => {}}
                hideSearchInput={true}
                onUpdate={updateProperty}
                onDelete={markDeleted}
                onAdd={addProperty}
                hasPendingChanges={hasPendingChanges}
                pendingCount={pendingCount}
                onSave={saveGroup}
                onDiscard={discardChanges}
                saving={saving}
                isProd={isProd}
                allProps={mergedProps}
                envStr={environment}
                keyStr={group.key}
              />
            </div>
          </div>
        ) : (
          <div className="p-4">
            <PropertyTable
              props={mergedProps}
              originalProps={originalProps}
              pendingChanges={pendingChanges}
              search={globalSearch || ''}
              setSearch={() => {}}
              hideSearchInput={true}
              onUpdate={updateProperty}
              onDelete={markDeleted}
              onAdd={addProperty}
              hasPendingChanges={hasPendingChanges}
              pendingCount={pendingCount}
              onSave={saveGroup}
              onDiscard={discardChanges}
              saving={saving}
              isProd={isProd}
              allProps={mergedProps}
              envStr={environment}
              keyStr={group.key}
            />
          </div>
        )
      )}
    </div>
  );
}

export default SecureGroupEditor;
