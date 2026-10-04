import React from 'react';
import { AlertTriangle } from 'lucide-react';
import ConfirmActionModal from '../../../components/ui/ConfirmActionModal';
import { ACTION_CONFIG } from '../../../utils/appUtils';

/**
 * ConfirmModal — single-app lifecycle action (start/stop/restart) confirm dialog.
 *
 * Extracted from features/applications/ApplicationsPage.jsx — see
 * FRONTEND_ARCHITECTURE_REVIEW.md §10 folder-structure recommendation.
 */
export default function ConfirmModal({ state, onConfirm, onCancel, loading }) {
  if (!state) return null;
  const { action, app } = state;
  const { Icon, label, bulkCls } = ACTION_CONFIG[action];
  const dangerous = action === 'stop';
  return (
    <ConfirmActionModal
      icon={AlertTriangle}
      accent={dangerous ? 'red' : 'sf'}
      title={`${label} Application?`}
      colorClassName={bulkCls}
      confirmLabel={<><Icon size={13} /> Confirm {label}</>}
      loading={loading}
      onConfirm={onConfirm}
      onCancel={onCancel}
      message={
        <>
          <p className="text-gray-500 dark:text-gray-400 text-sm">
            Are you sure you want to <span className="font-semibold text-gray-900 dark:text-gray-100">{label.toLowerCase()}</span>{' '}
            <span className="font-mono text-sf-700 dark:text-sf-300 text-xs bg-sf-50 dark:bg-sf-500/15 px-1.5 py-0.5 rounded-md">{app.name}</span>?
          </p>
          {dangerous && <p className="text-red-600 dark:text-red-400 text-xs mt-2 font-medium">⚠ This will stop all running flows and connections.</p>}
        </>
      }
    />
  );
}
