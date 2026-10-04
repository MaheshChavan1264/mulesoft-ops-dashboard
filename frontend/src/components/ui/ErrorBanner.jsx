import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { getErrorMessage } from '../../services/http';

/**
 * Shared error display.
 *
 * - `variant="panel"` (default): full-width alert box with title/subtitle,
 *   used for page/section load failures. Accepts an axios-style error object.
 * - `variant="inline"`: compact single-line banner used inside forms/modals
 *   (e.g. validation or submit errors). Accepts either a plain string or an
 *   axios-style error object.
 */
export default function ErrorBanner({ error, onRetry, onLogin, className = '', variant = 'panel', size = 'md' }) {
  if (!error) return null;
  const status = error?.response?.status ?? error?.status;
  const isAuth = status === 401 || status === 403;
  const message = typeof error === 'string'
    ? error
    : isAuth
      ? 'Your Anypoint session has expired. Please log in again to continue.'
      : getErrorMessage(error);

  if (variant === 'inline') {
    const pad = size === 'sm' ? 'px-3 py-2 rounded-lg' : 'px-4 py-3 rounded-xl';
    const iconSize = size === 'sm' ? 11 : 12;
    return (
      <div role="alert" className={`flex items-center gap-2 bg-red-50/30 border border-red-200/50 ${pad} text-red-600 text-xs ${className}`}>
        <AlertTriangle size={iconSize} className="flex-shrink-0" />
        <span>{message}</span>
      </div>
    );
  }

  return (
    <div role="alert" className={`flex items-start gap-3 rounded-lg border px-4 py-3 ${isAuth ? 'bg-yellow-100/30 border-yellow-300 text-yellow-700' : 'bg-red-100/30 border-red-300 text-red-700'} ${className}`}>
      <span className="text-lg mt-0.5 shrink-0 select-none" aria-hidden="true">{isAuth ? '🔐' : '⚠️'}</span>
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-sm">{isAuth ? 'Session expired' : 'Failed to load data'}</p>
        <p className="text-xs mt-0.5 opacity-80 break-words">{message}</p>
      </div>
      {isAuth && onLogin && (
        <button onClick={onLogin} className="shrink-0 text-xs font-medium px-3 py-1.5 rounded bg-yellow-700 hover:bg-yellow-600 text-gray-900 transition-colors">Log in again</button>
      )}
      {!isAuth && onRetry && (
        <button onClick={onRetry} className="shrink-0 text-xs font-medium px-3 py-1.5 rounded bg-red-700 hover:bg-red-600 text-gray-900 transition-colors">Retry</button>
      )}
    </div>
  );
}