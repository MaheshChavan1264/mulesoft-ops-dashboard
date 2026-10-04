import React, { useState } from 'react';
import { Trash2, AlertTriangle } from 'lucide-react';
import { deleteCpsProject } from '../../services/cpsService';
import ErrorBanner from '../../components/ui/ErrorBanner';
import { normaliseCpsUrl } from '../../utils/cpsHelpers';
import Modal from '../../components/ui/Modal';
import Button from '../../components/ui/Button';
import { getErrorMessage } from '../../services/http';

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
  onResult,
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

    const pathMap = { 'non-secure': '/api/v2/properties/non-secure', secure: '/api/v2/properties/secure', binaries: '/api/v2/binaries/secure' };
    const cleanBase = normaliseCpsUrl(baseUrl);
    const fallbackReqDetails = {
      method: 'DELETE',
      url: `${cleanBase}${pathMap[type] || pathMap['non-secure']}`,
      params: { environment, keys: projectKey },
    };

    try {
      const resp = await deleteCpsProject({ baseUrl, type, environment, projectKey, bgOrgId });
      const { requestDetails, responseDetails } = resp.data || {};
      onResult?.({
        label: 'Delete Project',
        timestamp: new Date().toISOString(),
        requestDetails: requestDetails || fallbackReqDetails,
        responseDetails: responseDetails || { status: 200, body: resp.data },
        success: true,
      });
      onDeleted?.(projectKey);
      onClose();
    } catch (err) {
      const { requestDetails, responseDetails } = err.response?.data || {};
      onResult?.({
        label: 'Delete Project',
        timestamp: new Date().toISOString(),
        requestDetails: requestDetails || fallbackReqDetails,
        responseDetails: responseDetails || { status: err.response?.status, body: err.response?.data },
        success: false,
      });
      setError(getErrorMessage(err, 'Failed to delete CPS project entry'));
    }
    setDeleting(false);
  };

  return (
    <Modal
      onClose={onClose}
      size="sm"
      icon={Trash2}
      accent="red"
      title="Delete Entire Project Entry?"
      closeDisabled={deleting}
      footer={
        <div className="flex justify-end gap-3 ml-auto">
          <Button variant="secondary" size="sm" onClick={onClose} disabled={deleting}>
            Cancel
          </Button>
          <Button
            variant="danger"
            size="sm"
            icon={Trash2}
            onClick={handleDelete}
            disabled={!confirmMatch}
            loading={deleting}
          >
            {deleting ? 'Deleting…' : 'Delete Project Entry'}
          </Button>
        </div>
      }
    >
      <p className="text-gray-500 dark:text-gray-400 text-sm">
        This will permanently delete <strong>all properties</strong> for:
      </p>
      <div className="space-y-1 text-xs">
        <div className="flex items-center gap-2">
          <span className="text-gray-500 dark:text-gray-400 w-24">Project Key</span>
          <code className="text-red-700 dark:text-red-400 bg-red-50/30 dark:bg-red-500/10 px-1.5 py-0.5 rounded font-mono">{projectKey}</code>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-gray-500 dark:text-gray-400 w-24">Environment</span>
          <code className="text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-700/50 px-1.5 py-0.5 rounded font-mono">{environment}</code>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-gray-500 dark:text-gray-400 w-24">Type</span>
          <code className="text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-700/50 px-1.5 py-0.5 rounded font-mono">{type}</code>
        </div>
      </div>

      {/* Warning banner */}
      <div className="flex items-start gap-2 bg-yellow-50/30 dark:bg-yellow-500/10 border border-yellow-200/40 dark:border-yellow-400/30 rounded-xl px-4 py-3">
        <AlertTriangle size={13} className="text-yellow-600 dark:text-yellow-400 flex-shrink-0 mt-0.5" />
        <div className="text-xs text-yellow-600/90 dark:text-yellow-300/90">
          <p className="font-semibold">This removes the entire project entry — not individual keys.</p>
          <p className="mt-1 text-yellow-500/80 dark:text-yellow-400/70">
            To remove a single property, use <strong>Save Changes</strong> with that key deleted from the table instead.
          </p>
        </div>
      </div>

      {/* Production: require typing the project key */}
      {confirmRequired && (
        <div>
          <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1.5">
            Type{' '}
            <code className="text-red-700 dark:text-red-400 bg-red-50/30 dark:bg-red-500/10 px-1 rounded">{projectKey}</code>
            {' '}to confirm:
          </label>
          <input
            value={confirmText}
            onChange={e => setConfirmText(e.target.value)}
            placeholder={projectKey}
            className="w-full bg-gray-100 dark:bg-gray-900/60 border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-gray-100 font-mono placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:border-red-300/50 dark:focus:border-red-400/40"
          />
        </div>
      )}

      {/* Error */}
      <ErrorBanner error={error} variant="inline" />
    </Modal>
  );
}