import React from 'react';
import Modal from './Modal';
import Button from './Button';

/**
 * ConfirmActionModal
 *
 * Generic "confirm a dangerous/important action" dialog. Collapses the 5
 * near-identical confirm-modal implementations (ApplicationsPage's
 * ConfirmModal/BulkConfirmModal, ApplicationDetailPage's AppConfirmModal/
 * SchedulerConfirmModal/ContractConfirmModal — ~500 LOC total) that only
 * differed in icon/color/copy — see FRONTEND_ARCHITECTURE_REVIEW.md §1
 * finding #11.
 *
 * Props:
 *   icon          {Component}  lucide-react icon for the header chip
 *   accent        {string}     color passed through to Modal/Button (default 'red')
 *   title         {ReactNode}
 *   message       {ReactNode}  body content — plain text or richer JSX (e.g. a list)
 *   confirmLabel  {string}     primary button label (default 'Confirm')
 *   cancelLabel   {string}     secondary button label (default 'Cancel')
 *   dangerous     {boolean}    use the red "danger" button variant (default true)
 *   colorClassName {string}    full literal gradient/shadow class string for the
 *                  confirm button, overriding `accent`/`dangerous` (e.g. for
 *                  ACTION_CONFIG's per-action start/stop/restart `bulkCls`)
 *   loading       {boolean}    disables both buttons and shows a spinner on confirm
 *   onConfirm     {function}
 *   onCancel      {function}
 */
export default function ConfirmActionModal({
  icon,
  accent = 'red',
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  dangerous = true,
  colorClassName,
  loading = false,
  onConfirm,
  onCancel,
}) {
  return (
    <Modal
      onClose={onCancel}
      size="sm"
      icon={icon}
      accent={accent}
      title={title}
      closeDisabled={loading}
      footer={
        <div className="flex gap-2.5 ml-auto">
          <Button variant="secondary" size="sm" onClick={onCancel} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button
            variant={dangerous ? 'danger' : 'primary'}
            accent={accent}
            colorClassName={colorClassName}
            size="sm"
            onClick={onConfirm}
            loading={loading}
          >
            {confirmLabel}
          </Button>
        </div>
      }
    >
      {typeof message === 'string'
        ? <p className="text-gray-500 dark:text-gray-400 text-sm">{message}</p>
        : message}
    </Modal>
  );
}
