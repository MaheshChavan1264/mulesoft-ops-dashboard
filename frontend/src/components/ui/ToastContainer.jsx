import React from 'react';
import { X, CheckCircle2, XCircle, AlertTriangle, Info } from 'lucide-react';

const ICONS = {
  success: <CheckCircle2 size={15} className="text-emerald-400 flex-shrink-0" />,
  error:   <XCircle     size={15} className="text-red-400 flex-shrink-0" />,
  warning: <AlertTriangle size={14} className="text-yellow-400 flex-shrink-0" />,
  info:    <Info        size={15} className="text-blue-400 flex-shrink-0" />,
};

const STYLES = {
  success: 'bg-emerald-950/80 border-emerald-700/60 text-emerald-200',
  error:   'bg-red-950/80    border-red-700/60    text-red-200',
  warning: 'bg-yellow-950/80 border-yellow-700/60 text-yellow-200',
  info:    'bg-blue-950/80   border-blue-700/60   text-blue-200',
};

/**
 * ToastContainer
 *
 * The fixed bottom-right toast stack UI, extracted out of ToastContext.jsx
 * so the context module only manages state and this module only renders DOM
 * — see FRONTEND_ARCHITECTURE_REVIEW.md finding "ToastContext renders JSX inline".
 *
 * Props:
 *   toasts    {Array<{id, message, type}>}
 *   onDismiss {(id) => void}
 */
export default function ToastContainer({ toasts, onDismiss }) {
  return (
    <div className="fixed bottom-5 right-5 z-[9999] flex flex-col gap-2 items-end pointer-events-none">
      {toasts.map(t => (
        <div
          key={t.id}
          className={`pointer-events-auto flex items-center gap-3 px-4 py-3 rounded-xl border shadow-2xl text-sm max-w-sm animate-in slide-in-from-right duration-300 ${STYLES[t.type] || STYLES.info}`}
        >
          {ICONS[t.type] || ICONS.info}
          <span className="flex-1 leading-snug">{t.message}</span>
          <button
            onClick={() => onDismiss(t.id)}
            className="ml-1 opacity-50 hover:opacity-100 transition-opacity flex-shrink-0"
          >
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}
