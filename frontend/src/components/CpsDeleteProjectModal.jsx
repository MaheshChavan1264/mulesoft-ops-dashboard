import React, { useState } from 'react';
import { X, Trash2, AlertTriangle, RefreshCw } from 'lucide-react';
import api from '../services/api';

/**
 * CpsDeleteProjectModal
 *
 * Confirmation modal for deleting an ENTIRE CPS project entry.
 *
 * ⚠️  DELETE removes all properties for the given projectKey+environment.
 *     There is no per-key deletion in the CPS API.
 *
 * Props:
 *   baseUrl     {string}   CPS server base URL
 *   type        {string}   'non-secure' | 'secure' | 'binaries'
 *   environment {string}   CPS environment prefix
 *   projectKey  {string}   CPS project key to delete
 *   bgOrgId     {string}   Business Group org ID
 *   isProd      {boolean}  Whether this is a production environment
 *   onClose     {function} Called when modal closes
 *   onDeleted   {function} Called after successful deletion
 */
export default function CpsDeleteProjectModal({
  baseUrl,
  type = 'non-secure',
  environment,
  projectKey,
  bgOrgId,
  isProd = false,
  onClose,
  onDeleted,
}) {
  const [confirmText, setConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');

  const confirmRequired = isProd;
  const confirmMatch = !confirmRequired || confirmText.trim() === projectKey;

  const handleDelete = async () => {
    if (!confirmMatch) return;
    setError('');
    setDeleting(true);
    try {
      await api.delete('/cps/project', {
        data: { baseUrl, type, environment, projectKey, bgOrgId },
      });
      onDeleted?.(projectKey);
      onClose();
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to delete CPS project entry');
    }
    setDeleting(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="bg-gray-900 border border-red-800/50 rounded-2xl w-full max-w-md shadow-2xl">
        {/* Header */}
        <div className="flex items-start gap-4 px-6 py-5 border-b border-gray-800">
          <div className="p-2.5 rounded-xl bg-red-950/60 border border-red-800/40 flex-shrink-0">
            <Trash2 size={16} className="text-red-400" />
          </div>
          <div className="flex-1">
            <h3 className="text-white font-semibold text-base">Delete Entire Project Entry?</h3>
            <p className="text-gray-400 text-sm mt-1">
              This will permanently delete <strong>all properties</strong> for:
            </p>
            <div className="mt-2 space-y-1 text-xs">
              <div className="flex items-center gap-2">
                <span className="text-gray-500 w-24">Project Key</span>
                <code className="text-red-300 bg-red-950/30 px-1.5 py-0.5 rounded font-mono">{projectKey}</code>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-gray-500 w-24">Environment</span>
                <code className="text-gray-300 bg-gray-800 px-1.5 py-0.5 rounded font-mono">{environment}</code>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-gray-500 w-24">Type</span>
                <code className="text-gray-300 bg-gray-800 px-1.5 py-0.5 rounded font-mono">{type}</code>
              </div>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-600 hover:text-gray-300 flex-shrink-0">
            <X size={16} />
          </button>
        </div>

        <div className="px-6 py-4 space-y-4">
          {/* Warning banner */}
          <div className="flex items-start gap-2 bg-yellow-950/30 border border-yellow-800/40 rounded-xl px-4 py-3">
            <AlertTriangle size={13} className="text-yellow-400 flex-shrink-0 mt-0.5" />
            <div className="text-xs text-yellow-400/90">
              <p className="font-semibold">This removes the entire project entry — not individual keys.</p>
              <p className="mt-1 text-yellow-500/80">
                To remove a single property, use <strong>Save Changes</strong> with that key deleted from the table instead.
              </p>
            </div>
          </div>

          {/* Production: require typing the project key */}
          {confirmRequired && (
            <div>
              <label className="block text-xs text-gray-400 mb-1.5">
                Type{' '}
                <code className="text-red-300 bg-red-950/30 px-1 rounded">{projectKey}</code>
                {' '}to confirm:
              </label>
              <input
                value={confirmText}
                onChange={e => setConfirmText(e.target.value)}
                placeholder={projectKey}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white font-mono placeholder-gray-600 focus:outline-none focus:border-red-600/50"
              />
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="flex items-center gap-2 bg-red-950/30 border border-red-800/50 rounded-xl px-4 py-3 text-red-400 text-xs">
              <AlertTriangle size={12} className="flex-shrink-0" />
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-800">
          <button
            onClick={onClose}
            disabled={deleting}
            className="px-4 py-2 text-sm text-gray-400 hover:text-white bg-gray-800 hover:bg-gray-700 rounded-lg transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleDelete}
            disabled={deleting || !confirmMatch}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-red-600 hover:bg-red-500 text-white rounded-lg disabled:opacity-50 transition-colors"
          >
            {deleting
              ? <><RefreshCw size={13} className="animate-spin" /> Deleting…</>
              : <><Trash2 size={13} /> Delete Project Entry</>}
          </button>
        </div>
      </div>
    </div>
  );
}