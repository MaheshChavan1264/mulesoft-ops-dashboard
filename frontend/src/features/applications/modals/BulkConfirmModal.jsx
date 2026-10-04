import React from 'react';
import { AlertTriangle } from 'lucide-react';
import Modal from '../../../components/ui/Modal';
import Button from '../../../components/ui/Button';
import { ACTION_CONFIG, ENV_BADGE } from '../../../utils/appUtils';

/**
 * BulkConfirmModal — multi-app lifecycle action confirm dialog, with
 * per-app success/failure indicators once the bulk action has run.
 *
 * Extracted from features/applications/ApplicationsPage.jsx — see
 * FRONTEND_ARCHITECTURE_REVIEW.md §10 folder-structure recommendation.
 */
export default function BulkConfirmModal({ state, onConfirm, onCancel, loading, results }) {
  if (!state) return null;
  const { action, apps } = state;
  const { Icon, label, bulkCls } = ACTION_CONFIG[action];
  const dangerous = action === 'stop';
  const isDone = !!results;

  return (
    <Modal
      onClose={onCancel}
      size="lg"
      icon={AlertTriangle}
      accent={dangerous ? 'red' : 'sf'}
      title={isDone ? 'Results' : `${label} ${apps.length} Application${apps.length !== 1 ? 's' : ''}?`}
      closeDisabled={loading}
      footer={
        <div className="flex justify-end gap-3 ml-auto">
          <Button variant="secondary" size="sm" onClick={onCancel} disabled={loading}>
            {isDone ? 'Close' : 'Cancel'}
          </Button>
          {!isDone && (
            <Button colorClassName={bulkCls} size="sm" icon={Icon} onClick={onConfirm} loading={loading}>
              {loading ? 'Working…' : `${label} All ${apps.length}`}
            </Button>
          )}
        </div>
      }
    >
      {!isDone && (
        <p className="text-gray-500 dark:text-gray-400 text-sm">
          This will <span className="text-gray-900 dark:text-gray-100 font-semibold">{label.toLowerCase()}</span> the following applications:
        </p>
      )}
      {dangerous && !isDone && (
        <p className="text-red-600 dark:text-red-400 text-xs font-medium">⚠ This will stop all running flows and connections for each app.</p>
      )}

      {/* App list with per-app result indicators */}
      <div className="max-h-52 overflow-y-auto space-y-1.5 pr-1">
        {apps.map((app) => {
          const r = results?.[app.id];
          return (
            <div key={app.id} className="flex items-center justify-between bg-gray-50 dark:bg-gray-900/40 border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2.5 gap-2">
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <span className={`w-2 h-2 rounded-full flex-shrink-0 ring-2 ring-white dark:ring-gray-800 ${ENV_BADGE[app.environment?.type] || 'bg-gray-400'}`} />
                <span className="text-gray-700 dark:text-gray-300 text-xs font-semibold truncate">{app.name}</span>
                <span className="text-gray-400 dark:text-gray-500 text-xs flex-shrink-0 hidden sm:inline">({app.environment?.name})</span>
              </div>
              <div className="flex-shrink-0">
                {r ? (
                  r.success
                    ? <span className="text-emerald-600 dark:text-emerald-400 text-xs font-semibold">✓ Done</span>
                    : <span className="text-red-600 dark:text-red-400 text-xs font-semibold" title={r.error}>✗ Failed</span>
                ) : loading ? (
                  <span className="animate-spin rounded-full h-3 w-3 border-b-2 border-sf-400 block" />
                ) : (
                  <span className="text-gray-400 dark:text-gray-500 text-xs">Pending</span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Summary when done */}
      {isDone && (
        <div className="flex gap-3 text-xs">
          <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
            ✓ {Object.values(results).filter((r) => r.success).length} succeeded
          </span>
          {Object.values(results).filter((r) => !r.success).length > 0 && (
            <span className="text-red-600 dark:text-red-400 font-semibold">
              ✗ {Object.values(results).filter((r) => !r.success).length} failed
            </span>
          )}
        </div>
      )}
    </Modal>
  );
}
