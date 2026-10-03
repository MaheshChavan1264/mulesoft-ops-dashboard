import React, { createContext, useContext, useState, useCallback, useMemo } from 'react';
import ToastContainer from '../components/ui/ToastContainer';

// ─── Context ──────────────────────────────────────────────────────────────────
const ToastContext = createContext(null);

let _nextId = 1;

// ─── Provider ─────────────────────────────────────────────────────────────────
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const dismiss = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  /**
   * Show a toast notification.
   * @param {string} message
   * @param {'success'|'error'|'warning'|'info'} type
   * @param {number} duration  auto-dismiss ms (0 = never auto-dismiss)
   */
  const showToast = useCallback((message, type = 'success', duration = 4000) => {
    const id = _nextId++;
    setToasts(prev => [...prev.slice(-4), { id, message, type }]); // max 5 at once
    if (duration > 0) {
      setTimeout(() => dismiss(id), duration);
    }
    return id;
  }, [dismiss]);

  const value = useMemo(() => ({ showToast, dismiss }), [showToast, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastContainer toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────
export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}
